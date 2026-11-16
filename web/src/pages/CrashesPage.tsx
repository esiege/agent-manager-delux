// Crashes, under the Game tab: every crash the games we build reported, newest first, and one crash's page
// with what's needed to fix it in readable sections: what crashed, what you were doing, what led
// up to it, the callstack and the end of the log.

import type { CrashDetailResponse, CrashesResponse, CrashRecord } from '@agent-manager-delux/shared';
import { Alert, Anchor, Badge, Code, Group, Paper, SegmentedControl, Stack, Switch, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconMessageQuestion } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { GameSections } from '../components/GameSections';
import { JsonBlock } from '../components/JsonBlock';
import { MachineName, machineLabel } from '../components/MachineName';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, LoadError, TableSkeleton } from '../components/States';
import { RelativeTime, UpdatedAgo } from '../components/Time';
import { api } from '../lib/api';
import { formatAbsolute } from '../lib/time';
import { useUrlState } from '../lib/urlState';
import { usePolling } from '../lib/usePolling';

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

const SOURCE_LABEL: Record<CrashRecord['source'], string> = {
  'crash-reporter': 'Crash reporter',
  'next-launch': 'Next launch',
  api: 'Sent by the game',
};

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap={4} mb="sm">
        <Title order={2} size="h5">
          {title}
        </Title>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
      {children}
    </Paper>
  );
}

