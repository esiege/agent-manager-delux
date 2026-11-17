// Feedback cards. FeedbackCard is a request waiting on you: who asks, what they show (pictures,
// clips, sounds, with captions), their questions, and a quick form to answer them, with a note under
// any question and files of your own. FeedbackProgressCard is one you've answered: your answer and
// how far the agent has got with it.
//
// The cards don't call the API themselves: the Feedback tab wires them to the signed-in API, and
// the answer page an email links to wires them to that link's API. Loaded on demand: it brings
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
  ActionIcon,
  Anchor,
  Badge,
  Button,
  CloseButton,
  FileButton,
  Group,
  Image,
  Loader,
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
  IconChevronLeft,
  IconChevronRight,
  IconDeviceDesktop,
  IconDeviceFloppy,
  IconHash,
  IconMail,
  IconMessageCircle,
  IconMessageCircleOff,
  IconMusic,
  IconPaperclip,
  IconReplace,
  IconTag,
  IconVideo,
} from '@tabler/icons-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';
import { agentPath, STATE_COLOR, STATE_LABEL } from '../lib/labels';
import { MEDIA_ACCEPT, whyNotAttach } from '../lib/media';
import { notifyError } from '../lib/notify';
import { formatAbsolute } from '../lib/time';
import { FeedbackProgress } from './FeedbackProgress';
import { RelativeTime } from './Time';

/** A body longer than this starts folded. */
const FOLD_CHARS = 400;
const FOLD_LINES = 6;

/** Where a file's bytes are: the signed-in API on the Feedback tab, a signed link on the answer page. */
export type MediaUrl = (mediaId: string) => string;

/** Finds another request (the one this follows or replaces) when it's on the page. */
export type FindRequest = (id: string) => Feedback | undefined;

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

function Caption({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
      {text}
    </Text>
  );
}

function Clip({ m, mediaUrl, caption }: { m: FeedbackMedia; mediaUrl: MediaUrl; caption?: string }) {
  const src = mediaUrl(m.id);
  if (m.kind === 'video') {
    return (
      <Stack gap={2}>
        <video className="am-feedback-video" src={src} controls preload="metadata" playsInline aria-label={caption ?? m.name ?? 'Video'} />
        <Caption text={caption} />
      </Stack>
    );
  }
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
        {caption ?? m.name}
      </Text>
      <audio className="am-feedback-audio" src={src} controls preload="metadata" aria-label={caption ?? m.name ?? 'Sound'} />
    </Stack>
  );
}

