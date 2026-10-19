#!/usr/bin/env bash
set -euo pipefail

if (( $# == 0 )); then
  echo "Usage: bash scripts/check-appimage.sh <file.AppImage> [...]" >&2
  exit 1
fi

check_appimage() (
  appimage="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  temp_dir=$(mktemp -d)
  trap 'rm -rf "$temp_dir"' EXIT

  # Extract without FUSE and check the packaged files, not the build directory.
  cd "$temp_dir"
  "$appimage" --appimage-extract > /dev/null
  app_dir="$temp_dir/squashfs-root"

  require_file() {
    local path="$1"
    if [[ ! -f "$path" ]]; then
      echo "Missing file or broken symlink in AppImage: ${path#"$app_dir"/}" >&2
      exit 1
    fi
    # Tauri CLI < 2.11.4 used absolute links into the build machine's AppDir.
    if [[ -L "$path" && "$(readlink "$path")" == /* ]]; then
      echo "Absolute symlink in AppImage: ${path#"$app_dir"/}" >&2
      exit 1
    fi
  }

  require_file "$app_dir/.DirIcon"
  shopt -s nullglob
  desktop_files=("$app_dir"/*.desktop)
  if (( ${#desktop_files[@]} == 0 )); then
    echo "AppImage is missing a root .desktop entry" >&2
    exit 1
  fi
  for desktop_file in "${desktop_files[@]}"; do
    require_file "$desktop_file"
  done

  echo "Verified .DirIcon and desktop entry: $appimage"
)

for appimage in "$@"; do
  check_appimage "$appimage"
done
