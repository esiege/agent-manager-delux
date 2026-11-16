import { beforeEach, describe, expect, it } from 'vitest';
import {
  OWNER_WRITE_HEADER,
  type AgentctlStatusResponse,
  type AgentctlUpdateResponse,
  type CreateKeyResponse,
  type HeartbeatResponse,
} from '@agent-manager-delux/shared';
import { resetAuthState } from '../src/auth';
import { agentctlStatus, requestAgentctlUpdate } from '../src/handlers/agentctl';
import { heartbeat } from '../src/handlers/ingest';
import { createKey } from '../src/handlers/keys';
import { guarded, type Ctx, type Handler, type Req } from '../src/http';
import { MemoryStore } from '../src/store/memory';

const OWNER = 'owner@example.com';
const LATEST = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
let clock: Date;
let ctx: Ctx;
let key: string;

function call(handler: Handler, method: string, path: string, opts: { body?: unknown; key?: string; owner?: boolean } = {}) {
  const headers = new Headers({ host: 'manager.test', 'x-forwarded-proto': 'https' });
  if (opts.key) headers.set('x-agent-manager-key', opts.key);
  if (opts.owner) {
    headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ identityProvider: 'github', userDetails: OWNER })).toString('base64'));
    if (method === 'POST') headers.set(OWNER_WRITE_HEADER, '1');
  }
  const req: Req = { method, url: `https://manager.test${path}`, headers, body: opts.body === undefined ? '' : JSON.stringify(opts.body) };
  return guarded(handler, () => {})(req, ctx);
}

const beat = async (agentctl?: Record<string, unknown>, machine = 'pc-studio') => {
  const res = await call(heartbeat, 'POST', '/api/v1/heartbeat', {
    key,
    body: { machine, kind: 'claude-code', agentIds: [], ...(agentctl ? { agentctl } : {}) },
  });
  expect(res.status).toBe(200);
  return res.body as HeartbeatResponse;
};
const status = async () => (await call(agentctlStatus, 'GET', '/api/v1/agentctl', { owner: true })).body as AgentctlStatusResponse;
const pressUpdate = () => call(requestAgentctlUpdate, 'POST', '/api/v1/agentctl/update', { owner: true });

beforeEach(async () => {
  resetAuthState();
  clock = new Date('2026-11-16T12:00:00Z');
  ctx = { store: new MemoryStore(undefined, () => clock), now: () => clock, env: { OWNER_LOGINS: OWNER, AGENTCTL_SHA256: LATEST } };
  const res = await call(createKey, 'POST', '/api/v1/keys', { owner: true, body: { name: 'pc-studio' } });
  key = (res.body as CreateKeyResponse).secret;
});

describe('updating agentctl on every PC', () => {
  it('lists each PC with the agentctl it runs', async () => {
    await beat({ sha256: OLD, autoUpdate: true });
    await beat({ sha256: LATEST, autoUpdate: true }, 'pc-laptop');
    await beat(); // an older agentctl that doesn't say: not listed
    const s = await status();
    expect(s.latest).toBe(LATEST);
    expect(s.request).toBeNull();
    expect(s.machines.map((m) => [m.machine, m.upToDate])).toEqual([
      ['pc-studio', false],
      ['pc-laptop', true],
    ]);
  });

  it('offers nothing until the owner asks', async () => {
    expect((await beat({ sha256: OLD, autoUpdate: true })).update).toBeUndefined();
  });

  it('offers the deployed agentctl to PCs running another, once per request', async () => {
    const res = await pressUpdate();
    expect(res.status).toBe(200);
    const { request } = res.body as AgentctlUpdateResponse;
    expect(request).toEqual({ requestedAt: clock.toISOString(), sha256: LATEST, by: OWNER });

    expect((await beat({ sha256: OLD, autoUpdate: true })).update).toEqual({
      requestedAt: request.requestedAt,
      sha256: LATEST,
      url: 'https://manager.test/agentctl.js',
    });
    // Up to date, turned off, or already tried this request: nothing.
    expect((await beat({ sha256: LATEST, autoUpdate: true })).update).toBeUndefined();
    expect((await beat({ sha256: OLD, autoUpdate: false })).update).toBeUndefined();
    const tried = { requestedAt: request.requestedAt, sha256: LATEST, status: 'failed', at: clock.toISOString(), error: 'hash mismatch' };
    expect((await beat({ sha256: OLD, autoUpdate: true, update: tried })).update).toBeUndefined();
    expect((await status()).machines[0]?.agentctl.update).toEqual(tried);

    // Pressing again retries.
    clock = new Date(clock.getTime() + 60_000);
    await pressUpdate();
    expect((await beat({ sha256: OLD, autoUpdate: true, update: tried })).update?.requestedAt).toBe(clock.toISOString());
  });

  it('offers nothing once a newer deploy replaced the agentctl the owner asked for', async () => {
    await pressUpdate();
    ctx.env.AGENTCTL_SHA256 = 'c'.repeat(64);
    expect((await beat({ sha256: OLD, autoUpdate: true })).update).toBeUndefined();
  });

  it('needs the owner, and a build with an agentctl', async () => {
    expect((await call(requestAgentctlUpdate, 'POST', '/api/v1/agentctl/update', { key })).status).toBe(401);
    delete ctx.env.AGENTCTL_SHA256;
    expect((await pressUpdate()).status).toBe(409);
  });

  it('refuses a malformed agentctl state', async () => {
    const res = await call(heartbeat, 'POST', '/api/v1/heartbeat', {
      key,
      body: { machine: 'pc', kind: 'claude-code', agentIds: [], agentctl: { sha256: 'nope' } },
    });
    expect(res.status).toBe(400);
  });
});
