import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import RefreshIcon from '@mui/icons-material/Refresh';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import ReplayIcon from '@mui/icons-material/Replay';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import SettingsIcon from '@mui/icons-material/Settings';
import AddTaskIcon from '@mui/icons-material/AddTask';
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import SearchIcon from '@mui/icons-material/Search';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import CloseIcon from '@mui/icons-material/Close';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewCompactIcon from '@mui/icons-material/ViewCompact';
import GridViewIcon from '@mui/icons-material/GridView';
import ViewListIcon from '@mui/icons-material/ViewList';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import { api, type BulkAction, type CommandType, type ServerExport, type Unit } from '../api/client';
import StatusDot from '../components/StatusDot';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatTimestamp, timeAgo } from '../util/time';

const POLL_MS = 5_000;

type StatusFilter = 'all' | 'online' | 'offline';
type Density = 'comfortable' | 'compact';
type ViewMode = 'grid' | 'list';

export default function UnitsDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [snack, setSnack] = useState<string | null>(null);

  // Fleet-management UI state.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [density, setDensity] = useState<Density>('comfortable');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const unitsQuery = useQuery({
    queryKey: ['units'],
    queryFn: api.listUnits,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['units'] });

  const commandMutation = useMutation({
    mutationFn: ({ id, type }: { id: string; type: CommandType }) =>
      api.sendCommand(id, type),
    onSuccess: (_data, vars) => {
      setSnack(
        vars.type === 'identify'
          ? 'Identify sent — watch for the on-screen flash.'
          : 'Reload sent — the unit will refresh shortly.',
      );
      invalidate();
    },
    onError: (err) => setSnack(err instanceof Error ? err.message : 'Command failed.'),
  });

  const adoptMutation = useMutation({
    mutationFn: (id: string) => api.adoptUnit(id),
    onSuccess: () => {
      setSnack('Device adopted — pushing your default settings to it now.');
      invalidate();
    },
    onError: (err) => setSnack(err instanceof Error ? err.message : 'Adopt failed.'),
  });

  const bulkMutation = useMutation({
    mutationFn: ({ ids, action, data }: { ids: string[]; action: BulkAction; data?: string }) =>
      api.bulkAction(ids, action, data),
    onSuccess: (result, vars) => {
      setSnack(`${BULK_VERB[vars.action]} ${result.affected} ${pluralize(result.affected, 'device')}.`);
      setSelected(new Set());
      invalidate();
    },
    onError: (err) => setSnack(err instanceof Error ? err.message : 'Bulk action failed.'),
  });

  const units = unitsQuery.data ?? [];
  const pending = units.filter((u) => !u.adopted);
  const managed = units.filter((u) => u.adopted);
  const onlineCount = managed.filter((u) => u.status.online).length;

  // Apply search + status filters to the adopted ("managed") fleet.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return managed.filter((u) => {
      if (statusFilter === 'online' && !u.status.online) return false;
      if (statusFilter === 'offline' && u.status.online) return false;
      if (!q) return true;
      const haystack = `${u.displayName} ${u.status.model ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [managed, search, statusFilter]);

  const filteredIds = useMemo(() => filtered.map((u) => u.unitId), [filtered]);

  // Keep selection in sync with what is actually visible/adopted.
  const selectedVisible = useMemo(
    () => filteredIds.filter((id) => selected.has(id)),
    [filteredIds, selected],
  );
  const allFilteredSelected = filteredIds.length > 0 && selectedVisible.length === filteredIds.length;
  const someFilteredSelected = selectedVisible.length > 0 && !allFilteredSelected;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const runBulk = (action: BulkAction, data?: string) => {
    if (selectedVisible.length === 0) return;
    bulkMutation.mutate({ ids: selectedVisible, action, data });
  };

  const summary =
    units.length === 0
      ? 'No Apple TVs registered yet'
      : `${onlineCount} of ${managed.length} adopted online` +
        (pending.length ? ` · ${pending.length} ready to adopt` : '');

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4">Units</Typography>
          <Typography variant="body2" color="text.secondary">{summary}</Typography>
        </Box>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <LiveIndicator
            updatedAt={unitsQuery.dataUpdatedAt}
            error={unitsQuery.isError}
          />
          <BackupControls onSnack={setSnack} onImported={invalidate} />
          <Tooltip title="Refresh now">
            <span>
              <IconButton onClick={() => unitsQuery.refetch()} disabled={unitsQuery.isFetching}>
                {unitsQuery.isFetching ? <CircularProgress size={22} /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {unitsQuery.isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {unitsQuery.error instanceof Error ? unitsQuery.error.message : 'Could not load units.'}
        </Alert>
      )}

      {unitsQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : units.length === 0 ? (
        <EmptyState />
      ) : (
        <Stack spacing={4}>
          {pending.length > 0 && (
            <ReadyToAdopt
              pending={pending}
              busy={adoptMutation.isPending}
              adoptingId={adoptMutation.isPending ? adoptMutation.variables : null}
              onAdopt={(id) => adoptMutation.mutate(id)}
              onAdoptAll={() => pending.forEach((u) => adoptMutation.mutate(u.unitId))}
            />
          )}

          <Box>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Devices
            </Typography>

            {managed.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No adopted devices yet — adopt one above to bring it online.
              </Typography>
            ) : (
              <>
                <FilterBar
                  search={search}
                  onSearch={setSearch}
                  statusFilter={statusFilter}
                  onStatusFilter={setStatusFilter}
                  density={density}
                  onDensity={setDensity}
                  viewMode={viewMode}
                  onViewMode={setViewMode}
                  shownCount={filtered.length}
                  totalCount={managed.length}
                  allSelected={allFilteredSelected}
                  someSelected={someFilteredSelected}
                  selectableCount={filteredIds.length}
                  onToggleAll={toggleAllFiltered}
                />

                {selectedVisible.length > 0 && (
                  <BulkActionBar
                    count={selectedVisible.length}
                    busy={bulkMutation.isPending}
                    onClear={clearSelection}
                    onReload={() => runBulk('reload')}
                    onIdentify={() => runBulk('identify')}
                    onRestart={() => runBulk('restart')}
                    onMigrate={() => setMigrateOpen(true)}
                    onDelete={() => setConfirmDeleteOpen(true)}
                  />
                )}

                {filtered.length === 0 ? (
                  <Paper
                    variant="outlined"
                    sx={{ p: 4, textAlign: 'center', mt: 2, color: 'text.secondary' }}
                  >
                    <Typography variant="body2">
                      No devices match your filters. Try clearing the search or status filter.
                    </Typography>
                  </Paper>
                ) : viewMode === 'list' ? (
                  <Stack spacing={1.25} sx={{ mt: 2 }}>
                    {filtered.map((unit) => (
                      <UnitRow
                        key={unit.unitId}
                        unit={unit}
                        selected={selected.has(unit.unitId)}
                        onToggleSelect={() => toggleOne(unit.unitId)}
                        onOpen={() => navigate(`/units/${unit.unitId}`)}
                        onCommand={(type) => commandMutation.mutate({ id: unit.unitId, type })}
                        commandPending={
                          commandMutation.isPending && commandMutation.variables?.id === unit.unitId
                        }
                      />
                    ))}
                  </Stack>
                ) : (
                  <Grid container spacing={density === 'compact' ? 1.5 : 3} sx={{ mt: 0 }}>
                    {filtered.map((unit) => (
                      <Grid
                        key={unit.unitId}
                        item
                        xs={12}
                        sm={6}
                        md={density === 'compact' ? 4 : 6}
                        lg={density === 'compact' ? 3 : 4}
                      >
                        <UnitCard
                          unit={unit}
                          density={density}
                          selected={selected.has(unit.unitId)}
                          onToggleSelect={() => toggleOne(unit.unitId)}
                          onOpen={() => navigate(`/units/${unit.unitId}`)}
                          onCommand={(type) => commandMutation.mutate({ id: unit.unitId, type })}
                          commandPending={
                            commandMutation.isPending && commandMutation.variables?.id === unit.unitId
                          }
                        />
                      </Grid>
                    ))}
                  </Grid>
                )}
              </>
            )}
          </Box>
        </Stack>
      )}

      <MigrateDialog
        open={migrateOpen}
        count={selectedVisible.length}
        busy={bulkMutation.isPending}
        onClose={() => setMigrateOpen(false)}
        onConfirm={(url) => {
          runBulk('migrate', url);
          setMigrateOpen(false);
        }}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete ${selectedVisible.length} ${pluralize(selectedVisible.length, 'device')}?`}
        message="This removes the selected Apple TVs from the management server. They will reappear as 'ready to adopt' if they check in again. This cannot be undone."
        confirmLabel="Delete"
        destructive
        busy={bulkMutation.isPending}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          runBulk('delete');
          setConfirmDeleteOpen(false);
        }}
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

