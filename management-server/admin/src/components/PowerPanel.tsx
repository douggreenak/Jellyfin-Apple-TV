import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import BedtimeOutlinedIcon from '@mui/icons-material/BedtimeOutlined';
import LinkIcon from '@mui/icons-material/Link';
import { api, ApiError } from '../api/client';
import PairDialog from './PairDialog';

/**
 * Remote power control for one unit: wake/sleep its Apple TV via pyatv. Pairing is
 * done entirely in the browser (scan → pick → enter PIN) — no terminal needed.
 */
export default function PowerPanel({ unitId }: { unitId: string }) {
  const queryClient = useQueryClient();
  const [snack, setSnack] = useState<string | null>(null);
  const [pairOpen, setPairOpen] = useState(false);

  const availableQuery = useQuery({
    queryKey: ['power-available'],
    queryFn: api.powerAvailable,
    staleTime: 60_000,
  });
  const powerQuery = useQuery({
    queryKey: ['unit-power', unitId],
    queryFn: () => api.getUnitPower(unitId),
  });

  const available = availableQuery.data?.available ?? true;
  const configured = powerQuery.data?.configured ?? false;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['unit-power', unitId] });
    queryClient.invalidateQueries({ queryKey: ['units'] });
  };

  const clearMutation = useMutation({
    mutationFn: () => api.clearUnitPower(unitId),
    onSuccess: () => {
      refresh();
      setSnack('Power-control pairing removed.');
    },
  });

  const powerMutation = useMutation({
    mutationFn: (on: boolean) => api.setPower(unitId, on),
    onSuccess: (_d, on) => setSnack(on ? 'Wake command sent.' : 'Sleep command sent.'),
    onError: (err) => setSnack(err instanceof ApiError ? err.message : 'Power command failed.'),
  });

  return (
    <Paper variant="outlined" sx={{ p: 2.5, mt: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <PowerSettingsNewIcon fontSize="small" color="action" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
          Remote power
        </Typography>
        {configured ? (
          <Chip size="small" color="success" variant="outlined" label="Paired" />
        ) : (
          <Chip size="small" variant="outlined" label="Not paired" />
        )}
      </Stack>
      <Alert severity="info" sx={{ mb: 2 }}>
        <strong>This does not turn the TV itself on or off.</strong> Apple provides no way for any
        app — including this one — to control a connected TV's power over the network. "Turn on" /
        "Turn off" only wake or sleep the Apple TV device; whether the TV screen also goes dark
        depends entirely on the TV's own HDMI-CEC behavior when it loses/regains signal, which this
        server has no control over.
      </Alert>

      {!available && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>pyatv isn’t installed on the server.</strong> Install it once on the management
          box (<code>pipx install pyatv</code>) — after that, pairing and control happen here, no
          terminal needed.
        </Alert>
      )}

      {configured ? (
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            color="success"
            startIcon={
              powerMutation.isPending && powerMutation.variables === true ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <PowerSettingsNewIcon />
              )
            }
            disabled={!available || powerMutation.isPending}
            onClick={() => powerMutation.mutate(true)}
          >
            Turn on
          </Button>
          <Button
            variant="outlined"
            startIcon={
              powerMutation.isPending && powerMutation.variables === false ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <BedtimeOutlinedIcon />
              )
            }
            disabled={!available || powerMutation.isPending}
            onClick={() => powerMutation.mutate(false)}
          >
            Turn off (sleep)
          </Button>
          <span style={{ flexGrow: 1 }} />
          <Button size="small" onClick={() => setPairOpen(true)} disabled={!available}>
            Re-pair
          </Button>
          <Button
            size="small"
            color="error"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
          >
            Remove
          </Button>
        </Stack>
      ) : (
        <Button
          variant="contained"
          startIcon={<LinkIcon />}
          onClick={() => setPairOpen(true)}
          disabled={!available}
        >
          Pair Apple TV
        </Button>
      )}

      <PairDialog
        open={pairOpen}
        unitId={unitId}
        onClose={() => setPairOpen(false)}
        onPaired={() => {
          refresh();
          setSnack('Apple TV paired — power control is ready.');
        }}
      />

      <Snackbar
        open={!!snack}
        autoHideDuration={3500}
        onClose={() => setSnack(null)}
        message={snack ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Paper>
  );
}
