// profile `cordis.patch.yml` 的写入事务。
//
// 本模块与 DSH 自带的插件管理器（`@deepseek-ai/dsh-plugin-manager`）共用同一套约定，
// 使两者的写入可以互相看见、互相收敛，而不是各自维护一份记账：
//
//   1. 行覆盖项是**顶层**、不带 `insert` 的 `- id: <loader 行 id>` 条目；启用写显式
//      `disabled: false` 而不是删除条目。官方 `writePluginEnabled` 用 `findLast` 命中
//      「最后一条 id 相同、且声明的模块名匹配」的条目后就地改 `disabled`，没有才追加。
//   2. 写入前对整个 profile 取写锁：锚点是 profile 的 `package.json`，与官方
//      `PluginManager.change()` 使用的是同一把跨进程文件锁（`<锚点>.lock`）。
//   3. 提交用 `writeFileAtomic`（随机后缀兄弟文件 + `wx` 独占创建 + rename），
//      读者因此不需要加锁。
//
// 官方实现见 `@deepseek-ai/dsh-plugin-manager` 的 `writePluginEnabled`；
// 这里的行覆盖语义必须与其保持一致，否则两套开关会互相回滚。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { YAMLSeq, isMap, isSeq, parseDocument } from 'yaml'

import { LocalPluginManagerError, errorMessage } from './errors.js'

export const PROFILE_PATCH_FILE = 'cordis.patch.yml'

// 写锁锚点：官方 plugin-manager 用 profile 的 package.json 作为整个 profile 的写锁，
// 所有 profile 文件改动（patch、package.json、pnpm-workspace.yaml）都在同一把锁内完成。
// 用同一个锚点才能与官方和 `dsh plugin` CLI 串行化。
const LOCK_ANCHOR_FILE = 'package.json'

// 与官方 `PluginManager` 的 `lockWaitMs` 默认值一致。
export const DEFAULT_LOCK_WAIT_MS = 120_000

// 官方写入 patch 时固定使用 0o600；沿用同一权限位，避免两边写入来回改变文件模式。
export const PROFILE_PATCH_MODE = 0o600

const EMPTY_PATCH = '[]\n'

const JS_TAG = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value) => value
}

/** 解析 profile / bundle patch 时使用的自定义标签：`!!js` 表达式按原样保留。 */
export const PATCH_CUSTOM_TAGS = Object.freeze([JS_TAG])

// 旧版本（0.1.5 及更早）把自己生成的覆盖项包在这对标记之间。标记本身只是注释，
// 因此迁移只需删掉标记行，区块内的条目原地保留为普通顶层覆盖项。
export const MANAGED_BEGIN = '# >>> dsh-local-plugin-manager (managed)'
export const MANAGED_END = '# <<< dsh-local-plugin-manager (managed)'
const MANAGED_HINT = '# Generated from .dsh-local-plugin-manager/state.json. Use the Settings UI to change it.'

function markerLine(text) {
  return new RegExp(`^[\\t ]*${text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[\\t ]*\\r?\\n?`, 'gmu')
}

/** 去掉旧版受管区块的标记行（含已失效的生成提示），保留区块内的条目与其他字节。 */
export function migrateManagedBlock(text) {
  if (!text.includes('dsh-local-plugin-manager (managed)')) return { text, migrated: false }
  const next = text
    .replace(markerLine(MANAGED_BEGIN), '')
    .replace(markerLine(MANAGED_END), '')
    .replace(markerLine(MANAGED_HINT), '')
  return { text: next, migrated: next !== text }
}

