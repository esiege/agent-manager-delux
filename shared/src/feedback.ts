// Feedback requests: checking the questions an agent sends, reading requests stored before
// feedback replaced blockers, and the text an agent reads back (agentctl and session messages).

import {
  FEEDBACK_AGENT_STATUSES,
  LIMITS,
  type Feedback,
  type FeedbackAnswerValue,
  type FeedbackOption,
  type FeedbackQuestion,
  type FeedbackStatus,
  type FeedbackStep,
} from './contract';
import { maskSecrets } from './mask';

/** How agents run agentctl, in text written for them. */
export const AGENTCTL_COMMAND = 'node "$HOME/.agent-manager/agentctl.js"';

/** How each status reads on the page and to the agent. */
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: 'Waiting on you',
  sent: 'Sent',
  dismissed: 'Dismissed',
  viewed: 'Agent viewed',
  planning: 'Agent planning',
  implementing: 'Agent implementing',
  closed: 'Approved and closed',
  followup: 'Follow-up questions',
};

export class FeedbackFormError extends Error {}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const MEDIA_NAMES_PER_QUESTION = 6;

function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new FeedbackFormError(`${what} must be an object`);
  return v as Record<string, unknown>;
}

function text(r: Record<string, unknown>, name: string, what: string, max: number, required: boolean): string | null {
  const v = r[name];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw new FeedbackFormError(`${what}.${name} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new FeedbackFormError(`${what}.${name} must be a string`);
  if (v.length > max) throw new FeedbackFormError(`${what}.${name} is longer than ${max} characters`);
  return maskSecrets(v.trim());
}

function id(r: Record<string, unknown>, what: string, fallback: string, taken: Set<string>): string {
  // A number is fine too: "id": 1 is "1".
  const v = typeof r.id === 'number' && Number.isInteger(r.id) ? String(r.id) : r.id;
  let out = fallback;
  if (v !== undefined && v !== null) {
    if (typeof v !== 'string' || !ID.test(v)) throw new FeedbackFormError(`${what}.id must be 1 to 40 letters, digits, - or _ (or leave it out: it's filled in)`);
    out = v;
  }
  if (taken.has(out)) throw new FeedbackFormError(`${what}.id "${out}" is used twice`);
  taken.add(out);
  return out;
}

/** Just the file's name, as it was attached: folders are dropped. */
export function feedbackFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop()!.trim();
}

/** Captions found while reading a form, by file name. */
type Captions = Record<string, string>;

/**
 * A file a question or option points at: a name, or { "file": "<name>", "caption": "<text>" }.
 * Returns the name; a caption goes into `captions`.
 */
function mediaName(v: unknown, what: string, captions: Captions): string {
  let file = v;
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const r = v as Record<string, unknown>;
    file = r.file ?? r.name;
    const caption = text(r, 'caption', what, LIMITS.feedbackCaptionLength, false);
    if (typeof file === 'string' && caption) captions[feedbackFileName(file)] = caption;
  }
  if (typeof file !== 'string' || file.trim() === '') throw new FeedbackFormError(`${what} must be a file name, or { "file": "<name>", "caption": "<text>" }`);
  const name = feedbackFileName(file);
  if (!name || name.length > 120) throw new FeedbackFormError(`${what} must be a file name of at most 120 characters`);
  return name;
}

function mediaList(r: Record<string, unknown>, what: string, captions: Captions): string[] | undefined {
  const v = r.media;
  if (v === undefined || v === null) return undefined;
  const list = Array.isArray(v) ? v : [v];
  if (list.length > MEDIA_NAMES_PER_QUESTION) throw new FeedbackFormError(`${what}.media has more than ${MEDIA_NAMES_PER_QUESTION} files`);
  const names = list.map((m, i) => mediaName(m, `${what}.media[${i}]`, captions));
  return names.length ? names : undefined;
}

function option(raw: unknown, what: string, index: number, taken: Set<string>, captions: Captions): FeedbackOption {
  // A bare string is a label.
  const r = typeof raw === 'string' ? { label: raw } : obj(raw, what);
  const out: FeedbackOption = { id: id(r, what, String(index + 1), taken), label: text(r, 'label', what, LIMITS.feedbackOptionLength, true)! };
  const detail = text(r, 'detail', what, LIMITS.feedbackOptionDetailLength, false);
  if (detail) out.detail = detail;
  if (r.media !== undefined && r.media !== null) out.media = mediaName(r.media, `${what}.media`, captions);
  return out;
}

