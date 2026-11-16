// "Update all PCs": every PC with self-updates on installs the agentctl deployed now, at its next
// heartbeat (about a minute). Lists each PC with where its agentctl stands.

import type { AgentctlStatusResponse } from '@agent-manager-delux/shared';
import { Anchor, Badge, Button, Collapse, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { RelativeTime } from './Time';

type Machine = AgentctlStatusResponse['machines'][number];

function machineStatus(m: Machine, s: AgentctlStatusResponse): { label: string; color: string; tip?: string } {
  if (m.upToDate) return { label: 'Up to date', color: 'teal' };
  const request = s.request && s.request.sha256 === s.latest ? s.request : null;
  const attempt = m.agentctl.update;
  if (request && attempt?.requestedAt === request.requestedAt) {
    if (attempt.status === 'failed') return { label: 'Update failed', color: 'red', tip: attempt.error ?? 'No reason given' };
    if (attempt.status === 'updating') return { label: 'Updating', color: 'blue' };
  }
  if (!m.agentctl.autoUpdate) {
    return { label: 'Self-updates off', color: 'gray', tip: 'Turned off on that PC (agentctl install --no-auto-update). Send its agent the update sentence instead.' };
  }
  if (request) return { label: 'Waiting', color: 'blue', tip: 'It updates at its next heartbeat, within about a minute while a session is open.' };
  return { label: 'Out of date', color: 'yellow' };
}

export function UpdatePcs() {
  const { data, error, refresh } = usePolling('agentctl', (signal) => api.agentctl(signal), { intervalMs: 15_000 });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!data) {
    return error ? (
      <Text size="xs" c="red">
        Couldn&apos;t load the PCs: {error.message}
      </Text>
    ) : null;
  }

  const machines = data.machines;
  const current = machines.filter((m) => m.upToDate).length;
  const requested = data.request && data.request.sha256 === data.latest ? data.request : null;

  const press = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await api.updateAllPcs();
      refresh();
      setOpen(true);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={6} mt={8}>
      <Group gap="sm" wrap="wrap">
        <Tooltip
          label={data.latest ? 'Each PC installs the agentctl deployed now at its next heartbeat, then restarts its reporting.' : 'This build has no agentctl to offer.'}
          multiline
          maw={300}
        >
          <Button
            size="xs"
            leftSection={<IconRefresh size={14} />}
            onClick={press}
            loading={busy}
            disabled={!data.latest || (machines.length > 0 && current === machines.length)}
          >
            Update all PCs
          </Button>
        </Tooltip>
        {machines.length > 0 && (
          <Anchor component="button" type="button" size="xs" onClick={() => setOpen((o) => !o)}>
            {current} of {machines.length} PC{machines.length === 1 ? '' : 's'} up to date
          </Anchor>
        )}
      </Group>
      {failure && (
        <Text size="xs" c="red">
          {failure}
        </Text>
      )}
      {requested && (
        <Text size="xs" c="dimmed">
          Requested <RelativeTime iso={requested.requestedAt} c="dimmed" size="xs" /> by {requested.by}
        </Text>
      )}
      <Collapse in={open}>
        <Stack gap={4}>
          {machines.map((m) => {
            const st = machineStatus(m, data);
            return (
              <Group key={`${m.kind}:${m.machine}`} gap={6} wrap="nowrap" justify="space-between">
                <Text size="xs" truncate>
                  {m.machine}
                </Text>
                <Group gap={6} wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    <RelativeTime iso={m.beatAt} c="dimmed" size="xs" />
                  </Text>
                  <Tooltip label={st.tip} disabled={!st.tip} multiline maw={300}>
                    <Badge color={st.color} variant="light" radius="sm" tt="none" size="sm">
                      {st.label}
                    </Badge>
                  </Tooltip>
                </Group>
              </Group>
            );
          })}
        </Stack>
      </Collapse>
      <Text size="xs" c="dimmed">
        PCs set up before version 6 can&apos;t update themselves yet: send each one the update sentence once.
      </Text>
    </Stack>
  );
}
