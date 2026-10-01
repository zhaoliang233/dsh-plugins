#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_PROFILE="${DSH_PROFILE:-web}"
DSH_COMPATIBILITY_RANGE=">=0.2.0-rc.2 <0.2.1"
DSH_VERIFIED_VERSIONS="0.2.0-rc.2"
# 发布线与下界：必须与 lib/index.js 的 DSH_RELEASE_LINE / DSH_RELEASE_FLOOR 同源。
DSH_RELEASE_LINE="0.2.0"
DSH_RELEASE_FLOOR_CHANNEL="rc"
DSH_RELEASE_FLOOR_SEQUENCE=2
ACTUAL_DSH_VERSION="$(dsh --version)"
NORMALIZED_DSH_VERSION="${ACTUAL_DSH_VERSION%%+*}"

# prerelease channel 的优先级，与 lib/index.js 的 PRERELEASE_CHANNELS 同序。
prerelease_rank() {
  case "$1" in
    alpha) echo 0 ;;
    beta) echo 1 ;;
    rc) echo 2 ;;
    *) echo 255 ;;
  esac
}
is_compatible_dsh_version() {
  local version="$1"
  local channel
  local sequence
  local rank
  local floor_rank
  if [[ "$version" == "$DSH_RELEASE_LINE" ]]; then
    return 0
  fi
  if [[ "$version" =~ ^${DSH_RELEASE_LINE//./\\.}-(alpha|beta|rc)\.(0|[1-9][0-9]*)$ ]]; then
    channel="${BASH_REMATCH[1]}"
    sequence="${BASH_REMATCH[2]}"
    rank="$(prerelease_rank "$channel")"
    floor_rank="$(prerelease_rank "$DSH_RELEASE_FLOOR_CHANNEL")"
    [[ "$rank" -gt "$floor_rank" || ( "$rank" -eq "$floor_rank" && "$sequence" -ge "$DSH_RELEASE_FLOOR_SEQUENCE" ) ]]
    return
  fi
  return 1
}

if ! is_compatible_dsh_version "$NORMALIZED_DSH_VERSION"; then
  printf '错误: 支持的 DSH 范围为 %s，当前为 %s。\n' "$DSH_COMPATIBILITY_RANGE" "$ACTUAL_DSH_VERSION" >&2
  exit 1
fi
is_verified_dsh_version() {
  local version="$1"
  local verified
  for verified in $DSH_VERIFIED_VERSIONS; do
    [[ "$version" == "$verified" ]] && return 0
  done
  return 1
}
if ! is_verified_dsh_version "$NORMALIZED_DSH_VERSION"; then
  printf '警告: DSH %s 位于兼容发布线 %s 内，但尚未列入逐版本验证清单（%s）；安装后请验证通用会话的新建、保护和排序。\n' \
    "$ACTUAL_DSH_VERSION" "$DSH_COMPATIBILITY_RANGE" "$DSH_VERIFIED_VERSIONS" >&2
fi

printf '%s\n' '== dsh-default-workspace 安装 =='
printf '  插件目录: %s\n' "$PLUGIN_DIR"
printf '  profile:  %s\n' "$DSH_PROFILE"

npm run publish:check --prefix "$PLUGIN_DIR"

# The local bundle adds no registry package. This one-shot override lets pnpm
# accept an already-locked profile dependency that is still inside its age window.
dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR" --config.minimumReleaseAge=0

printf '%s\n' '本地链接安装完成（profile 直接引用当前源码目录）。'
printf '%s\n' 'Host 或 client 代码变更后，请重启 dsh web 并刷新页面。'
