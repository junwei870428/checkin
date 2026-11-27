import { Box, CircularProgress, CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { useMemo, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import AdminHome from './pages/AdminHome';
import LoginPage from './pages/LoginPage';
import StaffHome from './pages/StaffHome';
import { makeTheme } from './theme';

export default function App() {
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = useMemo(() => makeTheme(dark ? 'dark' : 'light'), [dark]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
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

function AppRoutes() {
  const { me, loading } = useAuth();
  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to={homePath(me.type)} replace /> : <LoginPage />} />
      <Route path="/checkin/*" element={<Guard type="staff"><StaffHome /></Guard>} />
      <Route path="/admin/*" element={<Guard type="user"><AdminHome /></Guard>} />
      <Route path="*" element={<Navigate to={homePath(me?.type)} replace />} />
    </Routes>
  );
}
