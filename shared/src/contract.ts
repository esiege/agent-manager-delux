// The data contract shared by the API, the web UI and the reporter.
// Spec: Docs/Spec-v2.md, "Reporting API".

export const API_BASE = '/api/v1';

/** Bump when Docs/instructions.md changes in a way agents must act on (I-05). */
export const INSTRUCTIONS_VERSION = 7;
/** When the instructions and agentctl last changed. web/public/update.md shows the same date. */
export const INSTRUCTIONS_UPDATED = '2026-11-16';

export const AGENT_KINDS = ['claude-code', 'openclaw', 'service', 'other'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** States an agent can report. "lost" is never reported: the manager derives it from silence. */
export const REPORTED_STATES = ['working', 'waiting', 'idle', 'stopped', 'failed'] as const;
export type ReportedState = (typeof REPORTED_STATES)[number];
export type AgentState = ReportedState | 'lost';

/**
 * A turn is one request: it starts with a prompt and ends when the agent finishes, fails, or is
 * cut off. "interrupted" means it never finished: a new prompt came first, or the session closed.
 * A turn still "running" on an agent that went Lost was cut off too; see unfinishedReason().
 */
export const TURN_OUTCOMES = ['running', 'finished', 'failed', 'interrupted'] as const;
export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

/**
 * What an alert subscription can be told about. "unfinished": interrupted, or lost mid-request.
 * "blocker": an agent asked for feedback (the name is from when the Feedback tab was Blockers;
 * saved subscriptions hold it, so it stays).
 */
export const ALERT_EVENTS = ['finished', 'waiting', 'failed', 'unfinished', 'blocker'] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

/**
 * Where alerts go. ntfy (https://ntfy.sh) is free: the phone app shows them like texts. Email goes
 * through Azure Communication Services; feedback emails can be answered from the email.
 */
export const ALERT_CHANNELS = ['ntfy', 'email'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

/**
 * The kinds of work the Reporting tab breaks time and tokens down by. Agents name theirs with
 * `agentctl story --type`; work that doesn't say is sorted by workType() in work.ts.
 */
export const WORK_TYPES = [
  'feature',
  'bugfix',
  'testing',
  'refactor',
  'infra',
  'docs',
  'level-design',
  'game-design',
  'writing',
  'art',
  'community',
  'planning',
  'other',
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const LIMITS = {
  reportBytes: 64 * 1024,
  heartbeatAgents: 500,
  idLength: 200,
  nameLength: 120,
  activityLength: 500,
  storyLength: 300,
  taskLength: 300,
  promptLength: 2000,
  resultTitleLength: 200,
  resultSummaryLength: 8000,
  resultChecks: 12,
  resultCheckLength: 300,
  messageLength: 8000,
  /** A message the owner sends to an agent from the UI. */
  agentMessageLength: 4000,
  linkLength: 2000,
  /** Models in one report's token usage. */
  usageModels: 10,
  perfBytes: 512 * 1024,
  perfSamplesPerCall: 500,
  /** Custom numbers on one performance sample. */
  perfMetrics: 32,
  perfMetricNameLength: 60,
  /** Single slow frames in one call, and the worst of them kept on a session. */
  perfHitchesPerCall: 200,
  perfHitchesKept: 50,
  /** Logged errors in one call, and the distinct messages kept on a session (the first ones). */
  perfErrorsPerCall: 100,
  perfErrorsKept: 30,
  perfErrorMessageLength: 1000,
  /** A crash's one-line reason, and its callstack. */
  perfCrashReasonLength: 1000,
  perfCrashCallstackLength: 16000,
  /** The tail of the game's log kept with a crash, and its breadcrumbs. */
  crashLogLength: 32000,
  crashBreadcrumbs: 100,
  crashBreadcrumbLength: 300,
  /** An Unreal crash report upload, minidump included. */
  crashUploadBytes: 64 * 1024 * 1024,
  machineNameLength: 40,
  perfScenesKept: 50,
  /** A feedback request's one-line title, and its Markdown body. */
  feedbackTitleLength: 200,
  feedbackBodyLength: 8000,
  feedbackQuestions: 8,
  feedbackPromptLength: 500,
  feedbackOptions: 8,
  feedbackOptionLength: 200,
  feedbackOptionDetailLength: 500,
  feedbackRatingMax: 10,
  /** The owner's answer to one text question, and their note. */
  feedbackAnswerLength: 4000,
  /** A note the agent sends with a status. */
  feedbackStatusNoteLength: 1000,
  /** Pictures, clips and sounds on one request. */
  feedbackMedia: 12,
  feedbackImageBytes: 8 * 1024 * 1024,
  /** Videos and sounds. */
  feedbackClipBytes: 25 * 1024 * 1024,
  /** A tag that groups requests, such as a release ("v0.20.0"). */
  feedbackGroupLength: 80,
  /** A caption under a picture, clip or sound. */
  feedbackCaptionLength: 300,
  /** A note under one question. */
  feedbackQuestionNoteLength: 2000,
  /** Files the owner attaches to an answer. */
  feedbackAnswerMedia: 6,
  /** A release: its version ("v0.20.0"), its name, its change notes (Markdown) and the agent's comments. */
  releaseVersionLength: 80,
  releaseTitleLength: 200,
  releaseNotesLength: 20000,
  releaseCommentLength: 4000,
  /** Extra links on a release (downloads, store pages), and each one's label. */
  releaseLinks: 8,
  releaseLinkLabelLength: 80,
} as const;

/** Owner calls that change something must carry this header, which another site can't add (CSRF). */
export const OWNER_WRITE_HEADER = 'x-agent-manager-owner';

/** An agent with no report or heartbeat for this long is Lost (R-02). */
export const DEFAULT_LOST_AFTER_SECONDS = 180;
/** Stopped agents stay listed this long (Goal 1). */
export const RECENT_DAYS = 7;

// ---- What agents send ----

/** POST /api/v1/report */
export interface ReportInput {
  agentId: string;
  kind: AgentKind;
  machine: string;
  name?: string;
  project?: string | null;
  parentId?: string | null;
  state?: ReportedState;
  activity?: string | null;
  /** The story or goal the agent is on: a ticket and its title when there is one, else a summary. */
  story?: string | null;
  /** The technical step it is on now. */
  task?: string | null;
  /** The person's latest prompt to it. */
  prompt?: string | null;
  /** "start" when a prompt starts a new request, "end" when the agent finishes it. */
  turn?: 'start' | 'end';
  /** The report of finished work (see WorkResult). */
  result?: WorkResultInput;
  /** The kind of work the agent is doing, for the Reporting tab. */
  workType?: WorkType | null;
  /** Tokens used since the agent's last report that carried usage, one entry per model. */
  usage?: TokenUsage[];
  link?: string | null;
  details?: Record<string, unknown>;
  /** How long silence means Lost. Agents that heartbeat rarely raise it. */
  lostAfterSeconds?: number;
  instructionsVersion?: number;
  /** When it happened, ISO 8601. Defaults to when the manager received it. */
  at?: string;
  /** Validate without storing (R-04). */
  test?: boolean;
}

/** POST /api/v1/heartbeat: the agents of one kind still alive on one machine. */
export interface HeartbeatInput {
  machine: string;
  kind: AgentKind;
  agentIds: string[];
  at?: string;
  /** Sent by agentctl 6 and later: which agentctl is running, and how its last self-update went. */
  agentctl?: AgentctlState;
  test?: boolean;
}

/** The agentctl a PC runs, as its heartbeat tells it. */
export interface AgentctlState {
  /** SHA-256 of the running agentctl.js, in hex. Equal to the deployed one's when up to date. */
  sha256: string;
  /** False when the person turned self-updates off on this PC (agentctl install --no-auto-update). */
  autoUpdate: boolean;
  /** The last self-update it tried, if any. */
  update?: AgentctlUpdateAttempt;
}

export const AGENTCTL_UPDATE_STATUSES = ['updating', 'updated', 'failed'] as const;
export type AgentctlUpdateStatus = (typeof AGENTCTL_UPDATE_STATUSES)[number];

export interface AgentctlUpdateAttempt {
  /** The update request it acted on: its requestedAt. */
  requestedAt: string;
  /** The agentctl it was updating to. */
  sha256: string;
  status: AgentctlUpdateStatus;
  at: string;
  /** Why it failed, in one line. */
  error?: string;
}

/** The owner's "Auto-update all PCs": every PC with self-updates on moves to the agentctl deployed then. */
export interface AgentctlUpdateRequest {
  requestedAt: string;
  /** The deployed agentctl.js the PCs should run. */
  sha256: string;
  by: string;
}

/** What the manager knows about one PC's agentctl, from its heartbeats. */
export interface MachineRecord {
  machine: string;
  kind: AgentKind;
  beatAt: string;
  agentctl: AgentctlState;
}

/** GET /api/v1/agentctl, as the owner: the deployed agentctl, the update request, and every PC. */
export interface AgentctlStatusResponse {
  now: string;
  /** SHA-256 of the agentctl.js deployed with this API. Null in development builds. */
  latest: string | null;
  request: AgentctlUpdateRequest | null;
  machines: (MachineRecord & { upToDate: boolean })[];
}

/** POST /api/v1/agentctl/update, as the owner. */
export interface AgentctlUpdateResponse {
  ok: true;
  request: AgentctlUpdateRequest;
}

/** The report an agent gives when it finishes a piece of work. */
export interface WorkResultInput {
  /** A short name for the work: the commit's subject when it committed. */
  title: string;
  /** What was done, in Markdown. */
  summary: string;
  /** Acceptance steps: what the person should see now, one short line each. */
  checks?: string[];
  /** The prompt it answers. Defaults to the agent's current prompt. */
  prompt?: string | null;
  commit?: string | null;
  /** A web link to the commit, such as https://github.com/<owner>/<repo>/commit/<sha>. */
  commitUrl?: string | null;
  branch?: string | null;
  /** Whether the commit is on the remote yet; the link only works once it is. */
  pushed?: boolean | null;
}

/** Tokens one model used. The counts don't overlap: `input` leaves out cache reads and writes. */
export interface TokenUsage {
  model: string;
  /** Input tokens not read from or written to the cache. */
  input: number;
  output: number;
  /** Input tokens written to the cache, all lifetimes. */
  cacheWrite: number;
  /** The part of cacheWrite written for an hour, which costs more than the 5-minute default. */
  cacheWrite1h: number;
  cacheRead: number;
}

// ---- What the manager stores and returns ----

export interface WorkResult {
  title: string;
  summary: string;
  checks: string[];
  prompt: string | null;
  commit: string | null;
  commitUrl: string | null;
  branch: string | null;
  pushed: boolean | null;
  at: string;
}

export interface AgentTurn {
  prompt: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: TurnOutcome;
  /** Why it didn't finish, in a few words. */
  reason: string | null;
}

export interface Agent {
  id: string;
  kind: AgentKind;
  name: string;
  machine: string;
  project: string | null;
  parentId: string | null;
  state: ReportedState;
  activity: string | null;
  story: string | null;
  task: string | null;
  prompt: string | null;
  /** When the current prompt was sent. */
  promptAt: string | null;
  /** The latest request and how it ended. */
  turn: AgentTurn | null;
  /** The latest report of finished work. */
  result: WorkResult | null;
  /** The kind of work it last said it was doing. */
  workType?: WorkType | null;
  link: string | null;
  details: Record<string, unknown>;
  /** Tokens it has used in all, one entry per model, counted from its reports' usage. */
  usageTotals?: TokenUsage[];
  lostAfterSeconds: number;
  instructionsVersion: number | null;
  firstSeen: string;
  lastSeen: string;
  lastReportAt: string;
  endedAt: string | null;
  /** Name of the machine key that last wrote this agent. */
  keyName: string;
  /** The request (its turn.startedAt) a "connection lost" alert went out for, so it goes once. */
  lostAlertFor?: string | null;
  /** When the owner hid it. Hidden agents are left out of every list in the UI. */
  hiddenAt?: string | null;
}

/** An agent as the UI sees it: with its derived state. */
export interface AgentView extends Agent {
  effectiveState: AgentState;
  runningChildren: number;
}

/** "blocker" is on events from before feedback replaced blockers. */
export type AgentEventType = 'report' | 'state' | 'action' | 'result' | 'turn' | 'message' | 'blocker' | 'feedback' | 'release';

export interface AgentEvent {
  id: string;
  agentId: string;
  type: AgentEventType;
  at: string;
  receivedAt: string;
  state: ReportedState | null;
  activity: string | null;
  story?: string | null;
  task?: string | null;
  prompt?: string | null;
  result?: WorkResult | null;
  /** On "turn" events: how the turn ended. */
  turn?: AgentTurn | null;
  workType?: WorkType | null;
  /** Tokens the report said were used. */
  usage?: TokenUsage[] | null;
  link: string | null;
  details: Record<string, unknown> | null;
}

export interface AlertSubscription {
  id: string;
  /** Who or what it's for, such as "My phone". */
  name: string;
  channel: AlertChannel;
  /** For ntfy: the topic's full URL, such as https://ntfy.sh/<a long random topic>. For email: the address. */
  target: string;
  events: AlertEvent[];
  /** Only these projects; empty means all. */
  projects: string[];
  enabled: boolean;
  createdAt: string;
  lastSentAt: string | null;
  /** The last delivery error, cleared by the next success. */
  lastError: string | null;
}

/** POST /api/v1/alerts: create (no id) or update a subscription. */
export interface AlertSubscriptionInput {
  id?: string;
  name: string;
  channel: AlertChannel;
  target: string;
  events: AlertEvent[];
  projects?: string[];
  enabled?: boolean;
}

export interface AlertsResponse {
  subscriptions: AlertSubscription[];
}

/**
 * What a key may do. "all": everything agents do, performance data included. "perf": only send
 * performance data, so it can ship inside a game build without giving away the rest.
 */
export const KEY_SCOPES = ['all', 'perf'] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];

export interface MachineKey {
  id: string;
  name: string;
  scope: KeyScope;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// ---- Messages to agents (Docs/Agent-Messaging-Findings.md) ----

/** How long a message waits for its PC to collect it. A late prompt is worse than none. */
export const MESSAGE_TTL_SECONDS = 600;

/** "expired" is never stored: a pending message past its expiresAt is shown as expired. */
export const MESSAGE_STATUSES = ['pending', 'delivered', 'failed', 'expired'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Text the owner sends to a Claude Code session from the UI. agentctl on the session's PC
 * collects it and posts it into the session's inbox.
 */
export interface AgentMessage {
  id: string;
  agentId: string;
  machine: string;
  /** The machine key that reports the agent. Only that key can collect the message. */
  keyName: string;
  text: string;
  /** The owner's login. */
  from: string;
  createdAt: string;
  expiresAt: string;
  status: MessageStatus;
  /** When it was delivered or failed. */
  doneAt: string | null;
  /** Why it failed. */
  reason: string | null;
  /** The feedback request whose answer it carries: delivering it marks the request viewed. */
  feedbackId?: string | null;
}

/** POST /api/v1/messages, as the owner. */
export interface SendMessageInput {
  agentId: string;
  text: string;
}

export interface SendMessageResponse {
  message: AgentMessage;
}

/** POST /api/v1/inbox, with a machine key: the messages waiting for agents on one machine. */
export interface InboxInput {
  machine: string;
}

export interface InboxResponse {
  /** Oldest first. */
  messages: AgentMessage[];
}

/** POST /api/v1/inbox/ack, with a machine key: what happened to one message. */
export interface MessageAckInput {
  id: string;
  machine: string;
  status: 'delivered' | 'failed';
  reason?: string;
}

/** POST /api/v1/agents/hide, as the owner: hide agents from the UI, or show them again. */
export interface HideAgentsInput {
  agentIds: string[];
  hidden: boolean;
}

export interface HideAgentsResponse {
  /** The ids that were found and changed. */
  agentIds: string[];
}

// ---- Feedback: an agent asks the owner, the owner answers, the agent reports what it did ----

/**
 * Where a feedback request is. The owner moves it from "open" to "sent" (answered) or "dismissed"
 * (no opinion: use your default), and can reopen it (back to "open") to change the answer. The agent then moves it on: "viewed" (it read the answer: set on
 * its own when it does), "planning", "implementing", and finally "closed" (done as asked) or
 * "followup" (it has more questions, in a new request that follows this one).
 */
export const FEEDBACK_STATUSES = ['open', 'sent', 'dismissed', 'viewed', 'planning', 'implementing', 'closed', 'followup'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** The statuses an agent sets with POST /feedback/status. "viewed" is also set on its own. */
export const FEEDBACK_AGENT_STATUSES = ['viewed', 'planning', 'implementing', 'closed', 'followup'] as const;
export type FeedbackAgentStatus = (typeof FEEDBACK_AGENT_STATUSES)[number];

/** Nothing more happens to a request in these. */
export const FEEDBACK_DONE_STATUSES: readonly FeedbackStatus[] = ['closed', 'followup'];

/** What a request can show. Anything else is refused, so the page never renders unknown types. */
export const FEEDBACK_MEDIA_TYPES = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'audio/mp4': 'audio',
  'audio/webm': 'audio',
} as const;
export type FeedbackMediaType = keyof typeof FEEDBACK_MEDIA_TYPES;
export type FeedbackMediaKind = (typeof FEEDBACK_MEDIA_TYPES)[FeedbackMediaType];

/** Closed and followed-up requests stay listed this long after their last change. */
export const FEEDBACK_RECENT_DAYS = 7;

/** A picture, clip or sound attached to a request. The bytes are fetched from /feedback/media. */
export interface FeedbackMedia {
  id: string;
  contentType: FeedbackMediaType;
  kind: FeedbackMediaKind;
  bytes: number;
  /** The file's name on the agent's PC, without its folder. Questions and options refer to files by it. */
  name: string | null;
  at: string;
}

/** One choice in a "choice" question. */
export interface FeedbackOption {
  id: string;
  label: string;
  /** A line under the label. */
  detail?: string | null;
  /** The name of an attached image, video or sound that shows this option (an A/B pick). */
  media?: string | null;
}

interface FeedbackQuestionBase {
  id: string;
  /** What to decide, in one or two lines. */
  prompt: string;
  /** Names of attached files to show with this question. */
  media?: string[];
}

/** Free text. */
export interface FeedbackTextQuestion extends FeedbackQuestionBase {
  type: 'text';
  placeholder?: string | null;
}

/** Pick one option, or several with `multiple`. The recommended one starts picked. */
export interface FeedbackChoiceQuestion extends FeedbackQuestionBase {
  type: 'choice';
  options: FeedbackOption[];
  multiple?: boolean;
  /** The option id the agent recommends. */
  recommended?: string | null;
}

/** A score from 1 to `max`, with words for the two ends. */
export interface FeedbackRatingQuestion extends FeedbackQuestionBase {
  type: 'rating';
  max: number;
  low?: string | null;
  high?: string | null;
  /** When set, the owner can answer this instead of a score ("Didn't see it"); the answer is "n/a". */
  notApplicable?: string | null;
}

export type FeedbackQuestion = FeedbackTextQuestion | FeedbackChoiceQuestion | FeedbackRatingQuestion;
export const FEEDBACK_QUESTION_TYPES = ['text', 'choice', 'rating'] as const;

/** An answer to one question: text, an option id, option ids (multiple), a score, or "n/a" (a rating's notApplicable). */
export type FeedbackAnswerValue = string | string[] | number;

export interface FeedbackResponse {
  /** By question id. Questions left unanswered are missing. */
  answers: Record<string, FeedbackAnswerValue>;
  /** Anything else the owner wrote. */
  note: string | null;
  /** A note under a question, by question id. */
  notes?: Record<string, string>;
  /** The owner's login, or the email address they answered from. */
  by: string;
  at: string;
  /** Where they answered: the Feedback tab, or a link in an email. */
  via?: 'site' | 'email';
}

/** One step in a request's life, shown as a panel on its card. */
export interface FeedbackStep {
  status: FeedbackStatus;
  at: string;
  /** The owner's login, or the agent's name. */
  by: string;
  /** What the agent or owner said with it: "Built as asked in v0.18". */
  note: string | null;
}

export interface Feedback {
  id: string;
  agentId: string;
  /** The agent as it was when it asked. */
  agentName: string;
  kind: AgentKind;
  project: string | null;
  machine: string;
  /** One line: the item, named ("New Clunk: Beaverlogger"). */
  title: string;
  /** More about it, in Markdown: what's built, what changed, what the question isn't about. */
  body: string | null;
  questions: FeedbackQuestion[];
  media: FeedbackMedia[];
  status: FeedbackStatus;
  createdAt: string;
  /** The last step's time. */
  updatedAt: string;
  /** Every step so far, oldest first; the first is "open". */
  history: FeedbackStep[];
  /** The owner's answer, once sent. */
  response: FeedbackResponse | null;
  /**
   * An answer saved to finish later, while it's still open: "Save" on the card. The agent doesn't
   * see it. Reopening a request puts its answer back here, to change and close again.
   */
  draft?: FeedbackResponse | null;
  /** The request this one follows up on. */
  follows: string | null;
  /** The request this one replaced (closed when this one was asked). */
  supersedes?: string | null;
  /** The request that followed up on this one, or replaced it. */
  followedBy: string | null;
  /** A tag that groups requests, such as a release: "v0.20.0". */
  group?: string | null;
  /** Captions for attached files, by file name. */
  captions?: Record<string, string>;
  /** Files the owner attached to their answer. */
  answerMedia?: FeedbackMedia[];
  /**
   * When alerts and emails went out. Null while the agent is still attaching files (it said how
   * many with expectFiles), so the email has its pictures.
   */
  notifiedAt?: string | null;
  /** How many files the agent said it would attach (FeedbackInput.expectFiles). */
  expectFiles?: number;
  /** How the answer reaches the agent, in a few words; set when it's answered. */
  delivery: string | null;
  /** The message that carries the answer to the session, when one was sent. */
  messageId: string | null;
  /** Name of the machine key that asked. Only that key can add media to it or move it on. */
  keyName: string;
}

/** POST /api/v1/feedback, with a machine key. */
export interface FeedbackInput {
  agentId: string;
  title: string;
  body?: string | null;
  /** Ids are optional: q1, q2… and 1, 2… are filled in. */
  questions?: unknown[];
  follows?: string | null;
  /** An earlier request this one replaces: it's closed, linking here. */
  supersedes?: string | null;
  group?: string | null;
  /** Captions by file name. */
  captions?: Record<string, string>;
  /** How many files will be attached next: alerts wait for them (or for POST /feedback/ready). */
  expectFiles?: number;
  test?: boolean;
}

export interface FeedbackCreateResponse extends WriteResponse<Feedback> {
  /** The Feedback tab, where the owner answers it. */
  feedbackUrl: string;
}

/**
 * POST /api/v1/feedback/respond, as the owner. "send" answers it (the card's Close button), "save"
 * keeps the answer as a draft and leaves it open, "dismiss" says no opinion, "close" ends one the
 * agent never closed, and "reopen" takes it back to open (waiting on you) to change the answer.
 */
export interface RespondFeedbackInput {
  id: string;
  action: 'send' | 'save' | 'dismiss' | 'close' | 'reopen';
  answers?: Record<string, FeedbackAnswerValue>;
  /** Notes under questions, by question id. */
  notes?: Record<string, string>;
  note?: string | null;
}

/**
 * GET /api/v1/feedback/link?t=<token>: a request, for the answer page an email links to. The
 * token is the only key: it's signed for one request and one email subscription, and expires.
 */
export interface FeedbackLinkResponse {
  now: string;
  feedback: Feedback;
  /** Signed addresses for the request's files and the answer's, by media id. */
  mediaUrls: Record<string, string>;
  /** The email address the link was sent to: the answer is recorded as theirs. */
  email: string;
  /** False once it's answered (or after FEEDBACK_LINK_DAYS): the page then shows it read-only. */
  canAnswer: boolean;
}

/** POST /api/v1/feedback/link/respond: answers from the page an email links to. */
export interface LinkRespondInput extends Omit<RespondFeedbackInput, 'id' | 'action'> {
  t: string;
  action: 'send' | 'save' | 'dismiss';
}

/** Email links stop working this long after the email. */
export const FEEDBACK_LINK_DAYS = 14;

/** POST /api/v1/feedback/status, with the machine key that asked. */
export interface FeedbackStatusInput {
  id: string;
  status: FeedbackAgentStatus;
  note?: string | null;
}

/** GET /api/v1/feedback: everything not done, then what finished in the last FEEDBACK_RECENT_DAYS. */
export interface FeedbackListResponse {
  now: string;
  feedback: Feedback[];
  /** The messages that carried answers to sessions, so the page can say whether they arrived. */
  messages: AgentMessage[];
  /** The agents with open requests, by id: how they are now, and whether an answer can reach them. */
  agents: Record<string, FeedbackAgentInfo>;
}

export interface FeedbackAgentInfo {
  state: AgentState;
  /** Why an answer can't go to the session as a message, or null when it can. */
  noMessages: string | null;
}

/** GET /api/v1/feedback/item?id=, as the owner or with a machine key. */
export interface FeedbackDetailResponse {
  now: string;
  feedback: Feedback;
}

/** GET /api/v1/feedback/inbox, with a machine key: this key's requests that are answered and not done. */
export interface FeedbackInboxResponse {
  now: string;
  feedback: Feedback[];
}

// ---- Responses ----

export interface ApiError {
  error: string;
}

export interface WriteResponse<T> {
  ok: true;
  test: boolean;
  /** What was (or, with test: true, would be) stored. */
  stored: T;
  warnings: string[];
}

export interface ReportResponse extends WriteResponse<Agent> {
  agentUrl: string;
}

export interface HeartbeatResponse extends WriteResponse<{ alive: number; stopped: string[]; unknown: string[] }> {
  /** Present when the owner asked every PC to update and this one runs a different agentctl. */
  update?: { requestedAt: string; sha256: string; url: string };
}

export interface AgentsResponse {
  now: string;
  agents: AgentView[];
}

export interface AgentDetailResponse {
  now: string;
  agent: AgentView;
  children: AgentView[];
  events: AgentEvent[];
  /** Messages sent to it from the UI, newest first. Only Claude Code sessions take them. */
  messages: AgentMessage[];
}

export interface KeysResponse {
  keys: MachineKey[];
}

export interface CreateKeyResponse {
  key: MachineKey;
  /** The secret, shown once. */
  secret: string;
}

/** How far back the Reporting tab can look. Turn, result and usage events are kept this long. */
export const REPORTING_MAX_DAYS = 365;

/** GET /api/v1/reporting: an agent the rows below refer to. */
export interface ReportingAgent {
  id: string;
  name: string;
  kind: AgentKind;
  machine: string;
  project: string | null;
  parentId: string | null;
  story: string | null;
  workType: WorkType | null;
  model: string | null;
  /** A request still running counts up to here: past it, the agent went silent. */
  lastSeen: string;
}

/** One request and how long it ran. */
export interface ReportingTurn {
  agentId: string;
  startedAt: string;
  /** Null while it runs, or when it was cut off by a lost connection. */
  endedAt: string | null;
  outcome: TurnOutcome;
  prompt: string | null;
  /** The story and work type when it ended; null for turns stored before these were kept. */
  story: string | null;
  workType: WorkType | null;
}

export interface ReportingUsage {
  agentId: string;
  at: string;
  usage: TokenUsage[];
  /** What the report said; a sub-agent's usage has neither, and goes by its parent's. */
  story: string | null;
  workType: WorkType | null;
}

/** A report of finished work. */
export interface ReportingResult {
  agentId: string;
  at: string;
  title: string;
  commitUrl: string | null;
  story: string | null;
  workType: WorkType | null;
}

export interface ReportingResponse {
  now: string;
  days: number;
  agents: ReportingAgent[];
  turns: ReportingTurn[];
  usage: ReportingUsage[];
  results: ReportingResult[];
}

// ---- Performance of the games and apps we build (web/public/performance.md) ----

/** How far back the Performance tab can look. Sessions, with their totals, are kept this long. */
export const PERF_MAX_DAYS = 365;
/** Samples, the per-window detail behind a session's charts, are kept this long. */
export const PERF_SAMPLE_DAYS = 30;
/** A session that hasn't ended and sent something this recently is still running. */
export const PERF_LIVE_SECONDS = 120;
/** Session ids are made by the game: a UUID works. They go in URLs and document ids. */
export const PERF_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/;

/** POST /api/v1/perf/session: start one run of a game on one machine, update it, or end it. */
export interface PerfSessionInput {
  sessionId: string;
  /** The game or app, named the same on every machine. */
  game: string;
  machine: string;
  /** The version or commit that is running. */
  build?: string | null;
  /** Such as windows, linux, macos, steamdeck, android. */
  platform?: string | null;
  cpu?: string | null;
  gpu?: string | null;
  cpuCores?: number | null;
  ramMb?: number | null;
  vramMb?: number | null;
  os?: string | null;
  /** Such as 2560x1440. */
  resolution?: string | null;
  refreshHz?: number | null;
  /** How long the game took to start, up to its first playable frame. */
  loadSeconds?: number | null;
  /** Anything else worth comparing runs by: quality preset, renderer, network region. */
  details?: Record<string, unknown>;
  /** True once the run is over. */
  ended?: boolean;
  /** `test` for automated or development runs: hidden on the Game tab and from `agentctl perf` unless asked for. */
  kind?: PerfRunKind;
  /**
   * The run crashed. Usually sent on the next launch, for the previous session: the game can't
   * send it while crashing. Ends the session at the last time it was heard from.
   */
  crash?: PerfCrashInput;
  test?: boolean;
}

export interface PerfCrashInput {
  /** One line: the exception, assert or signal, such as "EXCEPTION_ACCESS_VIOLATION reading address 0x0". */
  reason: string;
  /** The callstack or crash report summary, as text. */
  callstack?: string;
  /** Seconds since the session started, when it crashed, if known. */
  t?: number;
  /** The level, scene or menu it crashed in. */
  scene?: string;
}

export interface PerfCrash extends PerfCrashInput {
  reportedAt: string;
  /** The crash's own record (GET /api/v1/perf/crash?id=). Missing on crashes stored before crashes had records. */
  crashId?: string;
}

export const PERF_RUN_KINDS = ['play', 'test'] as const;
export type PerfRunKind = (typeof PERF_RUN_KINDS)[number];

/** How a crash reached the manager. */
export const CRASH_SOURCES = ['crash-reporter', 'next-launch', 'api'] as const;
export type CrashSource = (typeof CRASH_SOURCES)[number];

/** POST /api/v1/perf/crash: a crash, sent by the game or a tool that read its crash report. */
export interface CrashInput {
  game: string;
  machine: string;
  build?: string | null;
  /** The performance session that crashed, when known: it is marked crashed. */
  sessionId?: string | null;
  /** One line: the exception, assert or signal. */
  reason: string;
  callstack?: string;
  /** The last lines of the game's log. */
  log?: string;
  /** What the game was doing just before, oldest first: "Loaded level forest", "Opened inventory". */
  breadcrumbs?: string[];
  /** When it crashed. Defaults to when it's reported. */
  at?: string;
  /** Seconds since the session started. */
  t?: number;
  scene?: string;
  platform?: string | null;
  /** Anything else: engine version, crash GUID, GPU driver. */
  details?: Record<string, unknown>;
  kind?: PerfRunKind;
  test?: boolean;
}

/** One crash, as stored and shown on the Crashes tab. */
export interface CrashRecord {
  id: string;
  game: string;
  machine: string;
  build: string | null;
  sessionId: string | null;
  at: string;
  reportedAt: string;
  reason: string;
  callstack: string | null;
  log: string | null;
  breadcrumbs: string[];
  t: number | null;
  scene: string | null;
  platform: string | null;
  source: CrashSource;
  kind: PerfRunKind;
  details: Record<string, unknown>;
  /** The Feedback item asking the owner what they were doing, when one was made. */
  feedbackId: string | null;
  keyName: string;
}

export interface CrashResponse extends WriteResponse<CrashRecord> {
  crashUrl: string;
}

/** GET /api/v1/perf/crashes, as the owner or with a machine key: newest first. */
export interface CrashesResponse {
  now: string;
  days: number;
  crashes: CrashRecord[];
  machineNames: Record<string, string>;
  truncated: boolean;
}

/** GET /api/v1/perf/crash?id=: one crash, with the owner's answer to its Feedback item. */
export interface CrashDetailResponse {
  now: string;
  crash: CrashRecord;
  machineNames: Record<string, string>;
  /** What the owner said they were doing, once they answered. */
  answer: { by: string; at: string; text: string } | null;
}

/** GET and POST /api/v1/machine-names: nicknames for machines ("gaming rig" for pc-0dc004594da2). */
export interface MachineNamesResponse {
  names: Record<string, string>;
}

/** An error or failed check the game logged. */
export interface PerfErrorEvent {
  /** Seconds since the session started. */
  t: number;
  /** error: an error logged. ensure: a failed check that didn't stop the game (Unreal's ensure). warning: worth a look. */
  kind: PerfErrorKind;
  message: string;
  scene?: string;
}

export const PERF_ERROR_KINDS = ['error', 'ensure', 'warning'] as const;
export type PerfErrorKind = (typeof PERF_ERROR_KINDS)[number];

/** One distinct message kept on a session: the first time it was logged, and how often. */
export interface PerfErrorSeen extends PerfErrorEvent {
  count: number;
}

/**
 * What the game measured over one window of a few seconds. Frame times are in milliseconds.
 * Only `t`, `seconds` and `frames` are required; send what the engine can measure.
 */
export interface PerfSampleInput {
  /** Seconds since the session started, at the end of the window. Unique within the session. */
  t: number;
  /** How long the window was. */
  seconds: number;
  /** Frames drawn in the window. */
  frames: number;
  frameMsP50?: number;
  frameMsP95?: number;
  frameMsP99?: number;
  frameMsMax?: number;
  /** Frames that took long enough to notice; the game picks the threshold (50 ms is common). */
  hitches?: number;
  /** Errors and failed checks (ensures) logged in the window. */
  errors?: number;
  ensures?: number;
  /** Average per frame. Engines that split the CPU's work by thread send gameMs and renderMs instead of cpuMs. */
  cpuMs?: number;
  gameMs?: number;
  renderMs?: number;
  gpuMs?: number;
  memoryMb?: number;
  vramMb?: number;
  drawCalls?: number;
  pingMs?: number;
  /** The level, scene or menu the window was in. */
  scene?: string;
  /** Any other numbers, by name: entities, particles, packetLossPct. */
  metrics?: Record<string, number>;
}

/** One frame slow enough to notice, with what each thread was doing in it. */
export interface PerfHitch {
  /** Seconds since the session started. */
  t: number;
  frameMs: number;
  gameMs?: number;
  renderMs?: number;
  gpuMs?: number;
  scene?: string;
}

/** POST /api/v1/perf/samples: samples, single slow frames, or both. */
export interface PerfSamplesInput {
  sessionId: string;
  samples: PerfSampleInput[];
  /** The session keeps the worst LIMITS.perfHitchesKept of all it is sent. */
  hitchEvents?: PerfHitch[];
  /** Errors as they were logged. The session keeps the first LIMITS.perfErrorsKept distinct messages, with a count each. */
  errorEvents?: PerfErrorEvent[];
  test?: boolean;
}

export interface PerfSample extends PerfSampleInput {
  /** `<sessionId>:<t in ms>`, so a batch sent twice is stored once. */
  id: string;
  sessionId: string;
  receivedAt: string;
}

/** A sum of values, each weighted by its window's frames; see perfStats() in perf.ts. */
export interface PerfWeighted {
  sum: number;
  frames: number;
}

/** A session's samples added up as they arrive, so its numbers outlive the samples. */
export interface PerfTotals {
  samples: number;
  frames: number;
  seconds: number;
  hitches: number;
  /** Missing on sessions stored before errors were counted: read as 0. */
  errors?: number;
  ensures?: number;
  frameMsMax: number | null;
  memoryMbMax: number | null;
  vramMbMax: number | null;
  frameMsP50: PerfWeighted;
  frameMsP95: PerfWeighted;
  frameMsP99: PerfWeighted;
  cpuMs: PerfWeighted;
  gameMs: PerfWeighted;
  renderMs: PerfWeighted;
  gpuMs: PerfWeighted;
}

export interface PerfSession {
  id: string;
  game: string;
  machine: string;
  build: string | null;
  platform: string | null;
  cpu: string | null;
  gpu: string | null;
  cpuCores: number | null;
  ramMb: number | null;
  vramMb: number | null;
  os: string | null;
  resolution: string | null;
  refreshHz: number | null;
  loadSeconds: number | null;
  details: Record<string, unknown>;
  /** The slowest single frames the game reported, worst first. */
  worstHitches: PerfHitch[];
  /** The first distinct errors logged, in order. Missing on older sessions. */
  errors?: PerfErrorSeen[];
  startedAt: string;
  lastSeen: string;
  endedAt: string | null;
  /** Set when the game reported that this run crashed. Missing on older sessions. */
  crash?: PerfCrash | null;
  /** `test` runs are hidden unless asked for. Missing means play. */
  kind?: PerfRunKind;
  /** The scenes its samples named, in the order first seen. Missing on older sessions. */
  scenes?: string[];
  totals: PerfTotals;
  /** Name of the key that sent it. */
  keyName: string;
}

export interface PerfSessionResponse extends WriteResponse<PerfSession> {
  sessionUrl: string;
}

export interface PerfSamplesResponse extends WriteResponse<{ count: number; duplicates: number; hitchEvents: number; errorEvents: number }> {}

/** GET /api/v1/perf/sessions, as the owner or with a machine key: newest first. */
export interface PerfSessionsResponse {
  now: string;
  days: number;
  sessions: PerfSession[];
  /** Nicknames by machine, for the machines that have one. */
  machineNames?: Record<string, string>;
  /** True when there were more sessions than one answer holds. */
  truncated: boolean;
}

/** GET /api/v1/perf/session?id=, as the owner or with a machine key. */
export interface PerfSessionDetailResponse {
  now: string;
  session: PerfSession;
  machineNames?: Record<string, string>;
  /** Oldest first. Empty once the samples have aged out. */
  samples: PerfSample[];
  /** True when the session has more samples than one answer holds: these are the latest. */
  truncated: boolean;
}

// ---- Releases ----

/** A link that goes with a release besides its main one: a download, a store page. */
export interface ReleaseLink {
  label: string;
  url: string;
}

/** POST /api/v1/releases, with a machine key. Sending the same game and version again updates it. */
export interface ReleaseInput {
  agentId: string;
  /** "v0.20.0", "1.4", "2026-11-16 nightly". */
  version: string;
  /** Where the release is: its GitHub release, store page or download. */
  url: string;
  /** A name for it ("The Winter Update"). */
  title?: string | null;
  /** The change notes, in Markdown. */
  notes?: string | null;
  /** What the agent has to say about it: what to try first, what's known to be rough. */
  comment?: string | null;
  links?: ReleaseLink[];
  /** The game or app released. Defaults to the agent's project. */
  project?: string | null;
  test?: boolean;
}

export interface Release {
  /** From the game and version, so sending them again updates this release. */
  id: string;
  agentId: string;
  agentName: string;
  kind: AgentKind;
  /** The game or app; null when neither the release nor the agent named one. */
  project: string | null;
  machine: string;
  version: string;
  title: string | null;
  url: string;
  links: ReleaseLink[];
  notes: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  keyName: string;
}

export interface ReleaseCreateResponse extends WriteResponse<Release> {
  /** True when this game and version were sent before, so this updated it. */
  updated: boolean;
  releaseUrl: string;
}

/** GET /api/v1/releases, as the owner or with a machine key. Newest first. */
export interface ReleasesResponse {
  now: string;
  releases: Release[];
  /** True when there are more than one answer holds: these are the newest. */
  truncated: boolean;
}

export interface MeResponse {
  login: string;
  provider: string;
}
