import { useEffect } from 'react';
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
import { Overview } from './routes/overview';
import { Traffic } from './routes/traffic';
import { Behavior } from './routes/behavior';
import { Funnel } from './routes/funnel';
import { Goals as KpiPage } from './routes/goals';
import { ReportPreview } from './routes/report-preview';
import { History } from './routes/history';
import { B2b } from './routes/b2b';
import { Live } from './pages/app/Live';
import { Goals } from './pages/app/Goals';
import { GoalDetail } from './pages/app/GoalDetail';
import { FunnelLive } from './pages/app/FunnelLive';
import { Explore } from './pages/app/Explore';
import { DataLens } from './pages/app/DataLens';
import { Users } from './pages/admin/Users';
import { AiProviders } from './pages/admin/AiProviders';
import { MetrikaSettings } from './pages/admin/Metrika';
import { Integrations } from './pages/admin/Integrations';
import { Audit } from './pages/admin/Audit';

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
