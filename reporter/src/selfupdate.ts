// agentctl updating itself, when the owner presses "Auto-update all PCs" (api/src/handlers/agentctl.ts).
// The heartbeat sends the SHA-256 of the agentctl.js it runs. When the answer offers an update,
// it downloads agentctl.js from the same site, checks the hash and that the file runs, swaps it
// in, and runs `install --after-update`: that refreshes the hooks, stops this heartbeat and starts
// the new one. Each request is tried once; the result goes back with the next heartbeats.
// `agentctl install --no-auto-update` turns it off.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { AgentctlState, AgentctlUpdateAttempt, HeartbeatResponse } from '@agent-manager-delux/shared';
import type { Config } from './config';
import { logLine, readJsonFile, writeJsonFile } from './files';
import { paths } from './paths';

export type UpdateOffer = NonNullable<HeartbeatResponse['update']>;

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The hash of an agentctl.js file, or null when it can't be read. */
export function fileSha256(file: string): string | null {
  try {
    return sha256(readFileSync(file));
  } catch {
    return null;
  }
}

export function lastAttempt(): AgentctlUpdateAttempt | null {
  return readJsonFile<AgentctlUpdateAttempt>(paths.update());
}

function record(attempt: AgentctlUpdateAttempt) {
  writeJsonFile(paths.update(), attempt);
}

/** What the heartbeat tells the manager about this agentctl. */
export function agentctlState(config: Config, runningSha: string): AgentctlState {
  const update = lastAttempt();
  return { sha256: runningSha, autoUpdate: config.autoUpdate !== false, ...(update ? { update } : {}) };
}

/**
 * Called when a heartbeat starts: an update that got as far as restarting is done once the
 * heartbeat runs the agentctl it was updating to.
 */
export function settleAttempt(runningSha: string) {
  const a = lastAttempt();
  if (a?.status !== 'updating') return;
  if (a.sha256 === runningSha) {
    record({ ...a, status: 'updated', at: new Date().toISOString() });
    logLine(`self-update: now running ${runningSha.slice(0, 12)}`);
  } else if (Date.now() - Date.parse(a.at) > 10 * 60_000) {
    record({ ...a, status: 'failed', at: new Date().toISOString(), error: 'The new agentctl was installed but the heartbeat still runs the old one' });
  }
}

/** Whether to act on an offer: self-updates on, not tried yet, and from the configured site. */
export function shouldUpdate(config: Config, offer: UpdateOffer | undefined, runningSha: string): offer is UpdateOffer {
  if (!offer || config.autoUpdate === false || offer.sha256 === runningSha) return false;
  const tried = lastAttempt();
  if (tried && tried.requestedAt === offer.requestedAt && tried.sha256 === offer.sha256) return false;
  // Only ever download from the site this PC reports to.
  return offer.url === `${config.url}/agentctl.js`;
}

/** Downloads, checks and installs the offered agentctl. Never throws: failures are recorded. */
export async function selfUpdate(offer: UpdateOffer, opts: { restart?: boolean } = {}): Promise<AgentctlUpdateAttempt> {
  const base = { requestedAt: offer.requestedAt, sha256: offer.sha256 };
  const target = paths.script();
  const fresh = `${target}.new`;
  record({ ...base, status: 'updating', at: new Date().toISOString() });
  logLine(`self-update: downloading ${offer.url}`);
  try {
    const res = await fetch(offer.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const got = sha256(bytes);
    if (got !== offer.sha256) throw new Error(`The downloaded agentctl.js hashes to ${got.slice(0, 12)}, not ${offer.sha256.slice(0, 12)}: not installed`);

    writeFileSync(fresh, bytes);
    const check = spawnSync(process.execPath, [fresh, 'version'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    if (check.status !== 0 || !check.stdout.startsWith('agentctl')) {
      throw new Error(`The new agentctl.js didn't run: ${(check.stderr || check.stdout || String(check.error ?? '')).trim().slice(0, 200)}`);
    }
    if (existsSync(target)) copyFileSync(target, `${target}.bak`);
    renameSync(fresh, target);
    logLine(`self-update: installed ${offer.sha256.slice(0, 12)}; reinstalling hooks and restarting the heartbeat`);
    if (opts.restart !== false) {
      // install stops this heartbeat (it's in daemon.json) and starts the new one.
      spawn(process.execPath, [target, 'install', '--after-update'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
    return lastAttempt() ?? { ...base, status: 'updating', at: new Date().toISOString() };
  } catch (e) {
    try {
      unlinkSync(fresh);
    } catch {
      // Never written.
    }
    const failed: AgentctlUpdateAttempt = { ...base, status: 'failed', at: new Date().toISOString(), error: (e as Error).message.slice(0, 300) };
    record(failed);
    logLine(`self-update failed: ${failed.error}`);
    return failed;
  }
}
