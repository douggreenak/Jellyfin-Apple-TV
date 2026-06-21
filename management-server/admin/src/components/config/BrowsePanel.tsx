import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
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
import type { BrowseConfig, BrowseMode, JellyfinLibrary } from '../../api/client';

interface BrowsePanelProps {
  value: BrowseConfig;
  onChange: (next: BrowseConfig) => void;
  /** Libraries discovered via "Test connection" on the Jellyfin tab. */
  libraries: JellyfinLibrary[];
}

const MODE_HELP: Record<BrowseMode, string> = {
  full: 'Show everything the Jellyfin account can see.',
  curated: 'Show only the allowed libraries you choose below.',
  kiosk: 'Lock to a single home library — simplest for little ones.',
};

export default function BrowsePanel({ value, onChange, libraries }: BrowsePanelProps) {
  const set = (patch: Partial<BrowseConfig>) => onChange({ ...value, ...patch });
  const haveLibs = libraries.length > 0;

  const libName = (id: string) => libraries.find((l) => l.id === id)?.name ?? id;

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

      {/* Home library — used as the kiosk target and the default landing library. */}
      {haveLibs ? (
        <TextField
          select
          label="Home library"
          fullWidth
          value={value.homeLibraryId ?? ''}
          onChange={(e) => set({ homeLibraryId: e.target.value || null })}
          helperText={
            value.mode === 'kiosk'
              ? 'Kiosk mode locks to this library.'
              : 'The library the app opens to.'
          }
        >
          <MenuItem value="">
            <em>None (use server default)</em>
          </MenuItem>
          {libraries.map((lib) => (
            <MenuItem key={lib.id} value={lib.id}>
              {lib.name}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <TextField
          label="Home library ID"
          fullWidth
          value={value.homeLibraryId ?? ''}
          onChange={(e) => set({ homeLibraryId: e.target.value || null })}
          helperText="Library the app opens to (or kiosk target)."
        />
      )}

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
