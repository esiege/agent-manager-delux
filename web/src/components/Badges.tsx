import { INSTRUCTIONS_VERSION, type AgentState } from '@agent-manager-delux/shared';
import { Badge, Tooltip } from '@mantine/core';
import { STATE_COLOR, STATE_LABEL } from '../lib/labels';

export function StateBadge({ state }: { state: AgentState }) {
  return (
    <Badge color={STATE_COLOR[state]} variant="light" radius="sm" tt="none" style={{ flexShrink: 0 }}>
      {STATE_LABEL[state]}
    </Badge>
  );
}

/** I-05: set up from an older instructions page. */
export function OldSetupBadge({ version }: { version: number | null }) {
  return (
    <Tooltip
      label={`Set up from instructions v${version ?? '?'}. The current version is v${INSTRUCTIONS_VERSION}: press Update all PCs on the Instructions tab, or send its agent the update sentence (PCs set up before v6 need the sentence once).`}
      multiline
      maw={320}
    >
      <Badge color="yellow" variant="outline" radius="sm" size="sm" tt="none" style={{ flexShrink: 0 }}>
        old version
      </Badge>
    </Tooltip>
  );
}
