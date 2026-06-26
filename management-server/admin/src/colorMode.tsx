import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import type { PaletteMode } from '@mui/material';
import { createAppTheme } from './theme';

const STORAGE_KEY = 'admin-color-mode';

interface ColorModeContextValue {
  mode: PaletteMode;
  toggle: () => void;
  setMode: (mode: PaletteMode) => void;
}

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

/** Read the persisted preference, falling back to the OS setting. */
function initialMode(): PaletteMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

/**
 * Provides the MUI theme (light/dark) plus a toggle. The chosen mode is persisted
 * to localStorage; if the user has never chosen, it follows the OS preference and
 * keeps tracking OS changes until they pick one explicitly.
 */
export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<PaletteMode>(initialMode);
  const [explicit, setExplicit] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY) !== null,
  );

  // Follow the OS preference until the user makes an explicit choice.
  useEffect(() => {
    if (explicit || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) =>
      setModeState(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [explicit]);

  const setMode = (next: PaletteMode) => {
    setExplicit(true);
    localStorage.setItem(STORAGE_KEY, next);
    setModeState(next);
  };

  const value = useMemo<ColorModeContextValue>(
    () => ({
      mode,
      setMode,
      toggle: () => setMode(mode === 'dark' ? 'light' : 'dark'),
    }),
    [mode],
  );

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export function useColorMode(): ColorModeContextValue {
  const ctx = useContext(ColorModeContext);
  if (!ctx) throw new Error('useColorMode must be used within ColorModeProvider');
  return ctx;
}
