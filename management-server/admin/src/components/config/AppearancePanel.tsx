import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AppearanceConfig, PosterStyle, ThemeMode } from '../../api/client';

interface AppearancePanelProps {
  value: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
}

// accentColorHex is intentionally not editable here — every TV uses the
// fixed built-in default. (The dashboard's own theme color is a separate,
// admin-only preference — see the palette icon next to the dark-mode toggle,
// colorMode.tsx — with no relationship to this per-fleet TV config at all.)

export default function AppearancePanel({ value, onChange }: AppearancePanelProps) {
  const set = (patch: Partial<AppearanceConfig>) => onChange({ ...value, ...patch });

  return (
    <Stack spacing={2.5} maxWidth={560}>
      <Typography variant="subtitle1">Appearance</Typography>

      <TextField
        label="App title"
        fullWidth
        value={value.appTitle}
        onChange={(e) => set({ appTitle: e.target.value })}
        helperText="Shown at the top of the TV app."
      />

      <TextField
        select
        label="Theme"
        fullWidth
        value={value.theme}
        onChange={(e) => set({ theme: e.target.value as ThemeMode })}
      >
        <MenuItem value="system">Match TV (System)</MenuItem>
        <MenuItem value="light">Light</MenuItem>
        <MenuItem value="dark">Dark</MenuItem>
      </TextField>

      <TextField
        select
        label="Poster style"
        fullWidth
        value={value.posterStyle}
        onChange={(e) => set({ posterStyle: e.target.value as PosterStyle })}
      >
        <MenuItem value="poster">Poster (tall)</MenuItem>
        <MenuItem value="thumb">Thumbnail (square)</MenuItem>
        <MenuItem value="wide">Wide (16:9)</MenuItem>
      </TextField>

      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={value.showClock}
              onChange={(e) => set({ showClock: e.target.checked })}
            />
          }
          label="Show clock"
        />
        <FormControlLabel
          control={
            <Switch
              checked={value.showItemTitles}
              onChange={(e) => set({ showItemTitles: e.target.checked })}
            />
          }
          label="Show item titles"
        />
      </Box>
    </Stack>
  );
}
