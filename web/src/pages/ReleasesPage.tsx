// Releases: what agents have shipped, newest first. Each one links to where the release is, with
// its change notes and what the agent has to say about it. The newest release of each game is
// marked Latest. Filters pick a game, agent or PC; they live in the URL, and ?id= opens on one.

import type { Release, ReleasesResponse } from '@agent-manager-delux/shared';
import { ActionIcon, Anchor, Badge, Box, Button, Group, Modal, Paper, Select, Stack, Text, Title, Tooltip, Typography } from '@mantine/core';
import { IconExternalLink, IconLink, IconTrash, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';
import { FilterBar } from '../components/FilterBar';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { RelativeTime, UpdatedAgo } from '../components/Time';
import { api } from '../lib/api';
import { agentPath } from '../lib/labels';
import { notifyError, notifySuccess } from '../lib/notify';
import { usePolling } from '../lib/usePolling';
import { useUrlState } from '../lib/urlState';

const POLL_MS = 30_000;
const FOLD_CHARS = 900;
const FOLD_LINES = 14;

const loadReleases = (signal: AbortSignal) => api.releases(signal);

const gameOf = (r: Release) => r.project ?? r.agentName;

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

function ReleaseCard({ release: r, latest, highlighted, onDelete }: { release: Release; latest: boolean; highlighted: boolean; onDelete: () => void }) {
  return (
    <Paper withBorder radius="md" p="md" className="am-release" id={`release-${r.id}`} data-latest={latest || undefined} data-highlighted={highlighted || undefined}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
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
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <Button component="a" href={r.url} target="_blank" rel="noopener noreferrer" size="xs" leftSection={<IconExternalLink size={14} />} visibleFrom="xs">
              Open release
            </Button>
            <Tooltip label="Open release">
              <ActionIcon component="a" href={r.url} target="_blank" rel="noopener noreferrer" variant="filled" size="lg" aria-label="Open release" hiddenFrom="xs">
                <IconExternalLink size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Delete this release">
              <ActionIcon variant="subtle" color="gray" size="lg" onClick={onDelete} aria-label={`Delete ${gameOf(r)} ${r.version}`}>
                <IconTrash size={16} />
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
          Sent by{' '}
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

function DeleteModal({ target, onClose, onDeleted }: { target: Release | null; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.deleteRelease(target.id);
      notifySuccess(`Deleted ${gameOf(target)} ${target.version}`);
      onDeleted();
      onClose();
    } catch (err) {
      notifyError(err, "Couldn't delete the release");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={target !== null} onClose={onClose} title={<Text fw={600}>Delete {target ? `${gameOf(target)} ${target.version}` : ''}?</Text>}>
      <Stack gap="md">
        <Text size="sm">
          It goes from this list, with its change notes and comments. The release itself isn&apos;t touched. An agent that sends it again adds it back.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button color="red" onClick={remove} loading={busy} data-autofocus>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function ReleasesPage() {
  const { data, error, updatedAt, refresh } = usePolling<ReleasesResponse>('releases', loadReleases, { intervalMs: POLL_MS });
  const { params, update } = useUrlState();
  const focusId = params.get('id');
  const [deleting, setDeleting] = useState<Release | null>(null);

  const everything = useMemo(() => data?.releases ?? [], [data]);
  const games = useMemo(() => choices(everything, gameOf), [everything]);
  const agentNames = useMemo(() => choices(everything, (r) => r.agentName), [everything]);
  const machines = useMemo(() => choices(everything, (r) => r.machine), [everything]);
  // The list is newest first, so the first of each game is its latest.
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
  const shown = everything.filter((r) => (!game || gameOf(r) === game) && (!agentName || r.agentName === agentName) && (!machine || r.machine === machine));

  // A link to one release opens the page on it: show it whatever the filters say.
  const focusFound = Boolean(focusId && everything.some((r) => r.id === focusId));
  useEffect(() => {
    if (!focusFound || !focusId) return;
    update({ game: null, agent: null, pc: null });
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
          When an agent ships a build, it announces it here with a link, its change notes and its comments. Agents announce with{' '}
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
          {shown.length === 0 ? (
            <EmptyState title="Nothing matches these filters">Clear a filter to see more.</EmptyState>
          ) : (
            shown.map((r) => (
              <ReleaseCard key={r.id} release={r} latest={latestIds.has(r.id)} highlighted={r.id === focusId} onDelete={() => setDeleting(r)} />
            ))
          )}
          {data.truncated && (
            <Text size="xs" c="dimmed">
              Showing the newest {everything.length} releases.
            </Text>
          )}
        </Stack>
      )}
      <DeleteModal target={deleting} onClose={() => setDeleting(null)} onDeleted={refresh} />
    </>
  );
}
