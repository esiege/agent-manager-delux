import { beforeEach, describe, expect, it } from 'vitest';
import {
  OWNER_WRITE_HEADER,
  type AgentDetailResponse,
  type CreateKeyResponse,
  type FeedbackInboxResponse,
  type FeedbackListResponse,
  type ReleaseCreateResponse,
  type ReleaseNotesResponse,
  type ReleasesResponse,
} from '@agent-manager-delux/shared';
import { resetAuthState } from '../src/auth';
import { report } from '../src/handlers/ingest';
import { createKey } from '../src/handlers/keys';
import { agent } from '../src/handlers/read';
import { feedbackInbox, feedbackList } from '../src/handlers/feedback';
import { addReleaseNotes, addReleaseScreenshot, createRelease, deleteRelease, listReleases, releaseScreenshot } from '../src/handlers/releases';
import { guarded, type Ctx, type Handler, type Req } from '../src/http';
import { MemoryMediaStore } from '../src/store/media';
import { MemoryStore } from '../src/store/memory';

const OWNER = 'owner@example.com';
const SESSION = 'pc/claude/s1';

let clock: Date;
let ctx: Ctx;
let key: string;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

function upload(id: string, bytes = PNG, contentType = 'image/png') {
  const headers = new Headers({ host: 'manager.test', 'x-forwarded-proto': 'https', 'x-agent-manager-key': key, 'content-type': contentType });
  const req: Req = { method: 'POST', url: `https://manager.test/api/v1/releases/screenshot?id=${id}&name=title.png`, headers, body: '', raw: bytes };
  return guarded(addReleaseScreenshot, () => {})(req, ctx);
}

function call(handler: Handler, method: string, path: string, opts: { body?: unknown; key?: string; owner?: boolean; noWriteHeader?: boolean } = {}) {
  const headers = new Headers({ host: 'manager.test', 'x-forwarded-proto': 'https' });
  if (opts.key) headers.set('x-agent-manager-key', opts.key);
  if (opts.owner) {
    headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ identityProvider: 'github', userDetails: OWNER })).toString('base64'));
    if (method === 'POST' && !opts.noWriteHeader) headers.set(OWNER_WRITE_HEADER, '1');
  }
  const req: Req = { method, url: `https://manager.test${path}`, headers, body: opts.body === undefined ? '' : JSON.stringify(opts.body) };
  return guarded(handler, () => {})(req, ctx);
}

const send = (body: Record<string, unknown> = {}, withKey = key) =>
  call(createRelease, 'POST', '/api/v1/releases', {
    key: withKey,
    body: {
      agentId: SESSION,
      version: 'v0.20.0',
      url: 'https://github.com/example/vanworld/releases/tag/v0.20.0',
      title: 'The Winter Update',
      notes: '- Snow\n- Beaverlogger has **gold** teeth',
      comment: 'Try the new level first.',
      ...body,
    },
  });

const list = async (path = '/api/v1/releases') => (await call(listReleases, 'GET', path, { owner: true })).body as ReleasesResponse;

beforeEach(async () => {
  resetAuthState();
  clock = new Date('2026-11-16T12:00:00Z');
  ctx = { store: new MemoryStore(undefined, () => clock), now: () => clock, env: { OWNER_LOGINS: OWNER }, releaseMedia: new MemoryMediaStore() };
  const res = await call(createKey, 'POST', '/api/v1/keys', { owner: true, body: { name: 'pc-studio' } });
  key = (res.body as CreateKeyResponse).secret;
  await call(report, 'POST', '/api/v1/report', {
    key,
    body: { agentId: SESSION, kind: 'claude-code', machine: 'pc', name: 'Beaverlogger', project: 'Twisted Vanworld', state: 'idle' },
  });
});

