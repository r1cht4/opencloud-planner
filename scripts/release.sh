#!/usr/bin/env bash
#
# Builds a store-ready zip of the Calendar & Contacts web app.
#
# Usage: bash scripts/release.sh
#
# Steps: install (frozen lockfile) -> lint -> typecheck -> unit tests -> build ->
#        release/planner-<version>.zip + md5sum.txt + sha256sum.txt
#
# The archive holds ONE top-level folder named after the app, so admins can
# extract it directly into their OpenCloud apps folder:
#
#   planner/manifest.json
#   planner/js/...
#   planner/assets/...
#   planner/LICENSE
#   planner/THIRD-PARTY-LICENSES
#
# Next to the zip, md5sum.txt and sha256sum.txt hold the checksums in the usual
# `<hash>  <file>` form (verifiable with `md5sum -c md5sum.txt`).
# Only `zip`, `md5sum` and `sha256sum` are used, no extra tooling.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { printf '\n==> %s\n' "$*"; }
fail() {
  printf 'release.sh: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' is missing ($2), aborting."
}

need node 'install Node.js 20 or newer from https://nodejs.org/'
need pnpm 'run "corepack enable" or "npm install -g pnpm"'
need zip 'install it with "apt-get install zip" (or your package manager)'
need md5sum 'install it with "apt-get install coreutils" (or your package manager)'
need sha256sum 'install it with "apt-get install coreutils" (or your package manager)'

VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version)")" \
  || fail "could not read the version from package.json"
[ -n "$VERSION" ] || fail "package.json has no version field"

RELEASE_DIR="$ROOT_DIR/release"
ZIP_NAME="planner-$VERSION.zip"
ZIP_PATH="$RELEASE_DIR/$ZIP_NAME"

log "Release $ZIP_NAME"

log "Installing dependencies (frozen lockfile)"
pnpm install --frozen-lockfile

log "Lint"
pnpm lint

log "Typecheck"
pnpm check:types

log "Unit tests"
pnpm exec vitest run

log "Build"
pnpm build

[ -f "$ROOT_DIR/dist/manifest.json" ] || fail "dist/manifest.json is missing - the build did not produce an app bundle"
[ -d "$ROOT_DIR/dist/js" ] || fail "dist/js is missing - the build did not produce any chunks"
[ -f "$ROOT_DIR/LICENSE" ] || fail "LICENSE is missing"
[ -f "$ROOT_DIR/THIRD-PARTY-LICENSES" ] || fail "THIRD-PARTY-LICENSES is missing"

log "Packaging $ZIP_NAME"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# stage apps/planner/... so that the zip has a single top-level folder
STAGING="$RELEASE_DIR/.staging"
trap 'rm -rf "$STAGING"' EXIT
mkdir -p "$STAGING/planner"
cp -a "$ROOT_DIR/dist/manifest.json" "$STAGING/planner/"
cp -a "$ROOT_DIR/dist/js" "$ROOT_DIR/dist/assets" "$STAGING/planner/"
cp -a "$ROOT_DIR/LICENSE" "$ROOT_DIR/THIRD-PARTY-LICENSES" "$STAGING/planner/"

(cd "$STAGING" && zip -q -X -r "$ZIP_PATH" planner)
rm -rf "$STAGING"

[ -f "$ZIP_PATH" ] || fail "the zip was not created"

(cd "$RELEASE_DIR" && sha256sum "$ZIP_NAME" >sha256sum.txt && md5sum "$ZIP_NAME" >md5sum.txt)

log "Done"
printf 'archive:   %s\n' "$ZIP_PATH"
printf 'size:      %s\n' "$(du -h "$ZIP_PATH" | cut -f1)"
printf 'sha256:    %s\n' "$(cut -d' ' -f1 "$RELEASE_DIR/sha256sum.txt")"
printf 'md5:       %s\n' "$(cut -d' ' -f1 "$RELEASE_DIR/md5sum.txt")"
printf 'checksums: %s/{sha256sum.txt,md5sum.txt}\n' "$RELEASE_DIR"
