import { deflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  OWNER_WRITE_HEADER,
  type CrashDetailResponse,
  type CrashesResponse,
  type CrashResponse,
  type CreateKeyResponse,
  type FeedbackListResponse,
  type MachineNamesResponse,
  type PerfSessionDetailResponse,
  type PerfSessionsResponse,
} from '@agent-manager-delux/shared';
import { resetAuthState } from '../src/auth';
import { crashDetail, listCrashes, machineNames, postCrash, setMachineName, unrealCrash } from '../src/handlers/crashes';
import { feedbackList } from '../src/handlers/feedback';
import { createKey } from '../src/handlers/keys';
import { perfSamples, perfSession, perfSessionDetail, perfSessions } from '../src/handlers/perf';
import { guarded, type Ctx, type Handler, type Req } from '../src/http';
import { MemoryStore } from '../src/store/memory';

const OWNER = 'owner@example.com';
const SESSION = '0b9c1c1e-6f0a-4c56-9a53-2f8f4d1f7a10';
let clock: Date;
let ctx: Ctx;
let key: string;

function call(handler: Handler, method: string, path: string, opts: { body?: unknown; raw?: Buffer; key?: string; owner?: boolean } = {}) {
  const headers = new Headers({ host: 'manager.test', 'x-forwarded-proto': 'https' });
  if (opts.key) headers.set('x-agent-manager-key', opts.key);
  if (opts.owner) {
    headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ identityProvider: 'github', userDetails: OWNER })).toString('base64'));
    if (method === 'POST') headers.set(OWNER_WRITE_HEADER, '1');
  }
  const body = opts.raw ? opts.raw.toString('latin1') : opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req: Req = { method, url: `https://manager.test${path}`, headers, body, ...(opts.raw ? { raw: opts.raw } : {}) };
  return guarded(handler, () => {})(req, ctx);
}

const owner = <T>(handler: Handler, path: string) => call(handler, 'GET', path, { owner: true }).then((r) => r.body as T);
const startSession = (body: Record<string, unknown> = {}) =>
  call(perfSession, 'POST', '/api/v1/perf/session', { key, body: { sessionId: SESSION, game: 'TwistedVanworld', machine: 'pc-0dc004594da2', build: '0.19.0', ...body } });
const session = () => owner<PerfSessionDetailResponse>(perfSessionDetail, `/api/v1/perf/session?id=${SESSION}`).then((r) => r.session);
const crashes = (q = '') => owner<CrashesResponse>(listCrashes, `/api/v1/perf/crashes${q}`);
const feedback = () => owner<FeedbackListResponse>(feedbackList, '/api/v1/feedback');

/** An upload in the format Unreal's CrashReportClient sends. */
function unrealUpload(files: Record<string, string>): Buffer {
  const i32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n);
    return b;
  };
  const fstring = (s: string) => Buffer.concat([i32(s.length + 1), Buffer.from(`${s}\0`, 'latin1')]);
  const parts = [fstring('UECC-Windows-ABC'), fstring('UECC-Windows-ABC_0000'), i32(0), i32(Object.keys(files).length)];
  Object.entries(files).forEach(([name, text], i) => {
    const data = Buffer.from(text, 'utf8');
    parts.push(i32(i), fstring(name), i32(data.length), data);
  });
  return deflateSync(Buffer.concat(parts));
}

const CONTEXT = `<?xml version="1.0" encoding="UTF-8"?>
<FGenericCrashContext>
  <RuntimeProperties>
    <CrashType>Crash</CrashType>
    <ErrorMessage>Unhandled Exception: EXCEPTION_ACCESS_VIOLATION reading address 0x00000000</ErrorMessage>
    <CallStack>TwistedVanworld!AVan::Tick() [C:\\Users\\esieg\\proj\\Van.cpp:120]
TwistedVanworld!FActorTickFunction::ExecuteTick()</CallStack>
    <GameName>UE5-TwistedVanworld</GameName>
    <BuildVersion>++UE5+Release-5.4</BuildVersion>
    <EngineVersion>5.4.4-0+++UE5+Release-5.4</EngineVersion>
    <SecondsSinceStart>481</SecondsSinceStart>
    <PlatformNameIni>Windows</PlatformNameIni>
  </RuntimeProperties>
  <GameData>
    <AMGame>TwistedVanworld</AMGame>
    <AMMachine>pc-0dc004594da2</AMMachine>
    <AMBuild>0.19.0</AMBuild>
    <AMSessionId>${SESSION}</AMSessionId>
    <AMScene>match</AMScene>
    <AMBreadcrumbs>Loaded level forest | Match started | Opened map</AMBreadcrumbs>
  </GameData>
</FGenericCrashContext>`;

