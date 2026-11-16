// Crashes of the games we build, as records of their own (the Crashes tab, agentctl crashes).
// They arrive three ways:
//   - straight from Unreal's CrashReportClient, whose DataRouterUrl points at
//     POST /api/v1/perf/crash/unreal/<game key> (unrealCrash.ts reads the upload);
//   - as JSON, from the game or a tool: POST /api/v1/perf/crash;
//   - from the next launch, as `crash` on POST /api/v1/perf/session (handlers/perf.ts).
// A crash with a session marks that session crashed. One session has at most one crash: a second
// report for it (the crash reporter, then the next launch) fills in what the first lacked.
// A new crash that isn't a test run puts a Feedback item in front of the owner: what were you doing?

import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  PERF_MAX_DAYS,
  PERF_RUN_KINDS,
  maskDeep,
  maskSecrets,
  validateCrash,
  type CrashDetailResponse,
  type CrashesResponse,
  type CrashInput,
  type CrashRecord,
  type CrashResponse,
  type CrashSource,
  type MachineNamesResponse,
  type PerfRunKind,
} from '@agent-manager-delux/shared';
import { requireKey, requireOwnerOrKey, requireOwnerWrite } from '../auth';
import { HttpError, fail, ok, publicOrigin, query, readJson, type Ctx, type Handler, type Req } from '../http';
import { UnrealCrashError, readUnrealCrash, scrub, summarizeUnrealCrash } from '../unrealCrash';
import { askAboutCrash, crashAnswer } from './feedback';

const DEFAULT_DAYS = 30;
const MAX_CRASHES = 1000;

export function crashPage(origin: string, id: string): string {
  return `${origin}/crashes/crash?id=${encodeURIComponent(id)}`;
}

const text = (s: string | null | undefined) => (s ? scrub(s) : null);

/**
 * Stores a crash, links it to its session, and asks the owner about it when it's new. A crash
 * for a session that already has one adds to that one instead.
 */
export async function recordCrash(
  ctx: Ctx,
  input: CrashInput,
  source: CrashSource,
  keyName: string,
  origin: string,
): Promise<{ crash: CrashRecord; added: boolean }> {
  const now = ctx.now().toISOString();
  const session = input.sessionId ? await ctx.store.getPerfSession(input.sessionId) : null;
  const existing = session?.crash?.crashId ? await ctx.store.getCrash(session.crash.crashId) : null;
  const kind: PerfRunKind = input.kind ?? session?.kind ?? 'play';

  const incoming = {
    reason: scrub(input.reason),
    callstack: text(input.callstack),
    log: text(input.log),
    breadcrumbs: (input.breadcrumbs ?? []).map(scrub),
    t: input.t ?? null,
    scene: input.scene ?? null,
  };
  const crash: CrashRecord = existing
    ? {
        ...existing,
        // Keep what the first report had; fill in what it lacked. A generic "didn't exit cleanly" gives way to a real reason.
        reason: /^Did not exit cleanly/i.test(existing.reason) ? incoming.reason : existing.reason,
        callstack: existing.callstack ?? incoming.callstack,
        log: existing.log ?? incoming.log,
        breadcrumbs: existing.breadcrumbs.length ? existing.breadcrumbs : incoming.breadcrumbs,
        t: existing.t ?? incoming.t,
        scene: existing.scene ?? incoming.scene,
        platform: existing.platform ?? input.platform ?? session?.platform ?? null,
        details: { ...maskDeep(input.details ?? {}), ...existing.details },
      }
    : {
        id: randomUUID(),
        game: session?.game ?? input.game,
        machine: session?.machine ?? input.machine,
        build: input.build ?? session?.build ?? null,
        sessionId: input.sessionId ?? null,
        at: input.at ?? session?.lastSeen ?? now,
        reportedAt: now,
        ...incoming,
        platform: input.platform ?? session?.platform ?? null,
        source,
        kind,
        details: maskDeep(input.details ?? {}),
        feedbackId: null,
        keyName,
      };
  if (input.test) return { crash, added: !existing };

  if (!existing && kind !== 'test') {
    const names = await ctx.store.getMachineNames();
    const feedback = await askAboutCrash(ctx, crash, origin, names[crash.machine] ?? null);
    crash.feedbackId = feedback.id;
  }
  await ctx.store.putCrash(crash);

  if (session) {
    // The run ended when it was last heard from; the crash is reported later.
    await ctx.store.putPerfSession({
      ...session,
      endedAt: session.endedAt ?? session.lastSeen,
      crash: {
        reason: crash.reason,
        ...(crash.callstack ? { callstack: crash.callstack } : {}),
        ...(crash.t !== null ? { t: crash.t } : {}),
        ...(crash.scene ? { scene: crash.scene } : {}),
        reportedAt: session.crash?.reportedAt ?? now,
        crashId: crash.id,
      },
    });
  }
  return { crash, added: !existing };
}

/** POST /api/v1/perf/crash: a crash as JSON, with a game key. */
export const postCrash: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx, 'perf');
  const result = validateCrash(readJson(req, LIMITS.perfBytes));
  if (!result.ok) return fail(400, result.error);
  const origin = publicOrigin(req, ctx.env);
  const { crash, added } = await recordCrash(ctx, result.value, 'api', key.name, origin);
  const body: CrashResponse = { ok: true, test: Boolean(result.value.test), stored: crash, warnings: result.warnings, crashUrl: crashPage(origin, crash.id) };
  return ok(body, added ? 201 : 200);
};

/**
 * POST /api/v1/perf/crash/unreal/<game key>: Unreal's CrashReportClient, sending as soon as the
 * game crashes. The key is in the path because the crash reporter can't send headers, and it
 * adds its own query string to the URL.
 */
