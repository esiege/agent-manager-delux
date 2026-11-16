// The Game tab's two sections: how runs went (Sessions) and how they ended badly (Crashes).

import { Tabs } from '@mantine/core';
import { IconBug, IconGauge } from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router';

export function GameSections() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const current = pathname.startsWith('/performance/crash') ? 'crashes' : 'sessions';
  return (
    <Tabs value={current} onChange={(v) => navigate(v === 'crashes' ? '/performance/crashes' : '/performance')} mb="md">
      <Tabs.List>
        <Tabs.Tab value="sessions" leftSection={<IconGauge size={16} />}>
          Sessions
        </Tabs.Tab>
        <Tabs.Tab value="crashes" leftSection={<IconBug size={16} />}>
          Crashes
        </Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}
