#!/usr/bin/env node
'use strict'

/**
 * 图标快照的漂移检查。**DSH 升级后第一件事就是跑它**，用来回答两个问题：
 *
 *   1. 内置图标集与 `icons.json` 快照是否还对得上（新增/消失/改名/图形变化）？
 *   2. 工作区各插件从 `@deepseek-ai/dsh-client-ui-primitives` 取的名字，在当前 DSH 构建里
 *      是否真的存在？（require 到 undefined 会静默渲染成空白，是最难查的一类回归）
 *
 * 用法:
 *   node tools/dsh-icons/check.js
 *   node tools/dsh-icons/check.js --dsh /path/to/@deepseek-ai/dsh
 *
 * 退出码：0 = 无漂移；1 = 有漂移或快照缺失/过期（可直接当 CI/`npm run check` 用）。
 */

const fs = require('node:fs')
const path = require('node:path')

const {
  locateDshRoot,
  dshVersion,
  buildCatalog,
  WORKSPACE_ROOT,
  CATALOG_PATH,
  PREVIEW_PATH,
  TOOL_NAME
} = require('./build.js')

const log = (line) => console.log(`${TOOL_NAME}: ${line}`)
const problems = []
const notes = []

function main(argv) {
  const explicitIndex = argv.indexOf('--dsh')
  const root = locateDshRoot(explicitIndex === -1 ? undefined : argv[explicitIndex + 1])
  log(`DSH ${dshVersion(root)} @ ${root}`)

  if (!fs.existsSync(CATALOG_PATH)) {
    log(`没有快照 ${path.relative(WORKSPACE_ROOT, CATALOG_PATH)}，先跑 node tools/dsh-icons/build.js`)
    return 1
  }
  const snapshot = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))

  const current = buildCatalog(root, (line) => log(`  ${line}`))

  // ---- 1. 图标集本身 ----
  const before = new Map(snapshot.icons.map((icon) => [icon.name, icon]))
  const after = new Map(current.icons.map((icon) => [icon.name, icon]))
  const added = [...after.keys()].filter((name) => !before.has(name)).sort()
  const removed = [...before.keys()].filter((name) => !after.has(name)).sort()
  const changed = [...after.keys()]
    .filter((name) => before.has(name) && (before.get(name).svg !== after.get(name).svg || before.get(name).viewBox !== after.get(name).viewBox))
    .sort()

  if (added.length > 0) problems.push(`新增 ${added.length} 个图标：${added.join(', ')}`)
  if (removed.length > 0) problems.push(`消失 ${removed.length} 个图标：${removed.join(', ')}`)
  if (changed.length > 0) problems.push(`图形变化 ${changed.length} 个：${changed.join(', ')}`)
  if (snapshot.unrenderable.length > 0) problems.push(`快照里有 ${snapshot.unrenderable.length} 个图标未能渲染，需人工确认`)
  if (current.unrenderable.length > 0) problems.push(`当前构建有 ${current.unrenderable.length} 个图标未能渲染：${current.unrenderable.map((item) => item.name).join(', ')}`)
  for (const [key, detail] of Object.entries(current.sanity ?? {})) {
    if (detail.length > 0) {
      const preview = detail.slice(0, 3).join(', ')
      problems.push(`提取自检 ${key} 非空：${preview}${detail.length > 3 ? ` 等 ${detail.length} 个` : ''}（提取脚本可能坏了，先查 build.js 的属性名映射与求值逻辑）`)
    }
  }

  // ---- 2. 工作区插件的导入 ----
  for (const item of current.workspace.missingIconImports) {
    problems.push(`插件 ${item.plugin} require 了当前构建里不存在的图标 ${item.icon}（会渲染成空白）`)
  }
  for (const item of current.workspace.unknownMemberImports) {
    problems.push(`插件 ${item.plugin} require 了当前构建里不存在的模块成员 ${item.icon}`)
  }

  // ---- 3. 快照自身的新鲜度 ----
  if (snapshot.dsh.version !== current.dsh.version) {
    problems.push(`快照来自 dsh ${snapshot.dsh.version}，当前安装是 ${current.dsh.version}：请 review 上面差异后重新生成`)
  }
  if (snapshot.source.sha1 !== current.source.sha1) {
    notes.push(`前端产物哈希变了（${snapshot.source.sha1.slice(0, 12)} → ${current.source.sha1.slice(0, 12)}）：${current.source.asset}`)
  }
  // 预览页里内嵌着同一份快照，所以"预览页是否过期"必须真比一遍数据，
  // 不能只找某个字符串是否出现（那样内嵌 JSON 里永远能找到，检查等于恒真——踩过）。
  if (!fs.existsSync(PREVIEW_PATH)) {
    problems.push('缺 preview.html，跑 build.js 重新生成')
  } else {
    const html = fs.readFileSync(PREVIEW_PATH, 'utf8')
    const embedded = /const catalog = (\{.*?\})\n/u.exec(html)
    if (embedded === null) {
      problems.push('preview.html 里找不到内嵌的图标数据，跑 build.js 重新生成')
    } else {
      let previewCatalog = null
      try {
        previewCatalog = JSON.parse(embedded[1])
      } catch (error) {
        problems.push(`preview.html 内嵌数据无法解析：${error.message}`)
      }
      if (previewCatalog !== null) {
        const sameSource = previewCatalog.source.sha1 === snapshot.source.sha1 && previewCatalog.dsh.version === snapshot.dsh.version
        const sameIcons = previewCatalog.icons.length === snapshot.icons.length
        if (!sameSource || !sameIcons) {
          problems.push(`preview.html 与 icons.json 不同源（预览页过期：${previewCatalog.icons.length} vs ${snapshot.icons.length} 个图标），跑 build.js 重新生成`)
        }
      }
    }
    if (!html.includes(`sha1 <code>${snapshot.source.sha1.slice(0, 12)}`)) {
      problems.push('preview.html 顶部标注的来源哈希与快照不一致，跑 build.js 重新生成')
    }
  }

  for (const line of notes) log(line)
  if (problems.length === 0) {
    log(`无漂移：${current.counts.icons} 个图标，档位 ${JSON.stringify(current.counts.tiers)}，工作区插件导入全部存在`)
    return 0
  }
  log('发现漂移：')
  for (const line of problems) log(`  ✗ ${line}`)
  log('处理方式：node tools/dsh-icons/build.js 重新生成 → review icons.json / preview.html 的差异 → 一并提交')
  return 1
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`${TOOL_NAME}: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { main }
