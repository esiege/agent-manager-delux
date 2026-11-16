import { beforeEach, describe, expect, it } from 'vitest';
import {
  OWNER_WRITE_HEADER,
  type CreateKeyResponse,
  type Feedback,
  type FeedbackCreateResponse,
  type FeedbackDetailResponse,
  type FeedbackInboxResponse,
  type FeedbackListResponse,
  type FeedbackMedia,
  type InboxResponse,
} from '@agent-manager-delux/shared';
import { resetAuthState } from '../src/auth';
import {
  addFeedbackMedia,
  createFeedback,
  feedbackInbox,
  feedbackItem,
  feedbackList,
  feedbackMedia,
  feedbackStatus,
  legacyBlocker,
  respondFeedback,
} from '../src/handlers/feedback';
import { report } from '../src/handlers/ingest';
import { createKey } from '../src/handlers/keys';
import { ackMessage, inbox } from '../src/handlers/messages';
import { agent } from '../src/handlers/read';
import { guarded, type Ctx, type Handler, type Req } from '../src/http';
import { MemoryMediaStore } from '../src/store/media';
import { MemoryStore } from '../src/store/memory';

const OWNER = 'owner@example.com';
const SESSION = 'pc/claude/s1';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(1000, 3)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(500, 1)]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(200, 2)]);

const QUESTIONS = [
  { type: 'choice', prompt: 'Which teeth?', options: ['Ivory', { id: 'gold', label: 'Gold', media: 'gold.png' }], recommended: 'gold' },
  { type: 'rating', prompt: 'How menacing is it?', max: 5, low: 'Cuddly', high: 'Terrifying' },
  { prompt: 'Anything else?' },
];

let clock: Date;
let ctx: Ctx;
let mediaStore: MemoryMediaStore;
let key: string;

function call(
  handler: Handler,
  method: string,
  path: string,
  opts: { body?: unknown; raw?: Buffer; key?: string; owner?: boolean; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({ host: 'manager.test', 'x-forwarded-proto': 'https', ...opts.headers });
  if (opts.key) headers.set('x-agent-manager-key', opts.key);
  if (opts.owner) {
    headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ identityProvider: 'github', userDetails: OWNER })).toString('base64'));
    if (method === 'POST') headers.set(OWNER_WRITE_HEADER, '1');
  }
  const req: Req = {
    method,
    url: `https://manager.test${path}`,
    headers,
    body: opts.raw ? opts.raw.toString('utf8') : opts.body === undefined ? '' : JSON.stringify(opts.body),
    raw: opts.raw,
  };
  return guarded(handler, () => {})(req, ctx);
}

async function makeKey(name: string) {
  const res = await call(createKey, 'POST', '/api/v1/keys', { owner: true, body: { name } });
  return (res.body as CreateKeyResponse).secret;
}

async function reportSession(details: Record<string, unknown> = { permissionMode: 'default' }, state = 'idle') {
  await call(report, 'POST', '/api/v1/report', {
    key,
    body: { agentId: SESSION, kind: 'claude-code', machine: 'pc', name: 'Beaverlogger', project: 'Twisted Vanworld', state, details },
  });
}

const ask = (body: Record<string, unknown> = {}) =>
  call(createFeedback, 'POST', '/api/v1/feedback', {
    key,
    body: { agentId: SESSION, title: 'New Clunk: Beaverlogger', body: 'Built with **ivory** teeth.', questions: QUESTIONS, ...body },
  });

const askId = async (body: Record<string, unknown> = {}) => ((await ask(body)).body as FeedbackCreateResponse).stored.id;

const list = async () => (await call(feedbackList, 'GET', '/api/v1/feedback', { owner: true })).body as FeedbackListResponse;

const respond = (id: string, body: Record<string, unknown> = {}) =>
  call(respondFeedback, 'POST', '/api/v1/feedback/respond', { owner: true, body: { id, action: 'send', note: 'Looks great', ...body } });

const setStatus = (id: string, status: string, note?: string, withKey = key) =>
  call(feedbackStatus, 'POST', '/api/v1/feedback/status', { key: withKey, body: { id, status, ...(note ? { note } : {}) } });

const read = async (id: string, withKey = key) =>
  ((await call(feedbackItem, 'GET', `/api/v1/feedback/item?id=${id}`, { key: withKey })).body as FeedbackDetailResponse).feedback;

