#!/bin/bash
#
# build-ipa.sh — archive + export an Ad Hoc IPA for the Jellyfin tvOS app and
# drop it at builds/Jellyfin.ipa. Also stamps a fresh version number into the
# management server + admin dashboard (they ship together) and generates the
# fleet's "latest app version" reference file the server compares units
# against — see docs/ARCHITECTURE.md §2, "App version tracking".
#
# Run this by hand anytime you want a fresh IPA:
#   ./scripts/build-ipa.sh
#
# It's also what scripts/git-hooks/pre-push runs automatically before a push
# that touches Jellyfin/ — see that file and README.md's "Building the Ad Hoc
# IPA" section for the one-time setup.
#
# Signing: automatic, team THW3L89YM6 (Bethel Church). Requires Xcode signed
# in to an Apple Developer account for that team — the export step uses
# -allowProvisioningUpdates so Xcode can fetch/create the Ad Hoc provisioning
# profile itself the first time (no App Store Connect access needed).

# Every build gets a distinct, monotonically-increasing version: MARKETING_VERSION
# is "1.<git commit count>" (e.g. "1.32", "1.33", ...), computed here and passed as
# a build-setting override — nothing is written back to the checked-in project
# file. DeviceIdentity.appVersion reports this string alone (no "(build)"
# parenthetical): a plain, always-incrementing "1.32" reads far better than the
# old "1.0 (31)" and is just as good a fleet version-check key, since it changes
# on every single build. CURRENT_PROJECT_VERSION (CFBundleVersion, invisible to
# users but required by Apple to be a monotonically increasing integer) is set to
# the same commit count. The same counter also becomes the web app's patch
# version (see below) — one counter, two products, both traceable to the exact
# commit that built them.

set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$REPO_ROOT/Jellyfin"
EXPORT_OPTIONS="$REPO_ROOT/scripts/exportOptions.plist"
OUT_IPA="$REPO_ROOT/builds/Jellyfin.ipa"
APP_VERSION_FILE="$REPO_ROOT/management-server/server/latest-app-version.json"

BUILD_NUMBER="$(git -C "$REPO_ROOT" rev-list --count HEAD)"
MARKETING_VERSION="1.$BUILD_NUMBER"
APP_VERSION="$MARKETING_VERSION"
WEB_VERSION="1.0.$BUILD_NUMBER"

WORK_DIR="$(mktemp -d)"
ARCHIVE_PATH="$WORK_DIR/Jellyfin.xcarchive"
EXPORT_DIR="$WORK_DIR/export"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Archiving Jellyfin (tvOS device, Ad Hoc) — version $MARKETING_VERSION…"
cd "$PROJECT_DIR"
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Jellyfin.xcodeproj -scheme Jellyfin \
  -destination 'generic/platform=tvOS' \
  -archivePath "$ARCHIVE_PATH" \
  DEVELOPMENT_TEAM=THW3L89YM6 \
  CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  MARKETING_VERSION="$MARKETING_VERSION" \
  archive

echo "==> Exporting Ad Hoc IPA…"
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates

mkdir -p "$REPO_ROOT/builds"
cp "$EXPORT_DIR/Jellyfin.ipa" "$OUT_IPA"
echo "==> Updated $OUT_IPA ($(du -h "$OUT_IPA" | cut -f1))"
echo "==> tvOS app version: $APP_VERSION"

# The fleet's "latest app version" reference — the server compares every
# unit's reported status.appVersion against this (GET /admin/app-version;
# no admin UI writes it, this file is the only source). Once this build ships
# via Mosyle, the deployed server picks it up on its next `git pull` + restart.
cat > "$APP_VERSION_FILE" << JSON
{
  "version": "$APP_VERSION",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "==> Wrote $APP_VERSION_FILE"

# The web app (management server + admin dashboard) ships alongside the tvOS
# app, so it gets a version from the same counter — 1.0.<build>, one push, one
# traceable number for both products. `npm pkg set` edits package.json in
# place without disturbing formatting/ordering.
npm pkg set version="$WEB_VERSION" --prefix "$REPO_ROOT/management-server/server" >/dev/null
npm pkg set version="$WEB_VERSION" --prefix "$REPO_ROOT/management-server/admin" >/dev/null
echo "==> Web app version: $WEB_VERSION (management-server/{server,admin}/package.json)"
