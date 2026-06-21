import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

interface StatusDotProps {
  online: boolean;
  size?: number;
  label?: string;
}

/** Green (online) / grey (offline) status indicator with a soft glow when live. */
export default function StatusDot({ online, size = 10, label }: StatusDotProps) {
  const dot = (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        bgcolor: online ? 'success.main' : 'grey.400',
        boxShadow: online ? '0 0 0 3px rgba(52,199,89,0.20)' : 'none',
      }}
    />
  );
  if (label) {
    return <Tooltip title={label}>{dot}</Tooltip>;
  }
  return dot;
}
