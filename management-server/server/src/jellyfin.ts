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
