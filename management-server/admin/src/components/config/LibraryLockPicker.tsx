import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import FolderIcon from '@mui/icons-material/FolderOutlined';
import MovieIcon from '@mui/icons-material/MovieOutlined';
import LockIcon from '@mui/icons-material/Lock';
import { api, type JellyfinBrowseItem, type JellyfinConfig } from '../../api/client';

interface Crumb {
  id: string | null; // null = top-level libraries
  name: string;
}

interface LibraryLockPickerProps {
  open: boolean;
  creds: JellyfinConfig;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

/**
 * Drill the Jellyfin tree and lock a TV to any library or sub-folder. Click a
 * folder to open it; use "Lock to this folder" (or a row's lock button) to pick.
 */
export default function LibraryLockPicker({
  open,
  creds,
  onClose,
  onSelect,
}: LibraryLockPickerProps) {
  const [path, setPath] = useState<Crumb[]>([{ id: null, name: 'Libraries' }]);
  const [items, setItems] = useState<JellyfinBrowseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = path[path.length - 1];
  const canLockCurrent = current.id !== null; // can't lock to the library root list

  // Reset to the top each time the dialog opens.
  useEffect(() => {
    if (open) setPath([{ id: null, name: 'Libraries' }]);
  }, [open]);

  // Load children whenever the current folder changes (while open).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .jellyfinChildren(creds, current.id ?? undefined)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setItems(res.items ?? []);
        else {
          setItems([]);
          setError(res.error ?? 'Could not load this folder.');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setItems([]);
        setError(err instanceof Error ? err.message : 'Could not load this folder.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current.id]);

  const openFolder = (item: JellyfinBrowseItem) =>
    setPath((p) => [...p, { id: item.id, name: item.name }]);

  const goTo = (index: number) => setPath((p) => p.slice(0, index + 1));

  const lock = (item: { id: string; name: string }) => {
    onSelect(item);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Lock to a library or folder</DialogTitle>
      <DialogContent dividers>
        <Breadcrumbs sx={{ mb: 1.5 }}>
          {path.map((crumb, i) =>
            i === path.length - 1 ? (
              <Typography key={i} color="text.primary" fontWeight={600}>
                {crumb.name}
              </Typography>
            ) : (
              <Link
                key={i}
                component="button"
                type="button"
                underline="hover"
                color="inherit"
                onClick={() => goTo(i)}
              >
                {crumb.name}
              </Link>
            ),
          )}
        </Breadcrumbs>

        {error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
            <CircularProgress />
          </Box>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            {error ? '' : 'This folder is empty.'}
          </Typography>
        ) : (
          <List dense sx={{ maxHeight: 360, overflow: 'auto' }}>
            {items.map((item) => {
              const folder = item.isFolder;
              return (
                <ListItem
                  key={item.id}
                  disablePadding
                  secondaryAction={
                    folder ? (
                      <Button
                        size="small"
                        startIcon={<LockIcon fontSize="small" />}
                        onClick={() => lock({ id: item.id, name: item.name })}
                      >
                        Lock here
                      </Button>
                    ) : undefined
                  }
                >
                  <ListItemButton disabled={!folder} onClick={() => folder && openFolder(item)}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      {folder ? <FolderIcon /> : <MovieIcon />}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.name}
                      secondary={
                        folder && item.childCount != null
                          ? `${item.childCount} item${item.childCount === 1 ? '' : 's'}`
                          : undefined
                      }
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          startIcon={<LockIcon />}
          disabled={!canLockCurrent}
          onClick={() => canLockCurrent && lock({ id: current.id as string, name: current.name })}
        >
          Lock to “{current.name}”
        </Button>
      </DialogActions>
    </Dialog>
  );
}
