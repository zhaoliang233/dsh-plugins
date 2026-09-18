import { spawn } from 'node:child_process'
import { readFile, realpath, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'

import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parse } from 'yaml'

import { LocalPluginManagerError, errorMessage } from './errors.js'
import {
  DEFAULT_LOCK_WAIT_MS,
  MANAGED_BEGIN,
  MANAGED_END,
  PATCH_CUSTOM_TAGS,
  migrateManagedBlock,
  nextPatchText,
  pruneRowOverrides,
  readPatchText,
  withProfileWriteLock,
  writePatchText
} from './patch-writer.js'

export { LocalPluginManagerError } from './errors.js'
export { MANAGED_BEGIN, MANAGED_END } from './patch-writer.js'

export const PLUGIN_NAME = 'dsh-local-plugin-manager'
export const DSH_COMPATIBILITY_RANGE = '>=0.1.6-alpha.1 <0.1.7'
export const VERIFIED_DSH_VERSIONS = Object.freeze(['0.1.6-alpha.2'])
export const DEFAULT_PROFILE = 'web'

// state.json v1 记录 `disabled` 包名列表并把它投影成受管区块；v2 起禁用状态的真源是
// profile patch 的覆盖项本身，state.json 只保留卸载墓碑。
const STATE_VERSION = 2
const LEGACY_STATE_VERSION = 1
export const MAX_DESCRIPTION_LENGTH = 200
const MAX_COMMAND_OUTPUT = 32 * 1024
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000
const DEFAULT_FORCE_KILL_MS = 5_000
const DEFAULT_PROCESS_MARKER = `${process.pid}:${performance.timeOrigin}`
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u
const ROW_ID_RE = /^[A-Za-z0-9@/_.:-]+$/u

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function uniqueStrings(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

// package.json#description is the single source for the list copy, but the plugin author
// owns its shape: collapse it to one bounded line so the DTO stays display-ready and the
// client never receives control characters, newlines, or an empty string.
export function normalizeDescription(value) {
  if (typeof value !== 'string') return undefined
  const text = value
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (text === '') return undefined
  return text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…` : text
}

export function classifyDshVersion(version) {
  if (typeof version !== 'string') return { supported: false, verified: false }
  const normalized = version.split('+', 1)[0]
  const verified = VERIFIED_DSH_VERSIONS.includes(normalized)
  if (normalized === '0.1.6') return { supported: true, verified, normalized }

  const prerelease = /^0\.1\.6-(alpha|beta|rc)\.(0|[1-9]\d*)$/u.exec(normalized)
  if (prerelease === null) return { supported: false, verified: false, normalized }
  const [, channel, sequenceText] = prerelease
  const supported = channel !== 'alpha' || Number(sequenceText) >= 1
  return { supported, verified: supported && verified, normalized }
}

export function resolveDshHome(env = process.env, home = homedir()) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return resolve(configured || join(home, '.dsh'))
}

export function resolveProfileDir(dshHome, profile = DEFAULT_PROFILE) {
  if (profile === '' || profile === '.' || profile === '..' || profile === 'node_modules' || /[\\/\0]/u.test(profile)) {
    throw new LocalPluginManagerError('invalid-profile', `无效的 DSH profile：${JSON.stringify(profile)}`)
  }
  return join(dshHome, 'profiles', profile)
}

async function readJsonFile(path, label) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new LocalPluginManagerError('read-failed', `无法读取${label}：${errorMessage(error)}`, 500)
  }
  try {
    const value = JSON.parse(text)
    if (!isRecord(value)) throw new Error('根节点不是对象')
    return { text, value }
  } catch (error) {
    throw new LocalPluginManagerError('invalid-json', `${label}不是有效 JSON：${errorMessage(error)}`, 500)
  }
}

async function readOptionalText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function parseEntryList(text, label, allowCommentOnly = false) {
  let value
  try {
    value = parse(text, { customTags: PATCH_CUSTOM_TAGS })
  } catch (error) {
    throw new LocalPluginManagerError('invalid-patch', `${label}不是有效的 Cordis patch：${errorMessage(error)}`, 409)
  }
  if ((value === undefined || value === null) && allowCommentOnly) return []
  if (!Array.isArray(value)) {
    throw new LocalPluginManagerError('invalid-patch', `${label}必须是顶层 YAML 数组。`, 409)
  }
  for (const row of value) {
    if (!isRecord(row)) {
      throw new LocalPluginManagerError('invalid-patch', `${label}包含非对象 patch 条目。`, 409)
    }
  }
  return value
}

function patchDisabledValues(rows) {
  const values = new Map()
  for (const row of rows) {
    if (typeof row.id === 'string' && typeof row.disabled === 'boolean') {
      values.set(row.id, row.disabled)
    }
  }
  return values
}

function packageRoot(specifier) {
  if (typeof specifier !== 'string' || specifier === '' || specifier.startsWith('.') || isAbsolute(specifier)) return undefined
  if (/^[a-z][a-z\d+.-]*:/iu.test(specifier)) return undefined
  const segments = specifier.split('/')
  if (specifier.startsWith('@')) {
    if (segments.length < 2 || segments[0].length < 2 || segments[1] === '') return undefined
    return `${segments[0]}/${segments[1]}`
  }
  return segments[0] || undefined
}

function collectInsertedPackageReferences(rows) {
  const references = new Map()
  const visitEntries = (entries) => {
    if (!Array.isArray(entries)) return
    for (const entry of entries) {
      if (!isRecord(entry)) continue
      const root = packageRoot(entry.name)
      if (root !== undefined) {
        const values = references.get(root) ?? []
        values.push(typeof entry.id === 'string' ? entry.id : entry.name)
        references.set(root, values)
      }
      if (Array.isArray(entry.config)) visitEntries(entry.config)
    }
  }
  for (const row of rows) visitEntries(row.insert)
  return references
}

// 每个 bundle patch 声明行都保留 `{ id, name }`：写覆盖项时要按官方语义同时核对
// loader 行 id 与该行声明的模块名，避免命中同名 id 的无关条目。
function analyzeBundlePatch(rows) {
  const declared = new Map()
  const problems = []
  for (const patch of rows) {
    const keys = Object.keys(patch)
    if (!Array.isArray(patch.insert)) {
      problems.push('bundle patch 会改写既有条目，无法只通过禁用自有行来完整停用')
      continue
    }
    if (keys.some((key) => key !== 'id' && key !== 'insert')) {
      problems.push('bundle patch 同时包含 insert 之外的覆盖字段')
    }
    for (const entry of patch.insert) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !ROW_ID_RE.test(entry.id)) {
        problems.push('bundle patch 包含缺少稳定 id 的插入条目')
        continue
      }
      if (entry.disabled === true) problems.push(`插入条目 ${entry.id} 默认处于禁用状态`)
      if (!declared.has(entry.id)) {
        declared.set(entry.id, {
          id: entry.id,
          name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : undefined
        })
      }
    }
  }
  const records = [...declared.values()].sort((left, right) => left.id.localeCompare(right.id))
  if (records.length === 0) problems.push('bundle patch 没有可管理的插入条目')
  return {
    rows: records,
    rowIds: records.map((record) => record.id),
    manageable: problems.length === 0,
    reason: problems.length === 0 ? undefined : uniqueStrings(problems).join('；')
  }
}

function withinDirectory(root, candidate) {
  const delta = relative(root, candidate)
  return delta === '' || (!delta.startsWith(`..${sep}`) && delta !== '..' && !isAbsolute(delta))
}

async function inspectLocalPackage(profileDir, name, spec, profileBundles) {
  const target = spec.slice('link:'.length)
  const lexicalPath = resolve(profileDir, target)
  let sourcePath
  try {
    sourcePath = await realpath(lexicalPath)
  } catch (error) {
    return {
      name,
      spec,
      path: lexicalPath,
      version: undefined,
      description: undefined,
      hasClient: false,
      rowIds: [],
      rows: [],
      manageable: false,
      reason: `本地链接目标不可用：${errorMessage(error)}`,
      inBundleStack: profileBundles.has(name)
    }
  }

  let packageFile
  try {
    packageFile = await readJsonFile(join(sourcePath, 'package.json'), `${name} 的 package.json`)
  } catch (error) {
    return {
      name,
      spec,
      path: sourcePath,
      version: undefined,
      description: undefined,
      hasClient: false,
      rowIds: [],
      rows: [],
      manageable: false,
      reason: errorMessage(error),
      inBundleStack: profileBundles.has(name)
    }
  }

  const manifest = packageFile.value
  const description = normalizeDescription(manifest.description)
  const declaredPatch = manifest.dsh?.bundle?.patch
  const hasClient = isRecord(manifest.dsh?.client)
  if (manifest.name !== name) {
    return {
      name,
      spec,
      path: sourcePath,
      version: typeof manifest.version === 'string' ? manifest.version : undefined,
      description,
      hasClient,
      rowIds: [],
      rows: [],
      manageable: false,
      reason: `依赖名与本地 package.json#name 不一致（${String(manifest.name)}）`,
      inBundleStack: profileBundles.has(name)
    }
  }
  if (typeof declaredPatch !== 'string' || declaredPatch === '') return undefined

  const patchPath = resolve(sourcePath, declaredPatch)
  if (!withinDirectory(sourcePath, patchPath)) {
    return {
      name,
      spec,
      path: sourcePath,
      version: typeof manifest.version === 'string' ? manifest.version : undefined,
      description,
      hasClient,
      rowIds: [],
      rows: [],
      manageable: false,
      reason: 'dsh.bundle.patch 指向插件目录之外，管理器拒绝读取',
      inBundleStack: profileBundles.has(name)
    }
  }

  let analysis
  try {
    const canonicalPatchPath = await realpath(patchPath)
    if (!withinDirectory(sourcePath, canonicalPatchPath)) {
      throw new LocalPluginManagerError('unsafe-patch-path', 'dsh.bundle.patch 经符号链接指向插件目录之外。', 409)
    }
    const patchText = await readFile(canonicalPatchPath, 'utf8')
    analysis = analyzeBundlePatch(parseEntryList(patchText, `${name} 的 bundle patch`))
  } catch (error) {
    analysis = { rowIds: [], rows: [], manageable: false, reason: errorMessage(error) }
  }
  if (!profileBundles.has(name)) {
    analysis = {
      ...analysis,
      manageable: false,
      reason: '本地依赖未加入 dsh.profile.bundles；请重新运行该插件的 install.sh'
    }
  }

  return {
    name,
    spec,
    path: sourcePath,
    version: typeof manifest.version === 'string' ? manifest.version : undefined,
    description,
    hasClient,
    rowIds: analysis.rowIds,
    rows: analysis.rows,
    manageable: analysis.manageable,
    reason: analysis.reason,
    inBundleStack: profileBundles.has(name)
  }
}

