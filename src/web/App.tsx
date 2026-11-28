import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Loading } from './components/Loading';
import { NotifyProvider } from './components/notify';
import AdminLayout from './pages/admin/AdminLayout';
import LoginPage from './pages/LoginPage';
import { makeTheme } from './theme';

// 各頁分開載入：報到端手機不用下載後台的 SheetJS，後台也不用下載相機掃描套件
const EventsPage = lazy(() => import('./pages/admin/EventsPage'));
const EventDetailPage = lazy(() => import('./pages/admin/EventDetailPage'));
const EmployeesPage = lazy(() => import('./pages/admin/EmployeesPage'));
const AccountsPage = lazy(() => import('./pages/admin/AccountsPage'));
const AuditPage = lazy(() => import('./pages/admin/AuditPage'));
const StationsPage = lazy(() => import('./pages/checkin/StationsPage'));
const ScanPage = lazy(() => import('./pages/checkin/ScanPage'));

export default function App() {
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = useMemo(() => makeTheme(dark ? 'dark' : 'light'), [dark]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <NotifyProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </NotifyProvider>
    </ThemeProvider>
  );
}

function homePath(type: 'user' | 'staff' | undefined) {
  if (type === 'user') return '/admin/events';
  if (type === 'staff') return '/checkin/stations';
  return '/login';
}

function Guard({ type, children }: { type: 'user' | 'staff'; children: ReactNode }) {
  const { me } = useAuth();
  if (!me) return <Navigate to="/login" replace />;
  if (me.type !== type) return <Navigate to={homePath(me.type)} replace />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  if (me?.type !== 'user' || me.role !== 'admin') return <Navigate to="/admin/events" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={me ? <Navigate to={homePath(me.type)} replace /> : <LoginPage />} />
        <Route path="/admin" element={<Guard type="user"><AdminLayout /></Guard>}>
          <Route index element={<Navigate to="/admin/events" replace />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="events/:id" element={<EventDetailPage />} />
          <Route path="employees" element={<AdminOnly><EmployeesPage /></AdminOnly>} />
          <Route path="accounts" element={<AdminOnly><AccountsPage /></AdminOnly>} />
          <Route path="audit" element={<AdminOnly><AuditPage /></AdminOnly>} />
          <Route path="*" element={<Navigate to="/admin/events" replace />} />
        </Route>
        <Route path="/checkin" element={<Guard type="staff"><Outlet /></Guard>}>
          <Route index element={<ScanPage />} />
          <Route path="stations" element={<StationsPage />} />
          <Route path="*" element={<Navigate to="/checkin/stations" replace />} />
        </Route>
        <Route path="*" element={<Navigate to={homePath(me?.type)} replace />} />
      </Routes>
    </Suspense>
  );
}
