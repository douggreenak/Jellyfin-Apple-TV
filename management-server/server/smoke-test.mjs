// End-to-end smoke test of the management server's device + admin API.
// Run against a server listening on BASE. Exits non-zero on first failure.

const BASE = process.env.BASE || "http://localhost:4000/api/v1";
const ADMIN_USER = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "changeme";

let passed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name} ${extra}`); process.exit(1); }
}
const j = (r) => r.json();

const unitId = "smoke-" + Math.floor(Date.now() % 1e9);

console.log("1. Device register");
let r = await fetch(`${BASE}/devices/register`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ unitId, deviceName: "Lobby TV", model: "AppleTV14,1", tvosVersion: "18.0", appVersion: "1.0" }),
});
check("register 200/201", r.status === 200 || r.status === 201, `got ${r.status}`);
let body = await j(r);
const token = body.token;
check("returned a token", typeof token === "string" && token.length > 0);
check("no deviceToken leak in unit", !JSON.stringify(body.unit).includes("deviceToken"));
check("config.displayName seeded from deviceName", body.unit.config.displayName === "Lobby TV");
const v0 = body.unit.config.configVersion;

const dh = { "X-Unit-Id": unitId, "X-Unit-Token": token, "content-type": "application/json" };

console.log("2. Device GET config (auth required)");
r = await fetch(`${BASE}/devices/${unitId}/config`, { headers: { "X-Unit-Id": unitId, "X-Unit-Token": "wrong" } });
check("rejects bad token", r.status === 401, `got ${r.status}`);
r = await fetch(`${BASE}/devices/${unitId}/config`, { headers: dh });
check("config 200 with token", r.status === 200, `got ${r.status}`);
const cfg = await j(r);
check("config has jellyfin block", typeof cfg.jellyfin === "object");

console.log("3. Device PUT config (on-device edit -> server)  [new endpoint]");
const edited = { ...cfg, displayName: "Room 101 TV", appearance: { ...cfg.appearance, accentColorHex: "#FF375F", appTitle: "Jellyfin" } };
r = await fetch(`${BASE}/devices/${unitId}/config`, { method: "PUT", headers: dh, body: JSON.stringify(edited) });
check("PUT config 200", r.status === 200, `got ${r.status}`);
const saved = await j(r);
check("displayName persisted", saved.displayName === "Room 101 TV");
check("accent persisted", saved.appearance.accentColorHex === "#FF375F");
check("appTitle persisted", saved.appearance.appTitle === "Jellyfin");
check("configVersion bumped", saved.configVersion === v0 + 1, `was ${v0} now ${saved.configVersion}`);
check("server-owned unitId intact", saved.unitId === unitId);

console.log("4. Device heartbeat reflects new version");
r = await fetch(`${BASE}/devices/${unitId}/heartbeat`, { method: "POST", headers: dh, body: JSON.stringify({ ipAddress: "10.0.0.5" }) });
const hb = await j(r);
check("heartbeat ok", hb.ok === true);
check("heartbeat configVersion = bumped", hb.configVersion === v0 + 1, `got ${hb.configVersion}`);

console.log("5. Admin login + see the unit");
r = await fetch(`${BASE}/admin/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }) });
check("admin login 200", r.status === 200, `got ${r.status}`);
const { token: jwt } = await j(r);
check("admin jwt issued", typeof jwt === "string" && jwt.length > 0);
const ah = { Authorization: `Bearer ${jwt}`, "content-type": "application/json" };

r = await fetch(`${BASE}/admin/units`, { headers: ah });
const units = await j(r);
const mine = units.find((u) => u.unitId === unitId);
check("unit appears in admin list", !!mine);
check("admin sees on-device edit (displayName)", mine.displayName === "Room 101 TV");
check("admin list derives status.online", typeof mine.status.online === "boolean");
check("no deviceToken in admin list", !JSON.stringify(units).includes("deviceToken"));

console.log("6. Admin PATCH config bumps version again");
r = await fetch(`${BASE}/admin/units/${unitId}/config`, { method: "PATCH", headers: ah, body: JSON.stringify({ playback: { autoplayNext: false } }) });
const patched = await j(r);
check("admin patch 200", r.status === 200, `got ${r.status}`);
check("patch deep-merged (autoplay off)", patched.config.playback.autoplayNext === false);
check("patch preserved sibling (accent)", patched.config.appearance.accentColorHex === "#FF375F");
check("admin patch bumped version", patched.config.configVersion === v0 + 2, `got ${patched.config.configVersion}`);

