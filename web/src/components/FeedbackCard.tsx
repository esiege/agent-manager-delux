// Feedback cards. FeedbackCard is a request waiting on you: who asks, what they show (pictures,
// clips, sounds), their questions and a quick form to answer them. FeedbackProgressCard is one
// you've answered: your answer and how far the agent has got with it. Loaded on demand: it brings
// Markdown.

import {
  LIMITS,
  type AgentMessage,
  type Feedback,
  type FeedbackAgentInfo,
  type FeedbackAnswerValue,
  type FeedbackChoiceQuestion,
  type FeedbackMedia,
  type FeedbackQuestion,
  type FeedbackRatingQuestion,
} from '@agent-manager-delux/shared';
import {
  Anchor,
  Badge,
  Button,
  Group,
  Image,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
  Typography,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowBackUp,
  IconCheck,
  IconDeviceDesktop,
  IconHash,
  IconMessageCircle,
  IconMessageCircleOff,
  IconSend,
  IconX,
} from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';
import { feedbackMediaUrl } from '../lib/api';
import { agentPath, STATE_COLOR, STATE_LABEL } from '../lib/labels';
import { formatAbsolute } from '../lib/time';
import { FeedbackProgress } from './FeedbackProgress';
import { RelativeTime } from './Time';

/** A body longer than this starts folded. */
const FOLD_CHARS = 400;
const FOLD_LINES = 6;

/** The last part of an agent id, which tells sessions of the same agent apart. */
function instanceId(agentId: string): string {
  const last = agentId.split('/').pop() ?? agentId;
  return last.length > 8 ? last.slice(0, 8) : last;
}