describe('releases', () => {
  it('stores a release with the agent, PC and game, lists it and notes it on the agent', async () => {
    const res = await send({ links: [{ label: 'Windows build', url: 'https://example.com/win.zip' }, 'https://store.example.com/vanworld'] });
    expect(res.status).toBe(201);
    const body = res.body as ReleaseCreateResponse;
    expect(body.updated).toBe(false);
    expect(body.stored).toMatchObject({
      agentId: SESSION,
      agentName: 'Beaverlogger',
      project: 'Twisted Vanworld',
      machine: 'pc',
      version: 'v0.20.0',
      title: 'The Winter Update',
      comment: 'Try the new level first.',
      keyName: 'pc-studio',
      links: [
        { label: 'Windows build', url: 'https://example.com/win.zip' },
        { label: 'store.example.com', url: 'https://store.example.com/vanworld' },
      ],
    });
    expect(body.releaseUrl).toBe(`https://manager.test/releases?id=${body.stored.id}`);

    expect((await list()).releases.map((r) => r.version)).toEqual(['v0.20.0']);
    const detail = (await call(agent, 'GET', `/api/v1/agent?id=${encodeURIComponent(SESSION)}`, { owner: true })).body as AgentDetailResponse;
    expect(detail.events.some((e) => e.type === 'release' && e.activity === 'Released v0.20.0: The Winter Update')).toBe(true);
  });

  it('updates the same game and version instead of adding another, keeping when it was first sent', async () => {
    const first = (await send()).body as ReleaseCreateResponse;
    clock = new Date('2026-11-16T13:00:00Z');
    const res = await send({ version: 'V0.20.0', notes: '- Snow\n- Fixed the crash on load', comment: null });
    expect(res.status).toBe(200);
    const second = res.body as ReleaseCreateResponse;
    expect(second.updated).toBe(true);
    expect(second.stored.id).toBe(first.stored.id);
    expect(second.stored.createdAt).toBe('2026-11-16T12:00:00.000Z');
    expect(second.stored.updatedAt).toBe('2026-11-16T13:00:00.000Z');
    expect(second.stored.comment).toBeNull();
    expect((await list()).releases).toHaveLength(1);
  });

  it('corrects only what a resend gives, without needing the link again', async () => {
    await send({ links: ['https://example.com/win.zip'] });
    clock = new Date('2026-11-16T13:00:00Z');
    const res = await call(createRelease, 'POST', '/api/v1/releases', {
      key,
      body: { agentId: SESSION, version: 'v0.20.0', notes: '- Snow, fixed', releasedAt: '2025-03-14' },
    });
    expect(res.status).toBe(200);
    expect((res.body as ReleaseCreateResponse).stored).toMatchObject({
      url: 'https://github.com/example/vanworld/releases/tag/v0.20.0',
      title: 'The Winter Update',
      comment: 'Try the new level first.',
      notes: '- Snow, fixed',
      releasedAt: '2025-03-14T00:00:00.000Z',
      links: [{ label: 'example.com', url: 'https://example.com/win.zip' }],
    });
    // A later resend without a date keeps it; "" and null clear.
    const again = await call(createRelease, 'POST', '/api/v1/releases', { key, body: { agentId: SESSION, version: 'v0.20.0', title: '', links: null } });
    expect((again.body as ReleaseCreateResponse).stored).toMatchObject({ releasedAt: '2025-03-14T00:00:00.000Z', title: null, links: [] });
  });

  it('needs a link the first time, and refuses a release date in the future', async () => {
    expect((await send({ url: undefined })).status).toBe(400);
    expect((await send({ releasedAt: '2026-12-25' })).status).toBe(400);
    expect((await send({ releasedAt: 'last tuesday' })).status).toBe(400);
  });

  it('orders by release date, so an old release announced today goes below newer ones', async () => {
    await send({ version: 'v0.21.0', releasedAt: '2026-10-01T00:00:00Z' });
    clock = new Date('2026-11-17T12:00:00Z');
    await send({ version: 'v0.1.0', releasedAt: '2024-01-05' });
    const { releases } = await list();
    expect(releases.map((r) => r.version)).toEqual(['v0.21.0', 'v0.1.0']);
    expect(releases[1]!.createdAt).toBe('2026-11-17T12:00:00.000Z');
  });

  it('dates a release sent before dates existed by when it was sent', async () => {
    const { stored } = (await send()).body as ReleaseCreateResponse;
    const { releasedAt: _, ...legacy } = stored;
    await ctx.store.putRelease(legacy as typeof stored);
    expect((await list()).releases[0]!.releasedAt).toBe(stored.createdAt);
  });

  it('takes screenshots, serves them, keeps them on a resend and replaces them on request', async () => {
    const { stored } = (await send()).body as ReleaseCreateResponse;
    const res = await upload(stored.id);
    expect(res.status).toBe(201);
    const shot = (res.body as { stored: { id: string; name: string } }).stored;
    expect(shot.name).toBe('title.png');
    expect((await upload(stored.id, Buffer.from('not a picture'))).status).toBe(415);
    expect((await upload(stored.id, PNG, 'video/mp4')).status).toBe(415);

    const served = await call(releaseScreenshot, 'GET', `/api/v1/releases/screenshot?id=${stored.id}&shot=${shot.id}`, { owner: true });
    expect(served.status).toBe(200);
    expect(served.bytes?.equals(PNG)).toBe(true);

    await send({ notes: 'fixed' });
    expect((await list()).releases[0]!.screenshots).toHaveLength(1);
    await send({ clearScreenshots: true });
    expect((await list()).releases[0]!.screenshots).toEqual([]);
    expect((await call(releaseScreenshot, 'GET', `/api/v1/releases/screenshot?id=${stored.id}&shot=${shot.id}`, { owner: true })).status).toBe(404);
    expect((await ctx.releaseMedia!.get(`${stored.id}/${shot.id}`))).toBeNull();
  });

  it('refuses a screenshot for a release that does not exist', async () => {
    expect((await upload('0'.repeat(32))).status).toBe(404);
  });

  it('lists newest first and filters by game', async () => {
    await send();
    clock = new Date('2026-11-17T12:00:00Z');
    await send({ version: 'v0.21.0' });
    clock = new Date('2026-11-18T12:00:00Z');
    await send({ version: '1.0', project: 'Other Game' });
    expect((await list()).releases.map((r) => r.version)).toEqual(['1.0', 'v0.21.0', 'v0.20.0']);
    expect((await list('/api/v1/releases?game=twisted%20vanworld')).releases.map((r) => r.version)).toEqual(['v0.21.0', 'v0.20.0']);
    const limited = await list('/api/v1/releases?limit=1');
    expect(limited.releases).toHaveLength(1);
    expect(limited.truncated).toBe(true);
  });

  it('refuses a missing link, a link that is not http, and an unknown agent', async () => {
    expect((await send({ url: undefined })).status).toBe(400);
    const notHttp = await send({ url: 'ftp://example.com/x' });
    expect(notHttp.status).toBe(400);
    expect((notHttp.body as { error: string }).error).toMatch(/http or https/);
    expect((await send({ links: [{ label: 'x', url: 'javascript:alert(1)' }] })).status).toBe(400);
    expect((await send({ agentId: 'pc/claude/nobody' })).status).toBe(404);
  });

  it('checks a test release without storing it', async () => {
    const res = await send({ test: true });
    expect(res.status).toBe(200);
    expect((res.body as ReleaseCreateResponse).test).toBe(true);
    expect((await list()).releases).toHaveLength(0);
  });

  it('masks secrets in what agents write', async () => {
    const res = await send({ comment: 'Uploaded with token ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    expect((res.body as ReleaseCreateResponse).stored.comment).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('lets the owner delete one, only from the site', async () => {
    const { stored } = (await send()).body as ReleaseCreateResponse;
    expect((await call(deleteRelease, 'POST', '/api/v1/releases/delete', { owner: true, noWriteHeader: true, body: { id: stored.id } })).status).toBe(403);
    expect((await call(deleteRelease, 'POST', '/api/v1/releases/delete', { key, body: { id: stored.id } })).status).toBe(401);
    expect((await call(deleteRelease, 'POST', '/api/v1/releases/delete', { owner: true, body: { id: stored.id } })).status).toBe(200);
    expect((await list()).releases).toHaveLength(0);
  });

  it('turns playtest notes into answered feedback for the agent, In progress', async () => {
    const { stored } = (await send()).body as ReleaseCreateResponse;
    const notes = (body: unknown, opts: { owner?: boolean; key?: string; noWriteHeader?: boolean } = { owner: true }) =>
      call(addReleaseNotes, 'POST', '/api/v1/releases/notes', { ...opts, body });
    expect((await notes({ id: stored.id, notes: ['x'] }, { key })).status).toBe(401);
    expect((await notes({ id: stored.id, notes: ['x'] }, { owner: true, noWriteHeader: true })).status).toBe(403);
    expect((await notes({ id: stored.id, notes: ['  ', ''] })).status).toBe(400);
    expect((await notes({ id: 'f'.repeat(32), notes: ['x'] })).status).toBe(404);

    const res = await notes({ id: stored.id, notes: ['Jump feels floaty\nespecially on ice', 'Music too loud in the menu'] });
    expect(res.status).toBe(201);
    const made = (res.body as ReleaseNotesResponse).feedback;
    expect(made).toHaveLength(2);
    expect(made[0]).toMatchObject({
      agentId: SESSION,
      status: 'sent',
      release: stored.id,
      group: 'v0.20.0',
      title: 'Playtest v0.20.0: Jump feels floaty',
      response: { note: 'Jump feels floaty\nespecially on ice', by: OWNER },
      keyName: 'pc-studio',
    });

    const listed = (await call(feedbackList, 'GET', '/api/v1/feedback', { owner: true })).body as FeedbackListResponse;
    expect(listed.feedback.filter((f) => f.release === stored.id)).toHaveLength(2);
    const inbox = (await call(feedbackInbox, 'GET', '/api/v1/feedback/inbox', { key })).body as FeedbackInboxResponse;
    expect(inbox.feedback.map((f) => f.response?.note).sort()).toEqual(['Jump feels floaty\nespecially on ice', 'Music too loud in the menu']);
  });

  it('lets agents read releases with a machine key', async () => {
    await send();
    const res = await call(listReleases, 'GET', '/api/v1/releases', { key });
    expect(res.status).toBe(200);
    expect((res.body as ReleasesResponse).releases).toHaveLength(1);
  });
});
