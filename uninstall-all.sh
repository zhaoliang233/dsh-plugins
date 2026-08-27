#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_PROFILE="${DSH_PROFILE:-web}"
export DSH_PROFILE

total=0
succeeded=0
failed=()

echo "== 批量卸载 DSH 插件 =="
echo "  工作区: $ROOT_DIR"
echo "  profile: $DSH_PROFILE"

for script in "$ROOT_DIR"/*/uninstall.sh; do
  [[ -f "$script" ]] || continue

  plugin_name="$(basename "$(dirname "$script")")"
  total=$((total + 1))
  echo
  echo "[$total] 卸载 $plugin_name"

  if bash "$script"; then
    succeeded=$((succeeded + 1))
  else
    status=$?
    failed+=("$plugin_name (退出码 $status)")
    echo "卸载失败: $plugin_name (退出码 $status)" >&2
  fi
done

echo
echo "== 卸载汇总 =="
echo "  共发现: $total"
echo "  成功:   $succeeded"
echo "  失败:   ${#failed[@]}"

if (( total == 0 )); then
  echo "错误: 未找到任何插件卸载脚本（*/uninstall.sh）" >&2
  exit 1
fi

if (( ${#failed[@]} > 0 )); then
  printf '  - %s\n' "${failed[@]}" >&2
  exit 1
fi

echo "全部插件已从 profile 移除；插件目录和用户数据均保留。"
