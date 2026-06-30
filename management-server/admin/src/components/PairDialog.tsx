import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import TvIcon from '@mui/icons-material/Tv';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api, ApiError, type AtvDevice } from '../api/client';

type Step = 'scan' | 'pin' | 'done';

export default function PairDialog({
  open,
  unitId,
  onClose,
  onPaired,
}: {
  open: boolean;
  unitId: string;
  onClose: () => void;
  onPaired: () => void;
}) {
  const [step, setStep] = useState<Step>('scan');
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<AtvDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<AtvDevice | null>(null);
  const [pairingId, setPairingId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualId, setManualId] = useState('');
  const [manualCreds, setManualCreds] = useState('');

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await api.scanAppleTVs();
      if (res.ok) setDevices(res.devices ?? []);
      else setError(res.error ?? 'Scan failed.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Scan failed.');
    } finally {
      setScanning(false);
    }
  };

  // Reset + auto-scan whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStep('scan');
    setDevices([]);
    setError(null);
    setDevice(null);
    setPairingId('');
    setPin('');
    setShowManual(false);
    setManualId('');
    setManualCreds('');
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const begin = async (d: AtvDevice) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.pairBegin(d.identifier);
      if (res.ok && res.pairingId) {
        setDevice(d);
        setPairingId(res.pairingId);
        setStep('pin');
      } else {
        setError(res.error ?? 'Could not start pairing.');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start pairing.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.pairFinish(unitId, pairingId, pin.trim());
      if (res.ok) {
        onPaired();
        onClose();
      } else {
        setError(res.error ?? 'Pairing failed.');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Pairing failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveManual = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setUnitPower(unitId, manualId.trim(), manualCreds.trim());
      onPaired();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>
        {step === 'pin' ? `Enter the code on ${device?.name ?? 'the Apple TV'}` : 'Pair an Apple TV'}
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {step === 'scan' && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Pick the Apple TV to control. It must be on the same network as this server.
            </Typography>
            {scanning ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4, justifyContent: 'center' }}>
                <CircularProgress size={22} />
                <Typography variant="body2" color="text.secondary">
                  Scanning the network…
                </Typography>
              </Box>
            ) : devices.length > 0 ? (
              <List dense sx={{ maxHeight: 280, overflow: 'auto' }}>
                {devices.map((d) => (
                  <ListItemButton key={d.identifier} disabled={busy} onClick={() => begin(d)}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <TvIcon />
                    </ListItemIcon>
                    <ListItemText primary={d.name} secondary={d.address} />
                    <Button size="small" variant="outlined" disabled={busy}>
                      Pair
                    </Button>
                  </ListItemButton>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                No Apple TVs found. Make sure the TV is awake and on this network, then rescan.
              </Typography>
            )}

            <Box sx={{ mt: 1 }}>
              <Button size="small" startIcon={<RefreshIcon />} onClick={scan} disabled={scanning || busy}>
                Rescan
              </Button>
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={() => setShowManual((v) => !v)}
                sx={{ ml: 2 }}
              >
                {showManual ? 'Hide manual entry' : "Can't find it? Enter manually"}
              </Link>
            </Box>

            <Collapse in={showManual}>
              <Stack spacing={2} sx={{ mt: 2 }}>
                <TextField
                  label="Apple TV identifier"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  fullWidth
                  size="small"
                />
                <TextField
                  label="Companion credentials"
                  value={manualCreds}
                  onChange={(e) => setManualCreds(e.target.value)}
                  fullWidth
                  size="small"
                  multiline
                  minRows={2}
                />
                <Box>
                  <Button
                    variant="contained"
                    disabled={!manualId.trim() || !manualCreds.trim() || busy}
                    onClick={saveManual}
                  >
                    Save pairing
                  </Button>
                </Box>
              </Stack>
            </Collapse>
          </>
        )}

        {step === 'pin' && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              A 4-digit code should now be on <strong>{device?.name}</strong>. Enter it here to
              finish pairing.
            </Typography>
            <TextField
              label="PIN from the TV"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoFocus
              fullWidth
              inputProps={{ inputMode: 'numeric', style: { letterSpacing: 6, fontSize: 22 } }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pin.trim()) finish();
              }}
            />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} disabled={busy} color="inherit">
          Cancel
        </Button>
        {step === 'pin' && (
          <Button
            variant="contained"
            onClick={finish}
            disabled={busy || !pin.trim()}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {busy ? 'Pairing…' : 'Pair'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
