import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import SaveIcon from '@mui/icons-material/Save';
import { api, type JellyfinLibrary, type UnitConfig } from '../api/client';
import TabPanel from '../components/TabPanel';
import JellyfinPanel from '../components/config/JellyfinPanel';
import AppearancePanel from '../components/config/AppearancePanel';
import BrowsePanel from '../components/config/BrowsePanel';
import PlaybackPanel from '../components/config/PlaybackPanel';
import SecurityPanel from '../components/config/SecurityPanel';
import { diffUnitConfig, isEmptyObject } from '../util/diff';

export default function Defaults() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(0);
  const [draft, setDraft] = useState<UnitConfig | null>(null);
  const [libraries, setLibraries] = useState<JellyfinLibrary[]>([]);
  const [snack, setSnack] = useState<string | null>(null);

  const defaultsQuery = useQuery({
    queryKey: ['defaults'],
    queryFn: api.getDefaults,
    refetchOnWindowFocus: false,
  });

  const template = defaultsQuery.data;

  useEffect(() => {
    if (template && !draft) {
      setDraft(structuredClone(template));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const dirty = useMemo(() => {
    if (!template || !draft) return false;
    return !isEmptyObject(diffUnitConfig(template, draft));
  }, [template, draft]);

  const saveMutation = useMutation({
    mutationFn: (cfg: UnitConfig) => api.putDefaults(cfg),
    onSuccess: (updated) => {
      setDraft(structuredClone(updated));
      queryClient.setQueryData(['defaults'], updated);
      setSnack('Defaults saved. New units will use these settings.');
    },
    onError: (err) => setSnack(err instanceof Error ? err.message : 'Save failed.'),
  });

  if (defaultsQuery.isLoading || !draft) {
    if (defaultsQuery.isError) {
      return (
        <Alert severity="error">
          {defaultsQuery.error instanceof Error
            ? defaultsQuery.error.message
            : 'Could not load defaults.'}
        </Alert>
      );
    }
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: 12 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">Defaults</Typography>
        <Typography variant="body2" color="text.secondary">
          The template applied to every newly registered Apple TV. Set your shared
          Jellyfin account here once.
        </Typography>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        Editing defaults does <strong>not</strong> change TVs that are already set up —
        only the ones that register from now on. Use a unit's own settings to change an
        existing TV.
      </Alert>

      <Card>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Jellyfin" />
          <Tab label="Appearance" />
          <Tab label="Browse" />
          <Tab label="Playback" />
          <Tab label="Security" />
        </Tabs>

        <CardContent sx={{ px: { xs: 2, md: 3 } }}>
          <TabPanel value={tab} index={0}>
            <JellyfinPanel
              value={draft.jellyfin}
              onChange={(jellyfin) => setDraft({ ...draft, jellyfin })}
              onLibraries={setLibraries}
              note="This is the account every new Apple TV will use to sign in to Jellyfin."
            />
          </TabPanel>
          <TabPanel value={tab} index={1}>
            <AppearancePanel
              value={draft.appearance}
              onChange={(appearance) => setDraft({ ...draft, appearance })}
            />
          </TabPanel>
          <TabPanel value={tab} index={2}>
            <BrowsePanel
              value={draft.browse}
              onChange={(browse) => setDraft({ ...draft, browse })}
              libraries={libraries}
            />
          </TabPanel>
          <TabPanel value={tab} index={3}>
            <PlaybackPanel
              value={draft.playback}
              onChange={(playback) => setDraft({ ...draft, playback })}
            />
          </TabPanel>
          <TabPanel value={tab} index={4}>
            <SecurityPanel
              value={draft.security}
              onChange={(security) => setDraft({ ...draft, security })}
            />
          </TabPanel>
        </CardContent>
      </Card>

      <Paper
        elevation={3}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: { xs: 0, md: '248px' },
          right: 0,
          px: { xs: 2, md: 4 },
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          borderTop: 1,
          borderColor: 'divider',
          borderRadius: 0,
          zIndex: (t) => t.zIndex.appBar - 1,
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
        </Typography>
        <Button
          variant="contained"
          startIcon={
            saveMutation.isPending ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <SaveIcon />
            )
          }
          onClick={() => draft && saveMutation.mutate(draft)}
          disabled={!dirty || saveMutation.isPending}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save defaults'}
        </Button>
      </Paper>

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