console.log("7. Admin command -> device heartbeat delivers it -> ack clears");
r = await fetch(`${BASE}/admin/units/${unitId}/command`, { method: "POST", headers: ah, body: JSON.stringify({ type: "reload" }) });
check("command queued", r.status === 200, `got ${r.status}`);
r = await fetch(`${BASE}/devices/${unitId}/heartbeat`, { method: "POST", headers: dh, body: JSON.stringify({}) });
const hb2 = await j(r);
check("heartbeat delivers command", hb2.command && hb2.command.type === "reload", JSON.stringify(hb2.command));
check("heartbeat includes serverVersion", typeof hb2.serverVersion === "string" && hb2.serverVersion.length > 0, hb2.serverVersion);
r = await fetch(`${BASE}/devices/${unitId}/ack`, { method: "POST", headers: dh, body: JSON.stringify({ commandId: hb2.command.id }) });
check("ack ok", (await j(r)).ok === true);
r = await fetch(`${BASE}/devices/${unitId}/heartbeat`, { method: "POST", headers: dh, body: JSON.stringify({}) });
check("command cleared after ack", (await j(r)).command === null);

console.log("7b. Identify: admin turns it on, heartbeat delivers it, device dismisses it");
r = await fetch(`${BASE}/admin/units/${unitId}/identify`, { method: "POST", headers: ah, body: JSON.stringify({ on: true }) });
check("identify on 200", r.status === 200, `got ${r.status}`);
check("identify on reflected in response", (await j(r)).status.identifying === true);
r = await fetch(`${BASE}/devices/${unitId}/heartbeat`, { method: "POST", headers: dh, body: JSON.stringify({}) });
check("heartbeat reflects identifying=true", (await j(r)).identifying === true);
// The device itself clears it (physical-remote dismiss), not an admin action.
r = await fetch(`${BASE}/devices/${unitId}/heartbeat`, { method: "POST", headers: dh, body: JSON.stringify({ identifyDismissed: true }) });
check("heartbeat with identifyDismissed clears it", (await j(r)).identifying === false);
r = await fetch(`${BASE}/admin/units/${unitId}`, { headers: ah });
check("admin sees identifying=false after device dismiss", (await j(r)).status.identifying === false);
// An admin can also turn it off directly, independent of any device dismiss.
r = await fetch(`${BASE}/admin/units/${unitId}/identify`, { method: "POST", headers: ah, body: JSON.stringify({ on: true }) });
check("identify on again 200", r.status === 200);
r = await fetch(`${BASE}/admin/units/${unitId}/identify`, { method: "POST", headers: ah, body: JSON.stringify({ on: false }) });
check("identify off reflected in response", (await j(r)).status.identifying === false);

console.log("7c. Playback quality reporting + speedtest payload");
r = await fetch(`${BASE}/devices/${unitId}/speedtest`, { headers: dh });
check("speedtest 200", r.status === 200, `got ${r.status}`);
const speedtestBytes = await r.arrayBuffer();
check("speedtest payload is 4 MB", speedtestBytes.byteLength === 4 * 1024 * 1024, `got ${speedtestBytes.byteLength}`);
r = await fetch(`${BASE}/devices/${unitId}/playback-report`, {
  method: "POST", headers: dh,
  body: JSON.stringify({
    itemId: "item-1", itemName: "Test Movie", durationSeconds: 120,
    avgBitrateKbps: 3200, indicatedBitrateKbps: 3500, droppedFrames: 2, stalls: 0,
    width: 1920, height: 1080,
  }),
});
check("playback-report 200", r.status === 200, `got ${r.status}`);
r = await fetch(`${BASE}/admin/playback-stats`, { headers: ah });
check("playback-stats 200", r.status === 200, `got ${r.status}`);
const stats = await j(r);
const reported = stats.events.find((e) => e.unitId === unitId && e.itemId === "item-1");
check("reported event present", !!reported, JSON.stringify(stats.events));
check("event has unitDisplayName joined in", reported?.unitDisplayName === "Room 101 TV", reported?.unitDisplayName);
check("event carries reported bitrate", reported?.avgBitrateKbps === 3200);

