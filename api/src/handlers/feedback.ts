// Feedback: an agent asks the owner something, with pictures, clips or sounds and a few typed
// questions (text, a choice, a rating). It shows on the Feedback tab, where the owner answers it.
// The answer goes to the session as a message when it can take one, and the agent can always read
// it back. The agent then reports what it does with it: viewed, planning, implementing, and closed
// or a follow-up request.
//
// Feedback replaced blockers. Requests are kept where blockers were (the "blockers" container and
// blob prefix), and the old /blockers calls still work for agentctl versions that make them.

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import {
  AGENTCTL_COMMAND,
  FEEDBACK_DONE_STATUSES,
  FEEDBACK_MEDIA_TYPES,
  FEEDBACK_RECENT_DAYS,
  FEEDBACK_STATUS_LABEL,
  FeedbackFormError,
  LIMITS,
  canAgentMove,
  describeFeedbackAnswer,
  effectiveState,
  feedbackNextSteps,
  maskSecrets,
  readFeedbackAnswers,
  readFeedbackQuestions,
  type AgentEvent,
  type AgentMessage,
  type Feedback,
  type FeedbackAgentInfo,
  type FeedbackCreateResponse,
  type FeedbackDetailResponse,
  type FeedbackInboxResponse,
  type FeedbackListResponse,
  type FeedbackMedia,
  type FeedbackMediaType,
  type FeedbackStatus,
  type FeedbackStep,
} from '@agent-manager-delux/shared';
import { feedbackPage, notifyFeedback } from '../alerts';
import { requireKey, requireOwner, requireOwnerWrite } from '../auth';
import { HttpError, ok, publicOrigin, query, readJson, type Ctx, type Handler, type Req } from '../http';
import type { MediaRange, MediaStore } from '../store/media';
import { preview, queueMessage, whyNoMessages } from './messages';

const MAX_BODY = 64 * 1024;
const FILE_NAME_LENGTH = 120;
/** Request ids are UUIDs made here. */
const FEEDBACK_ID = /^[0-9a-f-]{36}$/;
const AGENTCTL = AGENTCTL_COMMAND;

function field(body: unknown, name: string): unknown {
  return (body as Record<string, unknown> | null)?.[name];
}

function requiredText(body: unknown, name: string, max: number): string {
  const v = field(body, name);
  if (typeof v !== 'string' || v.trim() === '') throw new HttpError(400, `${name} is required`);
  if (v.length > max) throw new HttpError(400, `${name} is longer than ${max} characters`);
  return v.trim();
}