function defaultState() {
  return { version: STATE_VERSION, legacyDisabled: [], pendingRemovals: [] }
}

// v1 的 `disabled` 包名列表不再参与状态推导：禁用状态现在就存在 profile patch 的覆盖项里。
// 读到的旧列表只作为一次性迁移输入返回（见 LocalPluginProfile#migrateState）。
function validateState(value, label) {
  if (!isRecord(value) || !Array.isArray(value.pendingRemovals)) {
    throw new LocalPluginManagerError('invalid-state', `${label}格式不受支持，管理器不会自动覆盖。`, 409)
  }
  let legacyDisabled = []
  if (value.version === LEGACY_STATE_VERSION) {
    if (!Array.isArray(value.disabled)) {
      throw new LocalPluginManagerError('invalid-state', `${label}格式不受支持，管理器不会自动覆盖。`, 409)
    }
    legacyDisabled = uniqueStrings(value.disabled.filter((name) => typeof name === 'string' && PACKAGE_NAME_RE.test(name)))
    if (legacyDisabled.length !== value.disabled.length) {
      throw new LocalPluginManagerError('invalid-state', `${label}包含无效的 disabled 包名。`, 409)
    }
  } else if (value.version !== STATE_VERSION) {
    throw new LocalPluginManagerError('invalid-state', `${label}格式不受支持，管理器不会自动覆盖。`, 409)
  }
  const pendingRemovals = []
  for (const item of value.pendingRemovals) {
    if (
      !isRecord(item)
      || typeof item.name !== 'string'
      || !PACKAGE_NAME_RE.test(item.name)
      || !Array.isArray(item.rowIds)
      || typeof item.processMarker !== 'string'
      || item.processMarker.length === 0
      || item.processMarker.length > 200
    ) {
      throw new LocalPluginManagerError('invalid-state', `${label}包含无效的 pendingRemovals 条目。`, 409)
    }
    const rowIds = uniqueStrings(item.rowIds.filter((id) => typeof id === 'string' && ROW_ID_RE.test(id)))
    if (rowIds.length !== item.rowIds.length) {
      throw new LocalPluginManagerError('invalid-state', `${label}包含无效的 loader 行 id。`, 409)
    }
    pendingRemovals.push({ name: item.name, rowIds, processMarker: item.processMarker })
  }
  return { version: STATE_VERSION, legacyDisabled, pendingRemovals }
}

