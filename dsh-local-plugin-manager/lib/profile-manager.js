import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'

import { JSON_SCHEMA, Type, load } from 'js-yaml'

export const PLUGIN_NAME = 'dsh-local-plugin-manager'
export const DSH_COMPATIBILITY_RANGE = '>=0.1.6-alpha.1 <0.1.7'
export const VERIFIED_DSH_VERSIONS = Object.freeze(['0.1.6-alpha.1'])
export const DEFAULT_PROFILE = 'web'
export const MANAGED_BEGIN = '# >>> dsh-local-plugin-manager (managed)'
export const MANAGED_END = '# <<< dsh-local-plugin-manager (managed)'

const STATE_VERSION = 1
export const MAX_DESCRIPTION_LENGTH = 200
const MAX_COMMAND_OUTPUT = 32 * 1024
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000
const DEFAULT_FORCE_KILL_MS = 5_000
const DEFAULT_PROCESS_MARKER = `${process.pid}:${performance.timeOrigin}`
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u
const ROW_ID_RE = /^[A-Za-z0-9@/_.:-]+$/u

const JsExpr = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (value) => typeof value === 'string',
  construct: (value) => ({ __jsExpr: String(value) })
})
const ENTRY_SCHEMA = JSON_SCHEMA.extend(JsExpr)

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function uniqueStrings(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
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

export class LocalPluginManagerError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message)
    this.name = 'LocalPluginManagerError'
    this.code = code
    this.status = status
    this.details = details
  }
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
    value = load(text, { schema: ENTRY_SCHEMA })
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

function markerMatches(text, marker) {
  const matches = []
  let offset = 0
  while (offset <= text.length) {
    const index = text.indexOf(marker, offset)
    if (index < 0) break
    const atLineStart = index === 0 || text[index - 1] === '\n'
    const after = index + marker.length
    const atLineEnd = after === text.length || text[after] === '\n' || (text[after] === '\r' && text[after + 1] === '\n')
    if (atLineStart && atLineEnd) matches.push(index)
    offset = after
  }
  return matches
}

export function splitManagedPatch(text) {
  const begins = markerMatches(text, MANAGED_BEGIN)
  const ends = markerMatches(text, MANAGED_END)
  if (begins.length === 0 && ends.length === 0) return { base: text, managed: '' }
  if (begins.length !== 1 || ends.length !== 1 || ends[0] <= begins[0]) {
    throw new LocalPluginManagerError(
      'managed-block-corrupt',
      '本地插件管理器在 cordis.patch.yml 中的受管区块标记不完整；请先修复标记，管理器不会自动改写该文件。',
      409
    )
  }
  let blockEnd = ends[0] + MANAGED_END.length
  if (text.slice(blockEnd, blockEnd + 2) === '\r\n') blockEnd += 2
  else if (text[blockEnd] === '\n') blockEnd += 1
  return {
    base: text.slice(0, begins[0]) + text.slice(blockEnd),
    managed: text.slice(begins[0], blockEnd)
  }
}

function removeStandaloneEmptySequence(text) {
  const lines = text.split(/(?<=\n)/u)
  let removed = false
  const next = lines.filter((line) => {
    if (removed || !/^\s*\[\]\s*(?:#.*)?(?:\r?\n)?$/u.test(line)) return true
    removed = true
    return false
  })
  return { text: next.join(''), removed }
}

function ensureTrailingNewline(text) {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`
}

function renderManagedBlock(disabledRows) {
  if (disabledRows.length === 0) return ''
  const lines = [
    MANAGED_BEGIN,
    '# Generated from .dsh-local-plugin-manager/state.json. Use the Settings UI to change it.'
  ]
  for (const group of disabledRows) {
    lines.push(`# package: ${group.name}`)
    for (const rowId of group.rowIds) {
      lines.push(`- id: ${JSON.stringify(rowId)}`)
      lines.push('  disabled: true')
    }
  }
  lines.push(MANAGED_END)
  return lines.join('\n')
}

export function rewriteManagedPatch(currentText, disabledRows, label = 'profile cordis.patch.yml') {
  const { base } = splitManagedPatch(currentText)
  const parsedBase = parseEntryList(base, label, true)
  const block = renderManagedBlock(disabledRows)
  let nextBase = base

  if (block !== '' && parsedBase.length === 0) {
    nextBase = removeStandaloneEmptySequence(nextBase).text
  }

  let next
  if (block !== '') {
    nextBase = ensureTrailingNewline(nextBase)
    next = `${nextBase}${block}\n`
  } else if (parsedBase.length === 0 && nextBase.trim() === '') {
    next = '[]\n'
  } else if (parsedBase.length === 0 && load(nextBase, { schema: ENTRY_SCHEMA }) == null) {
    nextBase = ensureTrailingNewline(nextBase)
    next = `${nextBase}[]\n`
  } else {
    next = ensureTrailingNewline(nextBase)
  }

  parseEntryList(next, label)
  return next
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

function analyzeBundlePatch(rows) {
  const rowIds = []
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
      rowIds.push(entry.id)
    }
  }
  const uniqueRowIds = uniqueStrings(rowIds)
  if (uniqueRowIds.length === 0) problems.push('bundle patch 没有可管理的插入条目')
  return {
    rowIds: uniqueRowIds,
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
    analysis = { rowIds: [], manageable: false, reason: errorMessage(error) }
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
    manageable: analysis.manageable,
    reason: analysis.reason,
    inBundleStack: profileBundles.has(name)
  }
}