function optionalText(body: unknown, name: string, max: number): string | null {
  const v = field(body, name);
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be a string`);
  if (v.length > max) throw new HttpError(400, `${name} is longer than ${max} characters`);
  return v.trim() || null;
}

function feedbackId(value: unknown): string {
  if (typeof value !== 'string' || !FEEDBACK_ID.test(value)) {
    throw new HttpError(400, 'id must be a feedback id, as POST /api/v1/feedback returned it');
  }
  return value;
}

/** FeedbackFormError is the caller's mistake: a 400 with its message. */
function form<T>(read: () => T): T {
  try {
    return read();
  } catch (e) {
    if (e instanceof FeedbackFormError) throw new HttpError(400, e.message);
    throw e;
  }
}

function feedbackEvent(agentId: string, activity: string, at: string): AgentEvent {
  return { id: randomUUID(), agentId, type: 'feedback', at, receivedAt: at, state: null, activity, link: null, details: null };
}

function step(f: Feedback, status: FeedbackStatus, by: string, note: string | null, at: string): Feedback {
  const s: FeedbackStep = { status, at, by, note };
  return { ...f, status, updatedAt: at, history: [...f.history, s] };
}

function media(ctx: Ctx): MediaStore {
  if (!ctx.media) {
    throw new HttpError(503, "Pictures, clips and sounds aren't set up on this Agent Manager Delux (no BLOB_ACCOUNT); the request was kept without it");
  }
  return ctx.media;
}

/** The key's own request, or 404: other keys can't see it exists. */
async function ownRequest(ctx: Ctx, id: string, keyName: string): Promise<Feedback> {
  const found = await ctx.store.getFeedback(id);
  if (!found || found.keyName !== keyName) throw new HttpError(404, `No feedback request with id ${id} for this machine key`);
  return found;
}

/**
 * Records that the agent has read the answer, once. Called when it reads the request with its key,
 * and when the message carrying the answer is posted into its session.
 */
export async function markViewed(ctx: Ctx, id: string, at: string): Promise<Feedback | null> {
  const found = await ctx.store.getFeedback(id);
  if (!found || !canAgentMove(found.status, 'viewed')) return found;
  const next = step(found, 'viewed', found.agentName, null, at);
  await ctx.store.putFeedback(next);
  await ctx.store.addEvents([feedbackEvent(found.agentId, `Read the feedback on "${preview(found.title)}"`, at)]);
  return next;
}

// ---- Agents ----

/** POST /api/v1/feedback: an agent asks for feedback. */
export const createFeedback: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const raw = readJson(req, MAX_BODY);
  const agentId = requiredText(raw, 'agentId', LIMITS.idLength);
  const title = requiredText(raw, 'title', LIMITS.feedbackTitleLength);
  // "details" is what blockers called it.
  const body = optionalText(raw, field(raw, 'body') === undefined ? 'details' : 'body', LIMITS.feedbackBodyLength);
  const questions = form(() => readFeedbackQuestions(field(raw, 'questions')));
  const followsRaw = field(raw, 'follows');
  const follows = followsRaw === undefined || followsRaw === null || followsRaw === '' ? null : feedbackId(followsRaw);
  const test = field(raw, 'test') === true;

  const agent = await ctx.store.getAgent(agentId);
  if (!agent) throw new HttpError(404, `No agent with id ${agentId}: report it first (POST /api/v1/report), then ask`);
  const parent = follows ? await ownRequest(ctx, follows, key.name) : null;

  const at = ctx.now().toISOString();
  const feedback: Feedback = {
    id: randomUUID(),
    agentId,
    agentName: agent.name,
    kind: agent.kind,
    project: agent.project,
    machine: agent.machine,
    title: maskSecrets(title),
    body: body === null ? null : maskSecrets(body),
    questions,
    media: [],
    status: 'open',
    createdAt: at,
    updatedAt: at,
    history: [{ status: 'open', at, by: agent.name, note: null }],
    response: null,
    follows,
    followedBy: null,
    delivery: null,
    messageId: null,
    keyName: key.name,
  };
  const origin = publicOrigin(req, ctx.env);
  const warnings = ctx.media ? [] : ["Pictures, clips and sounds aren't set up on this Agent Manager Delux, so only text can be added"];
  const url = feedbackPage(origin, feedback.id);
  // blockerUrl: what agentctl versions from before feedback print.
  const res: FeedbackCreateResponse & { blockerUrl: string } = { ok: true, test, stored: feedback, warnings, feedbackUrl: url, blockerUrl: url };
  if (test) return ok(res);

  await ctx.store.putFeedback(feedback);
  if (parent) {
    // The earlier round has follow-up questions now, unless it was already done.
    const linked = { ...parent, followedBy: parent.followedBy ?? feedback.id };
    const moved = canAgentMove(parent.status, 'followup') ? step(linked, 'followup', agent.name, `Follow-up: ${feedback.title}`, at) : linked;
    await ctx.store.putFeedback(moved);
  }
  await ctx.store.addEvents([feedbackEvent(agentId, `Asked for feedback: ${preview(feedback.title)}`, at)]);
  await notifyFeedback(ctx, feedback, origin);
  return ok(res, 201);
};

/** The first bytes of each type, so a file can't claim to be something it isn't. */
function looksLike(type: FeedbackMediaType, b: Buffer): boolean {
  const ascii = (start: number, end: number) => b.subarray(start, end).toString('latin1');
  const ebml = b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  switch (type) {
    case 'image/png':
      return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/gif':
      return ascii(0, 4) === 'GIF8';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'video/mp4':
    case 'audio/mp4':
      return ascii(4, 8) === 'ftyp';
    case 'video/webm':
    case 'audio/webm':
      return ebml;
    case 'audio/mpeg':
      // An ID3 tag, or straight into an MPEG frame.
      return ascii(0, 3) === 'ID3' || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0);
    case 'audio/wav':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    case 'audio/ogg':
      return ascii(0, 4) === 'OggS';
  }
}

function fileName(value: string | null): string | null {
  if (!value) return null;
  // eslint-disable-next-line no-control-regex
  const name = basename(value.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name ? name.slice(0, FILE_NAME_LENGTH) : null;
}

/**
 * POST /api/v1/feedback/media?id=<request>&name=<file name>: adds one picture, clip or sound.
 * The body is the file itself, with its Content-Type. Questions and options refer to it by name.
 */
export const addFeedbackMedia: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const params = query(req);
  const id = feedbackId(params.get('id'));
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!(contentType in FEEDBACK_MEDIA_TYPES)) {
    throw new HttpError(415, `Content-Type must be one of ${Object.keys(FEEDBACK_MEDIA_TYPES).join(', ')}`);
  }
  const type = contentType as FeedbackMediaType;
  const kind = FEEDBACK_MEDIA_TYPES[type];
  const bytes = req.raw ?? Buffer.from(req.body, 'utf8');
  const max = kind === 'image' ? LIMITS.feedbackImageBytes : LIMITS.feedbackClipBytes;
  if (bytes.length === 0) throw new HttpError(400, 'The body is empty; send the file itself');
  if (bytes.length > max) {
    throw new HttpError(413, `The ${kind} is ${bytes.length} bytes; the limit is ${max} (${max / 1024 / 1024} MB). Shrink or trim it.`);
  }
  if (!looksLike(type, bytes)) throw new HttpError(415, `The file doesn't look like ${type}`);

  const found = await ownRequest(ctx, id, key.name);
  if (found.status !== 'open') throw new HttpError(409, `The request is ${FEEDBACK_STATUS_LABEL[found.status].toLowerCase()} already`);
  if (found.media.length >= LIMITS.feedbackMedia) throw new HttpError(409, `A request holds at most ${LIMITS.feedbackMedia} files`);

  const item: FeedbackMedia = {
    id: randomUUID(),
    contentType: type,
    kind,
    bytes: bytes.length,
    name: fileName(params.get('name')),
    at: ctx.now().toISOString(),
  };
  await media(ctx).put(`${id}/${item.id}`, bytes, type);
  // Read again: two files sent at once must both be kept.
  const latest = (await ctx.store.getFeedback(id)) ?? found;
  await ctx.store.putFeedback({ ...latest, media: [...latest.media, item] });
  return ok({ ok: true, test: false, stored: item, warnings: [] }, 201);
};

