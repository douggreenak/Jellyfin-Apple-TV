import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

interface TabPanelProps {
  value: number;
  index: number;
  children: ReactNode;
}

export default function TabPanel({ value, index, children }: TabPanelProps) {
  if (value !== index) return null;
  return (
    <Box role="tabpanel" sx={{ pt: 3 }}>
      {children}
    </Box>
  );
}
