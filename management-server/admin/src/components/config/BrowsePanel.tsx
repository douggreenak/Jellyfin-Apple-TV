import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import OutlinedInput from '@mui/material/OutlinedInput';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LockIcon from '@mui/icons-material/Lock';
import {
  api,
  type BrowseConfig,
  type BrowseMode,
  type JellyfinConfig,
  type JellyfinLibrary,
} from '../../api/client';
import LibraryLockPicker from './LibraryLockPicker';

interface BrowsePanelProps {
  value: BrowseConfig;
  onChange: (next: BrowseConfig) => void;
  /** Libraries discovered via "Test connection" on the Jellyfin tab. */
  libraries: JellyfinLibrary[];
  /** Jellyfin credentials, needed to browse the tree for the lock picker. */
  jellyfin: JellyfinConfig;
}

const MODE_HELP: Record<BrowseMode, string> = {
  full: 'Show everything the Jellyfin account can see.',
  curated: 'Show only the allowed libraries you choose below.',
  kiosk: 'Lock to a single home library — simplest for little ones.',
};

export default function BrowsePanel({
  value,
  onChange,
  libraries,
  jellyfin,
}: BrowsePanelProps) {
  const set = (patch: Partial<BrowseConfig>) => onChange({ ...value, ...patch });
  const haveLibs = libraries.length > 0;

  const libName = (id: string) => libraries.find((l) => l.id === id)?.name ?? id;

  // ---- Lock to a library / sub-folder ----
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const credsReady = !!jellyfin.serverUrl.trim() && !!jellyfin.username.trim();
  const lockedId = value.homeLibraryId;
  const lockedNameFromLibs = lockedId
    ? libraries.find((l) => l.id === lockedId)?.name
    : undefined;

  // If locked to a sub-folder (not a top-level library), resolve its name to show.
  useEffect(() => {
    if (!lockedId || lockedNameFromLibs || !credsReady) {
      setResolvedName(null);
      return;
    }
    let cancelled = false;
    api
      .jellyfinResolve(jellyfin, lockedId)
      .then((r) => {
        if (!cancelled) setResolvedName(r.ok ? (r.item?.name ?? null) : null);
      })
      .catch(() => {
        if (!cancelled) setResolvedName(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedId, lockedNameFromLibs, credsReady, jellyfin.serverUrl, jellyfin.username, jellyfin.password]);

  const lockedName = lockedNameFromLibs ?? resolvedName ?? null;

  const handleHiddenChange = (event: SelectChangeEvent<string[]>) => {
    const v = event.target.value;
    set({ hiddenLibraryIds: typeof v === 'string' ? v.split(',') : v });
  };

  const handleAllowedChange = (event: SelectChangeEvent<string[]>) => {
    const v = event.target.value;
    set({ allowedLibraryIds: typeof v === 'string' ? v.split(',') : v });
  };

  return (
    <Stack spacing={2.5} maxWidth={560}>
      <Typography variant="subtitle1">Browsing</Typography>

      <TextField
        select
        label="Browse mode"
        fullWidth
        value={value.mode}
        onChange={(e) => set({ mode: e.target.value as BrowseMode })}
        helperText={MODE_HELP[value.mode]}
      >
        <MenuItem value="full">Full — everything</MenuItem>
        <MenuItem value="curated">Curated — chosen libraries</MenuItem>
        <MenuItem value="kiosk">Kiosk — one library only</MenuItem>
      </TextField>

      {!haveLibs && (
        <Alert severity="info">
          Run <strong>Test connection</strong> on the Jellyfin tab to load the list of
          libraries. You can still type IDs manually below.
        </Alert>
      )}

      {/* Lock to a library or sub-folder (e.g. Kids, Pre-K). */}
      <Box
        sx={{
          p: 2,
          borderRadius: 2,
          border: '1px solid',
          borderColor: lockedId ? 'primary.main' : 'divider',
          bgcolor: 'action.hover',
        }}
      >
        <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <LockIcon fontSize="small" /> Lock to a library or folder
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Pin this TV to one library or sub-folder (e.g. “Kids”, “Pre-K”). It opens
          straight there and can’t browse anywhere else.
        </Typography>

        {lockedId ? (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={{ mt: 1.5 }}
          >
            <Chip
              color="primary"
              icon={<LockIcon />}
              label={`Locked to: ${lockedName ?? `folder ${lockedId.slice(0, 8)}…`}`}
            />
            <Button size="small" onClick={() => setPickerOpen(true)} disabled={!credsReady}>
              Change
            </Button>
            <Button size="small" color="error" onClick={() => set({ homeLibraryId: null })}>
              Remove lock
            </Button>
          </Stack>
        ) : (
          <Button
            variant="outlined"
            startIcon={<LockIcon />}
            onClick={() => setPickerOpen(true)}
            disabled={!credsReady}
            sx={{ mt: 1.5 }}
          >
            Lock to a library or folder…
          </Button>
        )}

        {!credsReady && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Add the Jellyfin server and username on the Jellyfin tab first.
          </Typography>
        )}
      </Box>

      <LibraryLockPicker
        open={pickerOpen}
        creds={jellyfin}
        onClose={() => setPickerOpen(false)}
        onSelect={(item) => set({ homeLibraryId: item.id })}
      />

      {/* Allowed libraries — only meaningful in curated mode. */}
      {value.mode === 'curated' &&
        (haveLibs ? (
          <FormControl fullWidth>
            <InputLabel id="allowed-label">Allowed libraries</InputLabel>
            <Select
              labelId="allowed-label"
              multiple
              value={value.allowedLibraryIds}
              onChange={handleAllowedChange}
              input={<OutlinedInput label="Allowed libraries" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.map((id) => (
                    <Chip key={id} label={libName(id)} size="small" />
                  ))}
                </Box>
              )}
            >
              {libraries.map((lib) => (
                <MenuItem key={lib.id} value={lib.id}>
                  <Checkbox checked={value.allowedLibraryIds.includes(lib.id)} />
                  <ListItemText primary={lib.name} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : (
          <TextField
            label="Allowed library IDs"
            fullWidth
            value={value.allowedLibraryIds.join(', ')}
            onChange={(e) =>
              set({
                allowedLibraryIds: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            helperText="Comma-separated library IDs."
          />
        ))}

      {/* Hidden libraries — always available. */}
      {haveLibs ? (
        <FormControl fullWidth>
          <InputLabel id="hidden-label">Hidden libraries</InputLabel>
          <Select
            labelId="hidden-label"
            multiple
            value={value.hiddenLibraryIds}
            onChange={handleHiddenChange}
            input={<OutlinedInput label="Hidden libraries" />}
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((id) => (
                  <Chip key={id} label={libName(id)} size="small" />
                ))}
              </Box>
            )}
          >
            {libraries.map((lib) => (
              <MenuItem key={lib.id} value={lib.id}>
                <Checkbox checked={value.hiddenLibraryIds.includes(lib.id)} />
                <ListItemText primary={lib.name} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ) : (
        <TextField
          label="Hidden library IDs"
          fullWidth
          value={value.hiddenLibraryIds.join(', ')}
          onChange={(e) =>
            set({
              hiddenLibraryIds: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          helperText="Comma-separated library IDs to hide."
        />
      )}
    </Stack>
  );
}
