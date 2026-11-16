// Round two of feedback: captions, "didn't see it", notes per question, groups, replacing a
// request, files on answers, and email: alerts that wait for files, and answering from an email.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OWNER_WRITE_HEADER,
  type AlertSubscription,
  type CreateKeyResponse,
  type Feedback,
  type FeedbackCreateResponse,
  type FeedbackLinkResponse,
  type FeedbackListResponse,
  type FeedbackMedia,
} from '@agent-manager-delux/shared';
import { saveAlert, deleteAlert } from '../src/handlers/alerts';
import { resetAuthState } from '../src/auth';
import { setMailer, type Email } from '../src/email';
import {
  addAnswerMedia,
  addFeedbackMedia,
  createFeedback,
  feedbackItem,
  feedbackList,
  feedbackMedia,
  feedbackReady,
  linkAddAnswerMedia,
  linkFeedback,
  linkMedia,
  linkRespond,
  removeAnswerMedia,
  respondFeedback,
} from '../src/handlers/feedback';
import { report } from '../src/handlers/ingest';
import { createKey } from '../src/handlers/keys';
import { guarded, type Ctx, type Handler, type Req } from '../src/http';
import { MemoryMediaStore } from '../src/store/media';
import { MemoryStore } from '../src/store/memory';

const OWNER = 'owner@example.com';
const SESSION = 'pc/claude/s1';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);

let clock: Date;
let ctx: Ctx;
let key: string;
let sent: Email[];

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

const ask = (body: Record<string, unknown>) =>
  call(createFeedback, 'POST', '/api/v1/feedback', { key, body: { agentId: SESSION, title: 'New Clunk: Beaverlogger', ...body } });
const askId = async (body: Record<string, unknown> = {}) => ((await ask(body)).body as FeedbackCreateResponse).stored.id;
const list = async () => ((await call(feedbackList, 'GET', '/api/v1/feedback', { owner: true })).body as FeedbackListResponse).feedback;
const one = async (id: string) => (await list()).find((f) => f.id === id)!;
const upload = (id: string, name = 'gold.png') =>
  call(addFeedbackMedia, 'POST', `/api/v1/feedback/media?${new URLSearchParams({ id, name })}`, { key, raw: PNG, headers: { 'content-type': 'image/png' } });

async function subscribe(target = 'me@example.com', extra: Record<string, unknown> = {}) {
  const res = await call(saveAlert, 'POST', '/api/v1/alerts', {
    owner: true,
    body: { name: target, channel: 'email', target, events: ['blocker'], ...extra },
  });
  return (res.body as { subscription: AlertSubscription }).subscription;
}

/** The answer-page token from the last email. */
function tokenFromEmail(email: Email): string {
  const m = /\/answer\?t=([A-Za-z0-9_.-]+)/.exec(email.html);
  if (!m) throw new Error('No answer link in the email');
  return m[1]!;
}

beforeEach(async () => {
  resetAuthState();
  clock = new Date('2026-11-16T12:00:00Z');
  ctx = { store: new MemoryStore(undefined, () => clock), now: () => clock, env: { OWNER_LOGINS: OWNER }, media: new MemoryMediaStore() };
  sent = [];
  setMailer({ send: async (e) => void sent.push(e) });
  key = ((await call(createKey, 'POST', '/api/v1/keys', { owner: true, body: { name: 'pc-studio' } })).body as CreateKeyResponse).secret;
  await call(report, 'POST', '/api/v1/report', {
    key,
    body: { agentId: SESSION, kind: 'claude-code', machine: 'pc', name: 'Beaverlogger', project: 'Twisted Vanworld', state: 'idle', details: { permissionMode: 'default' } },
  });
});
afterEach(() => setMailer(undefined));