function formatClock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function CrashesPage() {
  const { params, update } = useUrlState();
  const days = WINDOWS.some((w) => w.value === params.get('days')) ? Number(params.get('days')) : 30;
  const tests = params.get('tests') === '1';
  const navigate = useNavigate();
  const { data, error, updatedAt, refresh } = usePolling<CrashesResponse>(`crashes:${days}:${tests}`, (signal) => api.crashes(days, signal, tests), {
    intervalMs: 30_000,
  });

  return (
    <>
      <GameSections />
      <PageHeader title="Crashes">
        <UpdatedAgo updatedAt={updatedAt} error={error} />
        <Switch label="Show test runs" checked={tests} onChange={(e) => update({ tests: e.currentTarget.checked ? '1' : null })} />
        <SegmentedControl aria-label="Time window" data={WINDOWS} value={String(days)} onChange={(value) => update({ days: value === '30' ? null : value })} />
      </PageHeader>
      {!data ? (
        error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <TableSkeleton rows={8} />
        )
      ) : data.crashes.length === 0 ? (
        <EmptyState title="No crashes">
          Nothing crashed in the last {days} days{tests ? '' : ' (test runs are hidden)'}. Games report crashes as{' '}
          <Anchor href="/performance.md#errors-and-crashes" target="_blank" rel="noopener">
            performance.md
          </Anchor>{' '}
          describes.
        </EmptyState>
      ) : (
        <Paper withBorder radius="md">
          <Table.ScrollContainer minWidth={820} type="native">
            <Table highlightOnHover verticalSpacing="xs" fz="sm" aria-label="Crashes">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>When</Table.Th>
                  <Table.Th>Game</Table.Th>
                  <Table.Th>Machine</Table.Th>
                  <Table.Th>What crashed</Table.Th>
                  <Table.Th>Where</Table.Th>
                  <Table.Th>From</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.crashes.map((c) => (
                  <Table.Tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/performance/crash?id=${encodeURIComponent(c.id)}`)}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <RelativeTime iso={c.at} />
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      {c.game}
                      {c.build ? ` ${c.build}` : ''}
                      {c.kind === 'test' && (
                        <Badge ml={6} size="xs" variant="light" color="gray" tt="none">
                          test
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>{machineLabel(c.machine, data.machineNames)}</Table.Td>
                    <Table.Td style={{ overflowWrap: 'anywhere' }}>{c.reason}</Table.Td>
                    <Table.Td>{c.scene ?? '–'}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{SOURCE_LABEL[c.source]}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </>
  );
}

export function CrashPage() {
  const [search] = useSearchParams();
  const id = search.get('id') ?? '';
  const { data, error, updatedAt, refresh } = usePolling<CrashDetailResponse>(`crash:${id}`, (signal) => api.crash(id, signal), { intervalMs: 30_000 });
  const [names, setNames] = useState<Record<string, string> | undefined>(undefined);
  useEffect(() => setNames(data?.machineNames), [data?.machineNames]);

  if (!data) {
    return (
      <>
        <GameSections />
        <PageHeader title="Crash" />
        {error ? <LoadError message={error.message} onRetry={refresh} /> : <TableSkeleton rows={8} />}
      </>
    );
  }
  const c = data.crash;
  return (
    <>
      <GameSections />
      <PageHeader title={`${c.game}${c.build ? ` ${c.build}` : ''} crashed`}>
        <UpdatedAgo updatedAt={updatedAt} error={error} />
        <Anchor component={Link} to="/performance/crashes" size="sm">
          All crashes
        </Anchor>
      </PageHeader>

      <Stack gap="md">
        <Alert variant="light" color="red" icon={<IconAlertTriangle size={18} />} title={c.reason} styles={{ title: { overflowWrap: 'anywhere' } }}>
          <Text size="sm">
            On <MachineName machine={c.machine} names={names} editable onRenamed={setNames} />
            {c.scene ? <>, in {c.scene}</> : null}
            {c.t !== null ? <>, {formatClock(c.t)} into the run</> : null}. {formatAbsolute(c.at)}
            {c.platform ? ` · ${c.platform}` : ''} · {SOURCE_LABEL[c.source].toLowerCase()}
            {c.kind === 'test' ? ' · test run' : ''}
          </Text>
          {c.sessionId && (
            <Anchor component={Link} to={`/performance/session?id=${encodeURIComponent(c.sessionId)}`} size="sm">
              Open the session: how it ran up to the crash
            </Anchor>
          )}
        </Alert>

        <Section title="What you were doing">
          {data.answer ? (
            <Stack gap={4}>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {data.answer.text}
              </Text>
              <Text size="xs" c="dimmed">
                {data.answer.by}, <RelativeTime iso={data.answer.at} c="dimmed" size="xs" />
              </Text>
            </Stack>
          ) : c.feedbackId ? (
            <Group gap="xs">
              <IconMessageQuestion size={16} />
              <Text size="sm">
                Not answered yet.{' '}
                <Anchor component={Link} to={`/feedback?id=${encodeURIComponent(c.feedbackId)}`}>
                  Answer on the Feedback tab
                </Anchor>
              </Text>
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              {c.kind === 'test' ? 'A test run: nobody was asked.' : 'Nobody was asked about this crash.'}
            </Text>
          )}
        </Section>

        <Section title="What led up to it" description="Breadcrumbs the game left, oldest first. The last one is just before the crash.">
          {c.breadcrumbs.length ? (
            <ol style={{ margin: 0, paddingInlineStart: 22 }}>
              {c.breadcrumbs.map((b, i) => (
                <li key={i}>
                  <Text size="sm" fw={i === c.breadcrumbs.length - 1 ? 600 : undefined}>
                    {b}
                  </Text>
                </li>
              ))}
            </ol>
          ) : (
            <Text size="sm" c="dimmed">
              The game didn&apos;t leave any.
            </Text>
          )}
        </Section>

        <Section title="Callstack" description="Innermost call first: the top lines are where it crashed.">
          {c.callstack ? (
            <Code block style={{ maxHeight: 480, overflow: 'auto', whiteSpace: 'pre' }}>
              {c.callstack}
            </Code>
          ) : (
            <Text size="sm" c="dimmed">
              None was sent. Unreal&apos;s crash reporter sends one; a crash found on the next launch without a crash report has none.
            </Text>
          )}
        </Section>

        <Section title="End of the log" description="The last lines the game wrote before it crashed. User names in paths are hidden.">
          {c.log ? (
            <Code block style={{ maxHeight: 480, overflow: 'auto', whiteSpace: 'pre' }}>
              {c.log}
            </Code>
          ) : (
            <Text size="sm" c="dimmed">
              None was sent.
            </Text>
          )}
        </Section>

        {Object.keys(c.details).length > 0 && (
          <Section title="Details" description="Everything else the crash report said: engine version, crash type, files.">
            <JsonBlock value={c.details} />
          </Section>
        )}
      </Stack>
    </>
  );
}
