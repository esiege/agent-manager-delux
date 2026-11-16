// The page a feedback email links to: one request, answered without signing in. The link's token
// (?t=) is the key; ?q=&a= carry the option or score you clicked in the email, already picked here.
// After you send, it shows your answer and how far the agent has got, and updates as it moves on.

import type { Feedback, FeedbackLinkResponse } from '@agent-manager-delux/shared';
import { Alert, Anchor, Button, Center, Container, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconCircleCheck, IconExternalLink } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { FeedbackCard, FeedbackReadOnlyCard, type FeedbackAction, type FeedbackAnswer, type Preselect } from '../components/FeedbackCard';
import { Logo } from '../components/Logo';
import { mediaTypeOf } from '../lib/media';
import { notifyError } from '../lib/notify';
import { LinkError, linkApi } from './linkApi';

/** After sending, look again this often, so the agent's steps show up here too. */
const POLL_MS = 15_000;

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; expired: boolean }
  | { kind: 'ready'; data: FeedbackLinkResponse; justSent: FeedbackAction | null };

function readParams(): { token: string | null; preselect: Preselect | undefined } {
  const p = new URLSearchParams(window.location.search);
  const q = p.get('q');
  const a = p.get('a');
  return { token: p.get('t'), preselect: q && a ? { questionId: q, value: a } : undefined };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Container size={720} px="md" py="lg" className="am-answer">
      <Stack gap="md">
        <Group gap="xs" wrap="nowrap">
          <Logo height={36} />
        </Group>
        {children}
      </Stack>
    </Container>
  );
}

function Problem({ message, expired }: { message: string; expired: boolean }) {
  return (
    <Paper withBorder p="lg" radius="md">
      <Stack gap="sm">
        <Group gap="xs" wrap="nowrap">
          <IconAlertCircle size={20} color="var(--mantine-color-orange-filled)" aria-hidden />
          <Title order={1} size="h4">
            {expired ? 'This link has expired' : "This link doesn't work"}
          </Title>
        </Group>
        <Text size="sm">{message}</Text>
        <Text size="sm" c="dimmed">
          You can still answer on the Feedback tab, once you've signed in.
        </Text>
        <Anchor href="/feedback" size="sm">
          Open the Feedback tab
        </Anchor>
      </Stack>
    </Paper>
  );
}

function Done({ feedback, action, email }: { feedback: Feedback; action: FeedbackAction; email: string }) {
  return (
    <Alert variant="light" color="teal" icon={<IconCircleCheck size={20} />} title={action === 'send' ? 'Sent: the agent will see it' : 'Dismissed: the agent goes ahead with its default'}>
      <Text size="sm">
        Recorded as {email}. The steps below fill in as the agent reads your answer and works on it.
      </Text>
      <Anchor href={`/feedback?id=${encodeURIComponent(feedback.id)}`} size="sm" mt={4} display="inline-flex" style={{ alignItems: 'center', gap: 4 }}>
        Open on the Feedback tab <IconExternalLink size={14} aria-hidden />
      </Anchor>
    </Alert>
  );
}

export function AnswerApp() {
  const [{ token, preselect }] = useState(readParams);
  const [state, setState] = useState<State>(() =>
    token ? { kind: 'loading' } : { kind: 'error', message: 'The link is missing its key. Open it from the email again.', expired: false },
  );

  const load = useCallback(
    async (justSent: FeedbackAction | null) => {
      if (!token) return;
      try {
        const data = await linkApi.load(token);
        setState((s) => ({ kind: 'ready', data, justSent: justSent ?? (s.kind === 'ready' ? s.justSent : null) }));
      } catch (e) {
        const err = e instanceof LinkError ? e : new LinkError(String(e), 0);
        setState((s) =>
          // A failed refresh keeps what's on screen.
          s.kind === 'ready' && err.status === 0 ? s : { kind: 'error', message: err.message, expired: /expired/i.test(err.message) },
        );
      }
    },
    [token],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  // Once it's answered, keep the progress current while the page is open.
  const answered = state.kind === 'ready' && !state.data.canAnswer;
  useEffect(() => {
    if (!answered) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(null);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [answered, load]);

  useEffect(() => {
    if (state.kind === 'ready') document.title = `${state.data.feedback.title} · Feedback`;
  }, [state]);

  if (state.kind === 'loading') {
    return (
      <Shell>
        <Center py="xl">
          <Loader />
        </Center>
      </Shell>
    );
  }
  if (state.kind === 'error' || !token) {
    return (
      <Shell>
        <Problem message={state.kind === 'error' ? state.message : ''} expired={state.kind === 'error' && state.expired} />
      </Shell>
    );
  }

  const { data, justSent } = state;
  const f = data.feedback;
  const mediaUrl = (id: string) => data.mediaUrls[id] ?? '';
  const findRequest = () => undefined;

  async function onAnswer(action: FeedbackAction, { answers, notes, note }: FeedbackAnswer): Promise<boolean> {
    try {
      await linkApi.respond({ t: token!, action, answers, notes, note: note || null });
      await load(action);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return true;
    } catch (e) {
      notifyError(e, action === 'send' ? "Couldn't send your feedback" : "Couldn't dismiss the request");
      void load(null);
      return false;
    }
  }

  return (
    <Shell>
      {data.canAnswer ? (
        <>
          <Text size="sm" c="dimmed">
            Answering as {data.email}. Pick, rate or write, then press Send.
          </Text>
          <FeedbackCard
            feedback={f}
            findRequest={findRequest}
            showDelivery={false}
            linkAgent={false}
            mediaUrl={mediaUrl}
            preselect={preselect}
            uploadAnswerMedia={async (file) => {
              const type = mediaTypeOf(file);
              if (!type) throw new Error(`${file.name} isn't a picture, clip or sound`);
              return (await linkApi.addAnswerMedia(token, file, type)).stored;
            }}
            removeAnswerMedia={async (id) => {
              await linkApi.removeAnswerMedia(token, id);
            }}
            onAnswer={onAnswer}
          />
        </>
      ) : (
        <>
          {justSent ? (
            <Done feedback={f} action={justSent} email={data.email} />
          ) : (
            <Alert variant="light" color="blue" title={f.status === 'open' ? 'This link has expired' : 'Already answered'}>
              <Text size="sm">
                {f.status === 'open'
                  ? 'Answer it on the Feedback tab instead.'
                  : `${f.response?.by ?? 'Someone'} answered it. Here's the answer and where the agent has got to.`}
              </Text>
              <Button component="a" href={`/feedback?id=${encodeURIComponent(f.id)}`} variant="subtle" size="compact-sm" mt={4} rightSection={<IconExternalLink size={14} />}>
                Open on the Feedback tab
              </Button>
            </Alert>
          )}
          <FeedbackReadOnlyCard feedback={f} mediaUrl={mediaUrl} findRequest={findRequest} />
        </>
      )}
    </Shell>
  );
}
