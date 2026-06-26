import { createTheme, type Theme } from '@mui/material/styles';
import type { PaletteMode } from '@mui/material';

// Google blue brand accent.
const GOOGLE_BLUE = '#1A73E8';
// A lighter blue reads better as the primary on dark surfaces.
const GOOGLE_BLUE_DARK_MODE = '#8AB4F8';

/**
 * Build the MUI theme for a given palette mode. Shared shape/typography/component
 * styling is identical across modes; only the palette differs.
 */
export function createAppTheme(mode: PaletteMode): Theme {
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: isDark
        ? {
            main: GOOGLE_BLUE_DARK_MODE,
            light: '#AECBFA',
            dark: '#669DF6',
            contrastText: '#0B1320',
          }
        : {
            main: GOOGLE_BLUE,
            light: '#4285F4',
            dark: '#1557B0',
            contrastText: '#ffffff',
          },
      secondary: {
        main: '#FF9F0A',
      },
      success: {
        main: '#34C759',
      },
      error: {
        main: isDark ? '#FF6961' : '#FF3B30',
      },
      background: isDark
        ? {
            default: '#121316',
            paper: '#1B1D22',
          }
        : {
            default: '#F5F5F7',
            paper: '#FFFFFF',
          },
      text: isDark
        ? {
            primary: '#E6E6E8',
            secondary: '#9AA0A6',
          }
        : {
            primary: '#1C1C1E',
            secondary: '#6E6E73',
          },
      divider: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    },
    shape: {
      borderRadius: 12,
    },
    typography: {
      fontFamily: [
        'Roboto',
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Helvetica',
        'Arial',
        'sans-serif',
      ].join(','),
      h4: { fontWeight: 700, letterSpacing: '-0.5px' },
      h5: { fontWeight: 600, letterSpacing: '-0.25px' },
      h6: { fontWeight: 600 },
      subtitle1: { fontWeight: 500 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 10 },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            boxShadow: isDark
              ? '0 1px 2px rgba(0,0,0,0.40), 0 1px 3px rgba(0,0,0,0.50)'
              : '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)',
            backgroundImage: 'none',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          rounded: { borderRadius: 16 },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiTextField: {
        defaultProps: { variant: 'outlined', size: 'small' },
      },
      MuiChip: {
        styleOverrides: { root: { fontWeight: 500 } },
      },
    },
  });
}

/** Default light theme, kept for any direct importers. */
export const theme = createAppTheme('light');

export default theme;
