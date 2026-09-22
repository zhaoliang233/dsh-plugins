#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_PROFILE="${DSH_PROFILE:-web}"
# 兼容发布线：只服务这一条已逐包核对过契约的 DSH 发布线；范围外拒绝安装（插件运行时也会保持 inert）。
DSH_COMPATIBILITY_RANGE=">=0.1.7-alpha.1 <0.1.8"
DSH_VERIFIED_VERSIONS="0.1.7-alpha.1"
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
  echo "错误: 支持的 DSH 范围为 ${DSH_COMPATIBILITY_RANGE}，当前为 ${ACTUAL_DSH_VERSION}。" >&2
  echo "      需要支持新的 DSH 版本时，先逐包核对契约差异并同步插件适配与测试，再发新版本。" >&2
  exit 1
fi
if ! is_verified_dsh_version "$NORMALIZED_DSH_VERSION"; then
  echo "警告: DSH $ACTUAL_DSH_VERSION 位于兼容发布线内，但尚未列入逐版本验证清单；安装后请检查归档恢复与永久删除能力状态。" >&2
fi

echo "== dsh-chat-archive-manager 本地安装 =="
echo "  插件目录: $PLUGIN_DIR"
echo "  profile:  $DSH_PROFILE"
echo "  DSH:      $ACTUAL_DSH_VERSION"

npm run publish:check --prefix "$PLUGIN_DIR"
dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR" --config.minimumReleaseAge=0

echo "本地链接安装完成。请重启 dsh web 并刷新页面。"
