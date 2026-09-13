#!/bin/bash
#
# build-ipa.sh — archive + export an Ad Hoc IPA for the Jellyfin tvOS app and
# drop it at builds/Jellyfin.ipa.
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

# Every build gets a distinct, monotonically-increasing CFBundleVersion (the
# git commit count at HEAD) so DeviceIdentity.appVersion ("1.0 (42)") actually
# changes from build to build — the whole point of the fleet version-check
# feature. MARKETING_VERSION ("1.0") is left as whatever's checked into the
# project; bump that by hand in Xcode when you want a real semantic version
# change. This overrides the pbxproj's CURRENT_PROJECT_VERSION for just this
# build — nothing is written back to the checked-in project file.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$REPO_ROOT/Jellyfin"
EXPORT_OPTIONS="$REPO_ROOT/scripts/exportOptions.plist"
OUT_IPA="$REPO_ROOT/builds/Jellyfin.ipa"

BUILD_NUMBER="$(git -C "$REPO_ROOT" rev-list --count HEAD)"
MARKETING_VERSION="$(cd "$PROJECT_DIR" && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project Jellyfin.xcodeproj -scheme Jellyfin -showBuildSettings 2>/dev/null | awk -F' = ' '/ MARKETING_VERSION /{print $2; exit}')"
MARKETING_VERSION="${MARKETING_VERSION:-1.0}"

WORK_DIR="$(mktemp -d)"
ARCHIVE_PATH="$WORK_DIR/Jellyfin.xcarchive"
EXPORT_DIR="$WORK_DIR/export"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Archiving Jellyfin (tvOS device, Ad Hoc) — version $MARKETING_VERSION ($BUILD_NUMBER)…"
cd "$PROJECT_DIR"
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Jellyfin.xcodeproj -scheme Jellyfin \
  -destination 'generic/platform=tvOS' \
  -archivePath "$ARCHIVE_PATH" \
  DEVELOPMENT_TEAM=THW3L89YM6 \
  CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
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
echo "==> This build reports itself as: $MARKETING_VERSION ($BUILD_NUMBER)"
echo "    Set that as the fleet's \"Latest app version\" on the Defaults page after you push it via Mosyle."
