// Feedback: an agent asks the owner something, with pictures, clips or sounds and a few typed
// questions (text, a choice, a rating). It shows on the Feedback tab, where the owner answers it,
// or in an email whose signed links open an answer page that needs no sign-in (the /link calls).
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
  type CrashRecord,
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
  readFeedbackCaptions,
  readFeedbackForm,
  readFeedbackNotes,
  type AgentEvent,
  type AgentMessage,
  type Feedback,
  type FeedbackAgentInfo,
  type FeedbackCreateResponse,
  type FeedbackDetailResponse,
  type FeedbackInboxResponse,
  type FeedbackLinkResponse,
  type FeedbackListResponse,
  type FeedbackMedia,
  type FeedbackMediaType,
  type FeedbackStatus,
  type FeedbackStep,
  type Release,
} from '@agent-manager-delux/shared';
import { feedbackPage, linkMediaUrl, notifyFeedback } from '../alerts';
import { requireKey, requireOwner, requireOwnerWrite } from '../auth';
import { HttpError, ok, publicOrigin, query, readJson, type Ctx, type Handler, type Req, type Res } from '../http';
import { readLink } from '../links';
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

function feedbackId(value: unknown, what = 'id'): string {
  if (typeof value !== 'string' || !FEEDBACK_ID.test(value)) {
    throw new HttpError(400, `${what} must be a feedback id, as POST /api/v1/feedback returned it`);
  }
  return value;
}

function optionalId(value: unknown, what: string): string | null {
  return value === undefined || value === null || value === '' ? null : feedbackId(value, what);
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

/** Sends the alerts and emails for a request, once. */
async function notifyOnce(ctx: Ctx, f: Feedback, origin: string): Promise<Feedback> {
  if (f.notifiedAt) return f;
  const latest = (await ctx.store.getFeedback(f.id)) ?? f;
  if (latest.notifiedAt) return latest;
  const next = { ...latest, notifiedAt: ctx.now().toISOString() };
  await ctx.store.putFeedback(next);
  await notifyFeedback(ctx, next, origin);
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
  const { questions, captions: formCaptions } = form(() => readFeedbackForm(field(raw, 'questions')));
  const captions = { ...formCaptions, ...form(() => readFeedbackCaptions(field(raw, 'captions'))) };
  const follows = optionalId(field(raw, 'follows'), 'follows');
  const supersedes = optionalId(field(raw, 'supersedes'), 'supersedes');
  const group = optionalText(raw, 'group', LIMITS.feedbackGroupLength);
  const expectRaw = field(raw, 'expectFiles');
  if (expectRaw !== undefined && (typeof expectRaw !== 'number' || !Number.isInteger(expectRaw) || expectRaw < 0 || expectRaw > LIMITS.feedbackMedia)) {
    throw new HttpError(400, `expectFiles must be a whole number from 0 to ${LIMITS.feedbackMedia}`);
  }
  const expectFiles = (expectRaw as number | undefined) ?? 0;
  const test = field(raw, 'test') === true;

  const agent = await ctx.store.getAgent(agentId);
  if (!agent) throw new HttpError(404, `No agent with id ${agentId}: report it first (POST /api/v1/report), then ask`);
  const parent = follows ? await ownRequest(ctx, follows, key.name) : null;
  const replaced = supersedes ? await ownRequest(ctx, supersedes, key.name) : null;

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
    follows: follows ?? null,
    supersedes,
    followedBy: null,
    group: group === null ? null : maskSecrets(group),
    captions,
    answerMedia: [],
    notifiedAt: null,
    expectFiles,
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
  if (replaced && replaced.id !== parent?.id) {
    // The new one replaces it: close it, so old questions don't pile up.
    const linked = { ...replaced, followedBy: feedback.id };
    const done = FEEDBACK_DONE_STATUSES.includes(replaced.status) ? linked : step(linked, 'closed', agent.name, `Replaced by: ${feedback.title}`, at);
    await ctx.store.putFeedback(done);
  }
  await ctx.store.addEvents([feedbackEvent(agentId, `Asked for feedback: ${preview(feedback.title)}`, at)]);
  // With files to come, the alerts wait for them (or for POST /feedback/ready), so emails have them.
  if (expectFiles === 0) res.stored = await notifyOnce(ctx, feedback, origin);
  return ok(res, 201);
};

/** POST /api/v1/feedback/ready: the agent has attached what it's going to; send the alerts now. */
export const feedbackReady: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const id = feedbackId(field(readJson(req, MAX_BODY), 'id'));
  const found = await ownRequest(ctx, id, key.name);
  const done = await notifyOnce(ctx, found, publicOrigin(req, ctx.env));
  return ok({ ok: true, test: false, stored: done, warnings: [] });
};

