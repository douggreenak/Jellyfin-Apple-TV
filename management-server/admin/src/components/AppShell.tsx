import { useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import InsightsIcon from '@mui/icons-material/Insights';
import ScheduleIcon from '@mui/icons-material/Schedule';
import TuneIcon from '@mui/icons-material/Tune';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import LockResetIcon from '@mui/icons-material/LockReset';
import LiveTvIcon from '@mui/icons-material/LiveTv';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import CheckIcon from '@mui/icons-material/Check';
import { useAuth } from '../auth';
import { useColorMode } from '../colorMode';
import { api } from '../api/client';
import ChangePasswordDialog from './ChangePasswordDialog';

const DRAWER_WIDTH = 248;

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Units', to: '/', icon: <DevicesOtherIcon /> },
  { label: 'Data', to: '/data', icon: <InsightsIcon /> },
  { label: 'Schedule', to: '/schedule', icon: <ScheduleIcon /> },
  { label: 'Defaults', to: '/defaults', icon: <TuneIcon /> },
];

// This dashboard's own theme color — a per-browser admin preference (see
// colorMode.tsx) with no relationship to the TVs' own fixed accent color.
// Same muted "jewel tone" family as elsewhere: distinct without being loud.
const THEME_PRESETS: { name: string; hex: string }[] = [
  { name: 'Google blue (default)', hex: '' }, // '' = fall back to GOOGLE_BLUE in theme.ts
  { name: 'Indigo', hex: '#5E5CE6' },
  { name: 'Teal', hex: '#2E8F86' },
  { name: 'Green', hex: '#3F8F5A' },
  { name: 'Amber', hex: '#B98A3D' },
  { name: 'Terracotta', hex: '#C97A45' },
  { name: 'Rose', hex: '#B84C74' },
  { name: 'Plum', hex: '#7B5AA6' },
];

function isActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/' || pathname.startsWith('/units');
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const location = useLocation();
  const navigate = useNavigate();
  const { username, logout } = useAuth();
  const { mode, toggle, accentHex, setAccent } = useColorMode();
  const [accentMenuAnchor, setAccentMenuAnchor] = useState<null | HTMLElement>(null);
  // The web app's own version (management-server + admin ship together,
  // bumped together by scripts/build-ipa.sh) — a quiet footer line, not
  // something anyone needs to act on day-to-day.
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: Infinity });

  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);

  const handleLogout = () => {
    setMenuAnchor(null);
    logout();
    navigate('/login', { replace: true });
  };

  const openChangePassword = () => {
    setMenuAnchor(null);
    setPwOpen(true);
  };

  const drawerContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar />
      <Box sx={{ px: 2, py: 1 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ pl: 1, letterSpacing: 1 }}
        >
          Manage
        </Typography>
      </Box>
      <List sx={{ px: 1.5, flexGrow: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(location.pathname, item.to);
          return (
            <ListItemButton
              key={item.to}
              component={RouterLink}
              to={item.to}
              selected={active}
              onClick={() => setMobileOpen(false)}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': { bgcolor: 'primary.dark' },
                  '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ fontWeight: 600 }}
              />
            </ListItemButton>
          );
        })}
      </List>
      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Signed in as
        </Typography>
        <Typography variant="body2" fontWeight={600} noWrap>
          {username ?? '—'}
        </Typography>
        {healthQuery.data?.version && (
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.75 }}>
            v{healthQuery.data.version}
          </Typography>
        )}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        elevation={mode === 'dark' ? 0 : 4}
        sx={{
          zIndex: (t) => t.zIndex.drawer + 1,
          bgcolor: (t) =>
            t.palette.mode === 'dark'
              ? t.palette.background.paper
              : t.palette.primary.main,
          color: (t) =>
            t.palette.mode === 'dark'
              ? t.palette.text.primary
              : t.palette.primary.contrastText,
          borderBottom: (t) =>
            t.palette.mode === 'dark' ? `1px solid ${t.palette.divider}` : 'none',
        }}
      >
        <Toolbar>
          {!isDesktop && (
            <IconButton
              color="inherit"
              edge="start"
              onClick={() => setMobileOpen((v) => !v)}
              sx={{ mr: 1 }}
              aria-label="Open navigation"
            >
              <MenuIcon />
            </IconButton>
          )}
          <LiveTvIcon sx={{ mr: 1.5 }} />
          <Typography variant="h6" noWrap sx={{ fontWeight: 700, flexGrow: 1 }}>
            Jellyfin — Fleet
          </Typography>
          <Tooltip title="Dashboard theme color">
            <IconButton
              color="inherit"
              onClick={(e) => setAccentMenuAnchor(e.currentTarget)}
              size="small"
              sx={{ mr: 0.5 }}
              aria-label="Dashboard theme color"
            >
              <PaletteOutlinedIcon />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={accentMenuAnchor}
            open={!!accentMenuAnchor}
            onClose={() => setAccentMenuAnchor(null)}
          >
            <Box sx={{ px: 2, py: 1, maxWidth: 220 }}>
              <Typography variant="caption" color="text.secondary">
                This dashboard's color — doesn't affect the TVs
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {THEME_PRESETS.map((preset) => {
                  const selected = (accentHex ?? '') === preset.hex;
                  return (
                    <Tooltip key={preset.name} title={preset.name}>
                      <Box
                        role="button"
                        aria-label={`Use ${preset.name}`}
                        onClick={() => {
                          setAccent(preset.hex || null);
                          setAccentMenuAnchor(null);
                        }}
                        sx={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          bgcolor: preset.hex || '#1A73E8',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '2px solid',
                          borderColor: selected ? 'text.primary' : 'transparent',
                          outline: '1px solid',
                          outlineColor: 'divider',
                          outlineOffset: '1px',
                          transition: 'transform .1s ease',
                          '&:hover': { transform: 'scale(1.1)' },
                        }}
                      >
                        {selected && <CheckIcon sx={{ fontSize: 16, color: '#fff' }} />}
                      </Box>
                    </Tooltip>
                  );
                })}
              </Box>
            </Box>
          </Menu>
          <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton
              color="inherit"
              onClick={toggle}
              size="small"
              sx={{ mr: 0.5 }}
              aria-label="Toggle dark mode"
            >
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Account">
            <IconButton
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              size="small"
              sx={{ ml: 1 }}
              aria-label="Account menu"
            >
              <Avatar
                sx={{
                  width: 34,
                  height: 34,
                  bgcolor: 'rgba(255,255,255,0.2)',
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                {(username ?? '?').charAt(0).toUpperCase()}
              </Avatar>
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={menuAnchor}
            open={!!menuAnchor}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem onClick={openChangePassword}>
              <ListItemIcon>
                <LockResetIcon fontSize="small" />
              </ListItemIcon>
              Change password
            </MenuItem>
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Desktop permanent drawer */}
      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              borderRight: '1px solid',
              borderColor: 'divider',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          minWidth: 0,
        }}
      >
        <Toolbar />
        <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto' }}>{children}</Box>
      </Box>

      <ChangePasswordDialog
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        onSuccess={() => {
          setPwOpen(false);
          setSnack('Password changed.');
        }}
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