describe('the form', () => {
  it('takes numeric ids, a recommendation by label, captions, and "didn\'t see it" on ratings', async () => {
    const res = await ask({
      questions: [
        { type: 'choice', prompt: 'Teeth?', options: [{ id: 1, label: 'Ivory', media: { file: 'shots/ivory.png', caption: 'As built' } }, 'Gold'], recommended: 'gold' },
        { type: 'rating', prompt: 'Menacing?', notApplicable: true },
        { type: 'rating', prompt: 'Roar?', notApplicable: "Didn't hear it" },
      ],
      captions: { 'hud.png': 'The HUD at 1080p' },
      group: 'v0.20.0',
    });
    const f = (res.body as FeedbackCreateResponse).stored;
    expect(f.questions[0]).toMatchObject({ options: [{ id: '1', media: 'ivory.png' }, { id: '2' }], recommended: '2' });
    expect(f.questions[1]).toMatchObject({ notApplicable: "Didn't see it" });
    expect(f.questions[2]).toMatchObject({ notApplicable: "Didn't hear it" });
    expect(f.captions).toEqual({ 'ivory.png': 'As built', 'hud.png': 'The HUD at 1080p' });
    expect(f.group).toBe('v0.20.0');
  });

  it('takes "n/a" on a rating that allows it, and a note under any question', async () => {
    const id = await askId({ questions: [{ type: 'rating', prompt: 'Menacing?', notApplicable: true }, { type: 'rating', prompt: 'Loud?' }] });
    const send = (body: Record<string, unknown>) => call(respondFeedback, 'POST', '/api/v1/feedback/respond', { owner: true, body: { id, action: 'send', ...body } });
    expect(((await send({ answers: { q2: 'n/a' } })).body as { error: string }).error).toBe('answers.q2 must be a whole number from 1 to 5');
    const res = await send({ answers: { q1: 'n/a', q2: 3 }, notes: { q2: 'Only in the cave' } });
    expect((res.body as { feedback: Feedback }).feedback.response).toMatchObject({ answers: { q1: 'n/a', q2: 3 }, notes: { q2: 'Only in the cave' }, via: 'site' });
    const agentView = ((await call(feedbackItem, 'GET', `/api/v1/feedback/item?id=${id}`, { key })).body as { feedback: Feedback }).feedback;
    expect(agentView.response!.notes).toEqual({ q2: 'Only in the cave' });
  });

  it('closes the request a new one supersedes, linking the two', async () => {
    const old = await askId({ title: 'Beaverlogger v0.19' });
    const next = await askId({ title: 'Beaverlogger v0.20', supersedes: old });
    const earlier = await one(old);
    expect(earlier).toMatchObject({ status: 'closed', followedBy: next });
    expect(earlier.history.at(-1)!.note).toBe('Replaced by: Beaverlogger v0.20');
    expect(await one(next)).toMatchObject({ status: 'open', supersedes: old });
  });
});

describe('files on the answer', () => {
  it('lets the owner attach and remove files before sending, and the asking key download them', async () => {
    const id = await askId();
    const res = await call(addAnswerMedia, 'POST', `/api/v1/feedback/answer-media?${new URLSearchParams({ id, name: 'ref.png' })}`, {
      owner: true,
      raw: PNG,
      headers: { 'content-type': 'image/png' },
    });
    const item = (res.body as { stored: FeedbackMedia }).stored;
    expect((await one(id)).answerMedia).toEqual([item]);

    const dl = await call(feedbackMedia, 'GET', `/api/v1/feedback/media?${new URLSearchParams({ id, media: item.id })}`, { key });
    expect(dl.bytes!.equals(PNG)).toBe(true);

    // A file alone is an answer.
    const sentRes = await call(respondFeedback, 'POST', '/api/v1/feedback/respond', { owner: true, body: { id, action: 'send' } });
    expect((sentRes.body as { feedback: Feedback }).feedback.status).toBe('sent');
    const removed = await call(removeAnswerMedia, 'POST', '/api/v1/feedback/answer-media/remove', { owner: true, body: { id, media: item.id } });
    expect(removed.status).toBe(409); // sent: it's part of the answer now
  });
});

