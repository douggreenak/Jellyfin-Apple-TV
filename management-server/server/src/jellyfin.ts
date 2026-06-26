/**
 * Jellyfin connectivity test used by POST /admin/jellyfin/test.
 *
 * Never throws to the caller — always resolves to a result object with
 * { ok: false, error } on any failure.
 */

export interface JellyfinTestInput {
  serverUrl: string;
  username: string;
  password: string;
}

export interface JellyfinLibrary {
  id: string;
  name: string;
}

/** A node in the Jellyfin tree, used by the admin's "lock to folder" picker. */
export interface JellyfinBrowseItem {
  id: string;
  name: string;
  isFolder: boolean;
  childCount?: number;
}

export interface JellyfinTestResult {
  ok: boolean;
  serverName?: string;
  version?: string;
  libraries?: JellyfinLibrary[];
  error?: string;
}

const EMBY_AUTH_HEADER =
  'MediaBrowser Client="Jellyfin Admin", Device="admin", DeviceId="admin", Version="1.0"';

/** Strip a single trailing slash so we can safely append paths. */
function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function testJellyfin(
  input: JellyfinTestInput
): Promise<JellyfinTestResult> {
  const base = normalizeBase(input.serverUrl.trim());
  if (!base) return { ok: false, error: "serverUrl is required" };

  let authJson: any;
  try {
    const authRes = await fetch(`${base}/Users/AuthenticateByName`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Emby-Authorization": EMBY_AUTH_HEADER,
      },
      body: JSON.stringify({ Username: input.username, Pw: input.password }),
    });

    if (!authRes.ok) {
      return {
        ok: false,
        error: `Authentication failed (HTTP ${authRes.status})`,
      };
    }
    authJson = await authRes.json();
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach server: ${(err as Error).message}`,
    };
  }

  const token: string | undefined = authJson?.AccessToken;
  const userId: string | undefined = authJson?.User?.Id;
  const serverName: string | undefined = authJson?.ServerName;
  if (!token || !userId) {
    return { ok: false, error: "Server did not return a token or user id" };
  }

  // Best-effort: fetch system info for version + server name.
  let version: string | undefined;
  let resolvedServerName = serverName;
  try {
    const infoRes = await fetch(`${base}/System/Info`, {
      headers: {
        Accept: "application/json",
        "X-Emby-Token": token,
        "X-Emby-Authorization": EMBY_AUTH_HEADER,
      },
    });
    if (infoRes.ok) {
      const info: any = await infoRes.json();
      version = info?.Version;
      if (info?.ServerName) resolvedServerName = info.ServerName;
    }
  } catch {
    /* non-fatal */
  }

  // List libraries via UserViews.
  let libraries: JellyfinLibrary[] = [];
  try {
    const viewsRes = await fetch(
      `${base}/UserViews?userId=${encodeURIComponent(userId)}`,
      {
        headers: {
          Accept: "application/json",
          "X-Emby-Token": token,
          "X-Emby-Authorization": EMBY_AUTH_HEADER,
        },
      }
    );
    if (viewsRes.ok) {
      const views: any = await viewsRes.json();
      const items: any[] = Array.isArray(views?.Items) ? views.Items : [];
      libraries = items.map((it) => ({
        id: String(it?.Id ?? ""),
        name: String(it?.Name ?? ""),
      }));
    } else {
      return {
        ok: false,
        error: `Authenticated but failed to list libraries (HTTP ${viewsRes.status})`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Authenticated but failed to list libraries: ${
        (err as Error).message
      }`,
    };
  }

  return {
    ok: true,
    serverName: resolvedServerName,
    version,
    libraries,
  };
}

/* ---------------------- Tree browsing (lock-to-folder) ---------------------- */

interface AuthSession {
  base: string;
  token: string;
  userId: string;
}

/** Authenticate and return a session, or an error string. Shared by the browse helpers. */
async function authenticateSession(
  input: JellyfinTestInput
): Promise<{ ok: true; session: AuthSession } | { ok: false; error: string }> {
  const base = normalizeBase(input.serverUrl.trim());
  if (!base) return { ok: false, error: "serverUrl is required" };
  try {
    const res = await fetch(`${base}/Users/AuthenticateByName`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Emby-Authorization": EMBY_AUTH_HEADER,
      },
      body: JSON.stringify({ Username: input.username, Pw: input.password }),
    });
    if (!res.ok) {
      return { ok: false, error: `Authentication failed (HTTP ${res.status})` };
    }
    const json: any = await res.json();
    const token: string | undefined = json?.AccessToken;
    const userId: string | undefined = json?.User?.Id;
    if (!token || !userId) {
      return { ok: false, error: "Server did not return a token or user id" };
    }
    return { ok: true, session: { base, token, userId } };
  } catch (err) {
    return { ok: false, error: `Could not reach server: ${(err as Error).message}` };
  }
}

function authHeaders(token: string) {
  return {
    Accept: "application/json",
    "X-Emby-Token": token,
    "X-Emby-Authorization": EMBY_AUTH_HEADER,
  };
}

/**
 * List the children of a folder (or the top-level libraries when no parentId),
 * so the admin can drill the Jellyfin tree and lock a TV to any sub-library.
 */
export async function browseJellyfin(
  input: JellyfinTestInput,
  parentId?: string
): Promise<{ ok: boolean; items?: JellyfinBrowseItem[]; error?: string }> {
  const auth = await authenticateSession(input);
  if (!auth.ok) return { ok: false, error: auth.error };
  const { base, token, userId } = auth.session;

  let url: string;
  if (parentId && parentId.trim()) {
    const qs = new URLSearchParams({
      userId,
      parentId: parentId.trim(),
      SortBy: "IsFolder,SortName",
      SortOrder: "Ascending,Ascending",
      Fields: "ChildCount",
    });
    url = `${base}/Items?${qs.toString()}`;
  } else {
    url = `${base}/UserViews?userId=${encodeURIComponent(userId)}`;
  }

  try {
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) {
      return { ok: false, error: `Failed to list items (HTTP ${res.status})` };
    }
    const json: any = await res.json();
    const items: any[] = Array.isArray(json?.Items) ? json.Items : [];
    return {
      ok: true,
      items: items.map((it) => ({
        id: String(it?.Id ?? ""),
        name: String(it?.Name ?? ""),
        isFolder: !!it?.IsFolder,
        childCount: typeof it?.ChildCount === "number" ? it.ChildCount : undefined,
      })),
    };
  } catch (err) {
    return { ok: false, error: `Failed to list items: ${(err as Error).message}` };
  }
}

/** Resolve a single item id to its name/type — lets the admin show what a TV is locked to. */
export async function resolveJellyfinItem(
  input: JellyfinTestInput,
  itemId: string
): Promise<{ ok: boolean; item?: JellyfinBrowseItem; error?: string }> {
  const auth = await authenticateSession(input);
  if (!auth.ok) return { ok: false, error: auth.error };
  const { base, token, userId } = auth.session;
  try {
    const res = await fetch(
      `${base}/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}`,
      { headers: authHeaders(token) }
    );
    if (!res.ok) return { ok: false, error: `Item not found (HTTP ${res.status})` };
    const it: any = await res.json();
    return {
      ok: true,
      item: {
        id: String(it?.Id ?? itemId),
        name: String(it?.Name ?? ""),
        isFolder: !!it?.IsFolder,
      },
    };
  } catch (err) {
    return { ok: false, error: `Failed to resolve item: ${(err as Error).message}` };
  }
}
