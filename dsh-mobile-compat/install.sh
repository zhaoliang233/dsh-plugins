#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_PROFILE="${DSH_PROFILE:-web}"

echo "== dsh-mobile-compat 安装 =="
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
if [[ "$DSH_PROFILE" != "web" ]]; then
  echo "错误: dsh-mobile-compat 当前只适配 web profile。" >&2
  exit 1
fi

node "$PLUGIN_DIR/scripts/check-compat.js" --installed
npm run publish:check --prefix "$PLUGIN_DIR"
# Use DSH's official profile manager; do not edit the user's patch layer.
dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR" --config.minimumReleaseAge=0

echo "本地链接安装完成。请刷新 DSH Web 页面；若组成未热加载，请在 Warp 中重启 dsh web。"
