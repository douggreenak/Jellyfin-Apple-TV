import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import ReplayIcon from '@mui/icons-material/Replay';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  api,
  type CommandType,
  type JellyfinLibrary,
  type Unit,
  type UnitConfig,
} from '../api/client';
import StatusDot from '../components/StatusDot';
import ConfirmDialog from '../components/ConfirmDialog';
import TabPanel from '../components/TabPanel';
import SaveBar from '../components/SaveBar';
import JellyfinPanel from '../components/config/JellyfinPanel';
import AppearancePanel from '../components/config/AppearancePanel';
import BrowsePanel from '../components/config/BrowsePanel';
import PlaybackPanel from '../components/config/PlaybackPanel';
import { diffUnitConfig, isEmptyObject } from '../util/diff';
import { formatTimestamp, timeAgo } from '../util/time';

const DETAIL_POLL_MS = 10_000;

export default function UnitDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState(0);
  const [draft, setDraft] = useState<UnitConfig | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [libraries, setLibraries] = useState<JellyfinLibrary[]>([]);
  const [snack, setSnack] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const unitQuery = useQuery({
    queryKey: ['unit', id],
    queryFn: () => api.getUnit(id),
    refetchInterval: DETAIL_POLL_MS,
    enabled: !!id,
  });

  const unit = unitQuery.data;

  // Seed the editable draft once (and re-seed when configVersion changes on the
  // server, but only if the user hasn't made unsaved edits).
  const serverConfig = unit?.config;
  const hasDraftEdits = useMemo(() => {
    if (!draft || !serverConfig) return false;
    return !isEmptyObject(diffUnitConfig(serverConfig, draft));
  }, [draft, serverConfig]);

  useEffect(() => {
    if (!unit) return;
    setDraft((prev) => {
      if (!prev) return structuredClone(unit.config);
      // Re-seed only when server advanced and we have no local edits.
      const noLocalEdits = isEmptyObject(diffUnitConfig(unit.config, prev));
      return noLocalEdits ? structuredClone(unit.config) : prev;
    });
    setDisplayName((prev) => (prev ? prev : unit.displayName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit?.config.configVersion, unit?.unitId]);

  const patchMutation = useMutation({
    mutationFn: (partial: Parameters<typeof api.patchConfig>[1]) =>
      api.patchConfig(id, partial),
    onSuccess: (updated) => {
      setDraft(structuredClone(updated.config));
      setDisplayName(updated.displayName);
      queryClient.setQueryData(['unit', id], updated);
      queryClient.invalidateQueries({ queryKey: ['units'] });
    },
    onError: (err) => setSnack(err instanceof Error ? err.message : 'Save failed.'),
  });

  const commandMutation = useMutation({
    mutationFn: (type: CommandType) => api.sendCommand(id, type),
    onSuccess: (updated, type) => {
      queryClient.setQueryData(['unit', id], updated);
      queryClient.invalidateQueries({ queryKey: ['units'] });
      setSnack(
        type === 'identify'
          ? 'Identify sent.'
          : type === 'reload'
            ? 'Reload sent.'
            : 'Restart sent.',
      );
    },
    onError: (err) => setSnack(err instanceof Error ? err.message : 'Command failed.'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteUnit(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['units'] });
      navigate('/', { replace: true });
    },
    onError: (err) => {
      setSnack(err instanceof Error ? err.message : 'Delete failed.');
      setConfirmDelete(false);
    },
  });

  // Build the pending change set (config diff + an optional displayName change,
  // sent together so name + settings save atomically in one request).
  const buildPatch = (): Parameters<typeof api.patchConfig>[1] | null => {
    if (!unit || !draft) return null;
    const patch = diffUnitConfig(unit.config, draft) as Record<string, unknown>;
    const nameChanged = !!displayName.trim() && displayName.trim() !== unit.displayName;
    if (nameChanged) patch.displayName = displayName.trim();
    return isEmptyObject(patch)
      ? null
      : (patch as Parameters<typeof api.patchConfig>[1]);
  };

  const saveNow = () => {
    const patch = buildPatch();
    if (patch) patchMutation.mutate(patch);
  };

  // Autosave: persist a moment after edits stop — no Save button to find.
  useEffect(() => {
    if (patchMutation.isPending) return;
    const patch = buildPatch();
    if (!patch) return;
    const t = setTimeout(() => patchMutation.mutate(patch), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, displayName, unit, patchMutation.isPending]);

  if (unitQuery.isLoading || !draft || !unit) {
    if (unitQuery.isError) {
      return (
        <Alert severity="error">
          {unitQuery.error instanceof Error
            ? unitQuery.error.message
            : 'Could not load this unit.'}{' '}
          <Link component={RouterLink} to="/">
            Back to units
          </Link>
        </Alert>
      );
    }
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const nameDirty = displayName.trim() !== '' && displayName.trim() !== unit.displayName;
  const saving = hasDraftEdits || nameDirty || patchMutation.isPending;

  return (
    <Box sx={{ pb: 12 }}>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/" underline="hover" color="inherit">
          Units
        </Link>
        <Typography color="text.primary">{unit.displayName}</Typography>
      </Breadcrumbs>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
        <StatusDot
          online={unit.status.online}
          size={12}
          label={unit.status.online ? 'Online' : 'Offline'}
        />
        <Typography variant="h4">{unit.displayName}</Typography>
        {unit.pendingCommand && (
          <Chip
            size="small"
            color="warning"
            label={`Pending: ${unit.pendingCommand.type}`}
          />
        )}
      </Stack>

      <Card>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="General" />
          <Tab label="Jellyfin" />
          <Tab label="Appearance" />
          <Tab label="Browse" />
          <Tab label="Playback" />
        </Tabs>

        <CardContent sx={{ px: { xs: 2, md: 3 } }}>
          {/* General */}
          <TabPanel value={tab} index={0}>
            <GeneralTab
              unit={unit}
              displayName={displayName}
              onDisplayName={setDisplayName}
              groupId={draft.groupId}
              onGroupId={(groupId) => setDraft({ ...draft, groupId })}
              onCommand={(type) => commandMutation.mutate(type)}
              commandPending={commandMutation.isPending}
              onDelete={() => setConfirmDelete(true)}
            />
          </TabPanel>

          {/* Jellyfin */}
          <TabPanel value={tab} index={1}>
            <JellyfinPanel
              value={draft.jellyfin}
              onChange={(jellyfin) => setDraft({ ...draft, jellyfin })}
              onLibraries={setLibraries}
            />
          </TabPanel>

          {/* Appearance */}
          <TabPanel value={tab} index={2}>
            <AppearancePanel
              value={draft.appearance}
              onChange={(appearance) => setDraft({ ...draft, appearance })}
            />
          </TabPanel>

          {/* Browse */}
          <TabPanel value={tab} index={3}>
            <BrowsePanel
              value={draft.browse}
              onChange={(browse) => setDraft({ ...draft, browse })}
              libraries={libraries}
              jellyfin={draft.jellyfin}
            />
          </TabPanel>

          {/* Playback */}
          <TabPanel value={tab} index={4}>
            <PlaybackPanel
              value={draft.playback}
              onChange={(playback) => setDraft({ ...draft, playback })}
            />
          </TabPanel>
        </CardContent>
      </Card>

      {/* Autosave status */}
      <SaveBar saving={saving} error={patchMutation.isError} onRetry={saveNow} />

      <ConfirmDialog
        open={confirmDelete}
        title="Remove this unit?"
        message={`This removes "${unit.displayName}" from the fleet. If the Apple TV is still running, it will re-register the next time it connects.`}
        confirmLabel="Remove"
        destructive
        busy={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />

      <Snackbar
        open={!!snack}
        autoHideDuration={3500}
        onClose={() => setSnack(null)}
        message={snack ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// General tab — identity + telemetry readout + actions
// ---------------------------------------------------------------------------

interface GeneralTabProps {
  unit: Unit;
  displayName: string;
  onDisplayName: (v: string) => void;
  groupId: string | null;
  onGroupId: (v: string | null) => void;
  onCommand: (type: CommandType) => void;
  commandPending: boolean;
  onDelete: () => void;
}

function GeneralTab({
  unit,
  displayName,
  onDisplayName,
  groupId,
  onGroupId,
  onCommand,
  commandPending,
  onDelete,
}: GeneralTabProps) {
  const { status } = unit;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Status', value: status.online ? 'Online' : 'Offline' },
    {
      label: 'Last seen',
      value: `${timeAgo(status.lastSeenAt)} (${formatTimestamp(status.lastSeenAt)})`,
    },
    { label: 'Model', value: status.model ?? '—' },
    { label: 'tvOS', value: status.tvosVersion ?? '—' },
    { label: 'App version', value: status.appVersion ?? '—' },
    { label: 'IP address', value: status.ipAddress ?? '—' },
    {
      label: 'Now playing',
      value: status.nowPlaying?.title ?? 'Idle',
    },
    { label: 'Last error', value: status.lastError ?? 'None' },
    { label: 'Unit ID', value: unit.unitId },
    { label: 'Registered', value: formatTimestamp(unit.registeredAt) },
    { label: 'Config version', value: String(unit.config.configVersion) },
  ];

  return (
    <Grid container spacing={4}>
      <Grid item xs={12} md={6}>
        <Typography variant="subtitle1" gutterBottom>
          Identity
        </Typography>
        <Stack spacing={2.5} sx={{ maxWidth: 420 }}>
          <TextField
            label="Display name"
            fullWidth
            value={displayName}
            onChange={(e) => onDisplayName(e.target.value)}
            helperText="The friendly name shown in this dashboard."
          />
          <TextField
            label="Group"
            fullWidth
            value={groupId ?? ''}
            onChange={(e) => onGroupId(e.target.value || null)}
            helperText="Optional. Group related TVs (e.g. by room)."
          />
        </Stack>

        <Divider sx={{ my: 3 }} />

        <Typography variant="subtitle1" gutterBottom>
          Actions
        </Typography>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={<LightbulbIcon />}
            onClick={() => onCommand('identify')}
            disabled={!status.online || commandPending}
          >
            Identify
          </Button>
          <Button
            variant="outlined"
            startIcon={<ReplayIcon />}
            onClick={() => onCommand('reload')}
            disabled={!status.online || commandPending}
          >
            Reload
          </Button>
          <Button
            variant="outlined"
            startIcon={<RestartAltIcon />}
            onClick={() => onCommand('restart')}
            disabled={!status.online || commandPending}
          >
            Restart
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            onClick={onDelete}
          >
            Remove
          </Button>
        </Stack>
      </Grid>

      <Grid item xs={12} md={6}>
        <Typography variant="subtitle1" gutterBottom>
          Telemetry
        </Typography>
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          {rows.map((row, i) => (
            <Stack
              key={row.label}
              direction="row"
              spacing={2}
              sx={{
                px: 2,
                py: 1.25,
                bgcolor: i % 2 ? 'transparent' : 'action.hover',
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ width: 130, flexShrink: 0 }}
              >
                {row.label}
              </Typography>
              <Typography
                variant="body2"
                sx={{ wordBreak: 'break-word', fontFamily: row.label === 'Unit ID' ? 'monospace' : undefined }}
              >
                {row.value}
              </Typography>
            </Stack>
          ))}
        </Paper>
      </Grid>
    </Grid>
  );
}
