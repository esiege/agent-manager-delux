import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config';
import { paths } from '../src/paths';
import { agentctlState, lastAttempt, selfUpdate, settleAttempt, sha256, shouldUpdate, type UpdateOffer } from '../src/selfupdate';

const OLD = Buffer.from('#!/usr/bin/env node\nconsole.log("agentctl, old");\n');
const NEW = Buffer.from('#!/usr/bin/env node\nconsole.log("agentctl, new");\n');
let server: Server;
let base: string;
let served: Buffer;
let config: Config;

beforeEach(async () => {
  process.env.AGENT_MANAGER_HOME = mkdtempSync(join(tmpdir(), 'agentctl-update-'));
  writeFileSync(paths.script(), OLD);
  served = NEW;
  server = createServer((req, res) => {
    if (req.url !== '/agentctl.js') return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(served);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config = { url: base, key: 'k', machine: 'pc' };
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  delete process.env.AGENT_MANAGER_HOME;
});

const offer = (over: Partial<UpdateOffer> = {}): UpdateOffer => ({
  requestedAt: '2026-11-16T12:00:00.000Z',
  sha256: sha256(NEW),
  url: `${base}/agentctl.js`,
  ...over,
});

describe('shouldUpdate', () => {
  it('acts on an offer from its own site, once, unless turned off or already current', () => {
    expect(shouldUpdate(config, offer(), sha256(OLD))).toBe(true);
    expect(shouldUpdate(config, undefined, sha256(OLD))).toBe(false);
    expect(shouldUpdate(config, offer(), sha256(NEW))).toBe(false);
    expect(shouldUpdate({ ...config, autoUpdate: false }, offer(), sha256(OLD))).toBe(false);
    expect(shouldUpdate(config, offer({ url: 'https://elsewhere.example/agentctl.js' }), sha256(OLD))).toBe(false);
  });
});

describe('selfUpdate', () => {
  it('installs the offered agentctl, keeps a backup, and settles once the new one runs', async () => {
    const result = await selfUpdate(offer(), { restart: false });
    expect(result.status).toBe('updating');
    expect(readFileSync(paths.script())).toEqual(NEW);
    expect(readFileSync(`${paths.script()}.bak`)).toEqual(OLD);
    expect(shouldUpdate(config, offer(), sha256(OLD))).toBe(false); // tried this request

    settleAttempt(sha256(NEW));
    expect(lastAttempt()?.status).toBe('updated');
    expect(agentctlState(config, sha256(NEW))).toMatchObject({ sha256: sha256(NEW), autoUpdate: true, update: { status: 'updated' } });
  });

  it('refuses a download whose hash differs, and leaves agentctl alone', async () => {
    served = Buffer.from('console.log("agentctl, tampered")');
    const result = await selfUpdate(offer(), { restart: false });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/hashes to/);
    expect(readFileSync(paths.script())).toEqual(OLD);
    expect(existsSync(`${paths.script()}.new`)).toBe(false);
  });

  it("refuses a file that doesn't run", async () => {
    served = Buffer.from('this is not javascript (');
    const result = await selfUpdate(offer({ sha256: sha256(served) }), { restart: false });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/didn't run/);
    expect(readFileSync(paths.script())).toEqual(OLD);
  });
});
