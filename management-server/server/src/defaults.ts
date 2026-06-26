import type { UnitConfig } from "./schema";

/**
 * DEFAULT_TEMPLATE — the canonical UnitConfig template used to seed new units
 * and editable via GET/PUT /admin/defaults.
 *
 * unitId/displayName are placeholders here; makeDefaultConfig() fills real
 * values when a device registers. updatedAt is regenerated on every write.
 */
export const DEFAULT_TEMPLATE: UnitConfig = {
  unitId: "",
  displayName: "New Apple TV",
  groupId: null,
  jellyfin: {
    serverUrl: "",
    username: "",
    password: "",
  },
  browse: {
    mode: "full",
    homeLibraryId: null,
    allowedLibraryIds: [],
    hiddenLibraryIds: [],
  },
  appearance: {
    appTitle: "Jellyfin",
    theme: "dark",
    accentColorHex: "#5E5CE6",
    showClock: true,
    showItemTitles: true,
    posterStyle: "wide",
  },
  playback: {
    autoplayNext: true,
    maxBitrateMbps: 0,
    preferDirectPlay: true,
  },
  security: {
    settingsPinEnabled: false,
    settingsPin: null,
  },
  configVersion: 1,
  updatedAt: new Date(0).toISOString(),
};