const upload = (id: string, bytes: Buffer, type: string, withKey = key, name = 'C:\\shots\\gold.png') =>
  call(addFeedbackMedia, 'POST', `/api/v1/feedback/media?${new URLSearchParams({ id, name })}`, {
    key: withKey,
    raw: bytes,
    headers: { 'content-type': type },
  });

beforeEach(async () => {
  resetAuthState();
  clock = new Date('2026-11-15T12:00:00Z');
  mediaStore = new MemoryMediaStore();
  ctx = { store: new MemoryStore(undefined, () => clock), now: () => clock, env: { OWNER_LOGINS: OWNER }, media: mediaStore };
  key = await makeKey('pc-studio');
  await reportSession();
});

describe('asking for feedback', () => {
  it('takes the agent, machine and project from the agent, fills in question ids, and lists it as open', async () => {
    const res = await ask();
    expect(res.status).toBe(201);
    const body = res.body as FeedbackCreateResponse;
    expect(body.stored).toMatchObject({
      agentId: SESSION,
      agentName: 'Beaverlogger',
      project: 'Twisted Vanworld',
      machine: 'pc',
      title: 'New Clunk: Beaverlogger',
      body: 'Built with **ivory** teeth.',
      status: 'open',
      history: [{ status: 'open', at: '2026-11-15T12:00:00.000Z', by: 'Beaverlogger', note: null }],
      keyName: 'pc-studio',
    });
    expect(body.stored.questions).toEqual([
      {
        id: 'q1',
        type: 'choice',
        prompt: 'Which teeth?',
        options: [
          { id: '1', label: 'Ivory' },
          { id: 'gold', label: 'Gold', media: 'gold.png' },
        ],
        recommended: 'gold',
      },
      { id: 'q2', type: 'rating', prompt: 'How menacing is it?', max: 5, low: 'Cuddly', high: 'Terrifying' },
      { id: 'q3', type: 'text', prompt: 'Anything else?' },
    ]);
    expect(body.feedbackUrl).toBe(`https://manager.test/feedback?id=${body.stored.id}`);
    expect((await list()).feedback.map((f) => f.id)).toEqual([body.stored.id]);
    expect((await list()).agents).toEqual({ [SESSION]: { state: 'idle', noMessages: null } });
    const detail = (await call(agent, 'GET', `/api/v1/agent?id=${encodeURIComponent(SESSION)}`, { owner: true })).body as {
      events: { type: string; activity: string }[];
    };
    expect(detail.events).toContainEqual(expect.objectContaining({ type: 'feedback', activity: 'Asked for feedback: New Clunk: Beaverlogger' }));
  });

  it('takes a plain question with no form', async () => {
    const res = await ask({ questions: undefined, body: 'Is the HUD too busy?' });
    expect((res.body as FeedbackCreateResponse).stored.questions).toEqual([]);
  });

  it('refuses questions it cannot show, saying which', async () => {
    const bad = async (questions: unknown) => ((await ask({ questions })).body as { error: string }).error;
    expect(await bad([{ type: 'choice', prompt: 'Pick', options: ['Only one'] }])).toBe('questions[0].options must hold 2 to 8 options');
    expect(await bad([{ type: 'choice', prompt: 'Pick', options: ['a', 'b'], recommended: 'c' }])).toMatch(/recommended must be one of/);
    expect(await bad([{ type: 'rating', prompt: 'Score', max: 50 }])).toBe('questions[0].max must be a whole number from 2 to 10');
    expect(await bad([{ type: 'slider', prompt: 'x' }])).toBe('questions[0].type must be text, choice or rating');
    expect(await bad([{ prompt: 'a', id: 'x' }, { prompt: 'b', id: 'x' }])).toBe('questions[1].id "x" is used twice');
    expect(await bad('nope')).toBe('questions must be a list');
  });

  it('stores nothing for a test call, and refuses unknown agents and missing titles', async () => {
    expect((await ask({ test: true })).status).toBe(200);
    expect((await list()).feedback).toEqual([]);
    expect((await ask({ agentId: 'nobody' })).status).toBe(404);
    expect((await ask({ title: ' ' })).body).toEqual({ error: 'title is required' });
  });

  it('masks secrets in what the agent wrote', async () => {
    const res = await ask({ body: 'The key ghp_abcdefghijklmnopqrstuvwxyz0123456789 was refused' });
    expect((res.body as FeedbackCreateResponse).stored.body).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('needs a machine key', async () => {
    const res = await call(createFeedback, 'POST', '/api/v1/feedback', { body: { agentId: SESSION, title: 'x' } });
    expect(res.status).toBe(401);
  });
});

describe('pictures, clips and sounds', () => {
  let id: string;
  beforeEach(async () => {
    id = await askId();
  });

  it('keeps a picture and serves it to the owner, with ranges for seeking', async () => {
    const res = await upload(id, PNG, 'image/png');
    expect(res.status).toBe(201);
    const item = (res.body as { stored: FeedbackMedia }).stored;
    expect(item).toMatchObject({ kind: 'image', contentType: 'image/png', bytes: PNG.length, name: 'gold.png' });
    expect((await list()).feedback[0]!.media).toEqual([item]);

    const path = `/api/v1/feedback/media?${new URLSearchParams({ id, media: item.id })}`;
    const whole = await call(feedbackMedia, 'GET', path, { owner: true });
    expect(whole.status).toBe(200);
    expect(whole.bytes!.equals(PNG)).toBe(true);
    expect(whole.headers).toMatchObject({ 'content-type': 'image/png', 'content-security-policy': "default-src 'none'; sandbox" });

    const part = await call(feedbackMedia, 'GET', path, { owner: true, headers: { range: 'bytes=0-7' } });
    expect(part.status).toBe(206);
    expect(part.bytes!.length).toBe(8);
    expect(part.headers!['content-range']).toBe(`bytes 0-7/${PNG.length}`);
    expect((await call(feedbackMedia, 'GET', path, {})).status).toBe(401);
  });

  it('takes a video and sounds', async () => {
    expect(((await upload(id, MP4, 'video/mp4')).body as { stored: FeedbackMedia }).stored.kind).toBe('video');
    expect(((await upload(id, MP3, 'audio/mpeg', key, 'roar.mp3')).body as { stored: FeedbackMedia }).stored.kind).toBe('audio');
    expect(((await upload(id, WAV, 'audio/wav', key, 'hum.wav')).body as { stored: FeedbackMedia }).stored.kind).toBe('audio');
  });

  it('refuses other types, files that lie about their type, and files that are too big', async () => {
    expect((await upload(id, Buffer.from('<html>'), 'text/html')).status).toBe(415);
    expect((await upload(id, Buffer.from('<html><script>alert(1)</script>'), 'image/png')).status).toBe(415);
    expect((await upload(id, PNG, 'audio/ogg')).status).toBe(415);
    const huge = Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]);
    expect((await upload(id, huge, 'image/png')).status).toBe(413);
    expect(mediaStore.files.size).toBe(0);
  });

  it('only lets the key that asked add to it', async () => {
    const other = await makeKey('pc-laptop');
    expect((await upload(id, PNG, 'image/png', other)).status).toBe(404);
  });

  it('says so when media storage is not set up', async () => {
    ctx.media = null;
    expect((await upload(id, PNG, 'image/png')).status).toBe(503);
  });
});

