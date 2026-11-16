// Feedback: what agents want your view on. Requests waiting on you are panels you answer in place;
// ones you've answered show how far the agent has got (viewed, planning, implementing); finished
// ones from the last week are listed underneath. Requests can be filtered by group (a release, say),
// and at the bottom you choose which email addresses get each new request.

import {
  FEEDBACK_DONE_STATUSES,
  FEEDBACK_RECENT_DAYS,
  FEEDBACK_STATUS_LABEL,
  type Feedback,
  type FeedbackListResponse,
} from '@agent-manager-delux/shared';
import { Anchor, Badge, Chip, Group, Paper, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmailSubscriptions } from '../components/EmailSubscriptions';
import {
  AnswerSummary,
  FeedbackCard,
  FeedbackProgressCard,
  scrollToFeedback,
  type FeedbackAction,
  type FeedbackAnswer,
} from '../components/FeedbackCard';
import { FEEDBACK_STATUS_COLOR } from '../components/FeedbackProgress';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { RelativeTime, UpdatedAgo } from '../components/Time';
import { api, feedbackMediaUrl } from '../lib/api';
import { mediaTypeOf } from '../lib/media';
import { agentPath, plural } from '../lib/labels';
import { notifyError } from '../lib/notify';
import { usePolling } from '../lib/usePolling';

const POLL_MS = 5000;

const loadFeedback = (signal: AbortSignal) => api.feedback(signal);

const isDone = (f: Feedback) => FEEDBACK_DONE_STATUSES.includes(f.status);

/** The "All" chip of the group filter. */
const ALL = '';

function DoneRow({ f }: { f: Feedback }) {
  const last = f.history[f.history.length - 1];
  return (
    <Stack gap={2} py={6} className="am-feedback-done" id={`feedback-${f.id}`}>
      <Group gap="xs" wrap="nowrap" align="baseline">
        <Badge size="sm" variant="light" color={FEEDBACK_STATUS_COLOR[f.status]} tt="none" style={{ flexShrink: 0 }}>
          {FEEDBACK_STATUS_LABEL[f.status]}
        </Badge>
        <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
          {f.title}
        </Text>
        {f.group && (
          <Badge size="xs" variant="outline" color="gray" tt="none" style={{ flexShrink: 0 }}>
            {f.group}
          </Badge>
        )}
      </Group>
      <Text size="xs" c="dimmed" component="div">
        <Anchor component={Link} to={agentPath(f.agentId)} size="xs">
          {f.project || f.agentName}
        </Anchor>{' '}
        on {f.machine} · {last ? `by ${last.by} ` : ''}
        <RelativeTime iso={f.updatedAt} span size="xs" />
      </Text>
      {last?.note && (
        <Text size="sm" lineClamp={3} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {last.note}
        </Text>
      )}
      {f.followedBy && (
        <Anchor component="button" type="button" size="xs" onClick={() => scrollToFeedback(f.followedBy!)} style={{ alignSelf: 'flex-start' }}>
          {f.history.some((s) => s.status === 'followup') ? 'See the follow-up' : 'See what replaced it'}
        </Anchor>
      )}
      <Text size="xs" c="dimmed" component="div">
        <AnswerSummary feedback={f} lines={2} mediaUrl={(m) => feedbackMediaUrl(f.id, m)} />
      </Text>
    </Stack>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: { short: string; long: string } }) {
  return (
    <Group gap="xs" align="baseline">
      <Title order={2} size="h4">
        {title}
      </Title>
      {hint && (
        <Tooltip label={hint.long}>
          <Text size="xs" c="dimmed">
            {hint.short}
          </Text>
        </Tooltip>
      )}
    </Group>
  );
}

