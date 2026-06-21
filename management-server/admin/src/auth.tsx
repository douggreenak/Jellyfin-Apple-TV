import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, getToken, onUnauthorized, setToken } from './api/client';

interface AuthState {
  username: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => !!getToken());
  const [loading, setLoading] = useState<boolean>(() => !!getToken());

  const handleUnauthorized = useCallback(() => {
    setToken(null);
    setUsername(null);
    setIsAuthenticated(false);
  }, []);

  // Validate an existing token on first load by calling /me.
  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((res) => {
        if (cancelled) return;
        setUsername(res.username);
        setIsAuthenticated(true);
      })
      .catch(() => {
        // 401 handler already clears token; just reflect logged-out state.
        if (cancelled) return;
        handleUnauthorized();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handleUnauthorized]);

  // React to 401s from anywhere in the app.
  useEffect(() => onUnauthorized(handleUnauthorized), [handleUnauthorized]);

  const login = useCallback(async (user: string, password: string) => {
    await api.login(user, password);
    const me = await api.me();
    setUsername(me.username);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    api.logout();
    setUsername(null);
    setIsAuthenticated(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ username, isAuthenticated, loading, login, logout }),
    [username, isAuthenticated, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return null; // brief; App shows nothing while we validate the token
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
