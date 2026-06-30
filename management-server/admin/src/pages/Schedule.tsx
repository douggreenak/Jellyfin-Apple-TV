import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import BedtimeOutlinedIcon from '@mui/icons-material/BedtimeOutlined';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { api, type PowerSchedule, type ScheduleInput, type Unit } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import ScheduleDialog from '../components/ScheduleDialog';
import { timeAgo } from '../util/time';

function formatTime(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function formatDays(days: number[]): string {
  const set = [...days].sort((a, b) => a - b);
  const eq = (a: number[]) => a.length === set.length && a.every((v, i) => v === set[i]);
  if (eq([0, 1, 2, 3, 4, 5, 6])) return 'Every day';
  if (eq([1, 2, 3, 4, 5])) return 'Weekdays';
  if (eq([0, 6])) return 'Weekends';
  return set.map((d) => DAY_NAMES[d]).join(', ');
}

export default function Schedule() {
  const queryClient = useQueryClient();
  const [snack, setSnack] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PowerSchedule | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PowerSchedule | null>(null);

  const schedulesQuery = useQuery({ queryKey: ['schedules'], queryFn: api.listSchedules });
  const unitsQuery = useQuery({ queryKey: ['units'], queryFn: api.listUnits });
  const availableQuery = useQuery({
    queryKey: ['power-available'],
    queryFn: api.powerAvailable,
    staleTime: 60_000,
  });

  const units = unitsQuery.data ?? [];
  const schedules = schedulesQuery.data ?? [];
  const groups = useMemo(
    () => [...new Set(units.map((u) => u.groupId).filter((g): g is string => !!g))].sort(),
    [units],
  );
  const unitName = (id: string) => units.find((u) => u.unitId === id)?.displayName ?? id;
  const pairedCount = units.filter((u) => u.powerConfigured).length;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['schedules'] });

  const toggleMutation = useMutation({
    mutationFn: ({ s, enabled }: { s: PowerSchedule; enabled: boolean }) => {
      const input: ScheduleInput = {
        name: s.name,
        enabled,
        action: s.action,
        targetType: s.targetType,
        targetValue: s.targetValue,
        time: s.time,
        days: s.days,
      };
      return api.updateSchedule(s.id, input);
    },
    onSuccess: () => invalidate(),
    onError: (err) => setSnack(err instanceof Error ? err.message : 'Update failed.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteSchedule(id),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(null);
      setSnack('Schedule deleted.');
    },
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => api.runSchedule(id),
    onSuccess: (res) => {
      invalidate();
      setSnack(`Ran now: ${res.result}`);
    },
    onError: (err) => setSnack(err instanceof Error ? err.message : 'Run failed.'),
  });

  const targetLabel = (s: PowerSchedule): string => {
    if (s.targetType === 'all') return 'All devices';
    if (s.targetType === 'group') return `Group: ${s.targetValue}`;
    return unitName(s.targetValue ?? '');
  };

  return (
    <Box sx={{ pb: 6 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4">Schedule</Typography>
          <Typography variant="body2" color="text.secondary">
            Automatically wake or sleep TVs at set times. Times are in the server’s local time.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          New schedule
        </Button>
      </Stack>

      {availableQuery.data && !availableQuery.data.available && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          pyatv isn’t installed on the server, so schedules can’t power devices yet. Install it
          (<code>pipx install pyatv</code>) and pair your TVs.
        </Alert>
      )}
      {availableQuery.data?.available && pairedCount === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No devices are paired for power control yet. Pair a TV from its <strong>Remote power</strong>{' '}
          panel so schedules have something to act on.
        </Alert>
      )}

      {schedulesQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : schedules.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <ScheduleIcon sx={{ fontSize: 56, color: 'text.disabled', mb: 1 }} />
          <Typography variant="h6">No schedules yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            Create one to turn TVs on in the morning and off at night automatically.
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            New schedule
          </Button>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {schedules.map((s) => (
            <Paper
              key={s.id}
              variant="outlined"
              sx={{
                p: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                opacity: s.enabled ? 1 : 0.6,
                borderLeft: '4px solid',
                borderLeftColor: s.action === 'on' ? 'success.main' : 'grey.500',
              }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  color: s.action === 'on' ? 'success.main' : 'text.secondary',
                  bgcolor: 'action.hover',
                }}
              >
                {s.action === 'on' ? <PowerSettingsNewIcon /> : <BedtimeOutlinedIcon />}
              </Box>

              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {s.name || `${s.action === 'on' ? 'Turn on' : 'Turn off'} ${targetLabel(s)}`}
                  </Typography>
                  <Chip
                    size="small"
                    label={s.action === 'on' ? 'On' : 'Off'}
                    color={s.action === 'on' ? 'success' : 'default'}
                    variant={s.action === 'on' ? 'filled' : 'outlined'}
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {formatTime(s.time)} · {formatDays(s.days)} · {targetLabel(s)}
                  {s.lastRun ? ` · last run ${timeAgo(s.lastRun)}${s.lastResult ? ` (${s.lastResult})` : ''}` : ''}
                </Typography>
              </Box>

              <Tooltip title={s.enabled ? 'Enabled' : 'Disabled'}>
                <Switch
                  checked={s.enabled}
                  onChange={(e) => toggleMutation.mutate({ s, enabled: e.target.checked })}
                />
              </Tooltip>
              <Tooltip title="Run now">
                <span>
                  <IconButton
                    onClick={() => runMutation.mutate(s.id)}
                    disabled={runMutation.isPending}
                  >
                    <PlayArrowIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Edit">
                <IconButton
                  onClick={() => {
                    setEditing(s);
                    setDialogOpen(true);
                  }}
                >
                  <EditOutlinedIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton color="error" onClick={() => setConfirmDelete(s)}>
                  <DeleteOutlineIcon />
                </IconButton>
              </Tooltip>
            </Paper>
          ))}
        </Stack>
      )}

      <ScheduleDialog
        open={dialogOpen}
        initial={editing}
        groups={groups}
        units={units.map((u: Unit) => ({
          unitId: u.unitId,
          displayName: u.displayName,
          powerConfigured: u.powerConfigured,
        }))}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          invalidate();
          setSnack(editing ? 'Schedule updated.' : 'Schedule created.');
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this schedule?"
        message={`"${confirmDelete?.name || 'This schedule'}" will no longer run.`}
        confirmLabel="Delete"
        destructive
        busy={deleteMutation.isPending}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        message={snack ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
