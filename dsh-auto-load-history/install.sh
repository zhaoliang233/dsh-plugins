#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_PROFILE="${DSH_PROFILE:-web}"
DSH_COMPATIBILITY_RANGE=">=0.2.0-rc.2 <0.2.1"
# 逐版本验证清单：必须与 lib/index.js 的 VERIFIED_DSH_VERSIONS 保持一致。
DSH_VERIFIED_VERSIONS="0.2.0-rc.2"
# 发布线与下界：必须与 lib/index.js 的 DSH_RELEASE_LINE / DSH_RELEASE_FLOOR 同源。
DSH_RELEASE_LINE="0.2.0"
DSH_RELEASE_FLOOR_CHANNEL="rc"
DSH_RELEASE_FLOOR_SEQUENCE=2

echo "== dsh-auto-load-history 安装 =="
echo "  插件目录: $PLUGIN_DIR"
echo "  profile:  $DSH_PROFILE"

command -v dsh >/dev/null 2>&1 || {
  echo "错误: PATH 中找不到 dsh" >&2
  exit 1
}
command -v pnpm >/dev/null 2>&1 || {
  echo "错误: dsh plugin 需要 pnpm，请先安装 pnpm" >&2
  exit 1
}

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
  if [[ "$version" == "$DSH_RELEASE_LINE" ]]; then return 0; fi
  if [[ "$version" =~ ^${DSH_RELEASE_LINE//./\\.}-(alpha|beta|rc)\.(0|[1-9][0-9]*)$ ]]; then
    channel="${BASH_REMATCH[1]}"
    sequence="${BASH_REMATCH[2]}"
    rank="$(prerelease_rank "$channel")"
    floor_rank="$(prerelease_rank "$DSH_RELEASE_FLOOR_CHANNEL")"
    if [[ "$rank" -gt "$floor_rank" ]]; then return 0; fi
    if [[ "$rank" -eq "$floor_rank" && "$sequence" -ge "$DSH_RELEASE_FLOOR_SEQUENCE" ]]; then return 0; fi
    return 1
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
  printf '警告: DSH %s 位于兼容发布线 %s 内，但尚未列入逐版本验证清单（%s）；客户端结构与能力检查仍是最终依据。\n' \
    "$ACTUAL_DSH_VERSION" "$DSH_COMPATIBILITY_RANGE" "$DSH_VERIFIED_VERSIONS" >&2
fi

npm run publish:check --prefix "$PLUGIN_DIR"
# Use DSH's official profile manager; do not edit the user's patch layer.
dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR" --config.minimumReleaseAge=0

echo "本地链接安装完成。Host 组成已变化，请在 Warp 中重启 dsh web 后刷新页面。"
