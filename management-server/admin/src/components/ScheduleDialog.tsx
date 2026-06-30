import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import BedtimeOutlinedIcon from '@mui/icons-material/BedtimeOutlined';
import { api, ApiError, type PowerSchedule, type ScheduleInput } from '../api/client';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const PRESETS: { label: string; days: number[] }[] = [
  { label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Weekends', days: [0, 6] },
];

interface UnitOpt {
  unitId: string;
  displayName: string;
  powerConfigured?: boolean;
}

export default function ScheduleDialog({
  open,
  initial,
  groups,
  units,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: PowerSchedule | null;
  groups: string[];
  units: UnitOpt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [action, setAction] = useState<'on' | 'off'>('on');
  const [targetType, setTargetType] = useState<'all' | 'group' | 'unit'>('all');
  const [targetValue, setTargetValue] = useState<string>('');
  const [time, setTime] = useState('07:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initial) {
      setName(initial.name);
      setEnabled(initial.enabled);
      setAction(initial.action);
      setTargetType(initial.targetType);
      setTargetValue(initial.targetValue ?? '');
      setTime(initial.time);
      setDays(initial.days);
    } else {
      setName('');
      setEnabled(true);
      setAction('on');
      setTargetType('all');
      setTargetValue('');
      setTime('07:00');
      setDays([1, 2, 3, 4, 5]);
    }
  }, [open, initial]);

  const valid =
    /^([01]\d|2[0-3]):[0-5]\d$/.test(time) &&
    days.length > 0 &&
    (targetType === 'all' || !!targetValue);

  const save = async () => {
    if (!valid) {
      setError('Pick a time, at least one day, and a target.');
      return;
    }
    setBusy(true);
    setError(null);
    const input: ScheduleInput = {
      name: name.trim(),
      enabled,
      action,
      targetType,
      targetValue: targetType === 'all' ? null : targetValue,
      time,
      days,
    };
    try {
      if (initial) await api.updateSchedule(initial.id, input);
      else await api.createSchedule(input);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the schedule.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? 'Edit schedule' : 'New schedule'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="overline" color="text.secondary">
              Action
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={action}
              onChange={(_e, v) => v && setAction(v)}
              sx={{ mt: 0.5 }}
            >
              <ToggleButton value="on" color="success">
                <PowerSettingsNewIcon fontSize="small" sx={{ mr: 1 }} /> Turn on
              </ToggleButton>
              <ToggleButton value="off">
                <BedtimeOutlinedIcon fontSize="small" sx={{ mr: 1 }} /> Turn off (sleep)
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <TextField
            select
            label="Apply to"
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value as 'all' | 'group' | 'unit');
              setTargetValue('');
            }}
            fullWidth
          >
            <MenuItem value="all">All devices</MenuItem>
            <MenuItem value="group" disabled={groups.length === 0}>
              A group
            </MenuItem>
            <MenuItem value="unit">A specific device</MenuItem>
          </TextField>

          {targetType === 'group' && (
            <TextField
              select
              label="Group"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              fullWidth
            >
              {groups.map((g) => (
                <MenuItem key={g} value={g}>
                  {g}
                </MenuItem>
              ))}
            </TextField>
          )}

          {targetType === 'unit' && (
            <TextField
              select
              label="Device"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              fullWidth
            >
              {units.map((u) => (
                <MenuItem key={u.unitId} value={u.unitId}>
                  {u.displayName}
                  {u.powerConfigured ? '' : ' (not paired)'}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            label="Time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            sx={{ width: 160 }}
            InputLabelProps={{ shrink: true }}
            helperText="Server local time"
          />

          <Box>
            <Typography variant="overline" color="text.secondary">
              Days
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, mb: 1 }}>
              {PRESETS.map((p) => (
                <Button key={p.label} size="small" variant="outlined" onClick={() => setDays(p.days)}>
                  {p.label}
                </Button>
              ))}
            </Stack>
            <ToggleButtonGroup
              value={days}
              onChange={(_e, v: number[]) => setDays([...v].sort((a, b) => a - b))}
              size="small"
            >
              {DAY_LABELS.map((label, i) => (
                <ToggleButton key={i} value={i} sx={{ width: 44 }}>
                  {label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          <TextField
            label="Name (optional)"
            placeholder="e.g. Morning on"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />

          <FormControlLabel
            control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
            label="Enabled"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} color="inherit">
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={busy || !valid}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Create schedule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
