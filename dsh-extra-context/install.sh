#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_PROFILE="${DSH_PROFILE:-web}"
DSH_COMPATIBILITY_RANGE=">=0.1.7-alpha.1 <0.1.8"
# 逐版本验证清单：必须与 lib/index.js 的 VERIFIED_DSH_VERSIONS 保持一致。
DSH_VERIFIED_VERSIONS="0.1.7-alpha.1"

echo "== dsh-extra-context 安装 =="
echo "  插件目录: $PLUGIN_DIR"
echo "  profile:  $DSH_PROFILE"

command -v dsh >/dev/null 2>&1 || {
  echo "错误: PATH 中找不到 dsh" >&2
  exit 1
}
command -v pnpm >/dev/null 2>&1 || {
  echo "错误: dsh plugin 需要 pnpm，请先安装 pnpm" >&2
  exit 1
}

ACTUAL_DSH_VERSION="$(dsh --version)"
NORMALIZED_DSH_VERSION="${ACTUAL_DSH_VERSION%%+*}"
is_compatible_dsh_version() {
  local version="$1"
  local channel
  local sequence
  if [[ "$version" == "0.1.7" ]]; then return 0; fi
  if [[ "$version" =~ ^0\.1\.7-(alpha|beta|rc)\.(0|[1-9][0-9]*)$ ]]; then
    channel="${BASH_REMATCH[1]}"
    sequence="${BASH_REMATCH[2]}"
    if [[ "$channel" == "alpha" && "$sequence" -lt 1 ]]; then return 1; fi
    return 0
  fi
  return 1
}
if ! is_compatible_dsh_version "$NORMALIZED_DSH_VERSION"; then
  printf '错误: 支持的 DSH 范围为 %s，当前为 %s。\n' "$DSH_COMPATIBILITY_RANGE" "$ACTUAL_DSH_VERSION" >&2
  exit 1
fi
# （0.1.5 线时曾只认 0.1.5-alpha.1，而实际部署跑的是 0.1.5-rc.2，于是每次安装都打一条
#   "尚未列入逐版本验证清单"的假告警，削弱了这条警告的可信度；换线时必须同步两处。）
is_verified_dsh_version() {
  local version="$1"
  local verified
  for verified in $DSH_VERIFIED_VERSIONS; do
    [[ "$version" == "$verified" ]] && return 0
  done
  return 1
}
if ! is_verified_dsh_version "$NORMALIZED_DSH_VERSION"; then
  printf '警告: DSH %s 位于兼容发布线 %s 内，但尚未列入逐版本验证清单（%s）；运行时能力检查继续 fail closed。\n' \
    "$ACTUAL_DSH_VERSION" "$DSH_COMPATIBILITY_RANGE" "$DSH_VERIFIED_VERSIONS" >&2
fi

npm run publish:check --prefix "$PLUGIN_DIR"

# 走官方 profile manager 进入依赖与 bundle 顺序；该一次性 age 覆盖只影响本条
# pnpm 校验，不修改用户的持久配置。
dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR" --config.minimumReleaseAge=0

cat <<'EOF'
安装完成。需要注意:
  1. 这是新插件首次进入 profile 的 bundle 列表，必须重启 dsh web（在 Warp 里 Ctrl+C 后
     重新执行 dsh web --no-open），并刷新页面；仅改 patch 文件是不会重新读 bundle 列表的。
  2. 重启后打开 设置 → 额外上下文 编辑规则；文本写入 profile 配置里 dsh-extra-context 这一行的 config 段。
EOF
