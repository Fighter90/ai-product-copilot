import { lazy, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { queryClient } from './lib/query';
import { AuthProvider, RequireAdmin, RequireAuth } from './auth/AuthContext';
import { CabinetLayout } from './components/CabinetLayout';
import { Assistant } from './components/Assistant';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyPrefs, usePrefs } from './store/prefs';
import { Landing } from './pages/public/Landing';
import { Login } from './pages/public/Login';
import { HelpCenter } from './pages/public/HelpCenter';

/**
 * Cabinet/admin pages are code-split: each loads in its own chunk on first
 * visit, keeping the initial bundle small. Modules use named exports — wrap
 * them to satisfy React.lazy's default-export contract.
 */
const Overview = lazy(() => import('./routes/overview').then((m) => ({ default: m.Overview })));
const Traffic = lazy(() => import('./routes/traffic').then((m) => ({ default: m.Traffic })));
const Behavior = lazy(() => import('./routes/behavior').then((m) => ({ default: m.Behavior })));
const Funnel = lazy(() => import('./routes/funnel').then((m) => ({ default: m.Funnel })));
const KpiPage = lazy(() => import('./routes/goals').then((m) => ({ default: m.Goals })));
const ReportPreview = lazy(() =>
  import('./routes/report-preview').then((m) => ({ default: m.ReportPreview })),
);
const History = lazy(() => import('./routes/history').then((m) => ({ default: m.History })));
const B2b = lazy(() => import('./routes/b2b').then((m) => ({ default: m.B2b })));
const Live = lazy(() => import('./pages/app/Live').then((m) => ({ default: m.Live })));
const Goals = lazy(() => import('./pages/app/Goals').then((m) => ({ default: m.Goals })));
const GoalDetail = lazy(() =>
  import('./pages/app/GoalDetail').then((m) => ({ default: m.GoalDetail })),
);
const FunnelLive = lazy(() =>
  import('./pages/app/FunnelLive').then((m) => ({ default: m.FunnelLive })),
);
const Explore = lazy(() => import('./pages/app/Explore').then((m) => ({ default: m.Explore })));
const DataLens = lazy(() => import('./pages/app/DataLens').then((m) => ({ default: m.DataLens })));
const Users = lazy(() => import('./pages/admin/Users').then((m) => ({ default: m.Users })));
const AiProviders = lazy(() =>
  import('./pages/admin/AiProviders').then((m) => ({ default: m.AiProviders })),
);
const MetrikaSettings = lazy(() =>
  import('./pages/admin/Metrika').then((m) => ({ default: m.MetrikaSettings })),
);
const Integrations = lazy(() =>
  import('./pages/admin/Integrations').then((m) => ({ default: m.Integrations })),
);
const Audit = lazy(() => import('./pages/admin/Audit').then((m) => ({ default: m.Audit })));

/** Same look as auth's Splash — shown while a lazy route chunk loads. */
/** Pre-v3 URLs (/traffic, /report, …) keep working by redirecting into the cabinet. */
function LegacyRedirect(): JSX.Element {
  const { pathname, search } = useLocation();
  const map: Record<string, string> = {
    '/hypotheses': '/app/report',
    '/decisions': '/app/report',
    '/settings': '/app/admin/metrika',
    '/goals': '/app/kpi',
  };
  return <Navigate to={`${map[pathname] ?? `/app${pathname}`}${search}`} replace />;
}

function PrefsSync(): null {
  const { theme, locale } = usePrefs();
  useEffect(() => applyPrefs(theme, locale), [theme, locale]);
  return null;
}

export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <PrefsSync />
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/help" element={<HelpCenter />} />
              <Route path="/help/:slug" element={<HelpCenter />} />
              <Route
                path="/app"
                element={
                  <RequireAuth>
                    <CabinetLayout />
                  </RequireAuth>
                }
              >
                <Route index element={<Overview />} />
                <Route path="live" element={<Live />} />
                <Route path="goals" element={<Goals />} />
                <Route path="goals/:id" element={<GoalDetail />} />
                <Route path="funnel-live" element={<FunnelLive />} />
                <Route path="traffic" element={<Traffic />} />
                <Route path="behavior" element={<Behavior />} />
                <Route path="funnel" element={<Funnel />} />
                <Route path="kpi" element={<KpiPage />} />
                <Route path="explore" element={<Navigate to="/app/explore/sources" replace />} />
                <Route path="explore/:preset" element={<Explore />} />
                <Route path="report" element={<ReportPreview />} />
                <Route path="history" element={<History />} />
                <Route path="b2b" element={<B2b />} />
                <Route path="datalens" element={<DataLens />} />
                <Route path="hypotheses" element={<Navigate to="/app/report" replace />} />
                <Route
                  path="admin/users"
                  element={
                    <RequireAdmin>
                      <Users />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="admin/ai"
                  element={
                    <RequireAdmin>
                      <AiProviders />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="admin/metrika"
                  element={
                    <RequireAdmin>
                      <MetrikaSettings />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="admin/integrations"
                  element={
                    <RequireAdmin>
                      <Integrations />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="admin/audit"
                  element={
                    <RequireAdmin>
                      <Audit />
                    </RequireAdmin>
                  }
                />
                <Route path="*" element={<Navigate to="/app" replace />} />
              </Route>
              {[
                '/traffic',
                '/behavior',
                '/funnel',
                '/goals',
                '/report',
                '/history',
                '/settings',
                '/hypotheses',
                '/decisions',
                '/b2b',
              ].map((p) => (
                <Route key={p} path={p} element={<LegacyRedirect />} />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <ErrorBoundary>
              <Assistant />
            </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