describe('answering', () => {
  let id: string;
  beforeEach(async () => {
    id = await askId();
  });

  it('sends the answers to a running session as a message, with what to report next', async () => {
    const res = await respond(id, { answers: { q1: '1', q2: 4, q3: 'Make it louder' }, note: 'Ivory reads better at a distance.' });
    expect(res.status).toBe(200);
    const done = (res.body as { feedback: Feedback }).feedback;
    expect(done).toMatchObject({
      status: 'sent',
      response: { answers: { q1: '1', q2: 4, q3: 'Make it louder' }, note: 'Ivory reads better at a distance.', by: OWNER },
    });
    expect(done.history.map((s) => s.status)).toEqual(['open', 'sent']);
    expect(done.delivery).toMatch(/^Sent to the session as a message/);

    const { messages } = (await call(inbox, 'POST', '/api/v1/inbox', { key, body: { machine: 'pc' } })).body as InboxResponse;
    expect(messages).toHaveLength(1);
    const text = messages[0]!.text;
    expect(text).toContain(`${OWNER} answered your feedback request "New Clunk: Beaverlogger" (${id}).`);
    expect(text).toContain('- Which teeth?\n  Ivory [1]');
    expect(text).toContain('- How menacing is it?\n  4 of 5');
    expect(text).toContain('Make it louder');
    expect(text).toContain(`feedback status ${id} planning`);
    expect(messages[0]!.feedbackId).toBe(id);
  });

  it('marks it viewed when the message reaches the session', async () => {
    await respond(id);
    const { messages } = (await call(inbox, 'POST', '/api/v1/inbox', { key, body: { machine: 'pc' } })).body as InboxResponse;
    await call(ackMessage, 'POST', '/api/v1/inbox/ack', { key, body: { id: messages[0]!.id, machine: 'pc', status: 'delivered' } });
    const [f] = (await list()).feedback;
    expect(f!.status).toBe('viewed');
    expect(f!.history.map((s) => s.status)).toEqual(['open', 'sent', 'viewed']);
  });

  it('refuses answers that do not fit the questions, and an empty answer', async () => {
    expect(((await respond(id, { answers: { q1: 'silver' } })).body as { error: string }).error).toBe('answers.q1 must be one of 1, gold');
    expect(((await respond(id, { answers: { q2: 9 } })).body as { error: string }).error).toBe('answers.q2 must be a whole number from 1 to 5');
    expect(((await respond(id, { answers: { q9: 'x' } })).body as { error: string }).error).toMatch(/no question with that id/);
    expect(((await respond(id, { note: null })).body as { error: string }).error).toBe('Answer a question or write a note, or dismiss it');
  });

  it('keeps the answer for the agent to check when the session cannot take messages', async () => {
    await reportSession({ permissionMode: 'bypassPermissions' });
    const done = ((await respond(id)).body as { feedback: Feedback }).feedback;
    expect(done.messageId).toBeNull();
    expect(done.delivery).toMatch(/^Not sent as a message: the session skips permission prompts/);
  });

  it('dismisses without an answer, once', async () => {
    const res = await respond(id, { action: 'dismiss', note: null });
    expect((res.body as { feedback: Feedback }).feedback).toMatchObject({ status: 'dismissed', response: null });
    expect((await respond(id)).status).toBe(409);
    expect((await upload(id, PNG, 'image/png')).status).toBe(409);
  });

  it('needs the owner and the site header', async () => {
    const res = await call(respondFeedback, 'POST', '/api/v1/feedback/respond', { key, body: { id, action: 'send', note: 'x' } });
    expect(res.status).toBe(401);
  });
});