const BULK_VERB: Record<BulkAction, string> = {
  adopt: 'Adopted',
  unadopt: 'Unadopted',
  reload: 'Reloaded',
  identify: 'Sent identify to',
  restart: 'Restarted',
  delete: 'Deleted',
  migrate: 'Moved',
};

function pluralize(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function LiveIndicator({ updatedAt, error }: { updatedAt: number; error: boolean }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.75}>
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: error ? 'error.main' : 'success.main',
          '@keyframes pulse': {
            '0%': { opacity: 1 },
            '50%': { opacity: 0.25 },
            '100%': { opacity: 1 },
          },
          animation: error ? 'none' : 'pulse 1.6s ease-in-out infinite',
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {error
          ? 'Disconnected'
          : updatedAt
            ? `Live · updated ${timeAgo(new Date(updatedAt).toISOString())}`
            : 'Connecting…'}
      </Typography>
    </Stack>
  );
}

function BackupControls({
  onSnack,
  onImported,
}: {
  onSnack: (m: string) => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; snapshot: ServerExport } | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    try {
      const snapshot = await api.exportConfig();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = `jellyfin-fleet-config-${stamp}.json`;
      // Append + defer-revoke so the download starts before the blob URL is freed
      // (a synchronous revoke can abort the download in Safari/Firefox).
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      onSnack(
        `Exported ${snapshot.units.length} ${pluralize(snapshot.units.length, 'device')} + defaults — keep this file safe, it contains credentials.`,
      );
    } catch (err) {
      onSnack(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked later
    if (!file) return;
    try {
      const snapshot = JSON.parse(await file.text()) as ServerExport;
      if (!snapshot || typeof snapshot !== 'object' || !snapshot.defaults || !Array.isArray(snapshot.units)) {
        onSnack('That file is not a valid server-config export.');
        return;
      }
      setReplaceExisting(false);
      setPending({ name: file.name, snapshot });
    } catch {
      onSnack('Could not read that file as JSON.');
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await api.importConfig(pending.snapshot, replaceExisting);
      onSnack(
        `Imported ${result.imported} ${pluralize(result.imported, 'device')}` +
          (result.removed ? `, removed ${result.removed}.` : '.'),
      );
      setPending(null);
      onImported();
    } catch (err) {
      onSnack(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title="Export full server config (includes credentials)">
        <IconButton onClick={handleExport}>
          <FileDownloadIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title="Import server config from a file">
        <IconButton onClick={() => fileRef.current?.click()}>
          <FileUploadIcon />
        </IconButton>
      </Tooltip>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={onFile}
      />

      <Dialog open={!!pending} onClose={busy ? undefined : () => setPending(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Import server configuration</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            <strong>{pending?.name}</strong> contains{' '}
            {pending ? pending.snapshot.units.length : 0}{' '}
            {pluralize(pending?.snapshot.units.length ?? 0, 'device')} and a defaults template.
            Importing replaces your defaults and updates each device's settings. Devices keep
            running and pick up the changes on their next check-in.
          </DialogContentText>
          <FormControlLabel
            control={
              <Checkbox
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
              />
            }
            label="Also delete devices not in this file (full restore)"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<FileUploadIcon />}
            onClick={confirmImport}
            disabled={busy}
          >
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

interface FilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusFilter: (v: StatusFilter) => void;
  density: Density;
  onDensity: (v: Density) => void;
  viewMode: ViewMode;
  onViewMode: (v: ViewMode) => void;
  shownCount: number;
  totalCount: number;
  allSelected: boolean;
  someSelected: boolean;
  selectableCount: number;
  onToggleAll: () => void;
}

function FilterBar({
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  density,
  onDensity,
  viewMode,
  onViewMode,
  shownCount,
  totalCount,
  allSelected,
  someSelected,
  selectableCount,
  onToggleAll,
}: FilterBarProps) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', md: 'center' }}
      >
        <FormControlLabel
          sx={{ ml: 0, mr: 0, whiteSpace: 'nowrap' }}
          control={
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              disabled={selectableCount === 0}
              onChange={onToggleAll}
            />
          }
          label={<Typography variant="body2">Select all</Typography>}
        />

        <TextField
          size="small"
          placeholder="Search by name or model…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          sx={{ flexGrow: 1, minWidth: 180 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" edge="end" onClick={() => onSearch('')}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />

        <ToggleButtonGroup
          size="small"
          exclusive
          value={statusFilter}
          onChange={(_e, v: StatusFilter | null) => v && onStatusFilter(v)}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="online">Online</ToggleButton>
          <ToggleButton value="offline">Offline</ToggleButton>
        </ToggleButtonGroup>

        <ToggleButtonGroup
          size="small"
          exclusive
          value={viewMode}
          onChange={(_e, v: ViewMode | null) => v && onViewMode(v)}
        >
          <ToggleButton value="grid" aria-label="Grid view">
            <GridViewIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="list" aria-label="List view">
            <ViewListIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>

        {viewMode === 'grid' && (
          <Tooltip title={density === 'compact' ? 'Comfortable cards' : 'Compact cards'}>
            <IconButton
              size="small"
              onClick={() => onDensity(density === 'compact' ? 'comfortable' : 'compact')}
            >
              {density === 'compact' ? <ViewModuleIcon /> : <ViewCompactIcon />}
            </IconButton>
          </Tooltip>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {shownCount} of {totalCount}
        </Typography>
      </Stack>
    </Paper>
  );
}

interface BulkActionBarProps {
  count: number;
  busy: boolean;
  onClear: () => void;
  onReload: () => void;
  onIdentify: () => void;
  onRestart: () => void;
  onMigrate: () => void;
  onDelete: () => void;
}

function BulkActionBar({
  count,
  busy,
  onClear,
  onReload,
  onIdentify,
  onRestart,
  onMigrate,
  onDelete,
}: BulkActionBarProps) {
  return (
    <Paper
      elevation={3}
      sx={{
        position: 'sticky',
        top: 8,
        zIndex: 10,
        p: 1.5,
        mb: 2,
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', sm: 'center' }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
          <Tooltip title="Clear selection">
            <IconButton size="small" onClick={onClear} sx={{ color: 'inherit' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="subtitle2" sx={{ whiteSpace: 'nowrap' }}>
            {count} selected
          </Typography>
        </Stack>

        <Box sx={{ flexGrow: 1 }} />

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ justifyContent: 'flex-end' }}>
          <BulkButton icon={<ReplayIcon />} label="Reload" onClick={onReload} disabled={busy} />
          <BulkButton icon={<LightbulbIcon />} label="Identify" onClick={onIdentify} disabled={busy} />
          <BulkButton icon={<RestartAltIcon />} label="Restart" onClick={onRestart} disabled={busy} />
          <BulkButton
            icon={<DriveFileMoveIcon />}
            label="Move to new server…"
            onClick={onMigrate}
            disabled={busy}
          />
          <Button
            size="small"
            variant="contained"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            onClick={onDelete}
            disabled={busy}
          >
            Delete
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function BulkButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={icon}
      onClick={onClick}
      disabled={disabled}
      sx={{
        color: 'inherit',
        borderColor: 'rgba(255,255,255,0.6)',
        '&:hover': { borderColor: 'inherit', bgcolor: 'rgba(255,255,255,0.12)' },
      }}
    >
      {label}
    </Button>
  );
}

interface MigrateDialogProps {
  open: boolean;
  count: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (url: string) => void;
}

function MigrateDialog({ open, count, busy, onClose, onConfirm }: MigrateDialogProps) {
  const defaultUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://';
  const [url, setUrl] = useState(defaultUrl);

  // Reset the field to the suggested origin whenever the dialog is (re)opened.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setUrl(defaultUrl);
    setWasOpen(true);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const trimmed = url.trim();
  const valid = /^https?:\/\/.+/i.test(trimmed);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Move {count} {pluralize(count, 'device')} to a new server</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Push a new management server URL to the selected Apple TVs. They will re-point
          themselves to it without needing to be re-adopted.
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          label="New management server URL"
          placeholder="http://192.168.1.20:4000"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          error={!!trimmed && !valid}
          helperText={
            !!trimmed && !valid
              ? 'Enter a full URL starting with http:// or https://'
              : 'The new server must already have this fleet’s migrated database, or the devices will be unable to load their config.'
          }
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} color="inherit">
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={<DriveFileMoveIcon />}
          disabled={busy || !valid}
          onClick={() => onConfirm(trimmed)}
        >
          Move {count} {pluralize(count, 'device')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface ReadyToAdoptProps {
  pending: Unit[];
  busy: boolean;
  adoptingId: string | null;
  onAdopt: (id: string) => void;
  onAdoptAll: () => void;
}

function ReadyToAdopt({ pending, busy, adoptingId, onAdopt, onAdoptAll }: ReadyToAdoptProps) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, borderColor: 'primary.main', bgcolor: 'action.hover' }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
        <NewReleasesIcon color="primary" />
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Ready to adopt ({pending.length})
        </Typography>
        {pending.length > 1 && (
          <Button
            size="small"
            variant="contained"
            startIcon={<AddTaskIcon />}
            onClick={onAdoptAll}
            disabled={busy}
          >
            Adopt all
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        These Apple TVs have checked in and are waiting. Adopting pushes your default settings
        (the shared Jellyfin account) and brings them online.
      </Typography>

      <Stack spacing={1.25}>
        {pending.map((unit) => (
          <Paper
            key={unit.unitId}
            variant="outlined"
            sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: 'background.paper' }}
          >
            <StatusDot online={unit.status.online} label={unit.status.online ? 'Online' : 'Offline'} />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap>{unit.displayName}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {[unit.status.model, unit.status.tvosVersion && `tvOS ${unit.status.tvosVersion}`]
                  .filter(Boolean)
                  .join(' · ') || 'Apple TV'}
                {' · '}
                <Tooltip title={formatTimestamp(unit.registeredAt)}>
                  <span>registered {timeAgo(unit.registeredAt)}</span>
                </Tooltip>
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddTaskIcon />}
              onClick={() => onAdopt(unit.unitId)}
              disabled={busy}
            >
              {adoptingId === unit.unitId ? 'Adopting…' : 'Adopt'}
            </Button>
          </Paper>
        ))}
      </Stack>
    </Paper>
  );
}

function EmptyState() {
  return (
    <Card sx={{ textAlign: 'center', py: 8, px: 3 }}>
      <DevicesOtherIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 1 }} />
      <Typography variant="h6">No Apple TVs yet</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 420, mx: 'auto' }}>
        Apple TVs will appear here once they connect. Open the Jellyfin app on a TV and it will
        register itself automatically, then show up as ready to adopt.
      </Typography>
    </Card>
  );
}