/** 读取 profile patch 文本；文件不存在时按官方语义返回空序列。 */
export async function readPatchText(profileDir, label = PROFILE_PATCH_FILE) {
  try {
    return await readFile(join(profileDir, PROFILE_PATCH_FILE), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return EMPTY_PATCH
    throw new LocalPluginManagerError('invalid-patch', `无法读取 ${label}：${errorMessage(error)}`, 500)
  }
}

/**
 * 把一批 loader 行的启停写进 patch 文本，返回新文本。
 *
 * 逐行复用官方的定位语义：只认顶层、不带 `insert`、`id` 相同且声明的模块名匹配的条目；
 * 命中就地改 `disabled`，没有则追加一条。目标值与现值相同时不动该行。
 */
export function nextPatchText(text, rows, enabled, label = PROFILE_PATCH_FILE) {
  let document
  try {
    document = parseDocument(text, { customTags: [JS_TAG] })
  } catch (error) {
    throw new LocalPluginManagerError('invalid-patch', `${label}不是有效的 Cordis patch：${errorMessage(error)}`, 409)
  }
  const parseError = document.errors[0]
  if (parseError !== undefined) {
    throw new LocalPluginManagerError('invalid-patch', `${label}不是有效的 Cordis patch：${parseError.message}`, 409)
  }
  // 只有注释或空文件等价于空序列，可以直接写入；写成别的形状（例如映射）就拒绝。
  if (document.contents === null) document.contents = new YAMLSeq()
  if (!isSeq(document.contents)) {
    throw new LocalPluginManagerError('invalid-patch', `${label}必须是顶层 YAML 数组。`, 409)
  }

  let changed = false
  for (const row of rows) {
    const items = document.contents.items
    const index = items.findLastIndex((item, position) => {
      if (!isMap(item)) return false
      if (document.getIn([position, 'id']) !== row.id) return false
      if (item.has('insert')) return false
      const declared = document.getIn([position, 'name'])
      return !declared || declared === row.name
    })
    if (index >= 0) {
      if (document.getIn([index, 'disabled']) === !enabled) continue
      document.setIn([index, 'disabled'], !enabled)
      changed = true
      continue
    }
    document.add({ id: row.id, disabled: !enabled })
    changed = true
  }
  return { text: changed ? String(document) : text, changed }
}

/** 原子提交 patch 文本。 */
export async function writePatchText(profileDir, text) {
  await writeFileAtomic(join(profileDir, PROFILE_PATCH_FILE), text, { mode: PROFILE_PATCH_MODE })
}

/**
 * 删除已卸载插件遗留的行覆盖项。
 *
 * 卸载成功时写入的 `disabled: true` 要保留到当前进程结束（bundle 层在启动时已冻结，
 * 这些行仍在 loader 树里）；下一个进程确认包已不在 manifest 后才清理，避免插件将来被
 * 重新安装时被这条陈旧覆盖项继续禁用。只处理「顶层、不带 insert、id 相同」的条目，
 * 且条目除 id 与 disabled 之外还有别的字段时只删除 disabled，不丢弃用户的配置。
 */
export function pruneRowOverrides(text, rowIds, label = PROFILE_PATCH_FILE) {
  if (rowIds.length === 0) return { text, changed: false }
  let document
  try {
    document = parseDocument(text, { customTags: [JS_TAG] })
  } catch (error) {
    throw new LocalPluginManagerError('invalid-patch', `${label}不是有效的 Cordis patch：${errorMessage(error)}`, 409)
  }
  const parseError = document.errors[0]
  if (parseError !== undefined) {
    throw new LocalPluginManagerError('invalid-patch', `${label}不是有效的 Cordis patch：${parseError.message}`, 409)
  }
  if (!isSeq(document.contents)) return { text, changed: false }

  let changed = false
  for (const rowId of rowIds) {
    const items = document.contents.items
    const index = items.findLastIndex((item, position) => {
      if (!isMap(item)) return false
      if (document.getIn([position, 'id']) !== rowId) return false
      return !item.has('insert')
    })
    if (index < 0) continue
    // 只承载 id + disabled 的条目整条删掉；条目还带着别的字段（例如用户自己配的 name 或
    // config）时只摘掉 disabled，绝不丢弃用户的配置，也不会留下 `- id: x` 这种空壳条目。
    const keys = items[index].items.map((pair) => pair.key?.value ?? pair.key)
    if (keys.every((key) => key === 'id' || key === 'disabled')) document.deleteIn([index])
    else document.deleteIn([index, 'disabled'])
    changed = true
  }
  return { text: changed ? String(document) : text, changed }
}

/**
 * 在 profile 写锁内完成「读—改—提交」，与官方 plugin-manager 和 `dsh plugin` 串行化。
 * 锁只在写入窗口内持有，读路径保持无锁。
 */
export async function withProfileWriteLock(profileDir, operation, options = {}) {
  const waitMs = Number.isSafeInteger(options.waitMs) && options.waitMs >= 0 ? options.waitMs : DEFAULT_LOCK_WAIT_MS
  return withFileLock(join(profileDir, LOCK_ANCHOR_FILE), operation, { waitMs })
}