/**
 * GET /api/v1/feedback/item?id=: one request, for the owner or for the key that asked. The agent
 * reading an answered request marks it viewed.
 */
export const feedbackItem: Handler = async (req, ctx) => {
  const id = feedbackId(query(req).get('id'));
  const key = req.headers.get('x-agent-manager-key') ? await requireKey(req, ctx) : null;
  let found: Feedback | null;
  if (key) {
    found = await ownRequest(ctx, id, key.name);
    found = (await markViewed(ctx, id, ctx.now().toISOString())) ?? found;
  } else {
    requireOwner(req, ctx);
    found = await ctx.store.getFeedback(id);
    if (!found) throw new HttpError(404, `No feedback request with id ${id}`);
  }
  const res: FeedbackDetailResponse = { now: ctx.now().toISOString(), feedback: found };
  return ok(res);
};

/** GET /api/v1/feedback/inbox: the key's requests that are answered and not done, so the agent can catch up. */
export const feedbackInbox: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const list = await ctx.store.listFeedbackFor(key.name);
  const res: FeedbackInboxResponse = { now: ctx.now().toISOString(), feedback: list };
  return ok(res);
};

/** POST /api/v1/feedback/status: the agent says what it's doing with the answer. */
export const feedbackStatus: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const body = readJson(req, MAX_BODY);
  const id = feedbackId(field(body, 'id'));
  const status = field(body, 'status');
  const note = optionalText(body, 'note', LIMITS.feedbackStatusNoteLength);
  const found = await ownRequest(ctx, id, key.name);
  if (typeof status !== 'string' || !canAgentMove(found.status, status as FeedbackStatus)) {
    const why =
      found.status === 'open'
        ? "The person hasn't answered yet: you can only close it (withdraw it) or follow it up"
        : FEEDBACK_DONE_STATUSES.includes(found.status)
          ? `It's ${FEEDBACK_STATUS_LABEL[found.status].toLowerCase()} already`
          : 'status must be planning, implementing, closed or followup';
    throw new HttpError(409, `Can't move it from ${found.status} to ${String(status)}: ${why}`);
  }
  const at = ctx.now().toISOString();
  const next = step(found, status as FeedbackStatus, found.agentName, note === null ? null : maskSecrets(note), at);
  await ctx.store.putFeedback(next);
  const label = FEEDBACK_STATUS_LABEL[next.status];
  await ctx.store.addEvents([feedbackEvent(found.agentId, `${label}: ${preview(found.title)}${note ? ` (${preview(note)})` : ''}`, at)]);
  return ok({ ok: true, test: false, stored: next, warnings: [] });
};

