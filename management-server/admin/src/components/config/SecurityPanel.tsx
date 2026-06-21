import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SecurityConfig } from '../../api/client';

interface SecurityPanelProps {
  value: SecurityConfig;
  onChange: (next: SecurityConfig) => void;
}

const PIN_RE = /^[0-9]{4}$/;

export default function SecurityPanel({ value, onChange }: SecurityPanelProps) {
  const set = (patch: Partial<SecurityConfig>) => onChange({ ...value, ...patch });

  const pin = value.settingsPin ?? '';
  const pinValid = !value.settingsPinEnabled || PIN_RE.test(pin);

  return (
    <Stack spacing={2.5} maxWidth={560}>
      <Typography variant="subtitle1">Security</Typography>

      <FormControlLabel
        control={
          <Switch
            checked={value.settingsPinEnabled}
            onChange={(e) => set({ settingsPinEnabled: e.target.checked })}
          />
        }
        label="Require a PIN to open Settings on the TV"
      />

      {value.settingsPinEnabled && (
        <TextField
          label="Settings PIN"
          value={pin}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
            set({ settingsPin: digits.length ? digits : null });
          }}
          error={!pinValid}
          helperText={pinValid ? 'Exactly 4 digits.' : 'PIN must be exactly 4 digits.'}
          inputProps={{ inputMode: 'numeric', maxLength: 4 }}
          sx={{ width: 200 }}
        />
      )}

      {!value.settingsPinEnabled && (
        <Alert severity="info">
          Settings are open to anyone using the remote. Turn on a PIN to keep little
          hands out.
        </Alert>
      )}
    </Stack>
  );
}
