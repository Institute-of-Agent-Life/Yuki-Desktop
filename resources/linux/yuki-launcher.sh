#!/usr/bin/env bash
# The AppImage launcher may append --no-sandbox when user namespaces are unavailable.
# Keep Electron's sandbox enabled; unsupported hosts must configure their sandbox support.
set -e
launcher_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
args=()
for arg in "$@"; do
  case "$arg" in
    --no-sandbox|--no-sandbox=*) ;;
    *) args+=("$arg") ;;
  esac
done
exec "$launcher_dir/yuki-bin" "${args[@]}"
