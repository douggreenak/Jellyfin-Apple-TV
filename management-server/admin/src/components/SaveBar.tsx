import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

interface SaveBarProps {
  /** A change is pending or in flight (debounce + request). */
  saving: boolean;
  /** The last autosave attempt failed. */
  error: boolean;
  /** Manually re-trigger a save (only used in the error state). */
  onRetry?: () => void;
}

/**
 * Autosave status bar. There is no Save button — edits persist automatically a
 * moment after you stop typing. This just reflects state: saving / saved / failed
 * (with a Retry as a safety net if a save errors).
 */
export default function SaveBar({ saving, error, onRetry }: SaveBarProps) {
  const state: 'saving' | 'error' | 'saved' = saving
    ? 'saving'
    : error
      ? 'error'
      : 'saved';

  const tint = (color: string, amount = 0.1) => (t: import('@mui/material').Theme) =>
    alpha(color === 'error' ? t.palette.error.main : t.palette.success.main, amount);

  return (
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
        gap: 1.5,
        borderRadius: 0,
        borderTop: '1px solid',
        borderColor: state === 'error' ? 'error.main' : 'divider',
        bgcolor: (t) =>
          state === 'error'
            ? tint('error', t.palette.mode === 'dark' ? 0.16 : 0.1)(t)
            : t.palette.background.paper,
        transition: 'background-color 150ms ease, border-color 150ms ease',
        zIndex: (t) => t.zIndex.appBar - 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, minWidth: 0 }}>
        {state === 'saving' && <CircularProgress size={16} />}
        {state === 'saved' && <CheckCircleIcon fontSize="small" color="success" />}
        {state === 'error' && <ErrorOutlineIcon fontSize="small" color="error" />}
        <Typography
          variant="body2"
          sx={{ fontWeight: state === 'error' ? 700 : 400 }}
          color={
            state === 'error'
              ? 'error.main'
              : state === 'saving'
                ? 'text.primary'
                : 'text.secondary'
          }
          noWrap
        >
          {state === 'saving'
            ? 'Saving…'
            : state === 'error'
              ? "Couldn't save your changes"
              : 'All changes saved automatically'}
        </Typography>
      </Box>
      {state === 'error' && onRetry && (
        <Button variant="contained" color="error" size="small" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Paper>
  );
}