function cloneState(state) {
  return {
    version: STATE_VERSION,
    legacyDisabled: [],
    pendingRemovals: state.pendingRemovals.map((item) => ({
      name: item.name,
      rowIds: [...item.rowIds],
      processMarker: item.processMarker
    }))
  }
}

function stateText(state) {
  return `${JSON.stringify({
    version: STATE_VERSION,
    pendingRemovals: [...state.pendingRemovals]
      .map((item) => ({
        name: item.name,
        rowIds: uniqueStrings(item.rowIds),
        processMarker: item.processMarker
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, null, 2)}\n`
}

// 提交统一走官方的 writeFileAtomic（随机后缀兄弟文件 + `wx` 独占创建 + rename），
// 已存在的文件保留它当前的权限位。
async function atomicWriteText(path, text, defaultMode = 0o600) {
  let mode = defaultMode
  try {
    mode = (await stat(path)).mode & 0o777
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await writeFileAtomic(path, text, { mode })
}

// 禁用状态完全由 profile patch 的覆盖项决定（home 级 patch 优先），不再有第二份记账。
function boolForRows(rowIds, profileValues, homeValues) {
  const values = rowIds.map((rowId) => {
    if (homeValues.has(rowId)) return homeValues.get(rowId)
    return profileValues.get(rowId) ?? false
  })
  const disabledCount = values.filter(Boolean).length
  if (disabledCount === 0) return 'enabled'
  if (disabledCount === values.length) return 'disabled'
  return 'partial'
}

function publicPlugin(plugin, snapshot) {
  const status = boolForRows(plugin.rowIds, snapshot.profileDisabled, snapshot.homeDisabled)
  // home 级 patch 的优先级高于 profile patch，因此只有它会挡住写入口：
  // profile patch 里的覆盖项（无论由本管理器、官方插件页还是用户手写）都可以就地改写。
  const homeKeepsDisabled = plugin.rowIds.some((rowId) => snapshot.homeDisabled.get(rowId) === true)
  const homeForcesEnabled = plugin.rowIds.some((rowId) => snapshot.homeDisabled.get(rowId) === false)
  return {
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    path: plugin.path,
    enabled: status === 'enabled',
    status,
    hasClient: plugin.hasClient,
    manageable: plugin.manageable,
    reason: plugin.reason,
    self: plugin.name === PLUGIN_NAME,
    externalControl: homeKeepsDisabled || homeForcesEnabled,
    rowIds: plugin.rowIds,
    canEnable: plugin.manageable && plugin.name !== PLUGIN_NAME && !homeKeepsDisabled,
    canDisable: plugin.manageable && plugin.name !== PLUGIN_NAME && !homeForcesEnabled,
    canUninstall: plugin.manageable && plugin.name !== PLUGIN_NAME && (snapshot.patchReferences.get(plugin.name)?.length ?? 0) === 0,
    uninstallBlockedBy: snapshot.patchReferences.get(plugin.name) ?? []
  }
}

async function locateDshPackage(cliPath) {
  const resolvedCli = await realpath(cliPath)
  let directory = dirname(resolvedCli)
  for (let depth = 0; depth < 5; depth += 1) {
    const packagePath = join(directory, 'package.json')
    try {
      const { value } = await readJsonFile(packagePath, '@deepseek-ai/dsh package.json')
      if (value.name === '@deepseek-ai/dsh') {
        return { cliPath: resolvedCli, packageDir: directory, version: value.version }
      }
    } catch (error) {
      if (!(error instanceof LocalPluginManagerError) || !error.message.includes('ENOENT')) throw error
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new LocalPluginManagerError('runtime-not-found', '无法从当前进程定位 @deepseek-ai/dsh。', 501)
}

export async function resolveCurrentDshRuntime(cliPath = process.argv[1]) {
  if (typeof cliPath !== 'string' || cliPath === '') {
    throw new LocalPluginManagerError('runtime-not-found', '当前进程没有可用的 DSH CLI 路径。', 501)
  }
  const runtime = await locateDshPackage(cliPath)
  const compatibility = classifyDshVersion(runtime.version)
  return {
    ...runtime,
    ...compatibility,
    compatibilityRange: DSH_COMPATIBILITY_RANGE,
    unsupportedReason: compatibility.supported
      ? undefined
      : `本插件支持 DSH ${DSH_COMPATIBILITY_RANGE}，实际运行版本为 ${String(runtime.version)}。`
  }
}

function cappedAppend(previous, chunk) {
  const next = previous + String(chunk)
  return next.length <= MAX_COMMAND_OUTPUT ? next : next.slice(-MAX_COMMAND_OUTPUT)
}

export function runDshPluginRemove(runtime, profile, name, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  const forceKillAfterMs = options.forceKillAfterMs ?? DEFAULT_FORCE_KILL_MS
  return new Promise((resolvePromise) => {
    const args = [runtime.cliPath, 'plugin', '--profile', profile, 'remove', name, '--config.minimumReleaseAge=0']
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer
    let forceKillTimer
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceKillTimer)
      resolvePromise({ ...result, stdout, stderr, timedOut })
    }
    child.stdout.on('data', (chunk) => { stdout = cappedAppend(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = cappedAppend(stderr, chunk) })
    child.on('error', (error) => finish({ exitCode: null, error: errorMessage(error) }))
    child.on('close', (code, signal) => finish({ exitCode: code, signal }))
    timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => { child.kill('SIGKILL') }, forceKillAfterMs)
    }, timeoutMs)
  })
}

