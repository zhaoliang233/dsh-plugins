#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"

echo "== dsh-extra-context 卸载 =="
command -v dsh >/dev/null 2>&1 || {
  echo "错误: PATH 中找不到 dsh" >&2
  exit 1
}
command -v pnpm >/dev/null 2>&1 || {
  echo "错误: dsh plugin 需要 pnpm，请先安装 pnpm" >&2
  exit 1
}

dsh plugin --profile "$DSH_PROFILE" remove dsh-extra-context --config.minimumReleaseAge=0

echo "卸载完成。settings.yaml 中的 extra-context 段是用户数据，保留不删；如不再需要请手动移除。"
echo "bundle 列表变化同样需要重启 dsh web 才生效。"