beforeEach(async () => {
  resetAuthState();
  clock = new Date('2026-11-16T20:00:00Z');
  ctx = { store: new MemoryStore(undefined, () => clock), now: () => clock, env: { OWNER_LOGINS: OWNER } };
  key = ((await call(createKey, 'POST', '/api/v1/keys', { owner: true, body: { name: 'TwistedVanworld', scope: 'perf' } })).body as CreateKeyResponse).secret;
});

describe('crashes from Unreal’s crash reporter', () => {
  it('reads the upload, marks the session crashed and asks what you were doing', async () => {
    await startSession();
    await call(perfSamples, 'POST', '/api/v1/perf/samples', { key, body: { sessionId: SESSION, samples: [{ t: 10, seconds: 10, frames: 600, scene: 'match' }] } });
    clock = new Date(clock.getTime() + 5_000);
    const upload = unrealUpload({
      'CrashContext.runtime-xml': CONTEXT,
      'TwistedVanworld.log': 'LogInit: started\nLogPath: C:\\Users\\esieg\\AppData\\Local\nLogVan: about to crash\n',
      'UEMinidump.dmp': 'MDMP....',
    });
    const res = await call(unrealCrash, 'POST', `/api/v1/perf/crash/unreal/${encodeURIComponent(key)}?AppID=CrashReporter&UploadType=crashreports`, { raw: upload });
    expect(res.status).toBe(200);

    const { crashes: list } = await crashes();
    expect(list).toHaveLength(1);
    const c = list[0]!;
    expect(c).toMatchObject({
      game: 'TwistedVanworld',
      machine: 'pc-0dc004594da2',
      build: '0.19.0',
      sessionId: SESSION,
      reason: 'Unhandled Exception: EXCEPTION_ACCESS_VIOLATION reading address 0x00000000',
      breadcrumbs: ['Loaded level forest', 'Match started', 'Opened map'],
      t: 481,
      scene: 'match',
      platform: 'Windows',
      source: 'crash-reporter',
      kind: 'play',
    });
    expect(c.callstack).toContain('AVan::Tick()');
    expect(c.callstack).toContain('C:\\Users\\<user>\\proj');
    expect(c.log).toContain('LogVan: about to crash');
    expect(c.log).not.toContain('esieg');
    expect(c.details).toMatchObject({ engineVersion: '5.4.4-0+++UE5+Release-5.4' });

    const s = await session();
    expect(s.crash).toMatchObject({ crashId: c.id, scene: 'match' });
    expect(s.endedAt).toBe('2026-11-16T20:00:00.000Z');
    expect(s.scenes).toEqual(['match']);

    const items = (await feedback()).feedback.filter((f) => f.id === c.feedbackId);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('TwistedVanworld crashed on pc-0dc004594da2');
    expect(items[0]!.questions[0]!.prompt).toBe('What were you doing when it crashed?');
  });

  it('needs a game key in the path, and an Unreal crash report', async () => {
    expect((await call(unrealCrash, 'POST', '/api/v1/perf/crash/unreal/am_nope', { raw: unrealUpload({ a: 'b' }) })).status).toBe(401);
    const bad = await call(unrealCrash, 'POST', `/api/v1/perf/crash/unreal/${encodeURIComponent(key)}`, { raw: Buffer.from('hello') });
    expect(bad.status).toBe(400);
  });
});

