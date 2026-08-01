#!/usr/bin/env bash
# Обновление «Наш быт». Файл состояния fam-data.json не читается и не меняется.
set -Eeuo pipefail

FAM_ROOT="${FAM_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
INSTALL_PREFIX="${INSTALL_PREFIX:-/opt/fam}"
UNIT="${UNIT:-fam}"

BIN_SRC="$FAM_ROOT/backend/target/release/fam-backend"
BIN_DIR="$INSTALL_PREFIX/bin"
BIN_DST="$BIN_DIR/fam-backend"
DIST_SRC="$FAM_ROOT/frontend/dist"
FRONTEND_DIR="$INSTALL_PREFIX/frontend"
RELEASES_DIR="$FRONTEND_DIR/releases"
DIST_DST="$FRONTEND_DIR/dist"
LOCK_DIR="$FRONTEND_DIR/.update-fam.lock"

STAGE_DIR=""
SWITCH_DIR=""
BIN_TMP=""
LOCK_HELD=0
LEGACY_DIR=""
LEGACY_MOVED=0
FRONTEND_SWITCHED=0
FRONTEND_COMMITTED=0
PREVIOUS_DIST_KIND="absent"
NEW_DIST_TARGET=""

if mv --help 2>&1 | grep -q -- '--no-target-directory'; then
  MV_HAS_NO_TARGET_DIRECTORY=1
else
  MV_HAS_NO_TARGET_DIRECTORY=0
fi

replace_symlink() {
  local source_link="$1"
  local destination="$2"

  if [[ -L "$destination" ]]; then
    if (( MV_HAS_NO_TARGET_DIRECTORY )); then
      mv -fT -- "$source_link" "$destination"
    else
      # BSD/macOS mv follows a destination symlink to a directory unless -h is used.
      mv -fh -- "$source_link" "$destination"
    fi
  elif [[ ! -e "$destination" ]]; then
    mv -- "$source_link" "$destination"
  else
    echo "error: refusing to replace non-symlink $destination" >&2
    return 1
  fi
}

new_dist_is_active() {
  [[ -L "$DIST_DST" ]] && [[ "$(readlink "$DIST_DST")" == "$NEW_DIST_TARGET" ]]
}

rollback_frontend() {
  case "$PREVIOUS_DIST_KIND" in
    symlink)
      if (( FRONTEND_SWITCHED )) && new_dist_is_active && [[ -L "$SWITCH_DIR/previous-dist" ]]; then
        replace_symlink "$SWITCH_DIR/previous-dist" "$DIST_DST"
      fi
      ;;
    directory)
      if (( LEGACY_MOVED )); then
        if (( FRONTEND_SWITCHED )); then
          if ! new_dist_is_active; then
            echo "warning: dist changed concurrently; legacy dist left at $LEGACY_DIR" >&2
            return
          fi
          mv -- "$DIST_DST" "$SWITCH_DIR/failed-dist"
        fi
        if [[ ! -e "$DIST_DST" && ! -L "$DIST_DST" ]]; then
          mv -- "$LEGACY_DIR" "$DIST_DST"
          LEGACY_MOVED=0
        fi
      fi
      ;;
    absent)
      if (( FRONTEND_SWITCHED )) && new_dist_is_active; then
        mv -- "$DIST_DST" "$SWITCH_DIR/failed-dist"
      fi
      ;;
  esac
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  set +e

  if (( status != 0 && ! FRONTEND_COMMITTED )); then
    rollback_frontend
  fi

  [[ -n "$BIN_TMP" ]] && rm -f -- "$BIN_TMP"
  [[ -n "$STAGE_DIR" ]] && rm -rf -- "$STAGE_DIR"
  [[ -n "$SWITCH_DIR" ]] && rm -rf -- "$SWITCH_DIR"
  if (( LOCK_HELD )); then
    if ! rmdir -- "$LOCK_DIR"; then
      echo "warning: could not remove deploy lock $LOCK_DIR" >&2
    fi
    LOCK_HELD=0
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$BIN_DIR" "$RELEASES_DIR"
if ! mkdir "$LOCK_DIR"; then
  echo "error: another update is already running (lock: $LOCK_DIR)" >&2
  exit 1
fi
LOCK_HELD=1

cd "$FAM_ROOT"

echo "==> build frontend"
npm run build --prefix frontend
[[ -s "$DIST_SRC/index.html" ]] || {
  echo "error: frontend build has no non-empty index.html" >&2
  exit 1
}

echo "==> build backend (release)"
cargo build --release --manifest-path backend/Cargo.toml

echo "==> publish versioned frontend release"
STAGE_DIR="$(mktemp -d "$FRONTEND_DIR/.dist-stage.XXXXXXXX")"
cp -a "$DIST_SRC/." "$STAGE_DIR/"
[[ -s "$STAGE_DIR/index.html" ]] || {
  echo "error: staged frontend has no non-empty index.html" >&2
  exit 1
}

STAGE_TOKEN="${STAGE_DIR##*.dist-stage.}"
RELEASE_NAME="$(date -u +%Y%m%dT%H%M%SZ)-$$-$STAGE_TOKEN"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"
[[ ! -e "$RELEASE_DIR" && ! -L "$RELEASE_DIR" ]] || {
  echo "error: release already exists: $RELEASE_DIR" >&2
  exit 1
}
mv -- "$STAGE_DIR" "$RELEASE_DIR"
STAGE_DIR=""

NEW_DIST_TARGET="releases/$RELEASE_NAME"
SWITCH_DIR="$(mktemp -d "$FRONTEND_DIR/.dist-switch.XXXXXXXX")"
ln -s "$NEW_DIST_TARGET" "$SWITCH_DIR/new-dist"

if [[ -L "$DIST_DST" ]]; then
  PREVIOUS_DIST_KIND="symlink"
  ln -s "$(readlink "$DIST_DST")" "$SWITCH_DIR/previous-dist"
  replace_symlink "$SWITCH_DIR/new-dist" "$DIST_DST"
elif [[ -d "$DIST_DST" ]]; then
  PREVIOUS_DIST_KIND="directory"
  LEGACY_DIR="$RELEASES_DIR/legacy-$RELEASE_NAME"
  mv -- "$DIST_DST" "$LEGACY_DIR"
  LEGACY_MOVED=1
  mv -- "$SWITCH_DIR/new-dist" "$DIST_DST"
elif [[ -e "$DIST_DST" ]]; then
  echo "error: $DIST_DST exists but is neither a directory nor a symlink" >&2
  exit 1
else
  PREVIOUS_DIST_KIND="absent"
  mv -- "$SWITCH_DIR/new-dist" "$DIST_DST"
fi
FRONTEND_SWITCHED=1

BIN_TMP="$(mktemp "$BIN_DIR/.fam-backend.XXXXXXXX")"
install -m 755 "$BIN_SRC" "$BIN_TMP"
mv -f -- "$BIN_TMP" "$BIN_DST"
BIN_TMP=""

if command -v systemctl >/dev/null 2>&1; then
  echo "==> restart $UNIT"
  systemctl restart "$UNIT"
else
  echo "==> systemctl not found; restart fam-backend manually"
fi

FRONTEND_COMMITTED=1
echo "==> done: frontend $RELEASE_NAME"