interface UnitCardProps {
  unit: Unit;
  density: Density;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onCommand: (type: CommandType) => void;
  commandPending: boolean;
}

function UnitCard({
  unit,
  density,
  selected,
  onToggleSelect,
  onOpen,
  onCommand,
  commandPending,
}: UnitCardProps) {
  const { status } = unit;
  const nowPlayingTitle = status.nowPlaying?.title;
  const compact = density === 'compact';
  const online = status.online;

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        borderColor: selected ? 'primary.main' : 'divider',
        borderWidth: selected ? 2 : 1,
        transition: 'box-shadow .15s ease, border-color .15s ease',
        '&:hover': { boxShadow: '0 4px 16px rgba(16,24,40,0.12)' },
        // Status accent strip down the left edge.
        '&::before': {
          content: '""',
          position: 'absolute',
          insetBlock: 0,
          left: 0,
          width: 4,
          bgcolor: online ? 'success.main' : 'grey.400',
        },
      }}
    >
      <CardContent sx={{ flexGrow: 1, pl: 2.5, pb: compact ? 1 : 2 }}>
        <Stack direction="row" alignItems="flex-start" spacing={1}>
          <Checkbox
            size="small"
            checked={selected}
            onChange={onToggleSelect}
            sx={{ p: 0.5, mt: -0.5, ml: -0.75 }}
            inputProps={{ 'aria-label': `Select ${unit.displayName}` }}
          />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Tooltip title="Open settings">
              <Link
                component="button"
                type="button"
                onClick={onOpen}
                underline="hover"
                color="inherit"
                sx={{
                  display: 'block',
                  width: '100%',
                  p: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <Typography variant="subtitle1" fontWeight={600} noWrap title={unit.displayName}>
                  {unit.displayName}
                </Typography>
              </Link>
            </Tooltip>
            <Tooltip title={formatTimestamp(status.lastSeenAt)}>
              <Typography variant="caption" color="text.secondary">
                {online ? 'Online' : 'Last seen'} · {timeAgo(status.lastSeenAt)}
              </Typography>
            </Tooltip>
          </Box>
          <Chip
            size="small"
            label={online ? 'Online' : 'Offline'}
            color={online ? 'success' : 'default'}
            variant={online ? 'filled' : 'outlined'}
            sx={{ fontWeight: 600, flexShrink: 0 }}
          />
        </Stack>

        <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 0.75 }}>
          {status.model && <Chip size="small" variant="outlined" label={status.model} />}
          {status.tvosVersion && (
            <Chip size="small" variant="outlined" label={`tvOS ${status.tvosVersion}`} />
          )}
          {status.appVersion && (
            <Chip size="small" variant="outlined" label={`App ${status.appVersion}`} />
          )}
        </Stack>

        {!compact && (
          <Box
            sx={{
              mt: 1.5,
              px: 1.5,
              py: 1,
              borderRadius: 2,
              bgcolor: 'action.hover',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              minHeight: 40,
            }}
          >
            {nowPlayingTitle ? (
              <>
                <PlayCircleIcon color="primary" fontSize="small" />
                <Typography variant="body2" noWrap title={nowPlayingTitle}>
                  {nowPlayingTitle}
                </Typography>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {online ? 'Idle — nothing playing' : 'Offline'}
              </Typography>
            )}
          </Box>
        )}

        {compact && nowPlayingTitle && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <PlayCircleIcon color="primary" fontSize="small" />
            <Typography variant="body2" noWrap title={nowPlayingTitle}>
              {nowPlayingTitle}
            </Typography>
          </Stack>
        )}

        {status.lastError && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
            {status.lastError}
          </Typography>
        )}
      </CardContent>

      <CardActions sx={{ px: 2, pb: 1.5, pt: 0, pl: 2.5, gap: 1, flexWrap: 'wrap' }}>
        <Tooltip title="Flash the screen to find this TV">
          <span>
            <Button
              size="small"
              startIcon={<LightbulbIcon />}
              onClick={() => onCommand('identify')}
              disabled={!online || commandPending}
            >
              Identify
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Re-fetch config and reload the app">
          <span>
            <Button
              size="small"
              startIcon={<ReplayIcon />}
              onClick={() => onCommand('reload')}
              disabled={!online || commandPending}
            >
              Reload
            </Button>
          </span>
        </Tooltip>
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" variant="contained" startIcon={<SettingsIcon />} onClick={onOpen}>
          Manage
        </Button>
      </CardActions>
    </Card>
  );
}

