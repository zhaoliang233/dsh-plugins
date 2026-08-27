#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"

printf '%s\n' '== dsh-default-workspace 卸载 =='
dsh plugin --profile "$DSH_PROFILE" remove dsh-default-workspace --config.minimumReleaseAge=0

printf '%s\n' '本地链接已从 profile 移除。Workspace、会话和受管目录均保留。'
