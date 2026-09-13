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

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$REPO_ROOT/Jellyfin"
EXPORT_OPTIONS="$REPO_ROOT/scripts/exportOptions.plist"
OUT_IPA="$REPO_ROOT/builds/Jellyfin.ipa"

WORK_DIR="$(mktemp -d)"
ARCHIVE_PATH="$WORK_DIR/Jellyfin.xcarchive"
EXPORT_DIR="$WORK_DIR/export"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Archiving Jellyfin (tvOS device, Ad Hoc)…"
cd "$PROJECT_DIR"
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Jellyfin.xcodeproj -scheme Jellyfin \
  -destination 'generic/platform=tvOS' \
  -archivePath "$ARCHIVE_PATH" \
  DEVELOPMENT_TEAM=THW3L89YM6 \
  CODE_SIGN_STYLE=Automatic \
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
