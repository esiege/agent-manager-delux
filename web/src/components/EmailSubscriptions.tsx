// Feedback tab > "Email me new requests": email addresses that get each new feedback request, with
// one-click answers. They're alert subscriptions on the email channel, for the feedback event
// ("blocker", the name from when Feedback was Blockers).

import { FEEDBACK_LINK_DAYS, LIMITS, type AlertSubscription } from '@agent-manager-delux/shared';
import { Anchor, Button, Group, MultiSelect, Paper, Stack, Switch, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconMail, IconPlus, IconSend, IconTrash } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { notifyError, notifySuccess } from '../lib/notify';
import { usePolling } from '../lib/usePolling';
import { LoadError } from './States';
import { RelativeTime } from './Time';

const loadAlerts = (signal: AbortSignal) => api.alerts(signal);

/** Good enough to catch typos; the mail service has the last word. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function save(sub: { id?: string; target: string; projects: string[]; enabled: boolean }) {
  return api.saveAlert({ ...sub, name: sub.target, channel: 'email', events: ['blocker'] });
}

function Row({ sub, projectOptions, onChanged }: { sub: AlertSubscription; projectOptions: string[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<'test' | 'toggle' | 'projects' | 'remove' | null>(null);
  const options = [...new Set([...projectOptions, ...sub.projects])].sort((a, b) => a.localeCompare(b));

  async function run(kind: NonNullable<typeof busy>, work: () => Promise<unknown>, failed: string, done?: string) {
    setBusy(kind);
    try {
      await work();
      if (done) notifySuccess(done);
    } catch (e) {
      notifyError(e, failed);
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  const base = { id: sub.id, target: sub.target, projects: sub.projects, enabled: sub.enabled };
  return (
    <Stack gap={6} py="xs" className="am-feedback-subscription">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Group gap={6} wrap="nowrap" miw={0}>
          <IconMail size={16} color="var(--mantine-color-dimmed)" aria-hidden />
          <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
            {sub.target}
          </Text>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Switch
            size="sm"
            label={sub.enabled ? 'On' : 'Off'}
            checked={sub.enabled}
            disabled={busy !== null}
            aria-label={`Emails to ${sub.target}`}
            onChange={(e) => {
              const enabled = e.currentTarget.checked;
              void run('toggle', () => save({ ...base, enabled }), "Couldn't change it");
            }}
          />
          <Button
            variant="light"
            size="compact-xs"
            leftSection={<IconSend size={12} />}
            loading={busy === 'test'}
            disabled={busy !== null && busy !== 'test'}
            onClick={() => void run('test', () => api.testAlert(sub.id), "The test email didn't go", `Sent a test email to ${sub.target}`)}
          >
            Send test
          </Button>
          <Tooltip label="Stop emailing this address">
            <Button
              variant="subtle"
              color="red"
              size="compact-xs"
              loading={busy === 'remove'}
              disabled={busy !== null && busy !== 'remove'}
              aria-label={`Remove ${sub.target}`}
              onClick={() => void run('remove', () => api.deleteAlert(sub.id), "Couldn't remove it", `Removed ${sub.target}`)}
            >
              <IconTrash size={14} />
            </Button>
          </Tooltip>
        </Group>
      </Group>
      <MultiSelect
        size="xs"
        aria-label={`Projects emailed to ${sub.target}`}
        placeholder={sub.projects.length ? undefined : 'All projects'}
        data={options}
        value={sub.projects}
        searchable
        clearable
        disabled={busy !== null}
        onChange={(projects) => void run('projects', () => save({ ...base, projects }), "Couldn't change the projects")}
      />
      <Text size="xs" c={sub.lastError ? 'red' : 'dimmed'} component="div" style={{ overflowWrap: 'anywhere' }}>
        {sub.lastError ? (
          `Last error: ${sub.lastError}`
        ) : sub.lastSentAt ? (
          <>
            Last sent <RelativeTime iso={sub.lastSentAt} size="xs" c="dimmed" />
          </>
        ) : (
          'Nothing sent yet'
        )}
      </Text>
    </Stack>
  );
}

export function EmailSubscriptions({ projects }: { projects: string[] }) {
  const { data, error, refresh } = usePolling('alerts', loadAlerts, { intervalMs: null });
  const [address, setAddress] = useState('');
  const [adding, setAdding] = useState(false);
  const subs = (data?.subscriptions ?? []).filter((s) => s.channel === 'email');
  const trimmed = address.trim();
  const invalid = trimmed !== '' && !EMAIL.test(trimmed);
  const exists = subs.some((s) => s.target.toLowerCase() === trimmed.toLowerCase());

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || invalid || exists) return;
    setAdding(true);
    try {
      await save({ target: trimmed, projects: [], enabled: true });
      notifySuccess(`New requests now go to ${trimmed}. Send a test to check it arrives (look in spam the first time).`);
      setAddress('');
      refresh();
    } catch (err) {
      notifyError(err, "Couldn't add the address");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Stack gap="xs" component="section" aria-labelledby="feedback-email-title">
      <Title order={2} size="h4" id="feedback-email-title">
        Email me new requests
      </Title>
      <Text size="sm" c="dimmed">
        Each email shows the request with one-click answers, so you can answer without coming here. Its links work without
        signing in for {FEEDBACK_LINK_DAYS} days or until it's answered, so anyone you forward it to can answer too.
      </Text>
      <Paper withBorder px="md" py="xs" radius="md">
        {!data && error ? (
          <LoadError message={error.message} onRetry={refresh} />
        ) : (
          <Stack gap={0}>
            {subs.map((s) => (
              <Row key={s.id} sub={s} projectOptions={projects} onChanged={refresh} />
            ))}
            <Group component="form" onSubmit={add} gap="xs" align="flex-start" py="xs" wrap="wrap">
              <TextInput
                type="email"
                size="xs"
                placeholder="you@example.com"
                aria-label="Email address"
                value={address}
                maxLength={LIMITS.linkLength}
                onChange={(e) => setAddress(e.currentTarget.value)}
                error={invalid ? 'That doesn’t look like an email address' : exists ? 'Already on the list' : undefined}
                style={{ flex: '1 1 220px' }}
              />
              <Button type="submit" size="xs" leftSection={<IconPlus size={14} />} loading={adding} disabled={!trimmed || invalid || exists}>
                Add
              </Button>
            </Group>
          </Stack>
        )}
      </Paper>
      <Text size="xs" c="dimmed">
        Phone alerts through ntfy are under{' '}
        <Anchor component={Link} to="/settings" size="xs">
          Settings
        </Anchor>
        .
      </Text>
    </Stack>
  );
}