/** Captions sent on their own, as { "<file name>": "<caption>" }. */
export function readFeedbackCaptions(raw: unknown): Captions {
  if (raw === undefined || raw === null) return {};
  const r = obj(raw, 'captions');
  const out: Captions = {};
  for (const [name, caption] of Object.entries(r)) {
    if (typeof caption !== 'string') throw new FeedbackFormError(`captions.${name} must be text`);
    if (caption.length > LIMITS.feedbackCaptionLength) throw new FeedbackFormError(`captions.${name} is longer than ${LIMITS.feedbackCaptionLength} characters`);
    if (caption.trim()) out[feedbackFileName(name)] = maskSecrets(caption.trim());
  }
  return out;
}

/** Checks and tidies the questions an agent sends; see readFeedbackForm. */
export function readFeedbackQuestions(raw: unknown): FeedbackQuestion[] {
  return readFeedbackForm(raw).questions;
}

/**
 * Checks and tidies the questions an agent sends. Ids are optional (q1, q2… and 1, 2…; numbers are
 * fine), a choice option can be a bare string, "recommended" can be an option's id or its label,
 * and a rating's max defaults to 5. Files can carry captions: { "file", "caption" }, which come
 * back in `captions`. Throws FeedbackFormError.
 */
export function readFeedbackForm(raw: unknown): { questions: FeedbackQuestion[]; captions: Captions } {
  const captions: Captions = {};
  if (raw === undefined || raw === null) return { questions: [], captions };
  if (!Array.isArray(raw)) throw new FeedbackFormError('questions must be a list');
  if (raw.length > LIMITS.feedbackQuestions) throw new FeedbackFormError(`questions holds at most ${LIMITS.feedbackQuestions}`);
  const taken = new Set<string>();
  const questions = raw.map((item, i): FeedbackQuestion => {
    const what = `questions[${i}]`;
    const r = obj(item, what);
    const media = mediaList(r, what, captions);
    const base = {
      id: id(r, what, `q${i + 1}`, taken),
      prompt: text(r, 'prompt', what, LIMITS.feedbackPromptLength, true)!,
      ...(media ? { media } : {}),
    };
    const type = r.type ?? (r.options ? 'choice' : 'text');
    if (type === 'text') {
      const placeholder = text(r, 'placeholder', what, LIMITS.feedbackOptionLength, false);
      return { ...base, type, ...(placeholder ? { placeholder } : {}) };
    }
    if (type === 'choice') {
      if (!Array.isArray(r.options) || r.options.length < 2 || r.options.length > LIMITS.feedbackOptions) {
        throw new FeedbackFormError(`${what}.options must hold 2 to ${LIMITS.feedbackOptions} options`);
      }
      const ids = new Set<string>();
      const options = r.options.map((o, j) => option(o, `${what}.options[${j}]`, j, ids, captions));
      let recommended: string | null = null;
      if (r.recommended !== undefined && r.recommended !== null) {
        // The option's id, or its label.
        const want = String(r.recommended);
        const match = options.find((o) => o.id === want) ?? options.find((o) => o.label.toLowerCase() === want.toLowerCase());
        if (!match) {
          throw new FeedbackFormError(`${what}.recommended must be an option's label or id: ${options.map((o) => `"${o.label}" (${o.id})`).join(', ')}`);
        }
        recommended = match.id;
      }
      if (r.multiple !== undefined && typeof r.multiple !== 'boolean') throw new FeedbackFormError(`${what}.multiple must be true or false`);
      return { ...base, type, options, ...(r.multiple ? { multiple: true } : {}), ...(recommended ? { recommended } : {}) };
    }
    if (type === 'rating') {
      const max = r.max ?? 5;
      if (typeof max !== 'number' || !Number.isInteger(max) || max < 2 || max > LIMITS.feedbackRatingMax) {
        throw new FeedbackFormError(`${what}.max must be a whole number from 2 to ${LIMITS.feedbackRatingMax}`);
      }
      const low = text(r, 'low', what, LIMITS.feedbackOptionLength, false);
      const high = text(r, 'high', what, LIMITS.feedbackOptionLength, false);
      // true for the usual words, or the words to use.
      const na =
        r.notApplicable === true
          ? "Didn't see it"
          : r.notApplicable === false || r.notApplicable === undefined
            ? null
            : text(r, 'notApplicable', what, LIMITS.feedbackOptionLength, false);
      return { ...base, type, max, ...(low ? { low } : {}), ...(high ? { high } : {}), ...(na ? { notApplicable: na } : {}) };
    }
    throw new FeedbackFormError(`${what}.type must be text, choice or rating`);
  });
  return { questions, captions };
}

