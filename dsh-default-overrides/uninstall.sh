#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"

echo "== dsh-default-overrides 卸载 =="
command -v dsh >/dev/null 2>&1 || {
  echo "错误: PATH 中找不到 dsh" >&2
  exit 1
}
command -v pnpm >/dev/null 2>&1 || {
  echo "错误: dsh plugin 需要 pnpm，请先安装 pnpm" >&2
  exit 1
}

dsh plugin --profile "$DSH_PROFILE" remove dsh-default-overrides --config.minimumReleaseAge=0

echo "卸载完成。插件只是入口：通过它写进 profile 补丁的覆盖项会保留，"
echo "如需还原请在补丁文件里手动删除对应条目的 config，或重装后逐项点「恢复默认」。"
echo "bundle 列表变化同样需要重启 dsh web 才生效。"
