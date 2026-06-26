// Typed fetch wrapper for the Jellyfin management-server admin API.
// All admin endpoints require a Bearer JWT (except login). On any 401 we clear
// the stored token and notify listeners so the app can redirect to /login.

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';
const TOKEN_KEY = 'kc.admin.jwt';

// ---------------------------------------------------------------------------
// Types — mirror the backend contract / UNIT_CONFIG_SCHEMA.json exactly.
// ---------------------------------------------------------------------------

export type BrowseMode = 'full' | 'curated' | 'kiosk';
export type ThemeMode = 'system' | 'light' | 'dark';
export type PosterStyle = 'poster' | 'thumb' | 'wide';
export type CommandType = 'reload' | 'identify' | 'restart';

// Fleet-wide bulk operations applied to many units at once.
// `migrate` re-points devices at a new management server URL (passed via `data`).
export type BulkAction =
  | 'adopt'
  | 'unadopt'
  | 'reload'
  | 'identify'
  | 'restart'
  | 'delete'
  | 'migrate';

export interface BulkActionResult {
  ok: true;
  affected: number;
}

export interface JellyfinConfig {
  serverUrl: string;
  username: string;
  password: string;
}

export interface BrowseConfig {
  mode: BrowseMode;
  homeLibraryId: string | null;
  allowedLibraryIds: string[];
  hiddenLibraryIds: string[];
}

export interface AppearanceConfig {
  appTitle: string;
  theme: ThemeMode;
  accentColorHex: string; // #RRGGBB
  showClock: boolean;
  showItemTitles: boolean;
  posterStyle: PosterStyle;
}

export interface PlaybackConfig {
  autoplayNext: boolean;
  maxBitrateMbps: number;
  preferDirectPlay: boolean;
}

export interface SecurityConfig {
  settingsPinEnabled: boolean;
  settingsPin: string | null; // 4 digits
}

export interface UnitConfig {
  unitId: string;
  displayName: string;
  groupId: string | null;
  jellyfin: JellyfinConfig;
  browse: BrowseConfig;
  appearance: AppearanceConfig;
  playback: PlaybackConfig;
  security: SecurityConfig;
  configVersion: number;
  updatedAt: string; // ISO8601
}

export interface NowPlaying {
  title?: string;
  itemId?: string;
  positionTicks?: number;
}

export interface UnitStatus {
  online: boolean;
  lastSeenAt: string | null;
  appVersion?: string | null;
  tvosVersion?: string | null;
  model?: string | null;
  ipAddress?: string | null;
  nowPlaying?: NowPlaying | null;
  lastError?: string | null;
}

export interface PendingCommand {
  id: string;
  type: CommandType;
  issuedAt?: string;
}

export interface Unit {
  unitId: string;
  displayName: string;
  groupId: string | null;
  config: UnitConfig;
  status: UnitStatus;
  pendingCommand: PendingCommand | null;
  registeredAt: string;
  adopted: boolean;
}

export interface JellyfinLibrary {
  id: string;
  name: string;
}

/** A node in the Jellyfin tree (library or sub-folder) for the lock picker. */
export interface JellyfinBrowseItem {
  id: string;
  name: string;
  isFolder: boolean;
  childCount?: number;
}

export interface JellyfinChildrenResult {
  ok: boolean;
  items?: JellyfinBrowseItem[];
  error?: string;
}

export interface JellyfinResolveResult {
  ok: boolean;
  item?: JellyfinBrowseItem;
  error?: string;
}

export interface JellyfinTestResult {
  ok: boolean;
  serverName?: string;
  version?: string;
  libraries?: JellyfinLibrary[];
  error?: string;
}

export interface ServerExportUnit {
  unitId: string;
  displayName: string;
  groupId: string | null;
  config: UnitConfig;
  configVersion: number;
  registeredAt: string;
  adopted: boolean;
  deviceToken: string | null;
}

export interface ServerExport {
  version: number;
  exportedAt: string;
  defaults: UnitConfig;
  units: ServerExportUnit[];
}

export interface ImportResult {
  ok: true;
  imported: number;
  removed: number;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
}

export interface MeResult {
  username: string;
}

// Deep-partial helper for PATCH /config (deep-partial UnitConfig).
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Array<infer U>
    ? Array<U>
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

