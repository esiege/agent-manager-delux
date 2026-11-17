// Releases: what agents have shipped, newest release date first. Each one links to where the release
// is, with its screenshots, change notes and what the agent has to say about it. The newest release
// of each game is marked Latest, and "Latest only" hides the rest. Each release folds to a row: the
// latest of each game start open and older ones folded, and Collapse all and Expand all fold or open
// them all. Filters pick a game, agent or PC; they live in the URL, and ?id= opens on one.

import { releasedAtOf, type FeedbackMedia, type Release, type ReleasesResponse } from '@agent-manager-delux/shared';
import { ActionIcon, Anchor, Badge, Box, Button, Group, Paper, Select, Stack, Switch, Text, Title, Tooltip, Typography, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconExternalLink, IconFoldDown, IconFoldUp, IconLink, IconPhoto, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';
import { MediaStrip } from '../components/FeedbackCard';
import { FilterBar } from '../components/FilterBar';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { RelativeTime, UpdatedAgo } from '../components/Time';
import { api, releaseScreenshotUrl } from '../lib/api';
import { agentPath } from '../lib/labels';
import { usePolling } from '../lib/usePolling';
import { useUrlState } from '../lib/urlState';

const POLL_MS = 30_000;
const FOLD_CHARS = 900;
const FOLD_LINES = 14;

const loadReleases = (signal: AbortSignal) => api.releases(signal);

const gameOf = (r: Release) => r.project ?? r.agentName;

/** A date only: release dates are often given as a day, stored as midnight UTC. */
const releaseDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Screenshots in the shape the feedback picture strip shows. */
const asMedia = (r: Release): FeedbackMedia[] => (r.screenshots ?? []).map((s) => ({ ...s, kind: 'image' }));

function choices(list: readonly Release[], pick: (r: Release) => string | null): string[] {
  return [...new Set(list.map(pick).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
}

function Notes({ text }: { text: string }) {
  const long = text.length > FOLD_CHARS || text.split('\n').length > FOLD_LINES;
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <Typography className="am-markdown am-release-notes" data-folded={long && !expanded ? true : undefined} fz="sm">
        <Markdown remarkPlugins={[remarkGfm]} skipHtml>
          {text}
        </Markdown>
      </Typography>
      {long && (
        <Anchor component="button" type="button" size="xs" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? 'Show less' : 'Show all the notes'}
        </Anchor>
      )}
    </div>
  );
}

interface ReleaseCardProps {
  release: Release;
  latest: boolean;
  highlighted: boolean;
  collapsed: boolean;
  onToggle: () => void;
}

/** A folded release: one row with its game, version, name and date. */
function ReleaseRow({ release: r, latest, highlighted, onToggle }: ReleaseCardProps) {
  const shots = r.screenshots?.length ?? 0;
  return (
    <Paper withBorder radius="md" px="sm" py={6} className="am-release" id={`release-${r.id}`} data-latest={latest || undefined} data-highlighted={highlighted || undefined}>
      <Group gap="xs" wrap="nowrap">
        <UnstyledButton onClick={onToggle} aria-expanded={false} aria-label={`Expand ${gameOf(r)} ${r.version}`} miw={0} style={{ flex: 1 }}>
          <Group gap="xs" wrap="nowrap" miw={0}>
            <IconChevronRight size={16} aria-hidden style={{ flexShrink: 0 }} />
            <Text fw={600} size="sm" truncate style={{ flexShrink: 0, maxWidth: '40%' }}>
              {gameOf(r)}
            </Text>
            <Badge variant="light" tt="none" style={{ flexShrink: 0, maxWidth: '30%' }}>
              {r.version}
            </Badge>
            {latest && (
              <Badge size="xs" color="green" variant="filled" tt="none" style={{ flexShrink: 0 }}>
                Latest
              </Badge>
            )}
            {r.title && (
              <Text size="sm" c="dimmed" truncate visibleFrom="sm" miw={0}>
                {r.title}
              </Text>
            )}
          </Group>
        </UnstyledButton>
        {shots > 0 && (
          <Tooltip label={`${shots} screenshot${shots === 1 ? '' : 's'}`}>
            <Group gap={2} wrap="nowrap" c="dimmed" visibleFrom="xs">
              <IconPhoto size={14} aria-hidden />
              <Text size="xs">{shots}</Text>
            </Group>
          </Tooltip>
        )}
        <Text size="xs" c="dimmed" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
          {releaseDate(releasedAtOf(r))}
        </Text>
        <Tooltip label="Open release">
          <ActionIcon component="a" href={r.url} target="_blank" rel="noopener noreferrer" variant="subtle" size="md" aria-label="Open release">
            <IconExternalLink size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  );
}

function ReleaseCard(props: ReleaseCardProps) {
  const { release: r, latest, highlighted, collapsed, onToggle } = props;
  if (collapsed) return <ReleaseRow {...props} />;
  const shots = asMedia(r);
  return (
    <Paper withBorder radius="md" p="md" className="am-release" id={`release-${r.id}`} data-latest={latest || undefined} data-highlighted={highlighted || undefined}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
          <Group gap={6} align="flex-start" wrap="nowrap" miw={0}>
            <Tooltip label="Fold to a row">
              <ActionIcon variant="subtle" color="gray" size="md" mt={2} onClick={onToggle} aria-expanded aria-label={`Collapse ${gameOf(r)} ${r.version}`}>
                <IconChevronDown size={16} />
              </ActionIcon>
            </Tooltip>
            <Stack gap={2} miw={0}>
              <Group gap="xs" align="center" wrap="wrap">
                <Title order={2} size="h4" style={{ overflowWrap: 'anywhere' }}>
                  {gameOf(r)}
                </Title>
                <Badge size="lg" variant="light" tt="none" style={{ maxWidth: '100%' }}>
                  {r.version}
                </Badge>
                {latest && (
                  <Badge size="sm" color="green" variant="filled" tt="none">
                    Latest
                  </Badge>
                )}
              </Group>
              {r.title && (
                <Text fw={500} style={{ overflowWrap: 'anywhere' }}>
                  {r.title}
                </Text>
              )}
            </Stack>
          </Group>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <Button component="a" href={r.url} target="_blank" rel="noopener noreferrer" size="xs" leftSection={<IconExternalLink size={14} />} visibleFrom="xs">
              Open release
            </Button>
            <Tooltip label="Open release">
              <ActionIcon component="a" href={r.url} target="_blank" rel="noopener noreferrer" variant="filled" size="lg" aria-label="Open release" hiddenFrom="xs">
                <IconExternalLink size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {r.links.length > 0 && (
          <Group gap="md" wrap="wrap">
            {r.links.map((l) => (
              <Anchor key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" size="sm">
                <Group gap={4} wrap="nowrap" component="span">
                  <IconLink size={14} aria-hidden />
                  {l.label}
                </Group>
              </Anchor>
            ))}
          </Group>
        )}

        {shots.length > 0 && <MediaStrip items={shots} mediaUrl={(shotId) => releaseScreenshotUrl(r.id, shotId)} captions={{}} />}

        {r.notes && (
          <div>
            <Text size="xs" c="dimmed" mb={4}>
              Change notes
            </Text>
            <Notes text={r.notes} />
          </div>
        )}

        {r.comment && (
          <Box className="am-release-comment">
            <Text size="xs" c="dimmed" mb={4}>
              From {r.agentName}
            </Text>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {r.comment}
            </Text>
          </Box>
        )}

        <Text size="xs" c="dimmed" component="div">
          Released{' '}
          <Text span size="xs" fw={500} c="var(--mantine-color-text)" title={new Date(releasedAtOf(r)).toLocaleString()}>
            {releaseDate(releasedAtOf(r))}
          </Text>{' '}
          · sent by{' '}
          <Anchor component={Link} to={agentPath(r.agentId)} size="xs">
            {r.agentName}
          </Anchor>{' '}
          on {r.machine} · <RelativeTime iso={r.createdAt} span size="xs" />
          {r.updatedAt !== r.createdAt && (
            <>
              {' '}
              · updated <RelativeTime iso={r.updatedAt} span size="xs" />
            </>
          )}
        </Text>
      </Stack>
    </Paper>
  );
}

export function ReleasesPage() {
  const { data, error, updatedAt, refresh } = usePolling<ReleasesResponse>('releases', loadReleases, { intervalMs: POLL_MS });
  const { params, update } = useUrlState();
  const focusId = params.get('id');
  const latestOnly = params.get('show') === 'latest';
  // How releases start: latest open and older folded, or all of one after Collapse all or Expand
  // all; and the ones folded or opened one at a time since.
  const [fold, setFold] = useState<'older' | 'all' | 'none'>('older');
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());

  const foldAll = (value: boolean) => {
    setFold(value ? 'all' : 'none');
    setToggled(new Set());
  };
  const toggle = (id: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const everything = useMemo(() => data?.releases ?? [], [data]);
  const games = useMemo(() => choices(everything, gameOf), [everything]);
  const agentNames = useMemo(() => choices(everything, (r) => r.agentName), [everything]);
  const machines = useMemo(() => choices(everything, (r) => r.machine), [everything]);
  // The list is newest release first, so the first of each game is its latest.
  const latestIds = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of everything) if (!seen.has(gameOf(r))) seen.set(gameOf(r), r.id);
    return new Set(seen.values());
  }, [everything]);

  const pickIn = (key: string, list: string[]) => {
    const v = params.get(key);
    return v && list.includes(v) ? v : null;
  };
  const game = pickIn('game', games);
  const agentName = pickIn('agent', agentNames);
  const machine = pickIn('pc', machines);
  const activeCount = [game, agentName, machine].filter(Boolean).length;
  const shown = everything.filter(
    (r) => (!latestOnly || latestIds.has(r.id)) && (!game || gameOf(r) === game) && (!agentName || r.agentName === agentName) && (!machine || r.machine === machine),
  );
  const olderCount = everything.length - latestIds.size;
  // A linked release always opens.
  const isCollapsed = (id: string) => {
    if (id === focusId) return false;
    const folded = fold === 'all' || (fold === 'older' && !latestIds.has(id));
    return folded !== toggled.has(id);
  };

  // A link to one release opens the page on it: show it whatever the filters say.
  const focusFound = Boolean(focusId && everything.some((r) => r.id === focusId));
  useEffect(() => {
    if (!focusFound || !focusId) return;
    update({ game: null, agent: null, pc: null, show: null });
    requestAnimationFrame(() => document.getElementById(`release-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    // Only when the link's release first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFound, focusId]);

  return (
    <>
      <PageHeader title="Releases">
        <UpdatedAgo updatedAt={updatedAt} error={error} />
      </PageHeader>
      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={6} />
        )
      ) : everything.length === 0 ? (
        <EmptyState title="No releases yet">
          When an agent ships a build, it announces it here with a link, screenshots, its change notes and its comments. Agents announce with{' '}
          <Text span ff="monospace" size="sm">
            agentctl release
          </Text>{' '}
          (see{' '}
          <Anchor component={Link} to="/instructions" size="sm">
            Instructions
          </Anchor>
          ).
        </EmptyState>
      ) : (
        <Stack gap="md" maw={960}>
          <FilterBar activeCount={activeCount}>
            <Select label="Game" placeholder="All games" data={games} value={game} onChange={(v) => update({ game: v })} clearable searchable size="xs" w={200} />
            <Select label="Agent" placeholder="All agents" data={agentNames} value={agentName} onChange={(v) => update({ agent: v })} clearable searchable size="xs" w={180} />
            <Select label="PC" placeholder="All PCs" data={machines} value={machine} onChange={(v) => update({ pc: v })} clearable searchable size="xs" w={150} />
            {activeCount > 0 && (
              <Button variant="subtle" size="xs" leftSection={<IconX size={14} />} onClick={() => update({ game: null, agent: null, pc: null })}>
                Clear filters
              </Button>
            )}
          </FilterBar>
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Switch
              label={latestOnly || olderCount === 0 ? 'Latest only' : `Latest only (hides ${olderCount} older)`}
              checked={latestOnly}
              onChange={(e) => update({ show: e.currentTarget.checked ? 'latest' : null })}
              size="sm"
            />
            <Group gap="xs">
              <Button variant="default" size="xs" leftSection={<IconFoldUp size={14} />} onClick={() => foldAll(true)}>
                Collapse all
              </Button>
              <Button variant="default" size="xs" leftSection={<IconFoldDown size={14} />} onClick={() => foldAll(false)}>
                Expand all
              </Button>
            </Group>
          </Group>
          {shown.length === 0 ? (
            <EmptyState title="Nothing matches these filters">Clear a filter to see more.</EmptyState>
          ) : (
            <Stack gap="sm">
              {shown.map((r) => (
                <ReleaseCard
                  key={r.id}
                  release={r}
                  latest={latestIds.has(r.id)}
                  highlighted={r.id === focusId}
                  collapsed={isCollapsed(r.id)}
                  onToggle={() => toggle(r.id)}
                />
              ))}
            </Stack>
          )}
          {data.truncated && (
            <Text size="xs" c="dimmed">
              Showing the newest {everything.length} releases.
            </Text>
          )}
        </Stack>
      )}
    </>
  );
}