describe('email', () => {
  it('waits for the files the agent said it would attach, then emails once', async () => {
    await subscribe();
    const id = await askId({ expectFiles: 2, questions: [{ type: 'choice', prompt: 'Teeth?', options: [{ label: 'Gold', media: 'gold.png' }, 'Ivory'] }] });
    expect(sent).toHaveLength(0);
    await upload(id, 'gold.png');
    expect(sent).toHaveLength(0);
    await upload(id, 'roar.png');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain('/api/v1/feedback/link/media?t=');
    // Ready afterwards changes nothing.
    await call(feedbackReady, 'POST', '/api/v1/feedback/ready', { key, body: { id } });
    expect(sent).toHaveLength(1);
  });

  it('sends when the agent says it is ready, even if a file failed', async () => {
    await subscribe();
    const id = await askId({ expectFiles: 3 });
    await upload(id);
    await call(feedbackReady, 'POST', '/api/v1/feedback/ready', { key, body: { id } });
    expect(sent).toHaveLength(1);
    expect((await one(id)).notifiedAt).toBe('2026-11-16T12:00:00.000Z');
  });

  it('only emails subscriptions for the event and project, and checks addresses', async () => {
    await subscribe('other@example.com', { projects: ['GoodCookin'] });
    await askId();
    expect(sent).toHaveLength(0);
    const bad = await call(saveAlert, 'POST', '/api/v1/alerts', { owner: true, body: { name: 'x', channel: 'email', target: 'not-an-address', events: ['blocker'] } });
    expect((bad.body as { error: string }).error).toBe('target must be an email address, such as you@example.com');
  });

  it('carries one-click answers that open the answer page, which answers without signing in', async () => {
    await subscribe();
    const id = await askId({
      questions: [
        { type: 'choice', prompt: 'Teeth?', options: ['Ivory', 'Gold'], recommended: 'Ivory' },
        { type: 'rating', prompt: 'Menacing?', max: 3, notApplicable: true },
      ],
    });
    const email = sent[0]!;
    expect(email.to).toBe('me@example.com');
    expect(email.subject).toBe('Feedback: New Clunk: Beaverlogger (Twisted Vanworld)');
    const t = tokenFromEmail(email);
    expect(email.html).toContain(`https://manager.test/answer?t=${t}&amp;q=q1&amp;a=2`);
    expect(email.html).toContain(`https://manager.test/answer?t=${t}&amp;q=q2&amp;a=n%2Fa`);

    const view = (await call(linkFeedback, 'GET', `/api/v1/feedback/link?t=${t}`)).body as FeedbackLinkResponse;
    expect(view).toMatchObject({ email: 'me@example.com', canAnswer: true, feedback: { id, keyName: '' } });

    const res = await call(linkRespond, 'POST', '/api/v1/feedback/link/respond', { body: { t, action: 'send', answers: { q1: '2', q2: 'n/a' } } });
    expect((res.body as { feedback: Feedback }).feedback.response).toMatchObject({ by: 'me@example.com', via: 'email', answers: { q1: '2', q2: 'n/a' } });
    expect((await one(id)).status).toBe('sent');
    const again = (await call(linkFeedback, 'GET', `/api/v1/feedback/link?t=${t}`)).body as FeedbackLinkResponse;
    expect(again.canAnswer).toBe(false);
    expect((await call(linkRespond, 'POST', '/api/v1/feedback/link/respond', { body: { t, action: 'send', note: 'x' } })).status).toBe(409);
  });

  it('serves files and takes attachments through the link', async () => {
    await subscribe();
    const id = await askId({ expectFiles: 1 });
    const media = ((await upload(id)).body as { stored: FeedbackMedia }).stored;
    const t = tokenFromEmail(sent[0]!);
    const file = await call(linkMedia, 'GET', `/api/v1/feedback/link/media?${new URLSearchParams({ t, media: media.id })}`);
    expect(file.bytes!.equals(PNG)).toBe(true);
    const add = await call(linkAddAnswerMedia, 'POST', `/api/v1/feedback/link/answer-media?${new URLSearchParams({ t, name: 'mine.png' })}`, {
      raw: PNG,
      headers: { 'content-type': 'image/png' },
    });
    expect(add.status).toBe(201);
    expect((await one(id)).answerMedia).toHaveLength(1);
  });

  it('refuses tampered and expired links, and links of a removed subscription', async () => {
    const sub = await subscribe();
    await askId();
    const t = tokenFromEmail(sent[0]!);
    const [payload, sig] = t.split('.');
    const forged = `${Buffer.from(Buffer.from(payload!, 'base64url').toString().replace(/"x":\d+/, '"x":9999999999')).toString('base64url')}.${sig}`;
    expect((await call(linkFeedback, 'GET', `/api/v1/feedback/link?t=${forged}`)).status).toBe(401);
    expect((await call(linkFeedback, 'GET', '/api/v1/feedback/link?t=nonsense')).status).toBe(401);

    clock = new Date(clock.getTime() + 15 * 86_400_000);
    expect(((await call(linkFeedback, 'GET', `/api/v1/feedback/link?t=${t}`)).body as { error: string }).error).toMatch(/expired/);
    clock = new Date('2026-11-16T12:00:00Z');

    await call(deleteAlert, 'POST', '/api/v1/alerts/delete', { owner: true, body: { id: sub.id } });
    expect(((await call(linkFeedback, 'GET', `/api/v1/feedback/link?t=${t}`)).body as { error: string }).error).toMatch(/removed or turned off/);
  });
});