function defaultState() {
  return { version: STATE_VERSION, disabled: [], pendingRemovals: [] }
}

function validateState(value, label) {
  if (!isRecord(value) || value.version !== STATE_VERSION || !Array.isArray(value.disabled) || !Array.isArray(value.pendingRemovals)) {
    throw new LocalPluginManagerError('invalid-state', `${label}格式不受支持，管理器不会自动覆盖。`, 409)
  }
  const disabled = uniqueStrings(value.disabled.filter((name) => typeof name === 'string' && PACKAGE_NAME_RE.test(name)))
  if (disabled.length !== value.disabled.length) {
    throw new LocalPluginManagerError('invalid-state', `${label}包含无效的 disabled 包名。`, 409)
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
  return { version: STATE_VERSION, disabled, pendingRemovals }
}

function cloneState(state) {
  return {
    version: STATE_VERSION,
    disabled: [...state.disabled],
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
    disabled: uniqueStrings(state.disabled),
    pendingRemovals: [...state.pendingRemovals]
      .map((item) => ({
        name: item.name,
        rowIds: uniqueStrings(item.rowIds),
        processMarker: item.processMarker
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, null, 2)}\n`
}

async function atomicWriteText(path, text, defaultMode = 0o600) {
  await mkdir(dirname(path), { recursive: true })
  let mode = defaultMode
  try {
    mode = (await stat(path)).mode & 0o777
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode })
    await chmod(temporary, mode)
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function restoreOptionalText(path, text, mode) {
  if (text === undefined) {
    await rm(path, { force: true })
    return
  }
  await atomicWriteText(path, text, mode)
}

function groupsForState(state, plugins) {
  const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]))
  const groups = []
  for (const name of state.disabled) {
    const plugin = byName.get(name)
    if (plugin !== undefined && plugin.manageable && plugin.rowIds.length > 0) {
      groups.push({ name, rowIds: plugin.rowIds })
    }
  }
  for (const pending of state.pendingRemovals) {
    if (pending.rowIds.length > 0) groups.push({ name: pending.name, rowIds: pending.rowIds })
  }
  const merged = new Map()
  for (const group of groups) {
    merged.set(group.name, uniqueStrings([...(merged.get(group.name) ?? []), ...group.rowIds]))
  }
  return [...merged.entries()]
    .map(([name, rowIds]) => ({ name, rowIds }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function boolForRows(rowIds, profileValues, managerDisabled, homeValues) {
  const values = rowIds.map((rowId) => {
    if (homeValues.has(rowId)) return homeValues.get(rowId)
    if (managerDisabled) return true
    return profileValues.get(rowId) ?? false
  })
  const disabledCount = values.filter(Boolean).length
  if (disabledCount === 0) return 'enabled'
  if (disabledCount === values.length) return 'disabled'
  return 'partial'
}

function publicPlugin(plugin, snapshot) {
  const managerDisabled = snapshot.state.disabled.includes(plugin.name)
  const status = boolForRows(plugin.rowIds, snapshot.profileDisabled, managerDisabled, snapshot.homeDisabled)
  const homeForcesEnabled = plugin.rowIds.some((rowId) => snapshot.homeDisabled.get(rowId) === false)
  const externalKeepsDisabled = plugin.rowIds.some((rowId) => {
    if (snapshot.homeDisabled.has(rowId)) return snapshot.homeDisabled.get(rowId) === true
    return snapshot.profileDisabled.get(rowId) === true
  })
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
    managerDisabled,
    externalControl: externalKeepsDisabled || homeForcesEnabled,
    rowIds: plugin.rowIds,
    canEnable: plugin.manageable && plugin.name !== PLUGIN_NAME && !externalKeepsDisabled,
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

    const patchText = (await readOptionalText(this.patchPath)) ?? '[]\n'
    const split = splitManagedPatch(patchText)
    const profileRows = parseEntryList(split.base, this.patchPath, true)
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
      managedText: split.managed,
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

  async persistState(nextState, snapshot) {
    const normalized = validateState(nextState, '待写入的本地插件管理状态')
    const nextPatchText = rewriteManagedPatch(snapshot.patchText, groupsForState(normalized, snapshot.plugins), this.patchPath)
    const nextStateText = stateText(normalized)
    const patchChanged = nextPatchText !== snapshot.patchText
    const stateChanged = nextStateText !== snapshot.stateText
    if (!patchChanged && !stateChanged) return

    const currentPatchText = (await readOptionalText(this.patchPath)) ?? '[]\n'
    const currentStateText = await readOptionalText(this.statePath)
    if (currentPatchText !== snapshot.patchText || currentStateText !== snapshot.stateText) {
      throw new LocalPluginManagerError(
        'concurrent-profile-change',
        'profile patch 或管理状态在操作期间被其他进程修改；未写入本次变更，请刷新后重试。',
        409
      )
    }

    try {
      if (patchChanged) await atomicWriteText(this.patchPath, nextPatchText, 0o644)
      if (stateChanged) await atomicWriteText(this.statePath, nextStateText, 0o600)
    } catch (error) {
      await Promise.allSettled([
        patchChanged ? restoreOptionalText(this.patchPath, snapshot.patchText, 0o644) : Promise.resolve(),
        stateChanged ? restoreOptionalText(this.statePath, snapshot.stateText, 0o600) : Promise.resolve()
      ])
      throw new LocalPluginManagerError('write-failed', `写入本地插件状态失败，已尝试回滚：${errorMessage(error)}`, 500)
    }
  }

  async initialize() {
    const snapshot = await this.snapshot()
    const installed = new Map(snapshot.plugins.map((plugin) => [plugin.name, plugin]))
    const next = cloneState(snapshot.state)
    next.disabled = next.disabled.filter((name) => name !== PLUGIN_NAME && installed.get(name)?.manageable === true)
    const pending = []
    for (const item of next.pendingRemovals) {
      const plugin = installed.get(item.name)
      if (plugin === undefined) {
        if (item.processMarker === this.processMarker) pending.push(item)
        continue
      }
      if (plugin.manageable) next.disabled.push(item.name)
      else pending.push(item)
    }
    next.disabled = uniqueStrings(next.disabled)
    next.pendingRemovals = pending
    await this.persistState(next, snapshot)

    const refreshed = await this.snapshot()
    for (const name of refreshed.state.disabled) {
      const plugin = refreshed.plugins.find((item) => item.name === name)
      if (plugin === undefined) continue
      await this.onLiveState(plugin, true).catch(() => undefined)
    }
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
        throw new LocalPluginManagerError('externally-disabled', '其他用户 patch 仍在禁用该插件；管理器不会覆盖该配置。', 409)
      }
      if (!enabled && !current.canDisable) {
        throw new LocalPluginManagerError('externally-enabled', 'home 级用户 patch 强制启用了该插件；管理器不会写入一个无效开关。', 409)
      }

      const next = cloneState(snapshot.state)
      next.pendingRemovals = next.pendingRemovals.filter((item) => item.name !== name)
      next.disabled = enabled
        ? next.disabled.filter((item) => item !== name)
        : uniqueStrings([...next.disabled, name])
      await this.persistState(next, snapshot)

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
    const path = join(this.profileDir, 'package.json')
    const { value: manifest } = await readJsonFile(path, 'profile package.json')
    const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {}
    const bundles = manifest.dsh?.profile?.bundles
    if (dependencies[name] !== undefined || !Array.isArray(bundles) || !bundles.includes(name)) return false
    manifest.dsh.profile.bundles = bundles.filter((bundle) => bundle !== name)
    await atomicWriteText(path, `${JSON.stringify(manifest, null, 2)}\n`, 0o644)
    return true
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

      const staged = cloneState(before.state)
      staged.disabled = uniqueStrings([...staged.disabled, name])
      staged.pendingRemovals = staged.pendingRemovals.filter((item) => item.name !== name)
      await this.persistState(staged, before)
      await this.onLiveState(plugin, true).catch(() => undefined)

      let command
      try {
        command = await this.commandRunner(this.runtime, this.profile, name, { cwd: this.profileDir })
      } catch (error) {
        const afterFailure = await this.snapshot()
        await this.persistState(before.state, afterFailure).catch(() => undefined)
        await this.onLiveState(plugin, before.state.disabled.includes(name)).catch(() => undefined)
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
        await this.persistState(before.state, afterCommand).catch(() => undefined)
        await this.onLiveState(plugin, before.state.disabled.includes(name)).catch(() => undefined)
        const detail = command.timedOut
          ? '卸载命令超时。'
          : (command.stderr.trim() || command.error || `卸载命令退出码 ${String(command.exitCode)}`)
        throw new LocalPluginManagerError('uninstall-failed', detail, 502, {
          exitCode: command.exitCode,
          timedOut: command.timedOut
        })
      }

      const finalized = cloneState(afterCommand.state)
      finalized.disabled = finalized.disabled.filter((item) => item !== name)
      finalized.pendingRemovals = [
        ...finalized.pendingRemovals.filter((item) => item.name !== name),
        { name, rowIds: plugin.rowIds, processMarker: this.processMarker }
      ]
      await this.persistState(finalized, afterCommand)

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
