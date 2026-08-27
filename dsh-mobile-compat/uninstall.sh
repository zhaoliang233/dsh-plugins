#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"

echo "== dsh-mobile-compat 卸载 =="
dsh plugin --profile "$DSH_PROFILE" remove dsh-mobile-compat --config.minimumReleaseAge=0

echo "插件已从 profile 移除；不会修改 DSH 源码、会话历史或用户配置。"
