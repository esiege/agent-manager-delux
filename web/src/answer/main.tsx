// The answer page's entry (answer.html): no sign-in gate and no navigation, just the request an
// email linked to. It shares the app's theme, styles and feedback card.

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '../styles.css';
import '../siteTheme.css';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { theme } from '../theme';
import { AnswerApp } from './AnswerApp';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" limit={4} />
      {/* The feedback card uses router links; nothing here navigates. */}
      <BrowserRouter>
        <AnswerApp />
      </BrowserRouter>
    </MantineProvider>
  </StrictMode>,
);
