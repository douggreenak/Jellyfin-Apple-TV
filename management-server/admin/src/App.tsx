import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth';
import AppShell from './components/AppShell';
import Login from './pages/Login';
import UnitsDashboard from './pages/UnitsDashboard';
import UnitDetail from './pages/UnitDetail';
import Defaults from './pages/Defaults';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell>
                <UnitsDashboard />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/units/:id"
          element={
            <RequireAuth>
              <AppShell>
                <UnitDetail />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/defaults"
          element={
            <RequireAuth>
              <AppShell>
                <Defaults />
              </AppShell>
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
