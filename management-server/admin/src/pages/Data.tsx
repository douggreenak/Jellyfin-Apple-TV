import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import WifiTetheringIcon from '@mui/icons-material/WifiTethering';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import { api, type Unit } from '../api/client';

const POLL_MS = 10_000;

interface Datum {
  name: string;
  value: number;
}

/** Count items by a derived key, return [{name,value}] sorted by count desc. */
function countBy(units: Unit[], keyOf: (u: Unit) => string): Datum[] {
  const map = new Map<string, number>();
  for (const u of units) {
    const k = keyOf(u);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export default function Data() {
  const theme = useTheme();

  const unitsQuery = useQuery({
    queryKey: ['units'],
    queryFn: api.listUnits,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const units = unitsQuery.data ?? [];

  const m = useMemo(() => {
    const adopted = units.filter((u) => u.adopted);
    const pending = units.filter((u) => !u.adopted);
    const online = adopted.filter((u) => u.status.online);
    const playing = adopted.filter((u) => u.status.online && u.status.nowPlaying?.title);
    const withErrors = units.filter((u) => u.status.lastError);

    // Cumulative fleet growth from registration timestamps (by day).
    const byDay = new Map<string, number>();
    for (const u of units) {
      const day = (u.registeredAt || '').slice(0, 10);
      if (day) byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    let running = 0;
    const growth = [...byDay.keys()]
      .sort()
      .map((day) => {
        running += byDay.get(day) ?? 0;
        return { day: day.slice(5), total: running }; // MM-DD label
      });

    return {
      total: units.length,
      adopted,
      pending,
      online,
      playing,
      withErrors,
      onlinePct: adopted.length ? Math.round((online.length / adopted.length) * 100) : 0,
      onlineSplit: [
        { name: 'Online', value: online.length },
        { name: 'Offline', value: adopted.length - online.length },
      ],
      adoptionSplit: [
        { name: 'Adopted', value: adopted.length },
        { name: 'Ready to adopt', value: pending.length },
      ],
      playbackSplit: [
        { name: 'Playing', value: playing.length },
        { name: 'Idle', value: online.length - playing.length },
        { name: 'Offline', value: adopted.length - online.length },
      ],
      lockedSplit: [
        { name: 'Locked to folder', value: adopted.filter((u) => u.config.browse.homeLibraryId).length },
        { name: 'Open', value: adopted.filter((u) => !u.config.browse.homeLibraryId).length },
      ],
      byModel: countBy(units, (u) => u.status.model || 'Unknown'),
      byTvos: countBy(units, (u) => (u.status.tvosVersion ? `tvOS ${u.status.tvosVersion}` : 'Unknown')),
      byApp: countBy(units, (u) => (u.status.appVersion ? `v${u.status.appVersion}` : 'Unknown')),
      byMode: countBy(adopted, (u) => u.config.browse.mode),
      byPoster: countBy(adopted, (u) => u.config.appearance.posterStyle),
      byGroup: countBy(units, (u) => u.groupId || 'Ungrouped'),
      growth,
    };
  }, [units]);

  if (unitsQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const c = theme.palette;
  const offline = c.mode === 'dark' ? c.grey[700] : c.grey[400];

  return (
    <Box sx={{ pb: 6 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4">Data</Typography>
        <Typography variant="body2" color="text.secondary">
          Fleet metrics across all your Apple TVs · updates live
        </Typography>
      </Box>

      {unitsQuery.isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {unitsQuery.error instanceof Error ? unitsQuery.error.message : 'Could not load data.'}
        </Alert>
      )}

      {units.length === 0 ? (
        <Alert severity="info">
          No Apple TVs registered yet — metrics will appear here once devices connect.
        </Alert>
      ) : (
        <Stack spacing={4}>
          {/* KPI row */}
          <Grid container spacing={2}>
            <StatCard
              label="Total devices"
              value={m.total}
              sub={`${m.adopted.length} adopted · ${m.pending.length} pending`}
              icon={<DevicesOtherIcon />}
              color={c.primary.main}
            />
            <StatCard
              label="Online"
              value={m.online.length}
              sub={`${m.onlinePct}% of adopted`}
              icon={<WifiTetheringIcon />}
              color={c.success.main}
            />
            <StatCard
              label="Playing now"
              value={m.playing.length}
              sub="currently streaming"
              icon={<PlayCircleIcon />}
              color={c.info.main}
            />
            <StatCard
              label="With errors"
              value={m.withErrors.length}
              sub="reported a problem"
              icon={<ErrorOutlineIcon />}
              color={m.withErrors.length ? c.error.main : c.success.main}
            />
          </Grid>

          {/* Fleet health */}
          <Section title="Fleet health">
            <ChartCard title="Online status" subtitle="Adopted devices reachable now">
              <Donut
                data={m.onlineSplit}
                colors={[c.success.main, offline]}
                theme={theme}
                center={`${m.onlinePct}%`}
                centerSub="online"
              />
            </ChartCard>
            <ChartCard title="Playback right now" subtitle="What the fleet is doing">
              <Donut
                data={m.playbackSplit}
                colors={[c.info.main, c.primary.main, offline]}
                theme={theme}
                center={m.playing.length}
                centerSub="playing"
              />
            </ChartCard>
            <ChartCard title="Adoption" subtitle="Adopted vs ready to adopt">
              <Donut
                data={m.adoptionSplit}
                colors={[c.success.main, c.warning.main]}
                theme={theme}
                center={m.total}
                centerSub="devices"
              />
            </ChartCard>
            <ChartCard title="Fleet growth" subtitle="Cumulative registrations over time" span={12} height={300}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={m.growth} margin={{ top: 8, right: 24, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c.primary.main} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={c.primary.main} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={c.divider} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" stroke={c.text.secondary} fontSize={12} tickLine={false} axisLine={{ stroke: c.divider }} />
                  <YAxis allowDecimals={false} stroke={c.text.secondary} fontSize={12} tickLine={false} axisLine={false} width={32} />
                  <Tooltip {...tooltipProps(theme)} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Devices"
                    stroke={c.primary.main}
                    fill="url(#growthFill)"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: c.primary.main, strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </Section>

          {/* Software */}
          <Section title="Software">
            <ChartCard title="Devices by model" subtitle="Hardware spread">
              <Bars data={m.byModel} color={c.primary.main} theme={theme} />
            </ChartCard>
            <ChartCard title="tvOS versions" subtitle="Keep the fleet up to date">
              <Bars data={m.byTvos} color={c.secondary.main} theme={theme} />
            </ChartCard>
            <ChartCard title="App versions" subtitle="Client app rollout">
              <Bars data={m.byApp} color={c.info.main} theme={theme} />
            </ChartCard>
          </Section>

          {/* Configuration */}
          <Section title="Configuration">
            <ChartCard title="Locked to a folder" subtitle="Kiosk-style restriction">
              <Donut
                data={m.lockedSplit}
                colors={[c.warning.main, offline]}
                theme={theme}
                center={m.lockedSplit[0].value}
                centerSub="locked"
              />
            </ChartCard>
            <ChartCard title="Browse mode" subtitle="Adopted devices">
              <Bars data={m.byMode} color={c.success.main} theme={theme} />
            </ChartCard>
            <ChartCard title="Poster style" subtitle="Card layout in the app">
              <Bars data={m.byPoster} color={c.primary.main} theme={theme} />
            </ChartCard>
            <ChartCard title="Devices by group" subtitle="Rooms / campuses">
              <Bars data={m.byGroup} color={c.secondary.main} theme={theme} />
            </ChartCard>
          </Section>
        </Stack>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function tooltipProps(theme: Theme) {
  return {
    contentStyle: {
      backgroundColor: theme.palette.background.paper,
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: 8,
      boxShadow: theme.shadows[3],
    },
    itemStyle: { color: theme.palette.text.primary },
    labelStyle: { color: theme.palette.text.secondary },
    cursor: { fill: theme.palette.action.hover },
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ letterSpacing: 1, fontWeight: 700, display: 'block', mb: 1 }}
      >
        {title}
      </Typography>
      <Grid container spacing={2.5}>
        {children}
      </Grid>
    </Box>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: ReactNode;
  color: string;
}) {
  return (
    <Grid item xs={6} md={3}>
      <Card sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', insetBlock: 0, left: 0, width: 4, bgcolor: color }} />
        <CardContent sx={{ pl: 2.5 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="overline" color="text.secondary">
              {label}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                width: 32,
                height: 32,
                borderRadius: '50%',
                alignItems: 'center',
                justifyContent: 'center',
                color,
                bgcolor: (t) => alpha(color, t.palette.mode === 'dark' ? 0.22 : 0.12),
              }}
            >
              {icon}
            </Box>
          </Stack>
          <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.1, mt: 0.5 }}>
            {value}
          </Typography>
          {sub && (
            <Typography variant="caption" color="text.secondary">
              {sub}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  span = 4,
  height = 240,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  span?: 4 | 8 | 12;
  height?: number;
}) {
  return (
    <Grid item xs={12} sm={span === 12 ? 12 : 6} md={span}>
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          height: '100%',
          transition: 'box-shadow .15s ease, border-color .15s ease',
          '&:hover': { boxShadow: 3, borderColor: 'text.disabled' },
        }}
      >
        <Typography variant="subtitle1" fontWeight={600}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
        <Box sx={{ height, mt: 1.5 }}>{children}</Box>
      </Paper>
    </Grid>
  );
}

function Donut({
  data,
  colors,
  theme,
  center,
  centerSub,
}: {
  data: Datum[];
  colors: string[];
  theme: Theme;
  center?: ReactNode;
  centerSub?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <NoData />;
  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="46%"
            innerRadius={52}
            outerRadius={84}
            paddingAngle={data.filter((d) => d.value > 0).length > 1 ? 2 : 0}
            stroke={theme.palette.background.paper}
            strokeWidth={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip
            {...tooltipProps(theme)}
            formatter={((v: number, n: string) => [
              `${v} (${Math.round((v / total) * 100)}%)`,
              n,
            ]) as never}
          />
          <Legend
            verticalAlign="bottom"
            height={26}
            iconType="circle"
            iconSize={9}
            formatter={(v) => (
              <span style={{ color: theme.palette.text.secondary, fontSize: 12 }}>{v}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
      {center !== undefined && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 38, // leave room for the legend
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Typography variant="h5" fontWeight={700} lineHeight={1}>
            {center}
          </Typography>
          {centerSub && (
            <Typography variant="caption" color="text.secondary">
              {centerSub}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

function Bars({ data, color, theme }: { data: Datum[]; color: string; theme: Theme }) {
  if (data.length === 0) return <NoData />;
  const maxValue = Math.max(...data.map((d) => d.value));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={theme.palette.divider} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          domain={[0, Math.max(1, maxValue)]}
          stroke={theme.palette.text.secondary}
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={100}
          stroke={theme.palette.text.secondary}
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip {...tooltipProps(theme)} />
        <Bar dataKey="value" name="Devices" fill={color} radius={[0, 4, 4, 0]} maxBarSize={26}>
          <LabelList
            dataKey="value"
            position="right"
            style={{ fill: theme.palette.text.secondary, fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function NoData() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <Typography variant="body2" color="text.secondary">
        No data yet
      </Typography>
    </Box>
  );
}
