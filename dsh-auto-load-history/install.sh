#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_PROFILE="${DSH_PROFILE:-web}"
DSH_COMPATIBILITY_RANGE=">=0.1.6-alpha.1 <0.1.7"

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
is_compatible_dsh_version() {
  local version="$1"
  local channel
  local sequence
  if [[ "$version" == "0.1.6" ]]; then return 0; fi
  if [[ "$version" =~ ^0\.1\.6-(alpha|beta|rc)\.(0|[1-9][0-9]*)$ ]]; then
    channel="${BASH_REMATCH[1]}"
    sequence="${BASH_REMATCH[2]}"
    if [[ "$channel" == "alpha" && "$sequence" -lt 1 ]]; then return 1; fi
    return 0
  fi
  return 1
}
if ! is_compatible_dsh_version "$NORMALIZED_DSH_VERSION"; then
  printf '错误: 支持的 DSH 范围为 %s，当前为 %s。\n' "$DSH_COMPATIBILITY_RANGE" "$ACTUAL_DSH_VERSION" >&2
  exit 1
fi
if [[ "$NORMALIZED_DSH_VERSION" != "0.1.6-alpha.1" ]]; then
  printf '警告: DSH %s 位于兼容发布线内，但尚未列入逐版本验证清单；客户端结构与能力检查仍是最终依据。\n' "$ACTUAL_DSH_VERSION" >&2
fi

npm run publish:check --prefix "$PLUGIN_DIR"
# Use DSH's official profile manager; do not edit the user's patch layer.
dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR" --config.minimumReleaseAge=0

echo "本地链接安装完成。Host 组成已变化，请在 Warp 中重启 dsh web 后刷新页面。"