export class LocalPluginProfile {
  constructor(options) {
    this.profile = options.profile ?? DEFAULT_PROFILE
    this.dshHome = options.dshHome ?? resolveDshHome()
    this.profileDir = options.profileDir ?? resolveProfileDir(this.dshHome, this.profile)
    this.patchPath = join(this.profileDir, 'cordis.patch.yml')
    this.homePatchPath = join(this.dshHome, 'cordis.patch.yml')
    this.statePath = join(this.profileDir, '.dsh-local-plugin-manager', 'state.json')
    this.runtime = options.runtime
    this.commandRunner = options.commandRunner ?? runDshPluginRemove
    this.onLiveState = options.onLiveState ?? (async () => ({ applied: false }))
    this.processMarker = options.processMarker ?? DEFAULT_PROCESS_MARKER
    // 与官方 plugin-manager 的 `lockWaitMs` 对齐：等待 profile 写锁的最长毫秒数。
    this.lockWaitMs = Number.isSafeInteger(options.lockWaitMs) && options.lockWaitMs >= 0 ? options.lockWaitMs : DEFAULT_LOCK_WAIT_MS
    this.busy = false
  }

  async readState() {
    const text = await readOptionalText(this.statePath)
    if (text === undefined) return { text: undefined, value: defaultState() }
    let value
    try {
      value = JSON.parse(text)
    } catch (error) {
      throw new LocalPluginManagerError('invalid-state', `本地插件管理状态不是有效 JSON：${errorMessage(error)}`, 409)
    }
    return { text, value: validateState(value, this.statePath) }
  }

