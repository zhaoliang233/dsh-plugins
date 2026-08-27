#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_PROFILE="${DSH_PROFILE:-web}"
export DSH_PROFILE

total=0
succeeded=0
failed=()

echo "== 批量安装 DSH 插件 =="
echo "  工作区: $ROOT_DIR"
echo "  profile: $DSH_PROFILE"

for script in "$ROOT_DIR"/*/install.sh; do
  [[ -f "$script" ]] || continue

  plugin_name="$(basename "$(dirname "$script")")"
  total=$((total + 1))
  echo
  echo "[$total] 安装 $plugin_name"

  if bash "$script"; then
    succeeded=$((succeeded + 1))
  else
    status=$?
    failed+=("$plugin_name (退出码 $status)")
    echo "安装失败: $plugin_name (退出码 $status)" >&2
  fi
done

echo
echo "== 安装汇总 =="
echo "  共发现: $total"
echo "  成功:   $succeeded"
echo "  失败:   ${#failed[@]}"

if (( total == 0 )); then
  echo "错误: 未找到任何插件安装脚本（*/install.sh）" >&2
  exit 1
fi

if (( ${#failed[@]} > 0 )); then
  printf '  - %s\n' "${failed[@]}" >&2
  exit 1
fi

echo "全部插件安装完成。请刷新 DSH Web；若组成未热加载，请在 Warp 中重启 dsh web。"
