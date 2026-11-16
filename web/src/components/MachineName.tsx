// A machine as people know it: its nickname ("gaming rig") when it has one, with the name games
// and agents report (pc-0dc004594da2) on hover. With `editable`, a pencil renames it.

import { ActionIcon, Button, Group, Popover, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../lib/api';

export function machineLabel(machine: string, names: Record<string, string> | undefined): string {
  return names?.[machine] ?? machine;
}

interface Props {
  machine: string;
  names: Record<string, string> | undefined;
  editable?: boolean;
  /** Called with the new names after a rename. */
  onRenamed?: (names: Record<string, string>) => void;
  size?: 'xs' | 'sm';
}

export function MachineName({ machine, names, editable, onRenamed, size = 'sm' }: Props) {
  const nickname = names?.[machine];
  const [opened, setOpened] = useState(false);
  const [value, setValue] = useState(nickname ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setMachineName(machine, name);
      onRenamed?.(res.names);
      setOpened(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const label = (
    <Tooltip label={machine} disabled={!nickname}>
      <Text span size={size}>
        {nickname ?? machine}
      </Text>
    </Tooltip>
  );
  if (!editable) return label;

  return (
    <Group gap={4} wrap="nowrap" component="span" style={{ display: 'inline-flex' }}>
      {label}
      <Popover
        opened={opened}
        onChange={setOpened}
        position="bottom-start"
        withArrow
        shadow="md"
        onOpen={() => setValue(nickname ?? '')}
      >
        <Popover.Target>
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Name ${machine}`} onClick={() => setOpened((o) => !o)}>
            <IconPencil size={14} />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(value.trim());
            }}
          >
            <Stack gap="xs" w={260}>
              <TextInput
                label={`Name for ${machine}`}
                placeholder="gaming rig"
                value={value}
                onChange={(e) => setValue(e.currentTarget.value)}
                maxLength={40}
                data-autofocus
              />
              {error && (
                <Text size="xs" c="red">
                  {error}
                </Text>
              )}
              <Group gap="xs" justify="flex-end">
                {nickname && (
                  <Button variant="subtle" color="gray" size="xs" onClick={() => void save('')} disabled={busy}>
                    Clear
                  </Button>
                )}
                <Button type="submit" size="xs" loading={busy}>
                  Save
                </Button>
              </Group>
            </Stack>
          </form>
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
}