type UnitRowProps = Omit<UnitCardProps, 'density'>;

function UnitRow({
  unit,
  selected,
  onToggleSelect,
  onOpen,
  onCommand,
  commandPending,
}: UnitRowProps) {
  const { status } = unit;
  const online = status.online;
  const nowPlayingTitle = status.nowPlaying?.title;

  return (
    <Paper
      variant="outlined"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        p: 1.25,
        pl: 2.25,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        borderColor: selected ? 'primary.main' : 'divider',
        borderWidth: selected ? 2 : 1,
        transition: 'border-color .15s ease, box-shadow .15s ease',
        '&:hover': { boxShadow: '0 2px 10px rgba(16,24,40,0.10)' },
        '&::before': {
          content: '""',
          position: 'absolute',
          insetBlock: 0,
          left: 0,
          width: 4,
          bgcolor: online ? 'success.main' : 'grey.400',
        },
      }}
    >
      <Checkbox
        size="small"
        checked={selected}
        onChange={onToggleSelect}
        sx={{ p: 0.5 }}
        inputProps={{ 'aria-label': `Select ${unit.displayName}` }}
      />

      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Tooltip title="Open settings">
          <Link
            component="button"
            type="button"
            onClick={onOpen}
            underline="hover"
            color="inherit"
            sx={{ display: 'block', width: '100%', p: 0, textAlign: 'left', cursor: 'pointer' }}
          >
            <Typography variant="subtitle1" fontWeight={600} noWrap title={unit.displayName}>
              {unit.displayName}
            </Typography>
          </Link>
        </Tooltip>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {online ? 'Online' : 'Last seen'} · {timeAgo(status.lastSeenAt)}
          {nowPlayingTitle ? ` · Playing: ${nowPlayingTitle}` : ''}
        </Typography>
      </Box>

      <Stack direction="row" spacing={0.75} sx={{ display: { xs: 'none', lg: 'flex' }, flexShrink: 0 }}>
        {status.model && <Chip size="small" variant="outlined" label={status.model} />}
        {status.tvosVersion && (
          <Chip size="small" variant="outlined" label={`tvOS ${status.tvosVersion}`} />
        )}
      </Stack>

      <Chip
        size="small"
        label={online ? 'Online' : 'Offline'}
        color={online ? 'success' : 'default'}
        variant={online ? 'filled' : 'outlined'}
        sx={{ fontWeight: 600, flexShrink: 0 }}
      />

      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
        <Tooltip title="Flash the screen to find this TV">
          <span>
            <IconButton
              size="small"
              onClick={() => onCommand('identify')}
              disabled={!online || commandPending}
            >
              <LightbulbIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Re-fetch config and reload the app">
          <span>
            <IconButton
              size="small"
              onClick={() => onCommand('reload')}
              disabled={!online || commandPending}
            >
              <ReplayIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Button
          size="small"
          variant="contained"
          startIcon={<SettingsIcon />}
          onClick={onOpen}
          sx={{ ml: 0.5 }}
        >
          Manage
        </Button>
      </Stack>
    </Paper>
  );
}
