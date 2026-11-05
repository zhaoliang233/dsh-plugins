#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"

echo "== dsh-workspace-running-indicator 卸载 =="
dsh plugin --profile "$DSH_PROFILE" remove dsh-workspace-running-indicator --config.minimumReleaseAge=0

echo "插件已从 profile 移除；不会修改会话历史或 DSH 源码。"
