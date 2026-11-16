// Feedback: what agents want your view on. Requests waiting on you are panels you answer in place;
// ones you've answered show how far the agent has got (viewed, planning, implementing); finished
// ones from the last week are listed underneath. Tabs at the top pick a status; the filters pick a
// game, agent, PC or group (a release, say), and the sort order. They live in the URL, so a view can
// be bookmarked. At the bottom you choose which email addresses get each new request.

import {
  FEEDBACK_DONE_STATUSES,
  FEEDBACK_RECENT_DAYS,
  FEEDBACK_STATUS_LABEL,
  type Feedback,
  type FeedbackListResponse,
} from '@agent-manager-delux/shared';
import { Anchor, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Tabs, Text, Title, Tooltip } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EmailSubscriptions } from '../components/EmailSubscriptions';
import { FilterBar } from '../components/FilterBar';
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
import { useUrlState } from '../lib/urlState';

const POLL_MS = 5000;

const loadFeedback = (signal: AbortSignal) => api.feedback(signal);

const isDone = (f: Feedback) => FEEDBACK_DONE_STATUSES.includes(f.status);

/** The status tabs: which sections show. */
const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'waiting', label: 'Waiting on you' },
  { value: 'progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
] as const;
type StatusTab = (typeof STATUS_TABS)[number]['value'];

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'updated', label: 'Recently changed' },
  { value: 'game', label: 'Game, A to Z' },
  { value: 'agent', label: 'Agent, A to Z' },
] as const;
type Sort = (typeof SORTS)[number]['value'];

const COMPARE: Record<Sort, (a: Feedback, b: Feedback) => number> = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  game: (a, b) => (a.project ?? '').localeCompare(b.project ?? '') || b.createdAt.localeCompare(a.createdAt),
  agent: (a, b) => a.agentName.localeCompare(b.agentName) || b.createdAt.localeCompare(a.createdAt),
};