function MediaStrip({ items, mediaUrl, captions }: { items: FeedbackMedia[]; mediaUrl: MediaUrl; captions: Record<string, string> }) {
  // The picture open full size, by its place among the pictures; the arrows page through them.
  const [openAt, setOpenAt] = useState<number | null>(null);
  const images = items.filter((m) => m.kind === 'image');
  const open = openAt !== null ? (images[openAt] ?? null) : null;
  const many = images.length > 1;
  const step = (by: number) => setOpenAt((i) => (i === null ? i : (i + by + images.length) % images.length));
  useEffect(() => {
    if (openAt === null || !many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // step only reads images.length, which `many` covers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt !== null, many, images.length]);
  if (items.length === 0) return null;
  const clips = items.filter((m) => m.kind !== 'image');
  const caption = (m: FeedbackMedia) => (m.name ? captions[m.name] : undefined);
  // One picture shows large; several show as a row of thumbnails, each with its caption.
  const single = images.length === 1;
  return (
    <Stack gap="xs">
      {clips.map((m) => (
        <Clip key={m.id} m={m} mediaUrl={mediaUrl} caption={caption(m)} />
      ))}
      {images.length > 0 && (
        <Group gap="xs" wrap="wrap" align="flex-start">
          {images.map((m, i) => (
            <Stack key={m.id} gap={2} className="am-feedback-figure" data-single={single || undefined}>
              <UnstyledButton
                onClick={() => setOpenAt(i)}
                className="am-feedback-thumb"
                data-single={single || undefined}
                aria-label={`Open ${caption(m) ?? m.name ?? 'picture'} full size`}
              >
                <Image src={mediaUrl(m.id)} alt={caption(m) ?? m.name ?? 'Picture'} loading="lazy" fit="contain" h="100%" />
              </UnstyledButton>
              <Caption text={caption(m)} />
            </Stack>
          ))}
        </Group>
      )}
      <Modal opened={open !== null} onClose={() => setOpenAt(null)} size="auto" title={open ? (caption(open) ?? open.name ?? 'Picture') : ''} centered>
        {open && openAt !== null && (
          <Stack gap="xs" align="center">
            <div className="am-feedback-viewer">
              <img className="am-feedback-full" src={mediaUrl(open.id)} alt={caption(open) ?? open.name ?? 'Picture'} />
              {many && (
                <>
                  <ActionIcon className="am-feedback-page" data-side="prev" variant="filled" color="dark" radius="xl" size="lg" onClick={() => step(-1)} aria-label="Previous picture">
                    <IconChevronLeft size={20} />
                  </ActionIcon>
                  <ActionIcon className="am-feedback-page" data-side="next" variant="filled" color="dark" radius="xl" size="lg" onClick={() => step(1)} aria-label="Next picture">
                    <IconChevronRight size={20} />
                  </ActionIcon>
                </>
              )}
            </div>
            <Group gap="md">
              {many && (
                <Text size="sm" c="dimmed">
                  {openAt + 1} of {images.length}
                </Text>
              )}
              <Anchor href={mediaUrl(open.id)} target="_blank" rel="noopener noreferrer" size="sm">
                Open in a new tab
              </Anchor>
            </Group>
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

function CardHeader({ feedback, agent, linkAgent }: { feedback: Feedback; agent: FeedbackAgentInfo | undefined; linkAgent: boolean }) {
  const who = feedback.project || feedback.agentName;
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
      <Stack gap={2} miw={0}>
        <Group gap="xs" wrap="nowrap" miw={0}>
          {linkAgent ? (
            <Anchor component={Link} to={agentPath(feedback.agentId)} fw={600} truncate="end">
              {who}
            </Anchor>
          ) : (
            <Text fw={600} truncate="end">
              {who}
            </Text>
          )}
          {agent && (
            <Badge size="sm" variant="light" color={STATE_COLOR[agent.state]} tt="none" style={{ flexShrink: 0 }}>
              {STATE_LABEL[agent.state]}
            </Badge>
          )}
        </Group>
        <Group gap="sm" wrap="wrap">
          {feedback.group && (
            <Badge size="sm" variant="outline" color="gray" tt="none" leftSection={<IconTag size={11} aria-hidden />}>
              {feedback.group}
            </Badge>
          )}
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

function LinkLine({ icon, label, other }: { icon: ReactNode; label: string; other: Feedback | undefined }) {
  return (
    <Group gap={4} wrap="nowrap" miw={0}>
      {icon}
      <Text size="xs" c="dimmed" truncate="end">
        {label}{' '}
        {other ? (
          <Anchor component="button" type="button" size="xs" onClick={() => scrollToFeedback(other.id)}>
            {other.title}
          </Anchor>
        ) : (
          'an earlier request'
        )}
      </Text>
    </Group>
  );
}

/** "Follows up on: …" and "Replaces: …", which scroll to the earlier request when it's on the page. */
function Links({ feedback, findRequest }: { feedback: Feedback; findRequest: FindRequest }) {
  return (
    <>
      {feedback.follows && (
        <LinkLine
          icon={<IconArrowBackUp size={14} color="var(--mantine-color-dimmed)" aria-hidden />}
          label="Follows up on:"
          other={findRequest(feedback.follows)}
        />
      )}
      {feedback.supersedes && (
        <LinkLine
          icon={<IconReplace size={14} color="var(--mantine-color-dimmed)" aria-hidden />}
          label="Replaces:"
          other={findRequest(feedback.supersedes)}
        />
      )}
    </>
  );
}

// ---- Answers ----

type Answers = Record<string, FeedbackAnswerValue>;
type Notes = Record<string, string>;

/** One answer as words: the option labels, "4 of 5", "Didn't see it", or the text. */
export function answerText(q: FeedbackQuestion, value: FeedbackAnswerValue | undefined): string | null {
  if (value === undefined) return null;
  if (q.type === 'text') return String(value);
  if (q.type === 'rating') return value === 'n/a' ? (q.notApplicable ?? 'n/a') : `${value} of ${q.max}`;
  const ids = Array.isArray(value) ? value : [String(value)];
  return ids.map((id) => q.options.find((o) => o.id === id)?.label ?? id).join(', ');
}

/** Files attached to the answer: thumbnails for pictures, a named chip for clips and sounds. */
function AttachmentList({
  items,
  mediaUrl,
  previews,
  onRemove,
  removing,
}: {
  items: FeedbackMedia[];
  mediaUrl: MediaUrl;
  /** Local previews of files just uploaded, by media id, for pages without a signed address yet. */
  previews?: Record<string, string>;
  onRemove?: (m: FeedbackMedia) => void;
  removing?: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <Group gap="xs" wrap="wrap">
      {items.map((m) => {
        const src = previews?.[m.id] ?? mediaUrl(m.id);
        return (
          <div key={m.id} className="am-feedback-attachment">
            {m.kind === 'image' ? (
              <a href={src} target="_blank" rel="noopener noreferrer" aria-label={`Open ${m.name ?? 'picture'}`}>
                <img src={src} alt={m.name ?? 'Picture'} loading="lazy" />
              </a>
            ) : (
              <a href={src} target="_blank" rel="noopener noreferrer" className="am-feedback-attachment-clip">
                {m.kind === 'video' ? <IconVideo size={16} aria-hidden /> : <IconMusic size={16} aria-hidden />}
              </a>
            )}
            <Text size="xs" truncate="end" maw={120} title={m.name ?? undefined}>
              {m.name ?? m.kind}
            </Text>
            {onRemove &&
              (removing === m.id ? (
                <Loader size={12} />
              ) : (
                <CloseButton size="xs" aria-label={`Remove ${m.name ?? 'file'}`} onClick={() => onRemove(m)} />
              ))}
          </div>
        );
      })}
    </Group>
  );
}

/** Your answer, question by question, with your notes and files. */
export function AnswerSummary({ feedback, lines, mediaUrl }: { feedback: Feedback; lines?: number; mediaUrl?: MediaUrl }) {
  const r = feedback.response;
  const files = feedback.answerMedia ?? [];
  if (!r) {
    return feedback.history.some((s) => s.status === 'dismissed') ? (
      <Text size="sm" c="dimmed">
        You dismissed it: the agent goes ahead with its default.
      </Text>
    ) : null;
  }
  const shown = feedback.questions.filter((q) => r.answers[q.id] !== undefined || r.notes?.[q.id]);
  return (
    <Stack gap={4}>
      {shown.map((q) => {
        const text = answerText(q, r.answers[q.id]);
        const note = r.notes?.[q.id];
        return (
          <div key={q.id}>
            <Text size="sm" lineClamp={lines} style={{ overflowWrap: 'anywhere' }}>
              <Text span c="dimmed" size="sm">
                {q.prompt}{' '}
              </Text>
              {text && (
                <Text span fw={500} size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {text}
                </Text>
              )}
            </Text>
            {note && (
              <Text size="xs" c="dimmed" lineClamp={lines} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                Note: {note}
              </Text>
            )}
          </div>
        );
      })}
      {r.note && (
        <Text size="sm" lineClamp={lines} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {r.note}
        </Text>
      )}
      {mediaUrl && <AttachmentList items={files} mediaUrl={mediaUrl} />}
      {!mediaUrl && files.length > 0 && (
        <Text size="xs" c="dimmed">
          {files.length === 1 ? '1 file attached' : `${files.length} files attached`}
        </Text>
      )}
      {shown.length === 0 && !r.note && files.length === 0 && (
        <Text size="sm" c="dimmed">
          Sent without a note: good as it is.
        </Text>
      )}
      {r.via === 'email' && (
        <Group gap={4} wrap="nowrap">
          <IconMail size={12} color="var(--mantine-color-dimmed)" aria-hidden />
          <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
            Answered by email ({r.by})
          </Text>
        </Group>
      )}
    </Stack>
  );
}

/** A value from an email link (?q=&a=) as an answer to that question, or null when it doesn't fit. */
function preselected(q: FeedbackQuestion, value: string): FeedbackAnswerValue | null {
  if (q.type === 'choice') {
    if (!q.options.some((o) => o.id === value)) return null;
    return q.multiple ? [value] : value;
  }
  if (q.type === 'rating') {
    if (value === 'n/a') return q.notApplicable ? 'n/a' : null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= q.max ? n : null;
  }
  return null;
}

function initialAnswers(questions: FeedbackQuestion[], preselect: Preselect | undefined, draft: Answers | undefined): Answers {
  // A saved draft is what you had; otherwise the recommended options start picked.
  const out: Answers = { ...draft };
  if (!draft) {
    for (const q of questions) {
      if (q.type === 'choice' && q.recommended) out[q.id] = q.multiple ? [q.recommended] : q.recommended;
    }
  }
  const q = preselect && questions.find((x) => x.id === preselect.questionId);
  if (q && preselect) {
    const v = preselected(q, preselect.value);
    if (v !== null) out[q.id] = v;
  }
  return out;
}

/** The answer as it's sent or saved: blanks dropped, text trimmed. */
function cleaned(answers: Answers, notes: Notes, note: string): FeedbackAnswer {
  const clean: Answers = {};
  for (const [id, v] of Object.entries(answers)) if (hasValue(v)) clean[id] = typeof v === 'string' ? v.trim() : v;
  const cleanNotes: Notes = {};
  for (const [id, n] of Object.entries(notes)) if (n.trim()) cleanNotes[id] = n.trim();
  return { answers: clean, notes: cleanNotes, note: note.trim() };
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
  q,
  value,
  media,
  mediaUrl,
  captions,
  disabled,
  onChange,
}: {
  q: FeedbackChoiceQuestion;
  value: FeedbackAnswerValue | undefined;
  media: Map<string, FeedbackMedia>;
  mediaUrl: MediaUrl;
  captions: Record<string, string>;
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
    const caption = o.media ? captions[o.media] : undefined;
    const checked = picked.has(o.id);
    return (
      <Stack key={o.id} gap={4}>
        {/* Videos and sounds have their own controls, so they sit above the option, not inside it. */}
        {m && m.kind !== 'image' && <Clip m={m} mediaUrl={mediaUrl} caption={caption} />}
        <button
          type="button"
          className="am-feedback-option"
          role={q.multiple ? 'checkbox' : 'radio'}
          aria-checked={checked}
          data-checked={checked || undefined}
          disabled={disabled}
          onClick={() => toggle(o.id)}
        >
          {m && m.kind === 'image' && <img className="am-feedback-option-media" src={mediaUrl(m.id)} alt={caption ?? o.label} loading="lazy" />}
          {m && m.kind === 'image' && caption && (
            <Text size="xs" c="dimmed" mb={4} style={{ overflowWrap: 'anywhere' }}>
              {caption}
            </Text>
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
    <Group gap="xs" wrap="wrap" align="flex-start">
      <Stack gap={2} role="radiogroup" aria-label={q.prompt}>
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
          {q.notApplicable && (
            <Button
              size="xs"
              variant={value === 'n/a' ? 'filled' : 'default'}
              color={value === 'n/a' ? 'gray' : undefined}
              role="radio"
              aria-checked={value === 'n/a'}
              disabled={disabled}
              onClick={() => onChange(value === 'n/a' ? undefined : 'n/a')}
            >
              {q.notApplicable}
            </Button>
          )}
        </Group>
        {(q.low || q.high) && (
          <Group justify="space-between" gap="md" wrap="nowrap" maw={q.max * 38}>
            <Text size="xs" c="dimmed">
              {q.low ?? ''}
            </Text>
            <Text size="xs" c="dimmed" ta="right">
              {q.high ?? ''}
            </Text>
          </Group>
        )}
      </Stack>
    </Group>
  );
}

/** "Add a note" under a question: a link that opens a short box. */
function QuestionNote({ prompt, value, disabled, onChange }: { prompt: string; value: string; disabled: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(value !== '');
  if (!open) {
    return (
      <Anchor component="button" type="button" size="xs" c="dimmed" onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start' }} disabled={disabled}>
        + Add a note
      </Anchor>
    );
  }
  return (
    <Textarea
      aria-label={`A note on: ${prompt}`}
      placeholder="A note on this question"
      autosize
      minRows={1}
      maxRows={6}
      size="xs"
      maxLength={LIMITS.feedbackQuestionNoteLength}
      value={value}
      disabled={disabled}
      autoFocus={value === ''}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
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

/** "send" is the card's Close button; Close with nothing filled in dismisses it. "save" keeps it open. */
export type FeedbackAction = 'send' | 'save' | 'dismiss';

export interface FeedbackAnswer {
  answers: Answers;
  notes: Notes;
  note: string;
}

/** A pick carried in from an email link: ?q=<question id>&a=<option id, score or n/a>. */
export interface Preselect {
  questionId: string;
  value: string;
}

export interface FeedbackCardProps {
  feedback: Feedback;
  findRequest: FindRequest;
  /** How the agent is now; the answer page doesn't know, and leaves it out. */
  agent?: FeedbackAgentInfo;
  /** Whether to say how the answer reaches the session (the Feedback tab knows; the answer page doesn't). */
  showDelivery?: boolean;
  highlighted?: boolean;
  /** Link the agent's name to its page (signed in only). */
  linkAgent?: boolean;
  mediaUrl: MediaUrl;
  uploadAnswerMedia: (file: File) => Promise<FeedbackMedia>;
  removeAnswerMedia: (mediaId: string) => Promise<void>;
  onAnswer: (action: FeedbackAction, answer: FeedbackAnswer) => Promise<boolean>;
  preselect?: Preselect;
}

export function FeedbackCard({
  feedback,
  findRequest,
  agent,
  showDelivery = true,
  highlighted = false,
  linkAgent = true,
  mediaUrl,
  uploadAnswerMedia,
  removeAnswerMedia,
  onAnswer,
  preselect,
}: FeedbackCardProps) {
  const draft = feedback.draft ?? undefined;
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers(feedback.questions, preselect, draft?.answers));
  const [notes, setNotes] = useState<Notes>(() => ({ ...draft?.notes }));
  const [note, setNote] = useState(draft?.note ?? '');
  const [busy, setBusy] = useState<FeedbackAction | null>(null);
  const [attached, setAttached] = useState<FeedbackMedia[]>(() => feedback.answerMedia ?? []);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  const { byName, loose, pick } = mediaIndex(feedback);
  const captions = feedback.captions ?? {};
  const noQuestions = feedback.questions.length === 0;
  const anyNote = Object.values(notes).some((n) => n.trim() !== '');
  const canSend = note.trim() !== '' || anyNote || attached.length > 0 || Object.values(answers).some(hasValue);
  const working = busy !== null || uploading.length > 0;
  const current = cleaned(answers, notes, note);
  // What was last saved (or the untouched form), to tell whether there's anything new to save.
  const [savedKey, setSavedKey] = useState(() =>
    JSON.stringify(draft ? cleaned(draft.answers, draft.notes ?? {}, draft.note ?? '') : cleaned(initialAnswers(feedback.questions, preselect, undefined), {}, '')),
  );
  const [savedAt, setSavedAt] = useState(draft?.at ?? null);
  const unsaved = JSON.stringify(current) !== savedKey;

  // Local previews are object URLs: let them go with the card.
  useEffect(() => () => Object.values(previewsRef.current).forEach((u) => URL.revokeObjectURL(u)), []);

  function set(id: string, v: FeedbackAnswerValue | undefined) {
    setAnswers((a) => {
      const next = { ...a };
      if (v === undefined) delete next[id];
      else next[id] = v;
      return next;
    });
  }

  async function attach(files: File[]) {
    for (const file of files) {
      const why = whyNotAttach(file);
      if (why) {
        notifyError(new Error(why), "Can't attach that file");
        continue;
      }
      if (attached.length + uploading.length >= LIMITS.feedbackAnswerMedia) {
        notifyError(new Error(`An answer holds at most ${LIMITS.feedbackAnswerMedia} files`), "Can't attach more files");
        return;
      }
      setUploading((u) => [...u, file.name]);
      try {
        const stored = await uploadAnswerMedia(file);
        setAttached((a) => [...a, stored]);
        if (stored.kind === 'image') setPreviews((p) => ({ ...p, [stored.id]: URL.createObjectURL(file) }));
      } catch (e) {
        notifyError(e, `Couldn't attach ${file.name}`);
      } finally {
        setUploading((u) => {
          const i = u.indexOf(file.name);
          return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)];
        });
      }
    }
  }

  async function remove(m: FeedbackMedia) {
    setRemoving(m.id);
    try {
      await removeAnswerMedia(m.id);
      setAttached((a) => a.filter((x) => x.id !== m.id));
    } catch (e) {
      notifyError(e, `Couldn't remove ${m.name ?? 'the file'}`);
    } finally {
      setRemoving(null);
    }
  }

  async function answer(action: FeedbackAction) {
    if (working) return;
    // Closing with nothing filled in is "no opinion": the agent goes ahead with its default.
    const act: FeedbackAction = action === 'send' && !canSend ? 'dismiss' : action;
    setBusy(act);
    const done = await onAnswer(act, act === 'dismiss' ? { answers: {}, notes: {}, note: '' } : current);
    if (act === 'save') {
      setBusy(null);
      if (done) {
        setSavedKey(JSON.stringify(current));
        setSavedAt(new Date().toISOString());
      }
    } else if (!done) setBusy(null);
  }

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      id={`feedback-${feedback.id}`}
      className="am-feedback"
      data-highlighted={highlighted || undefined}
      data-dragging={dragging || undefined}
      component="article"
      aria-label={`Feedback: ${feedback.title}`}
      onDragOver={(e) => {
        if (busy || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void attach([...e.dataTransfer.files]);
      }}
      onPaste={(e) => {
        const files = [...e.clipboardData.files];
        if (files.length === 0 || busy) return;
        e.preventDefault();
        void attach(files);
      }}
    >
      <Stack
        gap="sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void answer('send');
          } else if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void answer('save');
          }
        }}
      >
        <CardHeader feedback={feedback} agent={agent} linkAgent={linkAgent} />
        <Links feedback={feedback} findRequest={findRequest} />

        <Title order={2} size="h4" style={{ overflowWrap: 'anywhere' }}>
          {feedback.title}
        </Title>

        <MediaStrip items={loose} mediaUrl={mediaUrl} captions={captions} />
        {feedback.body && <Body text={feedback.body} />}

        {feedback.questions.map((q) => (
          <Stack key={q.id} gap={6}>
            <QuestionPrompt>{q.prompt}</QuestionPrompt>
            <MediaStrip items={pick(q.media)} mediaUrl={mediaUrl} captions={captions} />
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
                q={q}
                value={answers[q.id]}
                media={byName}
                mediaUrl={mediaUrl}
                captions={captions}
                disabled={busy !== null}
                onChange={(v) => set(q.id, v)}
              />
            )}
            {q.type === 'rating' && <RatingField q={q} value={answers[q.id]} disabled={busy !== null} onChange={(v) => set(q.id, v)} />}
            {/* A text question is its own note. */}
            {q.type !== 'text' && (
              <QuestionNote
                prompt={q.prompt}
                value={notes[q.id] ?? ''}
                disabled={busy !== null}
                onChange={(v) => setNotes((n) => ({ ...n, [q.id]: v }))}
              />
            )}
          </Stack>
        ))}

        <Stack gap={6}>
          {/* The agent's own text question may already be "Anything else?". */}
          {!noQuestions && <QuestionPrompt>{feedback.questions.some((q) => q.type === 'text') ? 'Note' : 'Anything else?'}</QuestionPrompt>}
          <Textarea
            aria-label={noQuestions ? `Your feedback on: ${feedback.title}` : 'A note for the agent'}
            placeholder={noQuestions ? 'Your feedback. Ctrl+S saves, Ctrl+Enter closes.' : 'A note for the agent (optional). Ctrl+S saves, Ctrl+Enter closes.'}
            autosize
            minRows={noQuestions ? 2 : 1}
            maxRows={10}
            maxLength={LIMITS.feedbackAnswerLength}
            value={note}
            disabled={busy !== null}
            onChange={(e) => setNote(e.currentTarget.value)}
          />

          <AttachmentList items={attached} mediaUrl={mediaUrl} previews={previews} onRemove={busy ? undefined : (m) => void remove(m)} removing={removing} />
          {uploading.length > 0 && (
            <Group gap={6} wrap="nowrap">
              <Loader size={12} />
              <Text size="xs" c="dimmed" truncate="end">
                Attaching {uploading.join(', ')}…
              </Text>
            </Group>
          )}

          <Group justify="space-between" wrap="wrap" gap="xs">
            <Group gap="xs" wrap="wrap">
              <FileButton onChange={(files) => void attach(files)} accept={MEDIA_ACCEPT} multiple disabled={busy !== null}>
                {(props) => (
                  <Tooltip label="Pictures, clips or sounds of your own. You can also paste or drop them on the card.">
                    <Button {...props} variant="subtle" color="gray" size="compact-xs" leftSection={<IconPaperclip size={14} />}>
                      Attach files
                    </Button>
                  </Tooltip>
                )}
              </FileButton>
              {showDelivery && <DeliveryHint status={agent} />}
            </Group>
            <Group gap="xs" wrap="nowrap" ml="auto">
              {(savedAt || unsaved) && (
                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {unsaved ? (
                    'Not saved'
                  ) : (
                    <>
                      Saved <RelativeTime iso={savedAt!} span size="xs" />
                    </>
                  )}
                </Text>
              )}
              <Tooltip label="Keep your answer to finish later. The agent doesn't see it until you close it.">
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<IconDeviceFloppy size={14} />}
                  loading={busy === 'save'}
                  disabled={(busy !== null && busy !== 'save') || uploading.length > 0 || !unsaved}
                  onClick={() => void answer('save')}
                >
                  Save
                </Button>
              </Tooltip>
              <Tooltip label={canSend ? 'Done: send your answer to the agent' : 'Nothing filled in: the agent goes ahead with its default'}>
                <Button
                  size="xs"
                  leftSection={<IconCheck size={14} />}
                  loading={busy === 'send' || busy === 'dismiss'}
                  disabled={busy === 'save' || uploading.length > 0}
                  onClick={() => void answer('send')}
                >
                  Close
                </Button>
              </Tooltip>
            </Group>
          </Group>
        </Stack>
      </Stack>
    </Paper>
  );
}

// ---- A request you've answered, while the agent works on it ----

/** Takes a request back to "Waiting on you", with its answer filled in to change. */
export function ReopenButton({ feedback, onReopen }: { feedback: Feedback; onReopen: (feedback: Feedback) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Tooltip label="Back to Waiting on you, with your answer filled in to change. The agent is told to wait for the new one.">
      <Button
        variant="subtle"
        size="compact-xs"
        leftSection={<IconArrowBackUp size={14} />}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          if (!(await onReopen(feedback))) setBusy(false);
        }}
      >
        Open
      </Button>
    </Tooltip>
  );
}

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
  findRequest: FindRequest;
  agent: FeedbackAgentInfo | undefined;
  message: AgentMessage | undefined;
  now: string;
  highlighted: boolean;
  mediaUrl: MediaUrl;
  onClose: (feedback: Feedback) => Promise<boolean>;
  onReopen: (feedback: Feedback) => Promise<boolean>;
}