/**
 * Checks the owner's answers against the questions. Unknown question ids, options that aren't
 * offered and scores out of range are refused; blank text answers are dropped.
 */
export function readFeedbackAnswers(questions: FeedbackQuestion[], raw: unknown): Record<string, FeedbackAnswerValue> {
  if (raw === undefined || raw === null) return {};
  const r = obj(raw, 'answers');
  const out: Record<string, FeedbackAnswerValue> = {};
  for (const [qid, value] of Object.entries(r)) {
    const q = questions.find((x) => x.id === qid);
    if (!q) throw new FeedbackFormError(`answers.${qid}: there's no question with that id`);
    const what = `answers.${qid}`;
    if (q.type === 'text') {
      if (typeof value !== 'string') throw new FeedbackFormError(`${what} must be text`);
      if (value.length > LIMITS.feedbackAnswerLength) throw new FeedbackFormError(`${what} is longer than ${LIMITS.feedbackAnswerLength} characters`);
      if (value.trim()) out[qid] = value.trim();
    } else if (q.type === 'choice') {
      const picked = Array.isArray(value) ? value : [value];
      if (picked.some((p) => typeof p !== 'string' || !q.options.some((o) => o.id === p))) {
        throw new FeedbackFormError(`${what} must be one of ${q.options.map((o) => o.id).join(', ')}`);
      }
      if (!q.multiple && picked.length > 1) throw new FeedbackFormError(`${what} takes one option`);
      if (picked.length) out[qid] = q.multiple ? [...new Set(picked as string[])] : (picked[0] as string);
    } else {
      if (value === 'n/a' && q.notApplicable) {
        out[qid] = 'n/a';
        continue;
      }
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > q.max) {
        throw new FeedbackFormError(`${what} must be a whole number from 1 to ${q.max}${q.notApplicable ? ', or "n/a"' : ''}`);
      }
      out[qid] = value;
    }
  }
  return out;
}

/** Notes under questions, by question id. Blank ones are dropped. */
export function readFeedbackNotes(questions: FeedbackQuestion[], raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  const r = obj(raw, 'notes');
  const out: Record<string, string> = {};
  for (const [qid, value] of Object.entries(r)) {
    if (!questions.some((q) => q.id === qid)) throw new FeedbackFormError(`notes.${qid}: there's no question with that id`);
    if (typeof value !== 'string') throw new FeedbackFormError(`notes.${qid} must be text`);
    if (value.length > LIMITS.feedbackQuestionNoteLength) {
      throw new FeedbackFormError(`notes.${qid} is longer than ${LIMITS.feedbackQuestionNoteLength} characters`);
    }
    if (value.trim()) out[qid] = value.trim();
  }
  return out;
}

/** Whether an agent may move a request from one status to the next. */
export function canAgentMove(from: FeedbackStatus, to: FeedbackStatus): boolean {
  if (!(FEEDBACK_AGENT_STATUSES as readonly string[]).includes(to)) return false;
  if (from === 'closed' || from === 'followup') return false;
  // The agent can withdraw a request nobody has answered yet, or say it has more questions.
  if (from === 'open') return to === 'closed' || to === 'followup';
  if (to === 'viewed') return from === 'sent' || from === 'dismissed';
  return true;
}

// ---- Requests stored before feedback replaced blockers ----

interface LegacyBlocker {
  id: string;
  agentId: string;
  agentName: string;
  kind: Feedback['kind'];
  project: string | null;
  machine: string;
  title: string;
  details: string | null;
  media: Feedback['media'];
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  delivery: string | null;
  messageId: string | null;
  keyName: string;
}

/**
 * A stored request as a Feedback. Blockers from before (no history) become requests: an open one
 * stays open; an answered one is closed, since no agent will move it on now.
 */