/** The distinct values of one field, sorted, for a filter's choices. */
function choices(list: readonly Feedback[], pick: (f: Feedback) => string | null | undefined): string[] {
  return [...new Set(list.map(pick).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
}

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
  const { params, update } = useUrlState();
  const focusId = params.get('id');
  // Answered or closed here but not yet reloaded: hidden so the panel goes as soon as you act.
  const [handled, setHandled] = useState<ReadonlyMap<string, string>>(new Map());

  const everything = useMemo(() => data?.feedback ?? [], [data]);
  const byId = new Map(everything.map((f) => [f.id, f]));
  const projects = useMemo(() => choices(everything, (f) => f.project), [everything]);
  const agentNames = useMemo(() => choices(everything, (f) => f.agentName), [everything]);
  const machines = useMemo(() => choices(everything, (f) => f.machine), [everything]);
  const groups = useMemo(() => choices(everything, (f) => f.group), [everything]);

  // From the URL. A value that's no longer in the list (its last request aged out) is ignored.
  const tab: StatusTab = STATUS_TABS.some((t) => t.value === params.get('status')) ? (params.get('status') as StatusTab) : 'all';
  const sort: Sort = SORTS.some((x) => x.value === params.get('sort')) ? (params.get('sort') as Sort) : 'newest';
  const pickIn = (key: string, list: string[]) => {
    const v = params.get(key);
    return v && list.includes(v) ? v : null;
  };
  const game = pickIn('game', projects);
  const agentName = pickIn('agent', agentNames);
  const machine = pickIn('pc', machines);
  const group = pickIn('group', groups);
  const activeCount = [game, agentName, machine, group].filter(Boolean).length;

  const matching = everything
    .filter((f) => (!game || f.project === game) && (!agentName || f.agentName === agentName) && (!machine || f.machine === machine) && (!group || f.group === group))
    .sort(COMPARE[sort]);
  // Hidden only while the list still shows the status it had when you acted.
  const shown = (f: Feedback) => handled.get(f.id) !== f.status;
  const open = matching.filter((f) => f.status === 'open' && shown(f));
  const progress = matching.filter((f) => f.status !== 'open' && !isDone(f) && shown(f));
  const done = matching.filter(isDone);
  const counts: Record<StatusTab, number> = { all: open.length + progress.length + done.length, waiting: open.length, progress: progress.length, done: done.length };
  const show = (section: Exclude<StatusTab, 'all'>) => tab === 'all' || tab === section;
  const messages = new Map((data?.messages ?? []).map((m) => [m.id, m]));

  // A link from an alert opens the page on that request: show it whatever the filters say.
  const focusFound = Boolean(focusId && byId.has(focusId));
  useEffect(() => {
    if (focusFound) update({ status: null, game: null, agent: null, pc: null, group: null });
    // Only when the link's request first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFound]);
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
          <Stack gap="sm">
            <Tabs value={tab} onChange={(v) => update({ status: v === 'all' ? null : v })} keepMounted={false}>
              <Tabs.List>
                {STATUS_TABS.map((t) => (
                  <Tabs.Tab
                    key={t.value}
                    value={t.value}
                    rightSection={
                      <Badge size="xs" variant={t.value === 'waiting' && counts.waiting > 0 ? 'filled' : 'light'} color={t.value === 'waiting' && counts.waiting > 0 ? 'red' : 'gray'} circle={counts[t.value] < 10}>
                        {counts[t.value]}
                      </Badge>
                    }
                  >
                    {t.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
            <FilterBar activeCount={activeCount}>
              <Select label="Game" placeholder="All games" data={projects} value={game} onChange={(v) => update({ game: v })} clearable searchable size="xs" w={180} />
              <Select label="Agent" placeholder="All agents" data={agentNames} value={agentName} onChange={(v) => update({ agent: v })} clearable searchable size="xs" w={180} />
              <Select label="PC" placeholder="All PCs" data={machines} value={machine} onChange={(v) => update({ pc: v })} clearable searchable size="xs" w={150} />
              {groups.length > 0 && (
                <Select label="Group" placeholder="All groups" data={groups} value={group} onChange={(v) => update({ group: v })} clearable searchable size="xs" w={150} />
              )}
              <Select
                label="Sort"
                data={SORTS.map((x) => ({ value: x.value, label: x.label }))}
                value={sort}
                onChange={(v) => update({ sort: v === 'newest' ? null : v })}
                allowDeselect={false}
                size="xs"
                w={170}
              />
              {activeCount > 0 && (
                <Button variant="subtle" size="xs" leftSection={<IconX size={14} />} onClick={() => update({ game: null, agent: null, pc: null, group: null })}>
                  Clear filters
                </Button>
              )}
            </FilterBar>
          </Stack>

          {activeCount > 0 && counts.all === 0 && (
            <EmptyState title="Nothing matches these filters">Clear a filter to see more.</EmptyState>
          )}

          {!show('waiting') || (activeCount > 0 && open.length === 0) ? null : open.length === 0 ? (
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

          {show('progress') && (progress.length > 0 || tab === 'progress') && (
            <Stack gap="sm">
              <SectionTitle title="In progress" />
              {progress.length === 0 && (
                <Text size="sm" c="dimmed">
                  Nothing in progress: requests you've answered show here until the agent closes them.
                </Text>
              )}
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

          {show('done') && (done.length > 0 || tab === 'done') && (
            <Stack gap="xs">
              <SectionTitle
                title="Done"
                hint={{ short: `last ${FEEDBACK_RECENT_DAYS} days`, long: `Requests closed or followed up in the last ${FEEDBACK_RECENT_DAYS} days` }}
              />
              {done.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Nothing closed in the last {FEEDBACK_RECENT_DAYS} days.
                </Text>
              ) : (
                <Paper withBorder px="md" py="xs" radius="md">
                  {done.map((f) => (
                    <DoneRow key={f.id} f={f} />
                  ))}
                </Paper>
              )}
            </Stack>
          )}

          <EmailSubscriptions projects={projects} />
        </Stack>
      )}
    </>
  );
}