// ---------------------------------------------------------------------------
// Token storage + 401 handling
// ---------------------------------------------------------------------------

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach Authorization header (default true)
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, 'Network error — is the management server running?');
  }

  if (res.status === 401) {
    // Token invalid / expired. Clear it and notify the app to redirect.
    setToken(null);
    unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : typeof payload === 'string' && payload
          ? payload
          : `Request failed (${res.status})`) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export const api = {
  // Auth
  async login(username: string, password: string): Promise<LoginResult> {
    const result = await request<LoginResult>('/admin/auth/login', {
      method: 'POST',
      body: { username, password },
      auth: false,
    });
    setToken(result.token);
    return result;
  },

  logout(): void {
    setToken(null);
  },

  me(): Promise<MeResult> {
    return request<MeResult>('/admin/auth/me');
  },

  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>('/admin/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
  },

  // Units
  listUnits(): Promise<Unit[]> {
    return request<Unit[]>('/admin/units');
  },

  getUnit(id: string): Promise<Unit> {
    return request<Unit>(`/admin/units/${encodeURIComponent(id)}`);
  },

  patchConfig(id: string, partial: DeepPartial<UnitConfig>): Promise<Unit> {
    return request<Unit>(`/admin/units/${encodeURIComponent(id)}/config`, {
      method: 'PATCH',
      body: partial,
    });
  },

  sendCommand(id: string, type: CommandType): Promise<Unit> {
    return request<Unit>(`/admin/units/${encodeURIComponent(id)}/command`, {
      method: 'POST',
      body: { type },
    });
  },

  renameUnit(id: string, displayName: string): Promise<Unit> {
    return request<Unit>(`/admin/units/${encodeURIComponent(id)}/rename`, {
      method: 'POST',
      body: { displayName },
    });
  },

  // Adoption
  adoptUnit(id: string): Promise<Unit> {
    return request<Unit>(`/admin/units/${encodeURIComponent(id)}/adopt`, {
      method: 'POST',
    });
  },

  unadoptUnit(id: string): Promise<Unit> {
    return request<Unit>(`/admin/units/${encodeURIComponent(id)}/unadopt`, {
      method: 'POST',
    });
  },

  deleteUnit(id: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/admin/units/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // Bulk fleet operations. For action="migrate", `data` is the new management
  // server base URL pushed to each selected device so it re-points itself.
  bulkAction(
    unitIds: string[],
    action: BulkAction,
    data?: string,
  ): Promise<BulkActionResult> {
    return request<BulkActionResult>('/admin/units/bulk', {
      method: 'POST',
      body: { unitIds, action, ...(data !== undefined ? { data } : {}) },
    });
  },

  // Defaults
  getDefaults(): Promise<UnitConfig> {
    return request<UnitConfig>('/admin/defaults');
  },

  putDefaults(cfg: UnitConfig): Promise<UnitConfig> {
    return request<UnitConfig>('/admin/defaults', {
      method: 'PUT',
      body: cfg,
    });
  },

  // Jellyfin
  testJellyfin(creds: JellyfinConfig): Promise<JellyfinTestResult> {
    return request<JellyfinTestResult>('/admin/jellyfin/test', {
      method: 'POST',
      body: creds,
    });
  },

  // Browse the Jellyfin tree for the "lock to library/folder" picker. Omit
  // parentId for the top-level libraries.
  jellyfinChildren(
    creds: JellyfinConfig,
    parentId?: string,
  ): Promise<JellyfinChildrenResult> {
    return request<JellyfinChildrenResult>('/admin/jellyfin/children', {
      method: 'POST',
      body: { ...creds, ...(parentId ? { parentId } : {}) },
    });
  },

  // Resolve a single item id to its name/type (to show what a TV is locked to).
  jellyfinResolve(
    creds: JellyfinConfig,
    itemId: string,
  ): Promise<JellyfinResolveResult> {
    return request<JellyfinResolveResult>('/admin/jellyfin/resolve', {
      method: 'POST',
      body: { ...creds, itemId },
    });
  },

  // Push this Jellyfin server/account to every existing unit (overwrites their
  // jellyfin section only). Returns how many units were updated.
  pushJellyfinToAll(
    creds: JellyfinConfig,
  ): Promise<{ ok: boolean; affected: number }> {
    return request<{ ok: boolean; affected: number }>(
      '/admin/units/push-jellyfin',
      { method: 'POST', body: creds },
    );
  },

  // Backup & restore — full server configuration (defaults + all units).
  exportConfig(): Promise<ServerExport> {
    return request<ServerExport>('/admin/export');
  },

  importConfig(snapshot: unknown, replace: boolean): Promise<ImportResult> {
    return request<ImportResult>(`/admin/import${replace ? '?replace=true' : ''}`, {
      method: 'POST',
      body: snapshot,
    });
  },
};

export default api;
