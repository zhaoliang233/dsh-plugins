#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"

echo "== dsh-chat-archive-manager 卸载 =="
dsh plugin --profile "$DSH_PROFILE" remove dsh-chat-archive-manager --config.minimumReleaseAge=0

echo "插件已移除。受管 Workspace、未删除会话和删除恢复日志均保留。"
