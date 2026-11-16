import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { AuthGate } from './components/AuthGate';
import { TableSkeleton } from './components/States';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { AgentsPage } from './pages/AgentsPage';
import { DashboardPage } from './pages/DashboardPage';
import { KeysPage } from './pages/KeysPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';

// The Markdown renderer is only needed on the Instructions, Feedback and Releases tabs.
// The charts are only needed on the Reporting and Game tabs.
const ReportingPage = lazy(() => import('./pages/ReportingPage').then((m) => ({ default: m.ReportingPage })));
const PerformancePage = lazy(() => import('./pages/PerformancePage').then((m) => ({ default: m.PerformancePage })));
const PerfSessionPage = lazy(() => import('./pages/PerfSessionPage').then((m) => ({ default: m.PerfSessionPage })));
const CrashesPage = lazy(() => import('./pages/CrashesPage').then((m) => ({ default: m.CrashesPage })));
const CrashPage = lazy(() => import('./pages/CrashesPage').then((m) => ({ default: m.CrashPage })));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage').then((m) => ({ default: m.FeedbackPage })));
const ReleasesPage = lazy(() => import('./pages/ReleasesPage').then((m) => ({ default: m.ReleasesPage })));
const InstructionsPage = lazy(() => import('./pages/InstructionsPage').then((m) => ({ default: m.InstructionsPage })));

/** The Feedback tab was Blockers: old alert links (/blockers?id=…) land on the same request. */
/** Crashes moved under the Game tab: /crashes and /crashes/crash?id=… land in the same place. */
function CrashesRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={`${pathname.endsWith('/crash') ? '/performance/crash' : '/performance/crashes'}${search}`} replace />;
}

function BlockersRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/feedback${search}`} replace />;
}

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route
            path="feedback"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <FeedbackPage />
              </Suspense>
            }
          />
          <Route path="blockers" element={<BlockersRedirect />} />
          <Route
            path="releases"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <ReleasesPage />
              </Suspense>
            }
          />
          <Route
            path="reporting"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <ReportingPage />
              </Suspense>
            }
          />
          <Route
            path="performance"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <PerformancePage />
              </Suspense>
            }
          />
          <Route
            path="performance/session"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <PerfSessionPage />
              </Suspense>
            }
          />
          <Route
            path="performance/crashes"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <CrashesPage />
              </Suspense>
            }
          />
          <Route
            path="performance/crash"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <CrashPage />
              </Suspense>
            }
          />
          {/* Crashes had a tab of their own; links in Feedback items sent then still work. */}
          <Route path="crashes" element={<CrashesRedirect />} />
          <Route path="crashes/crash" element={<CrashesRedirect />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/detail" element={<AgentDetailPage />} />
          <Route
            path="instructions"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <InstructionsPage />
              </Suspense>
            }
          />
          <Route path="keys" element={<KeysPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
