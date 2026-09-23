#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_PROFILE="${DSH_PROFILE:-web}"
DSH_COMPATIBILITY_RANGE=">=0.1.7-alpha.1 <0.1.8"
# 逐版本验证清单：必须与 lib/dsh.js 的 VERIFIED_DSH_VERSIONS 保持一致。
DSH_VERIFIED_VERSIONS="0.1.7-alpha.2"
ACTUAL_DSH_VERSION="$(dsh --version)"
NORMALIZED_DSH_VERSION="${ACTUAL_DSH_VERSION%%+*}"

is_compatible_dsh_version() {
  local version="$1"
  local channel
  local sequence
  if [[ "$version" == "0.1.7" ]]; then
    return 0
  fi
  if [[ "$version" =~ ^0\.1\.7-(alpha|beta|rc)\.(0|[1-9][0-9]*)$ ]]; then
    channel="${BASH_REMATCH[1]}"
    sequence="${BASH_REMATCH[2]}"
    [[ "$channel" != "alpha" || "$sequence" -ge 1 ]]
    return
  fi
  return 1
}

is_verified_dsh_version() {
  local version="$1"
  local verified
  for verified in $DSH_VERIFIED_VERSIONS; do
    [[ "$version" == "$verified" ]] && return 0
  done
  return 1
}

if ! is_compatible_dsh_version "$NORMALIZED_DSH_VERSION"; then
  echo "错误: 支持的 DSH 范围为 $DSH_COMPATIBILITY_RANGE，当前为 $ACTUAL_DSH_VERSION。" >&2
  exit 1
fi
if ! is_verified_dsh_version "$NORMALIZED_DSH_VERSION"; then
  echo "警告: DSH $ACTUAL_DSH_VERSION 位于兼容发布线内，但尚未列入逐版本验证清单；安装后请到设置页确认状态。" >&2
fi

echo "== dsh-mcp-manager 本地安装 =="
echo "  插件目录: $PLUGIN_DIR"
echo "  profile:  $DSH_PROFILE"

npm run verify --prefix "$PLUGIN_DIR"
dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR" --config.minimumReleaseAge=0

echo "本地链接安装完成。profile 组成发生变化，请在 Warp 中重启 dsh web --no-open，然后刷新页面。"
