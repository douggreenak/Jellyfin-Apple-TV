import fs from "node:fs";
import path from "node:path";

/**
 * This server's own version — bumped by scripts/build-ipa.sh on every push
 * (1.0.<git commit count>, same counter as the tvOS app's marketing version).
 * Read straight from package.json rather than duplicating it anywhere. Shared
 * by GET /health and the device heartbeat/register responses (so the identify
 * overlay can show which server build a unit is actually talking to).
 */
export const SERVER_VERSION: string = (() => {
  try {
    return (
      (JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as {
        version?: string;
      }).version ?? "0.0.0"
    );
  } catch {
    return "0.0.0";
  }
})();
