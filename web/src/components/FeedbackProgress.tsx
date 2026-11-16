// Where a feedback request has got to after you answered: a small panel per step (sent, agent
// viewed, planning, implementing, closed), then the step expected next, dashed. Steps that arrive
// while the page is open slide in, so you notice when the agent picks your answer up.

import { FEEDBACK_STATUS_LABEL, type Feedback, type FeedbackStatus, type FeedbackStep } from '@agent-manager-delux/shared';
import { Text, Tooltip } from '@mantine/core';
import { useEffect, useRef } from 'react';
import { formatAbsolute } from '../lib/time';
import { RelativeTime } from './Time';

/** Badge colors for each status, as Mantine colors. */
export const FEEDBACK_STATUS_COLOR: Record<FeedbackStatus, string> = {
  open: 'orange',
  sent: 'blue',
  dismissed: 'gray',
  viewed: 'blue',
  planning: 'violet',
  implementing: 'violet',
  closed: 'teal',
  followup: 'violet',
};

/** The step's panel color: the ones styles.css has a tone for. Blue is the default. */
function tone(status: FeedbackStatus): string | undefined {
  const color = FEEDBACK_STATUS_COLOR[status];
  return color === 'blue' ? undefined : color;
}

/** What usually comes after each status, for the dashed panel. Done requests have none. */
const NEXT: Partial<Record<FeedbackStatus, FeedbackStatus>> = {
  sent: 'viewed',
  dismissed: 'viewed',
  viewed: 'planning',
  planning: 'implementing',
  implementing: 'closed',
};

const stepKey = (s: FeedbackStep) => `${s.status}@${s.at}`;

export function FeedbackProgress({ feedback }: { feedback: Feedback }) {
  // The steps there on first render are old news; anything later is new and animates.
  const seen = useRef<Set<string> | null>(null);
  const steps = feedback.history.filter((s) => s.status !== 'open');
  if (seen.current === null) seen.current = new Set(steps.map(stepKey));
  const next = NEXT[feedback.status];
  // Remember them after they've been shown once, so the animation runs once.
  useEffect(() => {
    for (const s of steps) seen.current!.add(stepKey(s));
  });

  return (
    <div className="am-feedback-steps" role="list" aria-label="Progress">
      {steps.map((s) => {
        const key = stepKey(s);
        const isNew = !seen.current!.has(key);
        return (
          <div key={key} className="am-feedback-step" role="listitem" data-tone={tone(s.status)} data-new={isNew || undefined}>
            <Tooltip label={`${formatAbsolute(s.at)} · ${s.by}`}>
              <Text size="xs" fw={600} c="inherit">
                {FEEDBACK_STATUS_LABEL[s.status]}
              </Text>
            </Tooltip>
            <RelativeTime iso={s.at} size="xs" c="inherit" style={{ opacity: 0.8 }} />
            {s.note && (
              <Text size="xs" c="inherit" lineClamp={3} style={{ overflowWrap: 'anywhere' }} title={s.note}>
                {s.note}
              </Text>
            )}
          </div>
        );
      })}
      {next && (
        <div className="am-feedback-step" role="listitem" data-next aria-label={`Next: ${FEEDBACK_STATUS_LABEL[next]}`}>
          <Text size="xs" fw={500} c="inherit">
            {FEEDBACK_STATUS_LABEL[next]}
          </Text>
          <Text size="xs" c="inherit">
            next
          </Text>
        </div>
      )}
    </div>
  );
}
