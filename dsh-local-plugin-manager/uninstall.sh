#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"

if [[ "$DSH_PROFILE" != "web" ]]; then
  echo "错误: dsh-local-plugin-manager 当前只管理 web profile。" >&2
  exit 1
fi

echo "== dsh-local-plugin-manager 卸载 =="
dsh plugin --profile "$DSH_PROFILE" remove dsh-local-plugin-manager --config.minimumReleaseAge=0

echo "管理器已从 profile 移除。本地插件源码、插件数据和管理器状态文件均未删除。"