console.log("8. App version tracking (generated by scripts/build-ipa.sh, not admin-settable)");
// getLatestAppVersion() prefers a background GitHub poll of this same file's
// content on the repo's main branch over this checkout's own local copy (see
// appVersion.ts) — so a dev checkout with un-pushed local changes can
// legitimately disagree with GitHub, and that's correct, not a bug: it's
// exactly what stops a stale local deployment from flagging every unit
// running the real latest build as "outdated" forever. So this test can't
// assert equality against the local file; instead it takes whatever the API
// itself currently reports as ground truth and checks the current/outdated
// classification logic is internally consistent with that value.
r = await fetch(`${BASE}/admin/app-version`, { headers: ah });
const av = await j(r);
const realLatestVersion = av.latestVersion;
check("got a latest version (from GitHub or local fallback)", typeof realLatestVersion === "string" || realLatestVersion === null, JSON.stringify(av));
check("counts shape present", typeof av.counts.outdated === "number" && typeof av.counts.current === "number");
check("no PUT endpoint (not admin-settable)", (await fetch(`${BASE}/admin/app-version`, { method: "PUT", headers: ah, body: "{}" })).status === 404);

if (realLatestVersion) {
  // Registered with appVersion "1.0" (step 1), which won't match a real
  // generated version -> outdated (mismatch).
  r = await fetch(`${BASE}/admin/units/${unitId}`, { headers: ah });
  check("mismatched version -> outdated", (await j(r)).appVersionStatus === "outdated");

  // Heartbeat now reports the exact latest version -> the server's view
  // refreshes even though this unit already registered once (the staleness
  // bug this fixes).
  r = await fetch(`${BASE}/devices/${unitId}/heartbeat`, { method: "POST", headers: dh, body: JSON.stringify({ appVersion: realLatestVersion }) });
  check("heartbeat with appVersion ok", (await j(r)).ok === true);
  r = await fetch(`${BASE}/admin/units/${unitId}`, { headers: ah });
  const afterMatch = await j(r);
  check("heartbeat refreshed status.appVersion", afterMatch.status.appVersion === realLatestVersion);
  check("matching version -> current", afterMatch.appVersionStatus === "current");
} else {
  r = await fetch(`${BASE}/admin/units/${unitId}`, { headers: ah });
  check("no generated version yet -> unknown", (await j(r)).appVersionStatus === "unknown");
  console.log("  (skipped current/outdated checks — run scripts/build-ipa.sh once to generate latest-app-version.json)");
}

console.log("9. Real name via Bonjour (localName)");
// unitId's displayName is "Room 101 TV" by now (step 3's PUT config) — an
// admin-set (non-generic) name must never be overwritten by a device's
// self-reported localName, only the telemetry hint should update.
r = await fetch(`${BASE}/devices/${unitId}/heartbeat`, { method: "POST", headers: dh, body: JSON.stringify({ localName: "Fellowship Hall" }) });
check("heartbeat with localName ok", (await j(r)).ok === true);
r = await fetch(`${BASE}/admin/units/${unitId}`, { headers: ah });
const protectedUnit = await j(r);
check("custom displayName NOT overwritten", protectedUnit.displayName === "Room 101 TV", protectedUnit.displayName);
check("localNetworkName recorded as telemetry anyway", protectedUnit.status.localNetworkName === "Fellowship Hall");

// A unit that registered as the literal generic placeholder (what
// UIDevice.current.name actually returns without Apple's gated entitlement)
// IS safe to auto-rename from its first resolved localName.
const genericUnitId = "smoke-generic-" + Math.floor(Date.now() % 1e9);
r = await fetch(`${BASE}/devices/register`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ unitId: genericUnitId, deviceName: "Apple TV" }),
});
check("generic-name register ok", r.status === 200 || r.status === 201, `got ${r.status}`);
const genericToken = (await j(r)).token;
const gh = { "X-Unit-Id": genericUnitId, "X-Unit-Token": genericToken, "content-type": "application/json" };
r = await fetch(`${BASE}/devices/${genericUnitId}/heartbeat`, { method: "POST", headers: gh, body: JSON.stringify({ localName: "Sanctuary" }) });
check("heartbeat with localName ok (generic unit)", (await j(r)).ok === true);
r = await fetch(`${BASE}/admin/units/${genericUnitId}`, { headers: ah });
const adopted = await j(r);
check("generic \"Apple TV\" name auto-adopted", adopted.displayName === "Sanctuary", adopted.displayName);

console.log("10. Cleanup: delete units");
r = await fetch(`${BASE}/admin/units/${unitId}`, { method: "DELETE", headers: ah });
check("delete ok", (await j(r)).ok === true);
r = await fetch(`${BASE}/admin/units/${genericUnitId}`, { method: "DELETE", headers: ah });
check("delete ok (generic unit)", (await j(r)).ok === true);

console.log(`\nALL ${passed} CHECKS PASSED ✅`);