describe('the agent moving it on', () => {
  let id: string;
  beforeEach(async () => {
    id = await askId();
  });

  it('goes viewed when the agent reads the answer, then planning, implementing and closed', async () => {
    expect((await read(id)).status).toBe('open'); // nothing to view yet
    await respond(id);
    expect((await read(id)).status).toBe('viewed');
    expect((await read(id)).history.filter((s) => s.status === 'viewed')).toHaveLength(1);

    expect((await setStatus(id, 'planning')).status).toBe(200);
    expect((await setStatus(id, 'implementing', 'Swapping the teeth')).status).toBe(200);
    const res = await setStatus(id, 'closed', "You wrote: 'Looks great'. Done in v0.18.");
    expect(res.status).toBe(200);
    const f = (await list()).feedback[0]!;
    expect(f.history.map((s) => [s.status, s.by, s.note])).toEqual([
      ['open', 'Beaverlogger', null],
      ['sent', OWNER, null],
      ['viewed', 'Beaverlogger', null],
      ['planning', 'Beaverlogger', null],
      ['implementing', 'Beaverlogger', 'Swapping the teeth'],
      ['closed', 'Beaverlogger', "You wrote: 'Looks great'. Done in v0.18."],
    ]);
    expect((await setStatus(id, 'planning')).status).toBe(409);
  });

  it('lists what the agent still owes in its inbox', async () => {
    const other = await askId({ title: 'HUD' });
    await respond(id);
    const inboxList = async () =>
      ((await call(feedbackInbox, 'GET', '/api/v1/feedback/inbox', { key })).body as FeedbackInboxResponse).feedback.map((f) => f.id);
    expect((await inboxList()).sort()).toEqual([other, id].sort());
    await setStatus(id, 'closed');
    expect(await inboxList()).toEqual([other]);
    const laptop = await makeKey('pc-laptop');
    expect(((await call(feedbackInbox, 'GET', '/api/v1/feedback/inbox', { key: laptop })).body as FeedbackInboxResponse).feedback).toEqual([]);
  });

  it('refuses planning before an answer, but lets the agent withdraw it', async () => {
    expect(((await setStatus(id, 'planning')).body as { error: string }).error).toMatch(/hasn't answered yet/);
    expect((await setStatus(id, 'sent')).status).toBe(409);
    expect((await setStatus(id, 'closed', 'Not needed any more')).status).toBe(200);
  });

  it('only lets the key that asked move it on', async () => {
    await respond(id);
    const other = await makeKey('pc-laptop');
    expect((await setStatus(id, 'planning', undefined, other)).status).toBe(404);
    expect((await call(feedbackItem, 'GET', `/api/v1/feedback/item?id=${id}`, { key: other })).status).toBe(404);
  });

  it('chains a follow-up to the request it follows', async () => {
    await respond(id);
    const next = await askId({ title: 'Beaverlogger, round 2', follows: id });
    const all = (await list()).feedback;
    const first = all.find((f) => f.id === id)!;
    expect(first).toMatchObject({ status: 'followup', followedBy: next });
    expect(first.history.at(-1)).toMatchObject({ status: 'followup', note: 'Follow-up: Beaverlogger, round 2' });
    expect(all.find((f) => f.id === next)).toMatchObject({ status: 'open', follows: id });
    const laptop = await makeKey('pc-laptop');
    const res = await call(createFeedback, 'POST', '/api/v1/feedback', { key: laptop, body: { agentId: SESSION, title: 'x', follows: id } });
    expect(res.status).toBe(404);
  });

  it('lets the owner close one the agent never closed', async () => {
    await respond(id);
    const res = await respond(id, { action: 'close', note: null });
    expect((res.body as { feedback: Feedback }).feedback.history.at(-1)).toMatchObject({ status: 'closed', by: OWNER });
  });

  it('lists done requests for a week, and the rest until they are done', async () => {
    const other = await askId({ title: 'HUD' });
    await respond(id);
    await setStatus(id, 'closed');
    expect((await list()).feedback).toHaveLength(2);
    clock = new Date(clock.getTime() + 8 * 86_400_000);
    expect((await list()).feedback.map((f) => f.id)).toEqual([other]);
  });
});

describe('agentctl from before feedback', () => {
  it('still reports a blocker and reads the answer back', async () => {
    const res = await call(createFeedback, 'POST', '/api/v1/blockers', { key, body: { agentId: SESSION, title: 'Need the Steam login', details: 'Tried twice' } });
    const body = res.body as FeedbackCreateResponse & { blockerUrl: string };
    expect(body.stored).toMatchObject({ body: 'Tried twice', questions: [] });
    expect(body.blockerUrl).toBe(body.feedbackUrl);
    const id = body.stored.id;
    const blocker = async () =>
      ((await call(legacyBlocker, 'GET', `/api/v1/blocker?id=${id}`, { key })).body as { blocker: { status: string; resolution: string | null } }).blocker;
    expect(await blocker()).toMatchObject({ status: 'open', resolution: null });
    await respond(id, { note: 'Logged in for you' });
    expect(await blocker()).toMatchObject({ status: 'resolved', resolution: 'Logged in for you' });
  });

  it('reads blockers stored before feedback', async () => {
    const legacy = {
      id: '11111111-2222-3333-4444-555555555555',
      agentId: SESSION,
      agentName: 'Beaverlogger',
      kind: 'claude-code',
      project: 'Twisted Vanworld',
      machine: 'pc',
      title: 'Old blocker',
      details: 'From before',
      media: [],
      status: 'open',
      createdAt: '2026-11-14T12:00:00.000Z',
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
      delivery: null,
      messageId: null,
      keyName: 'pc-studio',
    };
    await ctx.store.putFeedback(legacy as unknown as Feedback);
    const [f] = (await list()).feedback;
    expect(f).toMatchObject({ id: legacy.id, status: 'open', body: 'From before', questions: [], history: [{ status: 'open' }] });
    expect((await respond(legacy.id)).status).toBe(200);
  });
});
