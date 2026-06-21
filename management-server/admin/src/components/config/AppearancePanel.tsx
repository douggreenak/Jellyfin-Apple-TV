import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
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

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export default function AppearancePanel({ value, onChange }: AppearancePanelProps) {
  const set = (patch: Partial<AppearanceConfig>) => onChange({ ...value, ...patch });
  const hexValid = HEX_RE.test(value.accentColorHex);

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

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <TextField
          label="Accent color"
          value={value.accentColorHex}
          onChange={(e) => set({ accentColorHex: e.target.value })}
          error={!hexValid}
          helperText={hexValid ? '#RRGGBB' : 'Must be a #RRGGBB hex color'}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Box
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: '4px',
                    border: '1px solid rgba(0,0,0,0.15)',
                    bgcolor: hexValid ? value.accentColorHex : 'transparent',
                  }}
                />
              </InputAdornment>
            ),
          }}
          sx={{ width: 220 }}
        />
        <Box
          component="input"
          type="color"
          value={hexValid ? value.accentColorHex : '#5E5CE6'}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            set({ accentColorHex: e.target.value.toUpperCase() })
          }
          sx={{
            mt: 0.25,
            width: 48,
            height: 40,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            p: 0,
          }}
          aria-label="Pick accent color"
        />
      </Box>

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