export const unrealCrash: Handler = async (req, ctx) => {
  const secret = decodeURIComponent(new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '');
  const headers = new Headers(req.headers);
  headers.set('x-agent-manager-key', secret);
  const key = await requireKey({ ...req, headers }, ctx, 'perf');

  const raw = req.raw ?? Buffer.from(req.body, 'utf8');
  if (raw.length === 0) throw new HttpError(400, 'The body is empty: this is where Unreal crash reports are uploaded');
  if (raw.length > LIMITS.crashUploadBytes) throw new HttpError(413, `The crash report is ${raw.length} bytes; the limit is ${LIMITS.crashUploadBytes}`);
  let summary;
  try {
    summary = summarizeUnrealCrash(readUnrealCrash(raw));
  } catch (e) {
    if (e instanceof UnrealCrashError) throw new HttpError(400, e.message);
    throw e;
  }
  const params = query(req);
  const kind = (PERF_RUN_KINDS as readonly string[]).includes(summary.kind ?? '') ? (summary.kind as PerfRunKind) : undefined;
  const input: CrashInput = {
    game: summary.game || params.get('AppID') || 'unknown game',
    machine: summary.machine || 'unknown machine',
    build: summary.build ?? params.get('AppVersion'),
    sessionId: summary.sessionId,
    reason: summary.reason,
    breadcrumbs: summary.breadcrumbs,
    platform: summary.platform,
    details: summary.details,
    ...(summary.callstack ? { callstack: summary.callstack } : {}),
    ...(summary.log ? { log: summary.log } : {}),
    ...(summary.t !== null ? { t: summary.t } : {}),
    ...(summary.scene ? { scene: summary.scene } : {}),
    ...(kind ? { kind } : {}),
  };
  const origin = publicOrigin(req, ctx.env);
  const { crash } = await recordCrash(ctx, input, 'crash-reporter', key.name, origin);
  return ok({ ok: true, id: crash.id, crashUrl: crashPage(origin, crash.id) });
};

function readDays(req: Req): number {
  const raw = query(req).get('days');
  const days = raw === null ? DEFAULT_DAYS : Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > PERF_MAX_DAYS) throw new HttpError(400, `days must be a whole number from 1 to ${PERF_MAX_DAYS}`);
  return days;
}

/** GET /api/v1/perf/crashes?days=&game=&machine=&tests=1, as the owner or with a machine key. */
export const listCrashes: Handler = async (req, ctx) => {
  await requireOwnerOrKey(req, ctx);
  const days = readDays(req);
  const q = query(req);
  const game = q.get('game')?.trim().toLowerCase();
  const machine = q.get('machine')?.trim().toLowerCase();
  const tests = q.get('tests') === '1' || q.get('tests') === 'true';
  const now = ctx.now();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const names = await ctx.store.getMachineNames();
  const found = (await ctx.store.listCrashes(since, MAX_CRASHES + 1)).filter(
    (c) =>
      (tests || c.kind !== 'test') &&
      (!game || c.game.toLowerCase() === game) &&
      (!machine || c.machine.toLowerCase() === machine || names[c.machine]?.toLowerCase() === machine),
  );
  const body: CrashesResponse = { now: now.toISOString(), days, crashes: found.slice(0, MAX_CRASHES), machineNames: names, truncated: found.length > MAX_CRASHES };
  return ok(body);
};

/** GET /api/v1/perf/crash?id=, as the owner or with a machine key. */
export const crashDetail: Handler = async (req, ctx) => {
  await requireOwnerOrKey(req, ctx);
  const id = query(req).get('id');
  if (!id) throw new HttpError(400, 'id is required, for example /api/v1/perf/crash?id=<crash id>');
  const crash = await ctx.store.getCrash(id);
  if (!crash) throw new HttpError(404, `No crash ${id}`);
  const feedback = crash.feedbackId ? await ctx.store.getFeedback(crash.feedbackId) : null;
  const body: CrashDetailResponse = {
    now: ctx.now().toISOString(),
    crash,
    machineNames: await ctx.store.getMachineNames(),
    answer: crashAnswer(feedback),
  };
  return ok(body);
};

/** GET /api/v1/machine-names, as the owner or with a machine key. */
export const machineNames: Handler = async (req, ctx) => {
  await requireOwnerOrKey(req, ctx);
  const body: MachineNamesResponse = { names: await ctx.store.getMachineNames() };
  return ok(body);
};

/** POST /api/v1/machine-names {machine, name}: the owner names a machine; an empty name clears it. */
export const setMachineName: Handler = async (req, ctx) => {
  requireOwnerWrite(req, ctx);
  const raw = readJson(req, 4096) as Record<string, unknown> | null;
  const machine = raw?.machine;
  const name = raw?.name;
  if (typeof machine !== 'string' || !machine.trim() || machine.length > LIMITS.nameLength) throw new HttpError(400, 'machine is required: the machine as games and agents report it');
  if (name !== null && name !== undefined && typeof name !== 'string') throw new HttpError(400, 'name must be a string, or null to clear it');
  const nickname = typeof name === 'string' ? maskSecrets(name.trim()) : '';
  if (nickname.length > LIMITS.machineNameLength) throw new HttpError(400, `name is longer than ${LIMITS.machineNameLength} characters`);
  const names = await ctx.store.getMachineNames();
  if (nickname) names[machine.trim()] = nickname;
  else delete names[machine.trim()];
  await ctx.store.putMachineNames(names);
  const body: MachineNamesResponse = { names };
  return ok(body);
};