describe('crashes as JSON and from the next launch', () => {
  it('keeps one crash per session: the next launch fills in what the crash reporter lacked', async () => {
    await startSession();
    const first = await call(postCrash, 'POST', '/api/v1/perf/crash', {
      key,
      body: { game: 'TwistedVanworld', machine: 'pc-0dc004594da2', sessionId: SESSION, reason: 'Did not exit cleanly (no crash report)' },
    });
    expect(first.status).toBe(201);
    const { crashUrl } = first.body as CrashResponse;
    expect(crashUrl).toMatch(/^https:\/\/manager\.test\/performance\/crash\?id=/);

    await startSession({ crash: { reason: 'Assertion failed: Van != nullptr', callstack: 'AVan::Tick()', t: 300 } });
    const { crashes: list } = await crashes();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: 'Assertion failed: Van != nullptr', callstack: 'AVan::Tick()', t: 300, source: 'api' });
    expect((await feedback()).feedback).toHaveLength(1);
  });

  it('shows what you said you were doing', async () => {
    const res = await call(postCrash, 'POST', '/api/v1/perf/crash', { key, body: { game: 'TwistedVanworld', machine: 'pc-1', reason: 'Boom' } });
    const crash = (res.body as CrashResponse).stored;
    const f = (await ctx.store.getFeedback(crash.feedbackId!))!;
    await ctx.store.putFeedback({ ...f, status: 'sent', response: { answers: { doing: 'Opening the map mid-match' }, note: null, by: OWNER, at: clock.toISOString() } });
    const detail = await owner<CrashDetailResponse>(crashDetail, `/api/v1/perf/crash?id=${crash.id}`);
    expect(detail.answer).toEqual({ by: OWNER, at: clock.toISOString(), text: 'Opening the map mid-match' });
  });

  it('refuses a crash without a reason', async () => {
    const res = await call(postCrash, 'POST', '/api/v1/perf/crash', { key, body: { game: 'g', machine: 'm' } });
    expect(res.status).toBe(400);
  });
});

describe('test runs', () => {
  it('are hidden unless asked for, and their crashes ask nothing', async () => {
    await startSession({ kind: 'test' });
    await call(postCrash, 'POST', '/api/v1/perf/crash', { key, body: { game: 'TwistedVanworld', machine: 'pc-0dc004594da2', sessionId: SESSION, reason: 'Boom' } });
    expect((await owner<PerfSessionsResponse>(perfSessions, '/api/v1/perf/sessions')).sessions).toHaveLength(0);
    expect((await owner<PerfSessionsResponse>(perfSessions, '/api/v1/perf/sessions?tests=1')).sessions).toHaveLength(1);
    expect((await crashes()).crashes).toHaveLength(0);
    expect((await crashes('?tests=1')).crashes[0]?.kind).toBe('test');
    expect((await feedback()).feedback).toHaveLength(0);
  });
});

describe('machine nicknames', () => {
  it('names a machine, shows the name with sessions and crashes, and clears it', async () => {
    const set = await call(setMachineName, 'POST', '/api/v1/machine-names', { owner: true, body: { machine: 'pc-0dc004594da2', name: 'gaming rig' } });
    expect((set.body as MachineNamesResponse).names).toEqual({ 'pc-0dc004594da2': 'gaming rig' });
    await startSession();
    expect((await owner<PerfSessionsResponse>(perfSessions, '/api/v1/perf/sessions')).machineNames).toEqual({ 'pc-0dc004594da2': 'gaming rig' });

    await call(postCrash, 'POST', '/api/v1/perf/crash', { key, body: { game: 'TwistedVanworld', machine: 'pc-0dc004594da2', reason: 'Boom' } });
    expect((await crashes('?machine=gaming%20rig')).crashes).toHaveLength(1);
    expect((await feedback()).feedback[0]?.title).toBe('TwistedVanworld crashed on gaming rig');

    await call(setMachineName, 'POST', '/api/v1/machine-names', { owner: true, body: { machine: 'pc-0dc004594da2', name: '' } });
    expect((await owner<MachineNamesResponse>(machineNames, '/api/v1/machine-names')).names).toEqual({});
  });

  it('only the owner can name machines', async () => {
    expect((await call(setMachineName, 'POST', '/api/v1/machine-names', { key, body: { machine: 'x', name: 'y' } })).status).toBe(401);
  });
});
