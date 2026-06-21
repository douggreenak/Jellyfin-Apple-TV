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
r = await fetch(`${BASE}/admin/units/${unitId}/command`, { method: "POST", headers: ah, body: JSON.stringify({ type: "identify" }) });
check("command queued", r.status === 200, `got ${r.status}`);
r = await fetch(`${BASE}/devices/${unitId}/heartbeat`, { method: "POST", headers: dh, body: JSON.stringify({}) });
const hb2 = await j(r);
check("heartbeat delivers command", hb2.command && hb2.command.type === "identify", JSON.stringify(hb2.command));
r = await fetch(`${BASE}/devices/${unitId}/ack`, { method: "POST", headers: dh, body: JSON.stringify({ commandId: hb2.command.id }) });
check("ack ok", (await j(r)).ok === true);
r = await fetch(`${BASE}/devices/${unitId}/heartbeat`, { method: "POST", headers: dh, body: JSON.stringify({}) });
check("command cleared after ack", (await j(r)).command === null);

console.log("8. Cleanup: delete unit");
r = await fetch(`${BASE}/admin/units/${unitId}`, { method: "DELETE", headers: ah });
check("delete ok", (await j(r)).ok === true);

console.log(`\nALL ${passed} CHECKS PASSED ✅`);