export function scrollToFeedback(id: string) {
  document.getElementById(`feedback-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---- Media ----

/** The files questions and options point at, by name. The rest show at the top. */
function mediaIndex(f: Feedback) {
  const byName = new Map<string, FeedbackMedia>();
  for (const m of f.media) if (m.name && !byName.has(m.name)) byName.set(m.name, m);
  const referenced = new Set<string>();
  for (const q of f.questions) {
    for (const n of q.media ?? []) referenced.add(n);
    if (q.type === 'choice') for (const o of q.options) if (o.media) referenced.add(o.media);
  }
  const loose = f.media.filter((m) => !m.name || !referenced.has(m.name) || byName.get(m.name) !== m);
  const pick = (names: string[] | undefined) => (names ?? []).map((n) => byName.get(n)).filter((m): m is FeedbackMedia => Boolean(m));
  return { byName, loose, pick };
}

function Clip({ feedbackId, m }: { feedbackId: string; m: FeedbackMedia }) {
  const src = feedbackMediaUrl(feedbackId, m.id);
  if (m.kind === 'video') {
    return <video className="am-feedback-video" src={src} controls preload="metadata" playsInline aria-label={m.name ?? 'Video'} />;
  }
  return (
    <Stack gap={2}>
      {m.name && (
        <Text size="xs" c="dimmed">
          {m.name}
        </Text>
      )}
      <audio className="am-feedback-audio" src={src} controls preload="metadata" aria-label={m.name ?? 'Sound'} />
    </Stack>
  );
}

function MediaStrip({ feedbackId, items }: { feedbackId: string; items: FeedbackMedia[] }) {
  const [open, setOpen] = useState<FeedbackMedia | null>(null);
  if (items.length === 0) return null;
  const images = items.filter((m) => m.kind === 'image');
  const clips = items.filter((m) => m.kind !== 'image');
  // One picture shows large; several show as a row of thumbnails.
  const single = images.length === 1;
  return (
    <Stack gap="xs">
      {clips.map((m) => (
        <Clip key={m.id} feedbackId={feedbackId} m={m} />
      ))}
      {images.length > 0 && (
        <Group gap="xs" wrap="wrap">
          {images.map((m) => (
            <UnstyledButton
              key={m.id}
              onClick={() => setOpen(m)}
              className="am-feedback-thumb"
              data-single={single || undefined}
              aria-label={`Open ${m.name ?? 'picture'} full size`}
            >
              <Image src={feedbackMediaUrl(feedbackId, m.id)} alt={m.name ?? 'Picture'} loading="lazy" fit="contain" h="100%" />
            </UnstyledButton>
          ))}
        </Group>
      )}
      <Modal opened={open !== null} onClose={() => setOpen(null)} size="auto" title={open?.name ?? 'Picture'} centered>
        {open && (
          <Stack gap="xs" align="center">
            <img className="am-feedback-full" src={feedbackMediaUrl(feedbackId, open.id)} alt={open.name ?? 'Picture'} />
            <Anchor href={feedbackMediaUrl(feedbackId, open.id)} target="_blank" rel="noopener noreferrer" size="sm">
              Open in a new tab
            </Anchor>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function Body({ text }: { text: string }) {
  const long = text.length > FOLD_CHARS || text.split('\n').length > FOLD_LINES;
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <Typography className="am-markdown am-feedback-details" data-folded={long && !expanded ? true : undefined} fz="sm">
        <Markdown remarkPlugins={[remarkGfm]} skipHtml>
          {text}
        </Markdown>
      </Typography>
      {long && (
        <Anchor component="button" type="button" size="xs" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? 'Show less' : 'Show more'}
        </Anchor>
      )}
    </div>
  );
}

// ---- The header both cards share ----

function CardHeader({ feedback, agent }: { feedback: Feedback; agent: FeedbackAgentInfo | undefined }) {
  const who = feedback.project || feedback.agentName;
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
      <Stack gap={2} miw={0}>
        <Group gap="xs" wrap="nowrap" miw={0}>
          <Anchor component={Link} to={agentPath(feedback.agentId)} fw={600} truncate="end">
            {who}
          </Anchor>
          {agent && (
            <Badge size="sm" variant="light" color={STATE_COLOR[agent.state]} tt="none" style={{ flexShrink: 0 }}>
              {STATE_LABEL[agent.state]}
            </Badge>
          )}
        </Group>
        <Group gap="sm" wrap="wrap">
          <Tooltip label={feedback.agentId}>
            <Group gap={4} wrap="nowrap" miw={0}>
              <IconHash size={13} color="var(--mantine-color-dimmed)" aria-hidden />
              <Text size="xs" c="dimmed" truncate="end" maw={260}>
                {feedback.agentName !== who ? `${feedback.agentName} · ` : ''}
                {instanceId(feedback.agentId)}
              </Text>
            </Group>
          </Tooltip>
          <Group gap={4} wrap="nowrap">
            <IconDeviceDesktop size={13} color="var(--mantine-color-dimmed)" aria-hidden />
            <Text size="xs" c="dimmed">
              {feedback.machine}
            </Text>
          </Group>
        </Group>
      </Stack>
      <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
        <RelativeTime iso={feedback.createdAt} size="xs" fw={500} />
        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {formatAbsolute(feedback.createdAt)}
        </Text>
      </Stack>
    </Group>
  );
}

/** "Follows up on: <earlier title>", which scrolls to the earlier request when it's on the page. */
function FollowsLine({ feedback, parent }: { feedback: Feedback; parent: Feedback | undefined }) {
  if (!feedback.follows) return null;
  return (
    <Group gap={4} wrap="nowrap" miw={0}>
      <IconArrowBackUp size={14} color="var(--mantine-color-dimmed)" aria-hidden />
      <Text size="xs" c="dimmed" truncate="end">
        Follows up on:{' '}
        {parent ? (
          <Anchor component="button" type="button" size="xs" onClick={() => scrollToFeedback(parent.id)}>
            {parent.title}
          </Anchor>
        ) : (
          'an earlier request'
        )}
      </Text>
    </Group>
  );
}

// ---- Answers ----

type Answers = Record<string, FeedbackAnswerValue>;

/** One answer as words: the option labels, "4 of 5", or the text. */
export function answerText(q: FeedbackQuestion, value: FeedbackAnswerValue | undefined): string | null {
  if (value === undefined) return null;
  if (q.type === 'text') return String(value);
  if (q.type === 'rating') return `${value} of ${q.max}`;
  const ids = Array.isArray(value) ? value : [String(value)];
  return ids.map((id) => q.options.find((o) => o.id === id)?.label ?? id).join(', ');
}

/** Your answer, question by question. */
export function AnswerSummary({ feedback, lines }: { feedback: Feedback; lines?: number }) {
  const r = feedback.response;
  if (!r) {
    return feedback.history.some((s) => s.status === 'dismissed') ? (
      <Text size="sm" c="dimmed">
        You dismissed it: the agent goes ahead with its default.
      </Text>
    ) : null;
  }
  const answered = feedback.questions.filter((q) => r.answers[q.id] !== undefined);
  return (
    <Stack gap={4}>
      {answered.map((q) => (
        <Text key={q.id} size="sm" lineClamp={lines} style={{ overflowWrap: 'anywhere' }}>
          <Text span c="dimmed" size="sm">
            {q.prompt}{' '}
          </Text>
          <Text span fw={500} size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {answerText(q, r.answers[q.id])}
          </Text>
        </Text>
      ))}
      {r.note && (
        <Text size="sm" lineClamp={lines} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {r.note}
        </Text>
      )}
      {answered.length === 0 && !r.note && (
        <Text size="sm" c="dimmed">
          Sent without a note: good as it is.
        </Text>
      )}
    </Stack>
  );
}

function initialAnswers(questions: FeedbackQuestion[]): Answers {
  const out: Answers = {};
  for (const q of questions) {
    if (q.type === 'choice' && q.recommended) out[q.id] = q.multiple ? [q.recommended] : q.recommended;
  }
  return out;
}

function hasValue(v: FeedbackAnswerValue | undefined): boolean {
  if (v === undefined) return false;
  if (typeof v === 'number') return true;
  if (Array.isArray(v)) return v.length > 0;
  return v.trim() !== '';
}

function QuestionPrompt({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>
      {children}
    </Text>
  );
}

function ChoiceField({
  feedbackId,
  q,
  value,
  media,
  disabled,
  onChange,
}: {
  feedbackId: string;
  q: FeedbackChoiceQuestion;
  value: FeedbackAnswerValue | undefined;
  media: Map<string, FeedbackMedia>;
  disabled: boolean;
  onChange: (v: FeedbackAnswerValue | undefined) => void;
}) {
  const picked = new Set(Array.isArray(value) ? value : typeof value === 'string' ? [value] : []);
  const withMedia = q.options.some((o) => o.media && media.has(o.media));
  const toggle = (id: string) => {
    if (q.multiple) {
      const next = new Set(picked);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Keep the order the options are in.
      onChange(q.options.filter((o) => next.has(o.id)).map((o) => o.id));
    } else {
      onChange(picked.has(id) ? undefined : id);
    }
  };
  const options = q.options.map((o) => {
    const m = o.media ? media.get(o.media) : undefined;
    const checked = picked.has(o.id);
    return (
      <Stack key={o.id} gap={4}>
        {/* Videos and sounds have their own controls, so they sit above the option, not inside it. */}
        {m && m.kind !== 'image' && <Clip feedbackId={feedbackId} m={m} />}
        <button
          type="button"
          className="am-feedback-option"
          role={q.multiple ? 'checkbox' : 'radio'}
          aria-checked={checked}
          data-checked={checked || undefined}
          disabled={disabled}
          onClick={() => toggle(o.id)}
        >
          {m && m.kind === 'image' && (
            <img className="am-feedback-option-media" src={feedbackMediaUrl(feedbackId, m.id)} alt={o.label} loading="lazy" />
          )}
          <Group gap="xs" wrap="nowrap" justify="space-between" align="flex-start">
            <Group gap={6} wrap="nowrap" miw={0} align="flex-start">
              {checked ? (
                <IconCheck size={16} color="var(--mantine-color-blue-filled)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
              ) : (
                <span style={{ width: 16, flexShrink: 0 }} aria-hidden />
              )}
              <Stack gap={0} miw={0}>
                <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                  {o.label}
                </Text>
                {o.detail && (
                  <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                    {o.detail}
                  </Text>
                )}
              </Stack>
            </Group>
            {q.recommended === o.id && (
              <Badge size="xs" variant="light" color="teal" tt="none" style={{ flexShrink: 0 }}>
                Recommended
              </Badge>
            )}
          </Group>
        </button>
      </Stack>
    );
  });
  return (
    <div role={q.multiple ? 'group' : 'radiogroup'} aria-label={q.prompt}>
      {withMedia ? (
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs" verticalSpacing="xs">
          {options}
        </SimpleGrid>
      ) : (
        <Stack gap={6}>{options}</Stack>
      )}
      {q.multiple && (
        <Text size="xs" c="dimmed" mt={4}>
          Pick any number.
        </Text>
      )}
    </div>
  );
}

function RatingField({
  q,
  value,
  disabled,
  onChange,
}: {
  q: FeedbackRatingQuestion;
  value: FeedbackAnswerValue | undefined;
  disabled: boolean;
  onChange: (v: FeedbackAnswerValue | undefined) => void;
}) {
  const scores = Array.from({ length: q.max }, (_, i) => i + 1);
  return (
    <Stack gap={2} role="radiogroup" aria-label={q.prompt} style={{ alignSelf: 'flex-start' }}>
      <Group gap={4} wrap="wrap">
        {scores.map((n) => (
          <Button
            key={n}
            size="xs"
            px={10}
            miw={34}
            variant={value === n ? 'filled' : 'default'}
            role="radio"
            aria-checked={value === n}
            disabled={disabled}
            onClick={() => onChange(value === n ? undefined : n)}
          >
            {n}
          </Button>
        ))}
      </Group>
      {(q.low || q.high) && (
        <Group justify="space-between" gap="md" wrap="nowrap">
          <Text size="xs" c="dimmed">
            {q.low ?? ''}
          </Text>
          <Text size="xs" c="dimmed" ta="right">
            {q.high ?? ''}
          </Text>
        </Group>
      )}
    </Stack>
  );
}

// ---- A request waiting on you ----

/** Whether the answer will reach the session now, in one line under the form. */
function DeliveryHint({ status }: { status: FeedbackAgentInfo | undefined }) {
  if (status && status.noMessages === null) {
    return (
      <Group gap={4} wrap="nowrap">
        <IconMessageCircle size={14} color="var(--mantine-color-teal-text)" aria-hidden />
        <Text size="xs" c="dimmed">
          Your answer goes to the session as a message.
        </Text>
      </Group>
    );
  }
  const why = status?.noMessages ?? 'The agent is gone';
  return (
    <Tooltip label={why} multiline maw={320}>
      <Group gap={4} wrap="nowrap">
        <IconMessageCircleOff size={14} color="var(--mantine-color-dimmed)" aria-hidden />
        <Text size="xs" c="dimmed">
          The agent reads your answer when it checks.
        </Text>
      </Group>
    </Tooltip>
  );
}

export type FeedbackAction = 'send' | 'dismiss';

interface FeedbackCardProps {
  feedback: Feedback;
  /** The request this one follows, when it's on the page. */
  parent: Feedback | undefined;
  agent: FeedbackAgentInfo | undefined;
  highlighted: boolean;
  onAnswer: (feedback: Feedback, action: FeedbackAction, answers: Answers, note: string) => Promise<boolean>;
}

export function FeedbackCard({ feedback, parent, agent, highlighted, onAnswer }: FeedbackCardProps) {
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers(feedback.questions));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<FeedbackAction | null>(null);
  const { byName, loose, pick } = mediaIndex(feedback);
  const noQuestions = feedback.questions.length === 0;
  const canSend = note.trim() !== '' || Object.values(answers).some(hasValue);

  function set(id: string, v: FeedbackAnswerValue | undefined) {
    setAnswers((a) => {
      const next = { ...a };
      if (v === undefined) delete next[id];
      else next[id] = v;
      return next;
    });
  }

  async function answer(action: FeedbackAction) {
    if (busy || (action === 'send' && !canSend)) return;
    setBusy(action);
    const clean: Answers = {};
    for (const [id, v] of Object.entries(answers)) if (hasValue(v)) clean[id] = typeof v === 'string' ? v.trim() : v;
    const done = await onAnswer(feedback, action, action === 'send' ? clean : {}, note.trim());
    if (!done) setBusy(null);
  }

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      id={`feedback-${feedback.id}`}
      className="am-feedback"
      data-highlighted={highlighted || undefined}
      component="article"
      aria-label={`Feedback: ${feedback.title}`}
    >
      <Stack
        gap="sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void answer('send');
          }
        }}
      >
        <CardHeader feedback={feedback} agent={agent} />
        <FollowsLine feedback={feedback} parent={parent} />

        <Title order={2} size="h4" style={{ overflowWrap: 'anywhere' }}>
          {feedback.title}
        </Title>

        <MediaStrip feedbackId={feedback.id} items={loose} />
        {feedback.body && <Body text={feedback.body} />}

        {feedback.questions.map((q) => (
          <Stack key={q.id} gap={6}>
            <QuestionPrompt>{q.prompt}</QuestionPrompt>
            <MediaStrip feedbackId={feedback.id} items={pick(q.media)} />
            {q.type === 'text' && (
              <Textarea
                aria-label={q.prompt}
                placeholder={q.placeholder ?? 'Your answer'}
                autosize
                minRows={2}
                maxRows={10}
                maxLength={LIMITS.feedbackAnswerLength}
                value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''}
                disabled={busy !== null}
                onChange={(e) => set(q.id, e.currentTarget.value)}
              />
            )}
            {q.type === 'choice' && (
              <ChoiceField
                feedbackId={feedback.id}
                q={q}
                value={answers[q.id]}
                media={byName}
                disabled={busy !== null}
                onChange={(v) => set(q.id, v)}
              />
            )}
            {q.type === 'rating' && <RatingField q={q} value={answers[q.id]} disabled={busy !== null} onChange={(v) => set(q.id, v)} />}
          </Stack>
        ))}

        <Stack gap={6}>
          {/* The agent's own text question may already be "Anything else?". */}
          {!noQuestions && <QuestionPrompt>{feedback.questions.some((q) => q.type === 'text') ? 'Note' : 'Anything else?'}</QuestionPrompt>}
          <Textarea
            aria-label={noQuestions ? `Your feedback on: ${feedback.title}` : 'A note for the agent'}
            placeholder={noQuestions ? 'Your feedback. Ctrl+Enter sends.' : 'A note for the agent (optional). Ctrl+Enter sends.'}
            autosize
            minRows={noQuestions ? 2 : 1}
            maxRows={10}
            maxLength={LIMITS.feedbackAnswerLength}
            value={note}
            disabled={busy !== null}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
          <Group justify="space-between" wrap="wrap" gap="xs">
            <DeliveryHint status={agent} />
            <Group gap="xs" wrap="nowrap" ml="auto">
              <Tooltip label="No opinion: the agent goes ahead with its default">
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<IconX size={14} />}
                  loading={busy === 'dismiss'}
                  disabled={busy === 'send'}
                  onClick={() => void answer('dismiss')}
                >
                  Dismiss
                </Button>
              </Tooltip>
              <Button
                size="xs"
                leftSection={<IconSend size={14} />}
                loading={busy === 'send'}
                disabled={busy === 'dismiss' || !canSend}
                onClick={() => void answer('send')}
              >
                Send
              </Button>
            </Group>
          </Group>
        </Stack>
      </Stack>
    </Paper>
  );
}

// ---- A request you've answered, while the agent works on it ----

/** What happened to the message that carried the answer, or the server's note on why none went. */
function deliveryLine(f: Feedback, message: AgentMessage | undefined, now: string): { text: string; color: string } {
  if (!message) return { text: f.delivery ?? '', color: 'dimmed' };
  if (message.status === 'delivered') return { text: 'Posted to the session', color: 'teal' };
  if (message.status === 'failed') return { text: `Not delivered: ${message.reason ?? 'agentctl couldn’t post it'}`, color: 'red' };
  if (message.expiresAt < now) {
    return { text: `Not picked up by ${f.machine}: messages may be off there. The agent can still check for it.`, color: 'orange' };
  }
  return { text: `Waiting for ${f.machine} to pick it up`, color: 'blue' };
}

interface FeedbackProgressCardProps {
  feedback: Feedback;
  parent: Feedback | undefined;
  agent: FeedbackAgentInfo | undefined;
  message: AgentMessage | undefined;
  now: string;
  highlighted: boolean;
  onClose: (feedback: Feedback) => Promise<boolean>;
}

export function FeedbackProgressCard({ feedback, parent, agent, message, now, highlighted, onClose }: FeedbackProgressCardProps) {
  const [busy, setBusy] = useState(false);
  const delivery = feedback.status === 'sent' || feedback.status === 'dismissed' ? deliveryLine(feedback, message, now) : null;

  async function close() {
    if (busy) return;
    setBusy(true);
    if (!(await onClose(feedback))) setBusy(false);
  }

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      id={`feedback-${feedback.id}`}
      className="am-feedback"
      data-stage="progress"
      data-highlighted={highlighted || undefined}
      component="article"
      aria-label={`Feedback: ${feedback.title}`}
    >
      <Stack gap="xs">
        <CardHeader feedback={feedback} agent={agent} />
        <FollowsLine feedback={feedback} parent={parent} />
        <Title order={3} size="h5" style={{ overflowWrap: 'anywhere' }}>
          {feedback.title}
        </Title>
        <AnswerSummary feedback={feedback} lines={4} />
        <FeedbackProgress feedback={feedback} />
        <Group justify="space-between" wrap="wrap" gap="xs">
          {delivery?.text ? (
            <Text size="xs" c={delivery.color}>
              {delivery.text}
            </Text>
          ) : (
            <span />
          )}
          <Tooltip label="Close it yourself: for a request the agent will never get back to">
            <Button variant="subtle" color="gray" size="compact-xs" loading={busy} onClick={() => void close()}>
              Close
            </Button>
          </Tooltip>
        </Group>
      </Stack>
    </Paper>
  );
}