// ---- The owner ----

/** GET /api/v1/feedback: everything not done, then what finished recently, with the messages that carried answers. */
export const feedbackList: Handler = async (req, ctx) => {
  requireOwner(req, ctx);
  const now = ctx.now();
  const since = new Date(now.getTime() - FEEDBACK_RECENT_DAYS * 86_400_000).toISOString();
  const list = await ctx.store.listFeedback(since);
  const messages = (
    await Promise.all(list.filter((f) => f.messageId).map((f) => ctx.store.getMessage(f.machine, f.messageId!).catch(() => null)))
  ).filter((m): m is AgentMessage => m !== null);
  const agents: Record<string, FeedbackAgentInfo> = {};
  const agentIds = [...new Set(list.filter((f) => !FEEDBACK_DONE_STATUSES.includes(f.status)).map((f) => f.agentId))];
  for (const a of await Promise.all(agentIds.map((id) => ctx.store.getAgent(id)))) {
    if (a) agents[a.id] = { state: effectiveState(a, now.getTime()), noMessages: whyNoMessages(a, now) };
  }
  const res: FeedbackListResponse = { now: now.toISOString(), feedback: list, messages, agents };
  return ok(res);
};

function parseRange(header: string | null, size: number): MediaRange | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // The last N bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) throw new HttpError(416, `The range ${header} is outside the file (${size} bytes)`);
  return { start, end };
}

/** GET /api/v1/feedback/media?id=<request>&media=<id>: the file, with Range support so clips can seek. */
export const feedbackMedia: Handler = async (req: Req, ctx) => {
  requireOwner(req, ctx);
  const params = query(req);
  const id = feedbackId(params.get('id'));
  const mediaId = params.get('media') ?? '';
  const found = await ctx.store.getFeedback(id);
  const item = found?.media.find((m) => m.id === mediaId);
  if (!found || !item) throw new HttpError(404, 'No such file');

  const range = parseRange(req.headers.get('range'), item.bytes);
  const file = await media(ctx).get(`${id}/${item.id}`, range ?? undefined);
  if (!file) throw new HttpError(404, 'The file is gone: it may have aged out');
  const headers: Record<string, string> = {
    'content-type': item.contentType,
    'accept-ranges': 'bytes',
    // The bytes behind an id never change.
    'cache-control': 'private, max-age=86400, immutable',
    // Agents send these files: never let one run as a page.
    'content-security-policy': "default-src 'none'; sandbox",
    'content-disposition': 'inline',
  };
  if (range) headers['content-range'] = `bytes ${range.start}-${range.start + file.bytes.length - 1}/${file.size}`;
  return { status: range ? 206 : 200, body: null, bytes: file.bytes, headers };
};

/** What the session is told when the owner answers: the answer itself, and what to report next. */
function answerText(f: Feedback, login: string): string {
  const verb = f.status === 'dismissed' ? 'dismissed' : 'answered';
  const head = `${login} ${verb} your feedback request "${f.title}" (${f.id}).`;
  const tail = feedbackNextSteps(f, AGENTCTL);
  const answer = describeFeedbackAnswer(f);
  const room = LIMITS.agentMessageLength - head.length - tail.length - 8;
  const more = `… (cut short: read it all with ${AGENTCTL} feedback ${f.id})`;
  const body = answer.length > room ? `${answer.slice(0, Math.max(0, room - more.length))}${more}` : answer;
  return `${head}\n\n${body}\n\n${tail}`;
}