export function FeedbackProgressCard({ feedback, findRequest, agent, message, now, highlighted, mediaUrl, onClose, onReopen }: FeedbackProgressCardProps) {
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
        <CardHeader feedback={feedback} agent={agent} linkAgent />
        <Links feedback={feedback} findRequest={findRequest} />
        <Title order={3} size="h5" style={{ overflowWrap: 'anywhere' }}>
          {feedback.title}
        </Title>
        <AnswerSummary feedback={feedback} lines={4} mediaUrl={mediaUrl} />
        <FeedbackProgress feedback={feedback} />
        <Group justify="space-between" wrap="wrap" gap="xs">
          {delivery?.text ? (
            <Text size="xs" c={delivery.color}>
              {delivery.text}
            </Text>
          ) : (
            <span />
          )}
          <Group gap="xs" wrap="nowrap">
            <ReopenButton feedback={feedback} onReopen={onReopen} />
            <Tooltip label="Close it yourself: for a request the agent will never get back to">
              <Button variant="subtle" color="gray" size="compact-xs" loading={busy} onClick={() => void close()}>
                Close
              </Button>
            </Tooltip>
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
}

/**
 * A request read-only, for the answer page once it's answered: what was asked, your answer and how
 * far the agent has got.
 */
export function FeedbackReadOnlyCard({ feedback, mediaUrl, findRequest }: { feedback: Feedback; mediaUrl: MediaUrl; findRequest: FindRequest }) {
  const { loose } = mediaIndex(feedback);
  return (
    <Paper withBorder p="md" radius="md" className="am-feedback" data-stage="progress" component="article" aria-label={`Feedback: ${feedback.title}`}>
      <Stack gap="sm">
        <CardHeader feedback={feedback} agent={undefined} linkAgent={false} />
        <Links feedback={feedback} findRequest={findRequest} />
        <Title order={2} size="h4" style={{ overflowWrap: 'anywhere' }}>
          {feedback.title}
        </Title>
        <MediaStrip items={loose} mediaUrl={mediaUrl} captions={feedback.captions ?? {}} />
        {feedback.body && <Body text={feedback.body} />}
        {(feedback.response || feedback.status !== 'open') && (
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              The answer
            </Text>
            <AnswerSummary feedback={feedback} mediaUrl={mediaUrl} />
          </Stack>
        )}
        <FeedbackProgress feedback={feedback} />
      </Stack>
    </Paper>
  );
}
