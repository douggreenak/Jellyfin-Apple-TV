import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { PlaybackConfig } from '../../api/client';

interface PlaybackPanelProps {
  value: PlaybackConfig;
  onChange: (next: PlaybackConfig) => void;
}

const MAX_MBPS = 120;

export default function PlaybackPanel({ value, onChange }: PlaybackPanelProps) {
  const set = (patch: Partial<PlaybackConfig>) => onChange({ ...value, ...patch });

  return (
    <Stack spacing={3} maxWidth={560}>
      <Typography variant="subtitle1">Playback</Typography>

      <Box>
        <Typography gutterBottom>
          Max bitrate
          <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>
            {value.maxBitrateMbps === 0
              ? 'Unlimited'
              : `${value.maxBitrateMbps} Mbps`}
          </Typography>
        </Typography>
        <Slider
          value={value.maxBitrateMbps}
          min={0}
          max={MAX_MBPS}
          step={1}
          marks={[
            { value: 0, label: 'Auto' },
            { value: 20, label: '20' },
            { value: 60, label: '60' },
            { value: MAX_MBPS, label: `${MAX_MBPS}` },
          ]}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => (v === 0 ? 'Unlimited' : `${v} Mbps`)}
          onChange={(_, v) => set({ maxBitrateMbps: v as number })}
        />
        <Typography variant="caption" color="text.secondary">
          0 = unlimited (let Jellyfin decide). Lower this on slow networks.
        </Typography>
      </Box>

      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={value.autoplayNext}
              onChange={(e) => set({ autoplayNext: e.target.checked })}
            />
          }
          label="Autoplay next episode"
        />
        <FormControlLabel
          control={
            <Switch
              checked={value.preferDirectPlay}
              onChange={(e) => set({ preferDirectPlay: e.target.checked })}
            />
          }
          label="Prefer direct play (avoid transcoding when possible)"
        />
      </Box>
    </Stack>
  );
}