export function FeedbackPage() {
  const { data, error, updatedAt, refresh } = usePolling<FeedbackListResponse>('feedback', loadFeedback, { intervalMs: POLL_MS });
  const [params] = useSearchParams();
  const focusId = params.get('id');
  // Answered or closed here but not yet reloaded: hidden so the panel goes as soon as you act.
  const [handled, setHandled] = useState<ReadonlyMap<string, string>>(new Map());

  const [group, setGroup] = useState(ALL);

  const everything = data?.feedback;
  const byId = new Map((everything ?? []).map((f) => [f.id, f]));
  const groups = useMemo(
    () => [...new Set((everything ?? []).map((f) => f.group).filter((g): g is string => Boolean(g)))].sort((a, b) => a.localeCompare(b)),
    [everything],
  );
  const projects = useMemo(
    () => [...new Set((everything ?? []).map((f) => f.project).filter((p): p is string => Boolean(p)))].sort((a, b) => a.localeCompare(b)),
    [everything],
  );
  // A group that's gone (its last request aged out) shows everything again.
  const activeGroup = group !== ALL && groups.includes(group) ? group : ALL;
  const all = (everything ?? []).filter((f) => activeGroup === ALL || f.group === activeGroup);
  // Hidden only while the list still shows the status it had when you acted.
  const shown = (f: Feedback) => handled.get(f.id) !== f.status;
  const open = all.filter((f) => f.status === 'open' && shown(f));
  const progress = all.filter((f) => f.status !== 'open' && !isDone(f) && shown(f));
  const done = all.filter(isDone).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const messages = new Map((data?.messages ?? []).map((m) => [m.id, m]));

  // A link from an alert opens the page on that request.
  const focusFound = Boolean(focusId && byId.has(focusId));
  useEffect(() => {
    if (focusFound && focusId) scrollToFeedback(focusId);
  }, [focusFound, focusId]);

  async function onAnswer(f: Feedback, action: FeedbackAction, { answers, notes, note }: FeedbackAnswer): Promise<boolean> {
    try {
      await api.respondFeedback({ id: f.id, action, answers, notes, note: note || null });
      setHandled((m) => new Map(m).set(f.id, f.status));
      refresh();
      return true;
    } catch (e) {
      notifyError(e, action === 'send' ? "Couldn't send your feedback" : "Couldn't dismiss the request");
      refresh();
      return false;
    }
  }

  async function onClose(f: Feedback): Promise<boolean> {
    try {
      await api.respondFeedback({ id: f.id, action: 'close' });
      setHandled((m) => new Map(m).set(f.id, f.status));
      refresh();
      return true;
    } catch (e) {
      notifyError(e, "Couldn't close the request");
      refresh();
      return false;
    }
  }

  const findRequest = (id: string) => byId.get(id);

  async function uploadAnswerMedia(f: Feedback, file: File) {
    const type = mediaTypeOf(file);
    if (!type) throw new Error(`${file.name} isn't a picture, clip or sound`);
    return (await api.addAnswerMedia(f.id, file, type)).stored;
  }

  return (
    <>
      <PageHeader title="Feedback">
        <UpdatedAgo updatedAt={updatedAt} error={error} />
      </PageHeader>
      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={6} />
        )
      ) : (
        <Stack gap="xl">
          {groups.length > 0 && (
            <Chip.Group value={activeGroup} onChange={(v) => setGroup(v as string)}>
              <Group gap="xs" wrap="wrap" role="group" aria-label="Show group">
                <Chip value={ALL} size="xs" variant="light">
                  All
                </Chip>
                {groups.map((g) => (
                  <Chip key={g} value={g} size="xs" variant="light">
                    {g}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          )}

          {open.length === 0 ? (
            <EmptyState title="Nothing waiting on you">
              When an agent wants your view on something it made, or can't get past something without you, it asks here. Agents
              ask with{' '}
              <Text span ff="monospace" size="sm">
                agentctl feedback ask
              </Text>{' '}
              (see{' '}
              <Anchor component={Link} to="/instructions" size="sm">
                Instructions
              </Anchor>
              ).
            </EmptyState>
          ) : (
            <Stack gap="sm">
              <SectionTitle title="Waiting on you" />
              <Text size="sm" c="dimmed">
                {plural(open.length, 'request is', 'requests are')} waiting on you. Pick, rate or write, then press Send, or Ctrl+Enter.
              </Text>
              <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md" verticalSpacing="md">
                {open.map((f) => (
                  <FeedbackCard
                    key={f.id}
                    feedback={f}
                    findRequest={findRequest}
                    agent={data.agents[f.agentId]}
                    highlighted={f.id === focusId}
                    mediaUrl={(m) => feedbackMediaUrl(f.id, m)}
                    uploadAnswerMedia={(file) => uploadAnswerMedia(f, file)}
                    removeAnswerMedia={async (m) => {
                      await api.removeAnswerMedia(f.id, m);
                    }}
                    onAnswer={(action, answer) => onAnswer(f, action, answer)}
                  />
                ))}
              </SimpleGrid>
            </Stack>
          )}

          {progress.length > 0 && (
            <Stack gap="sm">
              <SectionTitle title="In progress" />
              <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md" verticalSpacing="md">
                {progress.map((f) => (
                  <FeedbackProgressCard
                    key={f.id}
                    feedback={f}
                    findRequest={findRequest}
                    agent={data.agents[f.agentId]}
                    message={f.messageId ? messages.get(f.messageId) : undefined}
                    now={data.now}
                    highlighted={f.id === focusId}
                    mediaUrl={(m) => feedbackMediaUrl(f.id, m)}
                    onClose={onClose}
                  />
                ))}
              </SimpleGrid>
            </Stack>
          )}

          {done.length > 0 && (
            <Stack gap="xs">
              <SectionTitle
                title="Done"
                hint={{ short: `last ${FEEDBACK_RECENT_DAYS} days`, long: `Requests closed or followed up in the last ${FEEDBACK_RECENT_DAYS} days` }}
              />
              <Paper withBorder px="md" py="xs" radius="md">
                {done.map((f) => (
                  <DoneRow key={f.id} f={f} />
                ))}
              </Paper>
            </Stack>
          )}

          <EmailSubscriptions projects={projects} />
        </Stack>
      )}
    </>
  );
}
