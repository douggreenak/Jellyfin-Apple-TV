import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TvIcon from '@mui/icons-material/Tv';
import LinkIcon from '@mui/icons-material/Link';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import HomeIcon from '@mui/icons-material/Home';
import { api, ApiError, type RemoteKey } from '../api/client';
import PairDialog from './PairDialog';

const SCREEN_POLL_MS = 700;

/**
 * Live screen mirror + on-screen remote for one unit. Reuses the exact pairing
 * PowerPanel establishes (pyatv Companion credentials) — a unit paired for power
 * is automatically ready for remote control too, no separate pairing step.
 *
 * Screenshot polling (and the keepalive that tells the device to keep capturing)
 * only runs while this component is mounted — the parent tab wraps it in
 * TabPanel, which unmounts it the moment you switch away, so nothing streams
 * when you're not looking at it.
 */
export default function RemoteScreenPanel({ unitId }: { unitId: string }) {
  const queryClient = useQueryClient();
  const [snack, setSnack] = useState<string | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(true);
  const objectUrlRef = useRef<string | null>(null);

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

  // Poll the screenshot + send the keepalive together on one interval, only
  // while paired. Cleans up (and revokes the last object URL) on unmount.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;

    const tick = async () => {
      try {
        await api.screenKeepalive(unitId);
        const blob = await api.fetchScreenshotBlob(unitId);
        if (cancelled) return;
        if (blob) {
          const url = URL.createObjectURL(blob);
          setImgUrl(url);
          setWaiting(false);
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = url;
        }
      } catch {
        // Transient network hiccups shouldn't spam the user — just keep trying.
      }
    };

    void tick();
    const timer = setInterval(tick, SCREEN_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setImgUrl(null);
      setWaiting(true);
    };
  }, [configured, unitId]);

  const remoteMutation = useMutation({
    mutationFn: (action: RemoteKey) => api.sendRemote(unitId, action),
    onError: (err) => setSnack(err instanceof ApiError ? err.message : 'Remote command failed.'),
  });

  const press = (action: RemoteKey) => remoteMutation.mutate(action);
  const pressing = (action: RemoteKey) =>
    remoteMutation.isPending && remoteMutation.variables === action;

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <TvIcon fontSize="small" color="action" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
          Remote &amp; screen
        </Typography>
        {configured ? (
          <Chip size="small" color="success" variant="outlined" label="Paired" />
        ) : (
          <Chip size="small" variant="outlined" label="Not paired" />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        See roughly what's on screen and click around to fix a stuck TV — no need to walk over.
        Presses go straight to the Apple TV over the network, same as a physical remote.
      </Typography>

      {!available && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>pyatv isn't installed on the server.</strong> Install it once on the management
          box (<code>pipx install pyatv</code>) — after that, pairing and control happen here, no
          terminal needed.
        </Alert>
      )}

      {configured ? (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="flex-start">
          {/* Screen mirror */}
          <Box
            sx={{
              width: { xs: '100%', md: 360 },
              aspectRatio: '16 / 9',
              flexShrink: 0,
              bgcolor: 'common.black',
              borderRadius: 1.5,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            {waiting && !imgUrl && (
              <>
                <Skeleton
                  variant="rectangular"
                  sx={{ position: 'absolute', inset: 0 }}
                  animation="wave"
                />
                <Stack alignItems="center" spacing={1} sx={{ position: 'relative', zIndex: 1 }}>
                  <CircularProgress size={22} sx={{ color: 'common.white' }} />
                  <Typography variant="caption" sx={{ color: 'common.white' }}>
                    Waiting for the TV's screen…
                  </Typography>
                </Stack>
              </>
            )}
            {imgUrl && (
              <Box
                component="img"
                src={imgUrl}
                alt="Apple TV screen"
                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            )}
          </Box>

          {/* D-pad + transport controls */}
          <Stack spacing={2.5} alignItems="center">
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 52px)',
                gridTemplateRows: 'repeat(3, 52px)',
                gap: 0.5,
              }}
            >
              <Box />
              <RemoteButton
                icon={<KeyboardArrowUpIcon />}
                label="Up"
                onClick={() => press('up')}
                busy={pressing('up')}
              />
              <Box />
              <RemoteButton
                icon={<KeyboardArrowLeftIcon />}
                label="Left"
                onClick={() => press('left')}
                busy={pressing('left')}
              />
              <RemoteButton
                icon={<RadioButtonCheckedIcon fontSize="small" />}
                label="Select"
                onClick={() => press('select')}
                busy={pressing('select')}
                variant="contained"
              />
              <RemoteButton
                icon={<KeyboardArrowRightIcon />}
                label="Right"
                onClick={() => press('right')}
                busy={pressing('right')}
              />
              <Box />
              <RemoteButton
                icon={<KeyboardArrowDownIcon />}
                label="Down"
                onClick={() => press('down')}
                busy={pressing('down')}
              />
              <Box />
            </Box>

            <Stack direction="row" spacing={1}>
              <RemoteButton
                icon={<ArrowBackIcon fontSize="small" />}
                label="Menu / Back"
                onClick={() => press('menu')}
                busy={pressing('menu')}
                wide
              />
              <RemoteButton
                icon={<PlayArrowIcon fontSize="small" />}
                label="Play / Pause"
                onClick={() => press('play_pause')}
                busy={pressing('play_pause')}
                wide
              />
              <RemoteButton
                icon={<HomeIcon fontSize="small" />}
                label="Home (exits app)"
                onClick={() => press('top_menu')}
                busy={pressing('top_menu')}
                wide
              />
            </Stack>
          </Stack>
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
          setSnack('Apple TV paired — remote control is ready.');
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

function RemoteButton({
  icon,
  label,
  onClick,
  busy,
  variant = 'outlined',
  wide = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy: boolean;
  variant?: 'outlined' | 'contained';
  wide?: boolean;
}) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          color={variant === 'contained' ? 'primary' : 'default'}
          onClick={onClick}
          disabled={busy}
          sx={{
            width: wide ? 44 : 52,
            height: 44,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: wide ? 2 : 1.5,
            bgcolor: variant === 'contained' ? 'primary.main' : 'transparent',
            color: variant === 'contained' ? 'primary.contrastText' : undefined,
            '&:hover': {
              bgcolor: variant === 'contained' ? 'primary.dark' : 'action.hover',
            },
          }}
        >
          {busy ? <CircularProgress size={16} color="inherit" /> : icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}
