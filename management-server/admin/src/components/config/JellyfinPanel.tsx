import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { api, type JellyfinConfig, type JellyfinLibrary } from '../../api/client';

interface JellyfinPanelProps {
  value: JellyfinConfig;
  onChange: (next: JellyfinConfig) => void;
  /** Surface discovered libraries to the parent so other tabs can use them. */
  onLibraries?: (libraries: JellyfinLibrary[]) => void;
  note?: string;
  /** When provided (Defaults only), shows a "push this server to all TVs" action. */
  onPushToAll?: () => void;
  /** True while the push request is in flight. */
  pushing?: boolean;
}

export default function JellyfinPanel({
  value,
  onChange,
  onLibraries,
  note,
  onPushToAll,
  pushing = false,
}: JellyfinPanelProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    serverName?: string;
    version?: string;
    libraries?: JellyfinLibrary[];
  } | null>(null);

  const set = (patch: Partial<JellyfinConfig>) => onChange({ ...value, ...patch });

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await api.testJellyfin(value);
      if (res.ok) {
        setResult({
          ok: true,
          message: 'Connected successfully.',
          serverName: res.serverName,
          version: res.version,
          libraries: res.libraries ?? [],
        });
        onLibraries?.(res.libraries ?? []);
      } else {
        setResult({ ok: false, message: res.error ?? 'Connection failed.' });
      }
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Connection failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Stack spacing={2.5} maxWidth={560}>
      <Box>
        <Typography variant="subtitle1">Jellyfin service account</Typography>
        <Typography variant="body2" color="text.secondary">
          {note ??
            'The shared media account these Apple TVs use to sign in to Jellyfin.'}
        </Typography>
      </Box>

      <TextField
        label="Server URL"
        placeholder="https://jelly.example.com"
        fullWidth
        value={value.serverUrl}
        onChange={(e) => set({ serverUrl: e.target.value })}
        helperText="Base URL, no trailing slash."
      />
      <TextField
        label="Username"
        fullWidth
        autoComplete="off"
        value={value.username}
        onChange={(e) => set({ username: e.target.value })}
      />
      <TextField
        label="Password"
        type="password"
        fullWidth
        autoComplete="new-password"
        value={value.password}
        onChange={(e) => set({ password: e.target.value })}
      />

      <Box>
        <Button
          variant="outlined"
          startIcon={
            testing ? <CircularProgress size={16} color="inherit" /> : <CloudSyncIcon />
          }
          onClick={handleTest}
          disabled={testing || !value.serverUrl || !value.username}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Testing is optional — your changes save automatically a moment after you stop typing.
        </Typography>
      </Box>

      {result && (
        <Alert
          severity={result.ok ? 'success' : 'error'}
          icon={result.ok ? <CheckCircleIcon /> : undefined}
        >
          {result.ok ? (
            <Box>
              <Typography variant="body2" fontWeight={600}>
                {result.message}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {result.serverName}
                {result.version ? ` · v${result.version}` : ''}
              </Typography>
              {result.libraries && result.libraries.length > 0 && (
                <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {result.libraries.map((lib) => (
                    <Chip key={lib.id} label={lib.name} size="small" />
                  ))}
                </Box>
              )}
            </Box>
          ) : (
            result.message
          )}
        </Alert>
      )}

      {onPushToAll && (
        <Box>
          <Divider sx={{ mb: 2 }} />
          <Button
            variant="outlined"
            color="warning"
            startIcon={
              pushing ? <CircularProgress size={16} color="inherit" /> : <CloudUploadIcon />
            }
            onClick={onPushToAll}
            disabled={pushing || !value.serverUrl.trim()}
          >
            {pushing ? 'Pushing…' : 'Push this server to all TVs'}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Applies this Jellyfin server to every existing Apple TV right now, overwriting
            each TV’s current server. They switch over on their next check-in. (Defaults
            otherwise only affect TVs that register from now on.)
          </Typography>
        </Box>
      )}
    </Stack>
  );
}
