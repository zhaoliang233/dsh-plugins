#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"

echo "== dsh-mcp-console 卸载 =="
dsh plugin --profile "$DSH_PROFILE" remove dsh-mcp-console --config.minimumReleaseAge=0

echo "已从 profile 移除。托管服务器清单仍在当前 profile 的 cordis.patch.yml 里 dsh-mcp-console 那一条的 config 中；"
echo "已写入的凭据仍在 ~/.dsh/.credentials.yaml 中，均未删除。"
