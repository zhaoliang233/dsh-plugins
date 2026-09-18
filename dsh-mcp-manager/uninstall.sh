#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"

echo "== dsh-mcp-manager 卸载 =="
dsh plugin --profile "$DSH_PROFILE" remove dsh-mcp-manager --config.minimumReleaseAge=0

echo "已从 profile 移除。托管服务器清单仍在 $DSH_HOME/settings.yaml 的 mcp-manager 段；"
echo "已写入的凭据仍在 ~/.dsh/.credentials.yaml 中，均未删除。"