/** The first bytes of each type, so a file can't claim to be something it isn't. */
export function looksLike(type: FeedbackMediaType, b: Buffer): boolean {
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

export function fileName(value: string | null): string | null {
  if (!value) return null;
  // eslint-disable-next-line no-control-regex
  const name = basename(value.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name ? name.slice(0, FILE_NAME_LENGTH) : null;
}

/** Checks an uploaded file and stores its bytes. The caller adds the returned item to the request. */
async function receiveFile(req: Req, ctx: Ctx, id: string): Promise<FeedbackMedia> {
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
  const item: FeedbackMedia = {
    id: randomUUID(),
    contentType: type,
    kind,
    bytes: bytes.length,
    name: fileName(query(req).get('name')),
    at: ctx.now().toISOString(),
  };
  await media(ctx).put(`${id}/${item.id}`, bytes, type);
  return item;
}

function mustBeOpen(f: Feedback) {
  if (f.status !== 'open') throw new HttpError(409, `The request is ${FEEDBACK_STATUS_LABEL[f.status].toLowerCase()} already`);
}

/**
 * POST /api/v1/feedback/media?id=<request>&name=<file name>: adds one picture, clip or sound.
 * The body is the file itself, with its Content-Type. Questions and options refer to it by name.
 */
export const addFeedbackMedia: Handler = async (req, ctx) => {
  const key = await requireKey(req, ctx);
  const id = feedbackId(query(req).get('id'));
  const found = await ownRequest(ctx, id, key.name);
  mustBeOpen(found);
  if (found.media.length >= LIMITS.feedbackMedia) throw new HttpError(409, `A request holds at most ${LIMITS.feedbackMedia} files`);
  const item = await receiveFile(req, ctx, id);
  // Read again: two files sent at once must both be kept.
  const latest = (await ctx.store.getFeedback(id)) ?? found;
  let next: Feedback = { ...latest, media: [...latest.media, item] };
  await ctx.store.putFeedback(next);
  // The last file it said it would send: the alerts can go now.
  if (!next.notifiedAt && next.expectFiles && next.media.length >= next.expectFiles) {
    next = await notifyOnce(ctx, next, publicOrigin(req, ctx.env));
  }
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

/** GET /api/v1/feedback/inbox: the key's requests that aren't done, so the agent can catch up. */
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

export function parseRange(header: string | null, size: number): MediaRange | null {
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

/** One of a request's files, or of its answer's, with Range support so clips can seek. */
async function serveFile(req: Req, ctx: Ctx, f: Feedback | null, mediaId: string): Promise<Res> {
  const item = f ? [...f.media, ...(f.answerMedia ?? [])].find((m) => m.id === mediaId) : undefined;
  if (!f || !item) throw new HttpError(404, 'No such file');
  const range = parseRange(req.headers.get('range'), item.bytes);
  const file = await media(ctx).get(`${f.id}/${item.id}`, range ?? undefined);
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
}

/** GET /api/v1/feedback/media?id=<request>&media=<id>: a file, for the owner or the key that asked. */
export const feedbackMedia: Handler = async (req: Req, ctx) => {
  const params = query(req);
  const id = feedbackId(params.get('id'));
  const key = req.headers.get('x-agent-manager-key') ? await requireKey(req, ctx) : null;
  const found = key ? await ownRequest(ctx, id, key.name) : (requireOwner(req, ctx), await ctx.store.getFeedback(id));
  return serveFile(req, ctx, found, params.get('media') ?? '');
};

/** What the session is told when the owner answers: the answer itself, and what to report next. */
function answerText(f: Feedback, by: string): string {
  const verb = f.status === 'dismissed' ? 'dismissed' : 'answered';
  const head = `${by} ${verb} your feedback request "${f.title}" (${f.id}).`;
  const tail = feedbackNextSteps(f, AGENTCTL);
  const answer = describeFeedbackAnswer(f);
  const room = LIMITS.agentMessageLength - head.length - tail.length - 8;
  const more = `… (cut short: read it all with ${AGENTCTL} feedback ${f.id})`;
  const body = answer.length > room ? `${answer.slice(0, Math.max(0, room - more.length))}${more}` : answer;
  return `${head}\n\n${body}\n\n${tail}`;
}

/** Saves an answer to finish later. The request stays open and the agent isn't told. */
async function saveDraft(ctx: Ctx, found: Feedback, by: string, via: 'site' | 'email', body: unknown): Promise<Feedback> {
  mustBeOpen(found);
  const note = optionalText(body, 'note', LIMITS.feedbackAnswerLength);
  const answers = form(() => readFeedbackAnswers(found.questions, field(body, 'answers')));
  const notes = form(() => readFeedbackNotes(found.questions, field(body, 'notes')));
  const empty = note === null && Object.keys(answers).length === 0 && Object.keys(notes).length === 0;
  const at = ctx.now().toISOString();
  // A save isn't a step: the request is still waiting on you. Its time still moves "Recently changed".
  const next: Feedback = { ...found, updatedAt: at, draft: empty ? null : { answers, ...(Object.keys(notes).length ? { notes } : {}), note, by, at, via } };
  await ctx.store.putFeedback(next);
  return next;
}

/** Sends or dismisses an open request, from the tab or from an email link, and tells the session. */
async function answer(ctx: Ctx, found: Feedback, by: string, via: 'site' | 'email', action: 'send' | 'dismiss', body: unknown): Promise<Feedback> {
  if (found.status !== 'open') {
    const who = found.response?.by ?? [...found.history].reverse().find((s) => s.status === 'dismissed' || s.status === 'closed')?.by;
    throw new HttpError(409, `It was ${FEEDBACK_STATUS_LABEL[found.status].toLowerCase()} already${who ? ` (${who})` : ''}`);
  }
  const note = optionalText(body, 'note', LIMITS.feedbackAnswerLength);
  const answers = action === 'send' ? form(() => readFeedbackAnswers(found.questions, field(body, 'answers'))) : {};
  const notes = form(() => readFeedbackNotes(found.questions, field(body, 'notes')));
  const files = found.answerMedia ?? [];
  if (action === 'send' && note === null && Object.keys(answers).length === 0 && Object.keys(notes).length === 0 && files.length === 0) {
    throw new HttpError(400, 'Answer a question, write a note or attach a file, or dismiss it');
  }
  const now = ctx.now();
  const at = now.toISOString();
  const response = { answers, ...(Object.keys(notes).length ? { notes } : {}), note, by, at, via };
  let next: Feedback =
    action === 'send'
      ? { ...step(found, 'sent', by, null, at), response, draft: null }
      : { ...step(found, 'dismissed', by, note, at), response: note || Object.keys(notes).length || files.length ? response : null, draft: null };

  const agent = await ctx.store.getAgent(found.agentId);
  const refused = agent ? whyNoMessages(agent, now) : 'The agent is gone';
  if (agent && !refused) {
    const verb = action === 'send' ? 'Feedback sent' : 'Feedback dismissed';
    const message = await queueMessage(ctx, agent, answerText(next, by), by, `${verb} by ${by}: ${preview(found.title)}`, found.id);
    next = { ...next, messageId: message.id, delivery: `Sent to the session as a message. It arrives if messages are on for ${found.machine}.` };
  } else {
    const why = refused!.charAt(0).toLowerCase() + refused!.slice(1);
    next = { ...next, delivery: `Not sent as a message: ${why}. The agent sees it when it checks its feedback.` };
  }
  await ctx.store.putFeedback(next);
  await ctx.store.addEvents([
    feedbackEvent(found.agentId, `Feedback ${action === 'send' ? 'sent' : 'dismissed'} by ${by}${via === 'email' ? ' (from an email)' : ''}: ${preview(found.title)}`, at),
  ]);
  return next;
}

/**
 * Takes an answered (or closed) request back to open, to change the answer. The answer becomes the
 * draft, so the card shows it filled in; the session is told the earlier answer is withdrawn.
 */
async function reopen(ctx: Ctx, found: Feedback, by: string): Promise<Feedback> {
  if (found.status === 'open') throw new HttpError(409, "It's open already");
  const now = ctx.now();
  const at = now.toISOString();
  const next: Feedback = {
    ...step(found, 'open', by, `Reopened by ${by}`, at),
    draft: found.response ?? found.draft ?? null,
    response: null,
    delivery: null,
    messageId: null,
  };
  const agent = await ctx.store.getAgent(found.agentId);
  if (agent && !whyNoMessages(agent, now)) {
    const text = `${by} reopened your feedback request "${found.title}" (${found.id}) to change their answer. Their earlier answer is withdrawn: hold off acting on it, and wait for the new one (${AGENTCTL} feedback ${found.id}).`;
    await queueMessage(ctx, agent, text, by, `Feedback reopened by ${by}: ${preview(found.title)}`, found.id);
  }
  await ctx.store.putFeedback(next);
  await ctx.store.addEvents([feedbackEvent(found.agentId, `Feedback reopened by ${by}: ${preview(found.title)}`, at)]);
  return next;
}

/**
 * POST /api/v1/feedback/respond: the owner answers a request, saves an answer to finish later,
 * dismisses it, closes one the agent never closed, or reopens one to change the answer.
 */
export const respondFeedback: Handler = async (req, ctx) => {
  const owner = requireOwnerWrite(req, ctx);
  const body = readJson(req, MAX_BODY);
  const id = feedbackId(field(body, 'id'));
  const action = field(body, 'action');
  if (action !== 'send' && action !== 'save' && action !== 'dismiss' && action !== 'close' && action !== 'reopen') {
    throw new HttpError(400, 'action must be send, save, dismiss, close or reopen');
  }
  const found = await ctx.store.getFeedback(id);
  if (!found) throw new HttpError(404, `No feedback request with id ${id}`);
  if (action === 'save') return ok({ feedback: await saveDraft(ctx, found, owner.login, 'site', body) });
  if (action === 'reopen') return ok({ feedback: await reopen(ctx, found, owner.login) });

  if (action === 'close') {
    if (FEEDBACK_DONE_STATUSES.includes(found.status)) throw new HttpError(409, `It's ${FEEDBACK_STATUS_LABEL[found.status].toLowerCase()} already`);
    const note = optionalText(body, 'note', LIMITS.feedbackAnswerLength);
    const at = ctx.now().toISOString();
    const done = step(found, 'closed', owner.login, note ?? `Closed by ${owner.login}`, at);
    await ctx.store.putFeedback(done);
    await ctx.store.addEvents([feedbackEvent(found.agentId, `Feedback closed by ${owner.login}: ${preview(found.title)}`, at)]);
    return ok({ feedback: done });
  }
  return ok({ feedback: await answer(ctx, found, owner.login, 'site', action, body) });
};

/** Adds a file to the answer of an open request. */
async function attachToAnswer(req: Req, ctx: Ctx, found: Feedback): Promise<FeedbackMedia> {
  mustBeOpen(found);
  if ((found.answerMedia ?? []).length >= LIMITS.feedbackAnswerMedia) {
    throw new HttpError(409, `An answer holds at most ${LIMITS.feedbackAnswerMedia} files`);
  }
  const item = await receiveFile(req, ctx, found.id);
  const latest = (await ctx.store.getFeedback(found.id)) ?? found;
  await ctx.store.putFeedback({ ...latest, answerMedia: [...(latest.answerMedia ?? []), item] });
  return item;
}

async function detachFromAnswer(ctx: Ctx, found: Feedback, mediaId: unknown): Promise<Feedback> {
  mustBeOpen(found);
  const item = (found.answerMedia ?? []).find((m) => m.id === mediaId);
  if (!item) throw new HttpError(404, 'No such file on the answer');
  await media(ctx)
    .delete(`${found.id}/${item.id}`)
    .catch(() => {});
  const next = { ...found, answerMedia: (found.answerMedia ?? []).filter((m) => m.id !== item.id) };
  await ctx.store.putFeedback(next);
  return next;
}

/** POST /api/v1/feedback/answer-media?id=&name=: the owner attaches a file to their answer. */
export const addAnswerMedia: Handler = async (req, ctx) => {
  requireOwnerWrite(req, ctx);
  const id = feedbackId(query(req).get('id'));
  const found = await ctx.store.getFeedback(id);
  if (!found) throw new HttpError(404, `No feedback request with id ${id}`);
  return ok({ ok: true, test: false, stored: await attachToAnswer(req, ctx, found), warnings: [] }, 201);
};

/** POST /api/v1/feedback/answer-media/remove {id, media}: the owner takes a file off their answer. */
export const removeAnswerMedia: Handler = async (req, ctx) => {
  requireOwnerWrite(req, ctx);
  const body = readJson(req, MAX_BODY);
  const id = feedbackId(field(body, 'id'));
  const found = await ctx.store.getFeedback(id);
  if (!found) throw new HttpError(404, `No feedback request with id ${id}`);
  return ok({ feedback: await detachFromAnswer(ctx, found, field(body, 'media')) });
};

// ---- From an email: the signed link is the key ----

/** The request and the address a link is for. A deleted or switched-off subscription kills its links. */
async function fromLink(ctx: Ctx, token: string | null | undefined): Promise<{ f: Feedback; email: string; token: string }> {
  const claims = readLink(ctx.env, token, ctx.now());
  const sub = await ctx.store.getAlert(claims.s);
  if (!sub || sub.channel !== 'email' || !sub.enabled) {
    throw new HttpError(401, 'The email alert this link came from was removed or turned off. Open the request on the Feedback tab instead.');
  }
  const f = await ctx.store.getFeedback(claims.f);
  if (!f) throw new HttpError(404, 'This request is gone: it may have aged out');
  return { f, email: sub.target, token: token! };
}

function linkView(req: Req, ctx: Ctx, f: Feedback, email: string, token: string): FeedbackLinkResponse {
  const origin = publicOrigin(req, ctx.env);
  const mediaUrls: Record<string, string> = {};
  for (const m of [...f.media, ...(f.answerMedia ?? [])]) mediaUrls[m.id] = linkMediaUrl(origin, token, m.id);
  // Only what the page shows: not the machine key's name.
  const { keyName: _key, ...shown } = f;
  return { now: ctx.now().toISOString(), feedback: { ...shown, keyName: '' }, mediaUrls, email, canAnswer: f.status === 'open' };
}

/** GET /api/v1/feedback/link?t=: the request, for the answer page an email links to. */
export const linkFeedback: Handler = async (req, ctx) => {
  const { f, email, token } = await fromLink(ctx, query(req).get('t'));
  return ok(linkView(req, ctx, f, email, token));
};

/** GET /api/v1/feedback/link/media?t=&media=: a file, for the email and its answer page. */
export const linkMedia: Handler = async (req, ctx) => {
  const params = query(req);
  const { f } = await fromLink(ctx, params.get('t'));
  return serveFile(req, ctx, f, params.get('media') ?? '');
};

/** POST /api/v1/feedback/link/respond {t, action, answers, notes, note}: answers from the email's page. */
export const linkRespond: Handler = async (req, ctx) => {
  const body = readJson(req, MAX_BODY);
  const { f, email, token } = await fromLink(ctx, field(body, 't') as string);
  const action = field(body, 'action');
  if (action !== 'send' && action !== 'save' && action !== 'dismiss') throw new HttpError(400, 'action must be send, save or dismiss');
  const done = action === 'save' ? await saveDraft(ctx, f, email, 'email', body) : await answer(ctx, f, email, 'email', action, body);
  return ok({ feedback: linkView(req, ctx, done, email, token).feedback });
};

/** POST /api/v1/feedback/link/answer-media?t=&name=: attaches a file to the answer, from the email's page. */
export const linkAddAnswerMedia: Handler = async (req, ctx) => {
  const { f } = await fromLink(ctx, query(req).get('t'));
  return ok({ ok: true, test: false, stored: await attachToAnswer(req, ctx, f), warnings: [] }, 201);
};

/** POST /api/v1/feedback/link/answer-media/remove {t, media}. */
export const linkRemoveAnswerMedia: Handler = async (req, ctx) => {
  const body = readJson(req, MAX_BODY);
  const { f, email, token } = await fromLink(ctx, field(body, 't') as string);
  const next = await detachFromAnswer(ctx, f, field(body, 'media'));
  return ok({ feedback: linkView(req, ctx, next, email, token).feedback });
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

// ---- Playtest notes ----

/**
 * A playtest note the owner adds on a release: a Feedback item for the agent that sent it, answered
 * as it's made (the note is the answer), so it goes to the session and shows as In progress. The
 * agent moves it on like any other: viewed, planning, implementing, closed.
 */
export async function playtestNote(ctx: Ctx, release: Release, by: string, text: string, releaseUrl: string): Promise<Feedback> {
  const agent = await ctx.store.getAgent(release.agentId);
  if (!agent) throw new HttpError(404, `The agent that sent ${release.version} (${release.agentName}) is gone, so there's no one to send notes to`);
  const at = ctx.now().toISOString();
  const game = release.project ?? release.agentName;
  const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? text;
  const short = firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine;
  const open: Feedback = {
    id: randomUUID(),
    agentId: agent.id,
    agentName: agent.name,
    kind: agent.kind,
    project: release.project,
    machine: agent.machine,
    title: maskSecrets(`Playtest ${release.version}: ${short}`).slice(0, LIMITS.feedbackTitleLength),
    body: maskSecrets(`Playtest note from ${by} on [${game} ${release.version}](${releaseUrl}).`),
    questions: [],
    media: [],
    status: 'open',
    createdAt: at,
    updatedAt: at,
    history: [{ status: 'open', at, by, note: null }],
    response: null,
    follows: null,
    supersedes: null,
    followedBy: null,
    group: release.version.slice(0, LIMITS.feedbackGroupLength),
    release: release.id,
    captions: {},
    answerMedia: [],
    // The owner wrote it: no alert or email about it.
    notifiedAt: at,
    expectFiles: 0,
    delivery: null,
    messageId: null,
    keyName: release.keyName,
  };
  return answer(ctx, open, by, 'site', 'send', { note: text });
}

// ---- Crashes ----

/** The question a crash's Feedback item asks; its answer is shown with the crash. */
export const CRASH_QUESTION_ID = 'doing';

/**
 * After a crash: a Feedback item asking the owner what they were doing. The game can't ask (the
 * machine it crashed on may have no agentctl), so the manager asks for it. The answer stays on
 * the item and shows on the crash's page and in `agentctl crashes <id>`.
 */
export async function askAboutCrash(ctx: Ctx, crash: CrashRecord, origin: string, machineName: string | null): Promise<Feedback> {
  const at = ctx.now().toISOString();
  const where = machineName ? `${machineName} (${crash.machine})` : crash.machine;
  const crashUrl = `${origin}/performance/crash?id=${encodeURIComponent(crash.id)}`;
  const lines = [
    `**${crash.reason}**`,
    '',
    `${crash.game}${crash.build ? ` ${crash.build}` : ''} crashed on ${where}${crash.scene ? `, in ${crash.scene}` : ''}.`,
    '',
    `[Open the crash](${crashUrl}): callstack, log and what led up to it.`,
  ];
  const feedback: Feedback = {
    id: randomUUID(),
    agentId: `crash-reporter/${crash.game}`,
    agentName: `${crash.game} crashes`,
    kind: 'other',
    project: crash.game,
    machine: crash.machine,
    title: maskSecrets(`${crash.game} crashed on ${machineName ?? crash.machine}`),
    body: maskSecrets(lines.join('\n')),
    questions: [
      {
        id: CRASH_QUESTION_ID,
        type: 'text',
        prompt: 'What were you doing when it crashed?',
        placeholder: 'In a match, opening the map, alt-tabbing…',
      },
    ],
    media: [],
    status: 'open',
    createdAt: at,
    updatedAt: at,
    history: [{ status: 'open', at, by: `${crash.game} crashes`, note: null }],
    response: null,
    follows: null,
    supersedes: null,
    followedBy: null,
    group: crash.build,
    captions: {},
    answerMedia: [],
    notifiedAt: null,
    expectFiles: 0,
    delivery: null,
    messageId: null,
    keyName: crash.keyName,
  };
  await ctx.store.putFeedback(feedback);
  return notifyOnce(ctx, feedback, origin);
}

/** What the owner said they were doing, from a crash's Feedback item. */
export function crashAnswer(f: Feedback | null): { by: string; at: string; text: string } | null {
  const r = f?.response;
  if (!r) return null;
  const answer = r.answers[CRASH_QUESTION_ID];
  const parts = [typeof answer === 'string' ? answer : '', r.notes?.[CRASH_QUESTION_ID] ?? '', r.note ?? ''].map((s) => s.trim()).filter(Boolean);
  return parts.length ? { by: r.by, at: r.at, text: parts.join('\n\n') } : null;
}