/** POST /api/v1/feedback/respond: the owner answers a request, dismisses it, or closes one the agent never closed. */
export const respondFeedback: Handler = async (req, ctx) => {
  const owner = requireOwnerWrite(req, ctx);
  const body = readJson(req, MAX_BODY);
  const id = feedbackId(field(body, 'id'));
  const action = field(body, 'action');
  if (action !== 'send' && action !== 'dismiss' && action !== 'close') throw new HttpError(400, 'action must be send, dismiss or close');
  const note = optionalText(body, 'note', LIMITS.feedbackAnswerLength);

  const found = await ctx.store.getFeedback(id);
  if (!found) throw new HttpError(404, `No feedback request with id ${id}`);
  const now = ctx.now();
  const at = now.toISOString();

  if (action === 'close') {
    if (FEEDBACK_DONE_STATUSES.includes(found.status)) throw new HttpError(409, `It's ${FEEDBACK_STATUS_LABEL[found.status].toLowerCase()} already`);
    const done = step(found, 'closed', owner.login, note ?? `Closed by ${owner.login}`, at);
    await ctx.store.putFeedback(done);
    await ctx.store.addEvents([feedbackEvent(found.agentId, `Feedback closed by ${owner.login}: ${preview(found.title)}`, at)]);
    return ok({ feedback: done });
  }

  if (found.status !== 'open') {
    const by = found.response?.by ?? [...found.history].reverse().find((s) => s.status === 'dismissed' || s.status === 'closed')?.by;
    throw new HttpError(409, `It was ${FEEDBACK_STATUS_LABEL[found.status].toLowerCase()} already${by ? ` (${by})` : ''}`);
  }
  const answers = action === 'send' ? form(() => readFeedbackAnswers(found.questions, field(body, 'answers'))) : {};
  if (action === 'send' && note === null && Object.keys(answers).length === 0) {
    throw new HttpError(400, 'Answer a question or write a note, or dismiss it');
  }
  let next =
    action === 'send'
      ? { ...step(found, 'sent', owner.login, null, at), response: { answers, note, by: owner.login, at } }
      : step(found, 'dismissed', owner.login, note, at);
  if (action === 'dismiss' && note) next = { ...next, response: { answers: {}, note, by: owner.login, at } };

  const agent = await ctx.store.getAgent(found.agentId);
  const refused = agent ? whyNoMessages(agent, now) : 'The agent is gone';
  if (agent && !refused) {
    const verb = action === 'send' ? 'Feedback sent' : 'Feedback dismissed';
    const message = await queueMessage(ctx, agent, answerText(next, owner.login), owner.login, `${verb} by ${owner.login}: ${preview(found.title)}`, found.id);
    next = { ...next, messageId: message.id, delivery: `Sent to the session as a message. It arrives if messages are on for ${found.machine}.` };
  } else {
    const why = refused!.charAt(0).toLowerCase() + refused!.slice(1);
    next = { ...next, delivery: `Not sent as a message: ${why}. The agent sees it when it checks its feedback.` };
  }
  await ctx.store.putFeedback(next);
  await ctx.store.addEvents([
    feedbackEvent(found.agentId, `Feedback ${action === 'send' ? 'sent' : 'dismissed'} by ${owner.login}: ${preview(found.title)}`, at),
  ]);
  return ok({ feedback: next });
};

// ---- For agentctl versions from before feedback ----

/** GET /api/v1/blocker?id=: the request in the shape `agentctl blocker <id>` reads. */
export const legacyBlocker: Handler = async (req, ctx) => {
  const res = await feedbackItem(req, ctx);
  if (res.status !== 200) return res;
  const f = (res.body as FeedbackDetailResponse).feedback;
  const answered = f.status !== 'open';
  const resolution = answered ? describeFeedbackAnswer(f) : null;
  return ok({
    now: (res.body as FeedbackDetailResponse).now,
    blocker: {
      ...f,
      details: f.body,
      status: !answered ? 'open' : f.history.some((s) => s.status === 'dismissed') ? 'dismissed' : 'resolved',
      resolvedAt: f.response?.at ?? (answered ? f.updatedAt : null),
      resolvedBy: f.response?.by ?? null,
      resolution,
    },
  });
};