export function feedbackFromStored(doc: Feedback | LegacyBlocker): Feedback {
  if ('history' in doc && Array.isArray(doc.history)) return doc;
  const b = doc as LegacyBlocker;
  const history: FeedbackStep[] = [{ status: 'open', at: b.createdAt, by: b.agentName, note: null }];
  const answered = b.status !== 'open' && b.resolvedAt !== null;
  if (answered) {
    history.push({ status: b.status === 'resolved' ? 'sent' : 'dismissed', at: b.resolvedAt!, by: b.resolvedBy ?? 'owner', note: null });
    history.push({ status: 'closed', at: b.resolvedAt!, by: b.resolvedBy ?? 'owner', note: 'Answered as a blocker, before feedback' });
  }
  return {
    id: b.id,
    agentId: b.agentId,
    agentName: b.agentName,
    kind: b.kind,
    project: b.project,
    machine: b.machine,
    title: b.title,
    body: b.details,
    questions: [],
    media: b.media ?? [],
    status: answered ? 'closed' : 'open',
    createdAt: b.createdAt,
    updatedAt: b.resolvedAt ?? b.createdAt,
    history,
    response:
      answered && b.status === 'resolved' ? { answers: {}, note: b.resolution, by: b.resolvedBy ?? 'owner', at: b.resolvedAt! } : null,
    follows: null,
    followedBy: null,
    delivery: b.delivery,
    messageId: b.messageId,
    keyName: b.keyName,
  };
}

// ---- What the agent reads ----

function answerLine(q: FeedbackQuestion, value: FeedbackAnswerValue | undefined): string {
  if (value === undefined) return '(no answer)';
  if (q.type === 'text') return String(value);
  if (q.type === 'rating' && value === 'n/a') return q.notApplicable ?? 'n/a';
  if (q.type === 'rating') return `${value} of ${q.max}${value === q.max && q.high ? ` (${q.high})` : value === 1 && q.low ? ` (${q.low})` : ''}`;
  const ids = Array.isArray(value) ? value : [String(value)];
  return ids
    .map((v) => {
      const o = q.options.find((x) => x.id === v);
      const label = o ? `${o.label} [${o.id}]` : v;
      return q.recommended === v ? `${label} (your recommendation)` : label;
    })
    .join(', ');
}

/** The owner's answer, question by question, for the agent. */
export function describeFeedbackAnswer(f: Feedback): string {
  if (f.status === 'dismissed' || (f.response === null && f.history.some((s) => s.status === 'dismissed'))) {
    return 'They dismissed it: no opinion. Go ahead with your default.';
  }
  if (!f.response) return 'No answer yet.';
  const lines: string[] = [];
  for (const q of f.questions) {
    lines.push(`- ${q.prompt}\n  ${answerLine(q, f.response.answers[q.id]).replace(/\n/g, '\n  ')}`);
    const note = f.response.notes?.[q.id];
    if (note) lines.push(`  Note: ${note.replace(/\n/g, '\n  ')}`);
  }
  if (f.response.note) lines.push(f.questions.length ? `Their note:\n${f.response.note}` : f.response.note);
  const files = f.answerMedia ?? [];
  if (files.length) {
    lines.push(`They attached ${files.map((m) => m.name ?? m.kind).join(', ')}. Download them with: agentctl feedback ${f.id} --save <folder>`);
  }
  if (lines.length === 0) lines.push('They sent it without a note: what you showed is good as it is.');
  return lines.join('\n');
}

/** What to run next, so the person can see where their feedback got to. */
export function feedbackNextSteps(f: Feedback, agentctl = 'agentctl'): string {
  const cmd = `${agentctl} feedback status ${f.id}`;
  return [
    'Keep the person posted on this feedback as you go:',
    `  ${cmd} planning                 when you start planning the change`,
    `  ${cmd} implementing             when you start building it`,
    `  ${cmd} closed --note "<what you did, in their words>"   when it's done`,
    `  ${agentctl} feedback ask "<title>" --follows ${f.id} ...   if you have follow-up questions`,
  ].join('\n');
}

/** Everything about one request, for `agentctl feedback <id>` and the message to the session. */
export function describeFeedback(f: Feedback, agentctl = 'agentctl'): string {
  const head = `Feedback ${f.id}: "${f.title}". Status: ${FEEDBACK_STATUS_LABEL[f.status]}.`;
  if (f.status === 'open') {
    const reopened = f.history.slice(1).some((s) => s.status === 'open');
    return reopened
      ? `${head}\nThe person reopened it to change their answer: their earlier answer is withdrawn. Wait for the new one.`
      : `${head}\nThe person hasn't answered yet.`;
  }
  const answer = f.response ?? null;
  const by = answer ? `${answer.by} answered at ${answer.at}:` : 'Their answer:';
  const lines = [head, by, describeFeedbackAnswer(f)];
  const last = f.history[f.history.length - 1];
  if (f.status === 'closed' || f.status === 'followup') {
    if (last?.note) lines.push(`Closing note: ${last.note}`);
    if (f.followedBy) lines.push(`Followed up in ${f.followedBy}.`);
  } else {
    lines.push('', feedbackNextSteps(f, agentctl));
  }
  return lines.join('\n');
}
