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
// The dashboard's own theme color — a per-browser admin preference with zero
// relationship to UnitConfig.appearance.accentColorHex (the TVs' own, fixed,
// non-editable default). Picked from ACCENT_PRESETS via the palette icon next
// to the dark-mode toggle; null means "use the Google-blue default."
const ACCENT_STORAGE_KEY = 'admin-theme-accent';

interface ColorModeContextValue {
  mode: PaletteMode;
  toggle: () => void;
  setMode: (mode: PaletteMode) => void;
  accentHex: string | null;
  setAccent: (hex: string | null) => void;
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

function initialAccent(): string | null {
  return localStorage.getItem(ACCENT_STORAGE_KEY);
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
  const [accentHex, setAccentState] = useState<string | null>(initialAccent);

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

  const setAccent = (hex: string | null) => {
    if (hex) localStorage.setItem(ACCENT_STORAGE_KEY, hex);
    else localStorage.removeItem(ACCENT_STORAGE_KEY);
    setAccentState(hex);
  };

  const value = useMemo<ColorModeContextValue>(
    () => ({
      mode,
      setMode,
      toggle: () => setMode(mode === 'dark' ? 'light' : 'dark'),
      accentHex,
      setAccent,
    }),
    [mode, accentHex],
  );

  const theme = useMemo(() => createAppTheme(mode, accentHex), [mode, accentHex]);

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