  async snapshot() {
    const manifestFile = await readJsonFile(join(this.profileDir, 'package.json'), 'profile package.json')
    const manifest = manifestFile.value
    const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {}
    const bundleValues = manifest.dsh?.profile?.bundles
    if (!Array.isArray(bundleValues) || !bundleValues.every((value) => typeof value === 'string')) {
      throw new LocalPluginManagerError('invalid-profile', 'profile package.json 缺少有效的 dsh.profile.bundles。', 500)
    }
    const profileBundles = new Set(bundleValues)
    const plugins = []
    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec !== 'string' || !spec.startsWith('link:') || !PACKAGE_NAME_RE.test(name) || !profileBundles.has(name)) continue
      const plugin = await inspectLocalPackage(this.profileDir, name, spec, profileBundles)
      if (plugin !== undefined) plugins.push(plugin)
    }
    plugins.sort((left, right) => left.name.localeCompare(right.name))

    const patchText = await readPatchText(this.profileDir, this.patchPath)
    const profileRows = parseEntryList(patchText, this.patchPath, true)
    const homePatchText = await readOptionalText(this.homePatchPath)
    const homeRows = homePatchText === undefined ? [] : parseEntryList(homePatchText, this.homePatchPath)
    const stateFile = await this.readState()
    const references = collectInsertedPackageReferences([...profileRows, ...homeRows])

    return {
      manifest,
      manifestText: manifestFile.text,
      dependencies,
      profileBundles,
      plugins,
      patchText,
      profileRows,
      homeRows,
      homePatchText,
      state: stateFile.value,
      stateText: stateFile.text,
      profileDisabled: patchDisabledValues(profileRows),
      homeDisabled: patchDisabledValues(homeRows),
      patchReferences: references
    }
  }

  /** 只写 state.json（卸载墓碑）。禁用状态不在这里，它由 profile patch 的覆盖项表达。 */
  async writeState(nextState) {
    const normalized = validateState({ version: STATE_VERSION, pendingRemovals: nextState.pendingRemovals }, '待写入的本地插件管理状态')
    const nextStateText = stateText(normalized)
    const previousText = await readOptionalText(this.statePath)
    if (nextStateText === previousText) return { changed: false, previousText }
    try {
      await atomicWriteText(this.statePath, nextStateText, 0o600)
    } catch (error) {
      throw new LocalPluginManagerError('write-failed', `写入本地插件管理状态失败：${errorMessage(error)}`, 500)
    }
    return { changed: true, previousText }
  }

  /**
   * 在 profile 写锁内把一组 loader 行的启停写进 profile patch。
   * 锁锚点与行覆盖语义都与官方 plugin-manager 一致，见 lib/patch-writer.js。
   */
  async applyRows(rows, enabled) {
    return withProfileWriteLock(this.profileDir, async () => {
      const current = await readPatchText(this.profileDir, this.patchPath)
      const migrated = migrateManagedBlock(current)
      const next = nextPatchText(migrated.text, rows, enabled, this.patchPath)
      if (!next.changed && !migrated.migrated) return { changed: false }
      await writePatchText(this.profileDir, next.text)
      return { changed: true, text: next.text }
    }, { waitMs: this.lockWaitMs })
  }

  /** 删除已卸载插件遗留的行覆盖项（只在下一个进程确认卸载完成后调用）。 */
  async pruneRows(rowIds) {
    if (rowIds.length === 0) return { changed: false }
    return withProfileWriteLock(this.profileDir, async () => {
      const current = await readPatchText(this.profileDir, this.patchPath)
      const next = pruneRowOverrides(current, rowIds, this.patchPath)
      if (!next.changed) return { changed: false }
      await writePatchText(this.profileDir, next.text)
      return { changed: true }
    }, { waitMs: this.lockWaitMs })
  }

  /** 把 patch 恢复成给定文本（卸载失败回滚）。 */
  async restorePatch(text) {
    return withProfileWriteLock(this.profileDir, async () => {
      const current = await readPatchText(this.profileDir, this.patchPath)
      if (current === text) return { changed: false }
      await writePatchText(this.profileDir, text)
      return { changed: true }
    }, { waitMs: this.lockWaitMs })
  }

  async initialize() {
    const snapshot = await this.snapshot()
    const installed = new Map(snapshot.plugins.map((plugin) => [plugin.name, plugin]))

    // 一次性迁移：删掉旧版受管区块的标记行，区块内的条目原地成为普通覆盖项。
    // v1 state 记录的禁用项此时已经在这些条目里；只有被手工删掉时才需要补写。
    const disableRows = []
    for (const name of snapshot.state.legacyDisabled) {
      if (name === PLUGIN_NAME) continue
      const plugin = installed.get(name)
      if (plugin?.manageable === true) disableRows.push(...plugin.rows)
    }

    const pending = []
    const pruneRowIds = []
    for (const item of snapshot.state.pendingRemovals) {
      const plugin = installed.get(item.name)
      if (plugin !== undefined) {
        // 卸载未完成，或插件已被重新安装：保持禁用，并保留墓碑交给下一次启动判断。
        pending.push(item)
        if (plugin.manageable) disableRows.push(...plugin.rows)
        continue
      }
      if (item.processMarker === this.processMarker) {
        // 同一进程：bundle 层在启动时已冻结，这些行仍在 loader 树里，覆盖项要继续保留。
        pending.push(item)
        disableRows.push(...item.rowIds.map((id) => ({ id })))
        continue
      }
      // 新进程确认包已不在 manifest：清掉陈旧覆盖项，避免将来重装时被继续禁用。
      pruneRowIds.push(...item.rowIds)
    }

    const needsMigration = snapshot.patchText.includes(MANAGED_BEGIN) || snapshot.patchText.includes(MANAGED_END)
    if (needsMigration || disableRows.length > 0) await this.applyRows(disableRows, false)
    if (pruneRowIds.length > 0) await this.pruneRows(uniqueStrings(pruneRowIds))
    await this.writeState({ pendingRemovals: pending })
  }

  async list() {
    const snapshot = await this.snapshot()
    return {
      profile: this.profile,
      busy: this.busy,
      plugins: snapshot.plugins.map((plugin) => publicPlugin(plugin, snapshot))
    }
  }

  async exclusive(operation) {
    if (this.busy) {
      throw new LocalPluginManagerError('busy', '另一个本地插件操作仍在进行，请稍后重试。', 409)
    }
    this.busy = true
    try {
      return await operation()
    } finally {
      this.busy = false
    }
  }

  async setEnabled(name, enabled) {
    return this.exclusive(async () => {
      const snapshot = await this.snapshot()
      const plugin = snapshot.plugins.find((item) => item.name === name)
      if (plugin === undefined) throw new LocalPluginManagerError('not-installed', '该本地插件未安装在当前 profile。', 404)
      const current = publicPlugin(plugin, snapshot)
      if (current.self) throw new LocalPluginManagerError('self-protected', '管理器不能从自己的页面停用；请使用命令行卸载。', 403)
      if (!plugin.manageable) throw new LocalPluginManagerError('not-manageable', plugin.reason || '该插件不能安全启停。', 409)
      if (enabled && !current.canEnable) {
        throw new LocalPluginManagerError('externally-disabled', 'home 级用户 patch 强制禁用了该插件；管理器不会写入一个无效开关。', 409)
      }
      if (!enabled && !current.canDisable) {
        throw new LocalPluginManagerError('externally-enabled', 'home 级用户 patch 强制启用了该插件；管理器不会写入一个无效开关。', 409)
      }

      if (enabled) {
        const pending = snapshot.state.pendingRemovals.filter((item) => item.name !== name)
        if (pending.length !== snapshot.state.pendingRemovals.length) {
          await this.writeState({ pendingRemovals: pending })
        }
      }
      // 只写行覆盖项：官方插件页与设置页读的是同一批顶层覆盖项，因此两边永远一致。
      await this.applyRows(plugin.rows, enabled)

      let live = { applied: false }
      let liveError
      try {
        live = await this.onLiveState(plugin, !enabled)
      } catch (error) {
        liveError = errorMessage(error)
      }
      return {
        ok: true,
        name,
        enabled,
        refresh: plugin.hasClient,
        restart: live.applied !== true,
        liveError,
        snapshot: await this.list()
      }
    })
  }

  async repairRemovedBundle(name) {
    return withProfileWriteLock(this.profileDir, async () => {
      const path = join(this.profileDir, 'package.json')
      const { value: manifest } = await readJsonFile(path, 'profile package.json')
      const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {}
      const bundles = manifest.dsh?.profile?.bundles
      if (dependencies[name] !== undefined || !Array.isArray(bundles) || !bundles.includes(name)) return false
      manifest.dsh.profile.bundles = bundles.filter((bundle) => bundle !== name)
      await atomicWriteText(path, `${JSON.stringify(manifest, null, 2)}\n`, 0o644)
      return true
    }, { waitMs: this.lockWaitMs })
  }

  async uninstall(name) {
    return this.exclusive(async () => {
      const before = await this.snapshot()
      const plugin = before.plugins.find((item) => item.name === name)
      if (plugin === undefined) throw new LocalPluginManagerError('not-installed', '该本地插件未安装在当前 profile。', 404)
      const current = publicPlugin(plugin, before)
      if (current.self) throw new LocalPluginManagerError('self-protected', '管理器不能卸载自己；请使用 uninstall.sh。', 403)
      if (!plugin.manageable) throw new LocalPluginManagerError('not-manageable', plugin.reason || '该插件不能安全卸载。', 409)
      if (current.uninstallBlockedBy.length > 0) {
        throw new LocalPluginManagerError(
          'user-patch-reference',
          `用户 patch 仍通过 insert 引用该包（${current.uninstallBlockedBy.join('、')}）；请先移除引用。`,
          409
        )
      }

      // 先写行覆盖项（卸载期间保持停用）并请求热停；失败时把 patch 恢复成操作前的文本。
      const previousPatchText = before.patchText
      await this.applyRows(plugin.rows, false)
      await this.onLiveState(plugin, true).catch(() => undefined)

      let command
      try {
        command = await this.commandRunner(this.runtime, this.profile, name, { cwd: this.profileDir })
      } catch (error) {
        await this.restorePatch(previousPatchText).catch(() => undefined)
        await this.onLiveState(plugin, !current.enabled).catch(() => undefined)
        throw new LocalPluginManagerError('uninstall-failed', `无法启动卸载命令：${errorMessage(error)}`, 502)
      }
      let afterCommand = await this.snapshot()
      let removed = afterCommand.dependencies[name] === undefined && !afterCommand.profileBundles.has(name)
      let reconciled = false
      if (!removed && afterCommand.dependencies[name] === undefined && afterCommand.profileBundles.has(name)) {
        reconciled = await this.repairRemovedBundle(name)
        afterCommand = await this.snapshot()
        removed = afterCommand.dependencies[name] === undefined && !afterCommand.profileBundles.has(name)
      }

      if (!removed) {
        await this.restorePatch(previousPatchText).catch(() => undefined)
        await this.onLiveState(plugin, !current.enabled).catch(() => undefined)
        const detail = command.timedOut
          ? '卸载命令超时。'
          : (command.stderr.trim() || command.error || `卸载命令退出码 ${String(command.exitCode)}`)
        throw new LocalPluginManagerError('uninstall-failed', detail, 502, {
          exitCode: command.exitCode,
          timedOut: command.timedOut
        })
      }

      // 墓碑：当前进程要继续保留覆盖项（bundle 层在启动时已冻结），下一个进程再清理。
      const finalized = cloneState(afterCommand.state)
      finalized.pendingRemovals = [
        ...finalized.pendingRemovals.filter((item) => item.name !== name),
        { name, rowIds: plugin.rowIds, processMarker: this.processMarker }
      ]
      await this.writeState(finalized)

      return {
        ok: true,
        name,
        refresh: plugin.hasClient,
        restart: true,
        reconciled,
        snapshot: await this.list()
      }
    })
  }
}
