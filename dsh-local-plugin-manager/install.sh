#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_PROFILE="${DSH_PROFILE:-web}"
DSH_COMPATIBILITY_RANGE=">=0.1.7-alpha.1 <0.1.8"
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

if [[ "$DSH_PROFILE" != "web" ]]; then
  echo "错误: dsh-local-plugin-manager 当前只适配 web profile。" >&2
  exit 1
fi
if ! is_compatible_dsh_version "$NORMALIZED_DSH_VERSION"; then
  echo "错误: 支持的 DSH 范围为 $DSH_COMPATIBILITY_RANGE，当前为 $ACTUAL_DSH_VERSION。" >&2
  exit 1
fi
# 逐版本验证清单：必须与 lib/profile-manager.js 的 VERIFIED_DSH_VERSIONS 逐字一致，
# test/manifest.test.js 会核对两处与 package.json#dshCompatibility 不漂移。
VERIFIED_DSH_VERSIONS=("0.1.7-alpha.1" "0.1.7-alpha.2")
is_verified_dsh_version() {
  local candidate="$1" known
  for known in "${VERIFIED_DSH_VERSIONS[@]}"; do
    [[ "$known" == "$candidate" ]] && return 0
  done
  return 1
}
if ! is_verified_dsh_version "$NORMALIZED_DSH_VERSION"; then
  printf '警告: DSH %s 位于兼容发布线内，但尚未列入逐版本验证清单（%s）；运行时能力检查继续 fail closed，安装后请检查设置里的「插件开发」页。\n' "$ACTUAL_DSH_VERSION" "${VERIFIED_DSH_VERSIONS[*]}" >&2
fi

echo "== dsh-local-plugin-manager 本地安装 =="
echo "  插件目录: $PLUGIN_DIR"
echo "  profile:  $DSH_PROFILE"

npm install --prefix "$PLUGIN_DIR" --ignore-scripts --no-audit --no-fund
npm run verify --prefix "$PLUGIN_DIR"
dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR" --config.minimumReleaseAge=0

echo "本地链接安装完成。请在 Warp 中重启 dsh web --no-open，然后刷新页面。"
