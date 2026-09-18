/**
 * dsh-extra-context 宿主半体。
 *
 * 职责：把「额外说明与上下文」注册成进程级的 system prompt section，
 * 让所有会话、子代理、workflow 子步骤都带上它；同时提供设置页所需的状态接口。
 *
 * 关键机制（已按 DSH 0.1.6-alpha.1 源码核对）：
 * - `ctx.systemPrompt.section()` 注册在调用者 fiber 的全局层，对所有 agent 生效；
 *   scoped（agent 级）同名 section 才会覆盖它。本插件只注册全局层，不参与 agent preset。
 * - section 的 `text` 可以是函数，每次组装实时求值，因此设置改动无需重新注册。
 * - 该函数在每次 prompt 组装时被调用，抛错会让模型请求整体失败，故渲染路径全部防御性读取。
 *
 * @module dsh-extra-context
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  DEFAULT_SETTINGS,
  PLUGIN_NAME,
  SETTINGS_NAMESPACE,
  SECTION_NAME,
  SECTION_ORDER,
  buildStatus,
  byteLength,
  effectiveSegments,
  normalizeSettings,
  renderExtraContext
} from './rules.js'

// 导出面刻意保持最小：只导出测试与兼容检查真正引用的符号。
// DEFAULT_SETTINGS 只在文件内部使用，不再对外重导出
// （曾把 rules.js 的导出整份转发一遍，于是"哪些符号真的需要对外"变得不可知；
//  测试需要它们时直接从 rules.js 取）。
export {
  PLUGIN_NAME,
  SETTINGS_NAMESPACE,
  SECTION_NAME,
  SECTION_ORDER,
  buildStatus,
  effectiveSegments,
  normalizeSettings,
  renderExtraContext
}

export const STATUS_PATH = '/dsh-extra-context/status'
export const CLIENT_HEADER = 'x-dsh-extra-context-client'
export const DSH_COMPATIBILITY_RANGE = '>=0.1.6-alpha.1 <0.1.7'

/** 本插件真正用得上的服务；settings 是可选服务，单独用 ctx.inject 管理生命周期。 */
export const inject = ['systemPrompt']

const DEFAULT_ENTRY_PATH = fileURLToPath(import.meta.url)

/**
 * 判定 DSH 版本是否落在已核对契约的兼容线内。
 * @param {unknown} version
 * @returns {{supported: boolean, verified: boolean, normalized?: string}}
 */
export const VERIFIED_DSH_VERSIONS = ['0.1.6-alpha.1']

export function classifyDshVersion(version) {
  if (typeof version !== 'string') return { supported: false, verified: false }
  const normalized = version.split('+', 1)[0]
  const verified = VERIFIED_DSH_VERSIONS.includes(normalized)
  if (normalized === '0.1.6') return { supported: true, verified, normalized }
  const prerelease = /^0\.1\.6-(alpha|beta|rc)\.(0|[1-9]\d*)$/u.exec(normalized)
  if (prerelease === null) return { supported: false, verified: false, normalized }
  const supported = prerelease[1] !== 'alpha' || Number(prerelease[2]) >= 1
  return { supported, verified: supported && verified, normalized }
}

/**
 * 从 DSH CLI 入口向上找 @deepseek-ai/dsh 的安装目录。
 * 复用工作区内既有插件的位置探测方式：入口是全局 bin 软链，
 * realpath 后向上最多 4 层即可命中包根。
 * @param {string} [entryPath]
 * @returns {Promise<{version: string, root: string}>}
 */
export async function readDshPackage(entryPath = process.argv[1]) {
  if (typeof entryPath !== 'string' || entryPath.trim() === '') {
    throw new Error('cannot locate the DSH CLI entry path')
  }
  let directory = dirname(await realpathSafe(entryPath))
  for (let depth = 0; depth < 4; depth += 1) {
    const manifestPath = join(directory, 'package.json')
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (manifest?.name === '@deepseek-ai/dsh') {
        if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
          throw new Error('@deepseek-ai/dsh package.json has no version')
        }
        return { version: manifest.version, root: directory }
      }
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`cannot parse ${manifestPath}: ${error.message}`)
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error('cannot locate @deepseek-ai/dsh/package.json from the DSH CLI entry')
}

async function realpathSafe(path) {
  const { realpath } = await import('node:fs/promises')
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * 从 DSH 安装里加载 schemastery。
 *
 * 宿主插件不声明 @deepseek-ai/* 依赖，裸 import 会 ERR_MODULE_NOT_FOUND；
 * 而 settings 命名空间的 schema 必须是真正的 schemastery 对象
 * （describe() 会调 schema.toJSON()，客户端用同一方言 rehydrate），
 * 所以按 DSH 安装内的绝对路径动态 import。
 *
 * **必须经 `pathToFileURL` 转成 file:// URL 再 import（Windows 上的真实缺陷）**：
 * `require.resolve` 返回的是**文件系统路径**，而 ESM 装载器只接受带协议的说明符。
 * Windows 下 `import('C:\\…\\schemastery\\lib\\index.cjs')` 会把 `C:` 当成协议，
 * 抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（Node 24 实测）。异常被下面的 try/catch 吞掉后
 * schema 变 null，`ctx.inject(['settings'])` 里 fail closed 直接 return，
 * 于是 settings 命名空间静默不注册：状态接口 `writable:false`，设置页的
 * 「+ 添加规则」与总开关按钮被 `disabled: busy || !writable` 永久禁用（用户实测反馈）。
 * @param {string} dshRoot
 * @returns {Promise<any>}
 */
async function loadSchemastery(dshRoot) {
  const anchor = join(dshRoot, 'package.json')
  const require = createRequire(anchor)
  const resolved = require.resolve('@deepseek-ai/schemastery')
  const imported = await import(pathToFileURL(resolved).href)
  return imported.default ?? imported
}

/**
 * 构造设置命名空间的 schema（与设置页共享同一份方言）。
 * @param {any} z
 * @returns {any}
 */
function createSettingsSchema(z) {
  const segment = z.object({
    id: z.string().default(''),
    label: z.string().default(''),
    enabled: z.boolean().default(true),
    text: z.string().default('')
  })
  return z.object({
    enabled: z.boolean().default(DEFAULT_SETTINGS.enabled),
    segments: z.array(segment).default([]),
    maxBytes: z.number().default(DEFAULT_SETTINGS.maxBytes)
  })
}

/** 读取请求头（兼容不同 Node 请求实现）。 */
/**
 * 用户层显式写过的字段名。
 *
 * 用 describe() 的 `user` 层判断"用户是否表达过意图"：字段只要出现就说明
 * 用户动过它——哪怕值是空数组。describe 不可用时退化为 scope 解析值本身。
 * @param {any} settings settings 服务
 * @param {string} namespace 命名空间
 * @param {any} scope 命名空间 owner scope
 * @returns {Set<string>}
 */
function explicitUserFields(settings, namespace, scope, log) {
  if (typeof settings?.describe === 'function') {
    let rows
    try {
      rows = settings.describe({ redactSecrets: true }) ?? []
    } catch (error) {
      // describe 存在但**调用失败**：这时绝不能退到 scope.get() 兜底。
      // scope.get() 是 resolved 值（恒含全部字段），会被判成"用户写过"，
      // 于是组合层 config 被整体丢弃——正是我们要避免的那个缺陷的另一条分支。
      // 判据"未知"时唯一的保守选择是：当作没写过，保留组合层。
      log?.('warn', `settings.describe() failed (${messageOf(error)}); treating user settings as unconfigured and keeping the composition config`)
      return new Set()
    }
    const mine = rows.find((row) => row.ns === namespace)
    const user = mine?.user
    // 关键：describe 可用时，**只有它**能判定"用户写过什么"。
    // 真实 describe 在"用户从未写过该段"时不给 user 键；此时必须返回空集合，
    // 绝不能回退到 scope.get()——那是 resolved 值（恒含全部字段），
    // 会被误判成"用户写过"，从而用空默认值覆盖掉组合层 config。
    return user !== null && typeof user === 'object' ? new Set(Object.keys(user)) : new Set()
  }
  // describe **不存在**（服务没提供这个方法）：只能退化为读当前解析值的字段名。
  // 这条兜底比"当作没写过"更激进，只在没有更好信息时使用。
  try {
    const value = scope?.get?.()
    if (value !== null && typeof value === 'object') return new Set(Object.keys(value))
  } catch {
    // 完全无从判断：等价于"未显式配置"。
  }
  return new Set()
}

/** 设置段是否已有实际内容（空 segments 视为未配置）。 */
function isConfigured(settings) {
  return effectiveSegments(settings).length > 0
}

function requestHeader(request, name) {
  const headers = request?.headers
  if (headers === undefined || headers === null) return undefined
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined
  const value = headers[name] ?? headers[String(name).toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

/** 仅接受本插件客户端发起的同源请求。 */
function trustedClientRequest(request) {
  if (requestHeader(request, CLIENT_HEADER) !== '1') return false
  const origin = requestHeader(request, 'origin') ?? requestHeader(request, 'referer')
  if (typeof origin !== 'string' || origin === '') return true
  const host = requestHeader(request, 'host')
  if (typeof host !== 'string' || host === '') return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload)
  })
  response.end(payload)
}

function rejectMethod(response, method) {
  response.writeHead(405, { allow: method, 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ ok: false, error: `method must be ${method}` }))
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 组装插件运行时。
 * @param {{ ctx: any, schema: any, initial: object, log: (level: string, message: string) => void }} input
 * @returns {Promise<() => Promise<void>>}
 */
async function createRuntime(input) {
  const { ctx, schema, initial, log } = input
  let current = normalizeSettings(initial)
  let settingsScope = null

  // 全局 system prompt section：进程级，一次注册对所有 agent 生效。
  // text 用函数形式，每次组装读取最新快照，因此设置改动即时生效、无需重注册。
  /** 实际贡献给 system prompt 的内容（防御性读取，脏数据退化为空串）。 */
  function renderForPrompt() {
    return renderExtraContext(normalizeSettings(current))
  }

  const disposer = ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    // 用户文本可以含 `{{...}}`。官方 `renderPrompt()` 会对 section 文本做
    // `{{variable}}` 插值，未知变量直接抛错，而抛错点在插件 try/catch 之外
    // → 该部署每一次模型请求都会失败。DSH 0.1.6 起 `PromptSection` 提供官方
    // `interpolate: false`，本段原样保留用户文本，不再需要把 `{{` 拆成
    // `{`+零宽空格+`{`（那条 hack 会让模型看到零宽字符）。
    // `renderPrompt()`（`dsh-system-prompt/lib/index.js:115`）是唯一渲染口，
    // 且它对 `interpolate === false` 的 section 直接取 `text`，不扫描变量。
    interpolate: false,
    text: () => {
      try {
        return renderForPrompt()
      } catch (error) {
        log('error', `render failed, contributing nothing this assembly: ${messageOf(error)}`)
        return ''
      }
    }
  })

  /**
   * 写入设置：优先走 settings 命名空间（设置页与配置兼容、带 revision 保护），
   * 没有 settings 服务时退化为仅更新内存快照（本次进程内仍生效）。
   */
  async function write(patch) {
    if (settingsScope === null) {
      current = normalizeSettings({ ...current, ...patch })
      return
    }
    await settingsScope.update(patch)
    current = normalizeSettings(settingsScope.get())
  }

  /**
   * 同步一次设置快照。
   *
   * 判据是"用户层是否显式写过字段"，而不是"解析值是否为空"。
   * 否则用户在设置页把分段全部删除（写入 segments: []）后，这里会把空数组
   * 当成"尚未配置"，静默回退到组合层默认值——表现为"这条规则删不掉"。
   * 只有从未写过任何字段时才回退到组合层 initial。
   * @param {unknown} resolved 解析后的设置值
   * @param {Set<string>} [explicitFields] 用户在设置文档里显式写过的字段名
   */
  function applyResolved(resolved, explicitFields) {
    const next = normalizeSettings(resolved)
    const touched = explicitFields !== undefined && explicitFields.size > 0
    if (!touched && !isConfigured(next)) return

    // 字段级合并：**只让用户显式写过的字段**覆盖组合层，其余字段保留组合层值。
    //
    // 曾经这里是 `current = next` 整体替换。由于注册时不传 base，resolved 里
    // 不含组合层内容，于是用户在设置页只动一个开关，组合层 config 里的基线规则
    // 就被整体丢掉——而文档承诺的是"其余字段回落到组合层值"，两边直接矛盾。
    if (touched) {
      const merged = { ...initial }
      for (const field of explicitFields) {
        if (Object.prototype.hasOwnProperty.call(next, field)) merged[field] = next[field]
      }
      current = normalizeSettings(merged)
      return
    }
    current = next
  }

  let settingsService = null

  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    settingsService = settings
    settingsCtx.effect(() => () => {
      settingsService = null
    }, `${PLUGIN_NAME}: settings reference`)
    if (typeof settings?.register !== 'function') {
      log('warn', 'settings service present but not usable; extra context persists in memory only for this process')
      return
    }
    if (schema === null) {
      log('warn', 'schemastery schema unavailable; settings namespace not registered')
      return
    }
    // 不传 base：设置文件里没有这一段时，解析值就是 schema 默认（空 segments）。
    // 这正是「尚未配置」的表示，此时保留 initial（组合层配置）作为生效值。
    const scope = settings.register(SETTINGS_NAMESPACE, schema, { applies: 'live' })
    settingsScope = scope
    const userFields = () => explicitUserFields(settings, SETTINGS_NAMESPACE, scope, log)
    applyResolved(scope.get(), userFields())
    scope.watch((next) => {
      applyResolved(next, userFields())
    })
    settingsCtx.effect(() => () => {
      settingsScope = null
    }, `${PLUGIN_NAME}: settings scope`)
    log('info', `settings namespace "${SETTINGS_NAMESPACE}" registered (live)`)
    return undefined
  })

  // 只读状态接口：插件自己的诊断口径（预览预算与可写能力）。
  ctx.inject(['webServer', 'connection'], (webContext) => {
    const rejectionOf = typeof webContext.connection?.requestRejection === 'function'
      ? (request) => webContext.connection.requestRejection(request)
      : () => undefined
    const route = {
      kind: 'exact',
      path: STATUS_PATH,
      handler: (request, response) => {
        const rejection = rejectionOf(request)
        if (rejection !== undefined) {
          sendJson(response, rejection, { ok: false, error: rejection === 401 ? 'browser authentication required' : 'request authority rejected' })
          return
        }
        if (request.method !== 'GET') {
          rejectMethod(response, 'GET')
          return
        }
        const debug = typeof request.url === 'string' && request.url.includes('debug=1')
        if (!trustedClientRequest(request)) {
          sendJson(response, 403, { ok: false, error: 'request origin rejected' })
          return
        }
        try {
          // buildStatus 与 renderForPrompt 走同一条渲染路径，因此状态里的
          // rendered/bytes/estimatedTokens/overBudget/source 就是实际注入口径。
          const status = buildStatus(current, { sectionOrder: SECTION_ORDER })
          const body = {
            ok: true,
            writable: settingsScope !== null,
            ...status
          }
          if (debug) {
            // `?debug=1`：把宿主真实注册的命名空间描述原样返回。
            // 用于比对"宿主存的"与"浏览器读的"，避免在两侧之间来回猜。
            body.debug = describeHostNamespace()
          }
          sendJson(response, 200, body)
        } catch (error) {
          sendJson(response, 500, { ok: false, error: messageOf(error) })
        }
      }
    }
    webContext.effect(() => webContext.webServer.register(route), `${PLUGIN_NAME}: status route`)
  })

  /**
   * 宿主侧权威视图：本命名空间在 settings 服务里的 resolved / user / base 与 revision。
   * 与浏览器 settings.describe 的响应同源，用于定位"存了但读到 0"这类分层故障。
   */
  function describeHostNamespace() {
    const out = {
      servicePresent: settingsService !== null,
      scopePresent: settingsScope !== null,
      appliedSegments: normalizeSettings(current).segments.length,
      renderedBytes: byteLength(renderForPrompt())
    }
    try {
      out.describeSupported = typeof settingsService?.describe === 'function'
      const rows = settingsService?.describe?.({ redactSecrets: true }) ?? []
      const mine = rows.find((row) => row.ns === SETTINGS_NAMESPACE)
      out.namespaceCount = rows.length
      out.namespacePresent = mine !== undefined
      // 服务端"注册了哪些命名空间"的完整清单：与浏览器拿到的那份比对，
      // 才能判定是宿主没注册，还是浏览器读到了过期快照。
      out.providerNamespaceCount = rows.length
      out.providerNamespaces = rows.map((row) => row.ns)
      out.resolvedSegments = Array.isArray(mine?.value?.segments) ? mine.value.segments.length : 'n/a'
      out.userSegments = Array.isArray(mine?.user?.segments) ? mine.user.segments.length : 'n/a'
      out.resolvedValue = mine?.value
      out.userValue = mine?.user
      out.revision = mine?.revision
      out.namespaces = rows.map((row) => row.ns)
    } catch (error) {
      out.error = messageOf(error)
    }
    try {
      // 用 DSH_HOME 约定解析，不依赖未定义的辅助函数（曾调用不存在的 resolveDshHome，
      // 被 try/catch 吞掉后 debug 面板永远缺少这两个字段）。
      const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
        ? process.env.DSH_HOME.trim()
        : join(homedir(), '.dsh')
      const settingsPath = join(home, 'settings.yaml')
      out.settingsFile = settingsPath
      out.settingsFileExists = existsSync(settingsPath)
    } catch (error) {
      out.settingsFileError = messageOf(error)
    }
    return out
  }

  return async () => {
    disposer?.()
  }
}

/**
 * 已通过契约检查时装配运行时。
 * @param {any} ctx
 * @param {{ entryPath?: string }} [options]
 */
export async function applyCompatibleRuntime(ctx, config = {}, options = {}) {
  const log = (level, message) => {
    const logger = ctx.logger
    const write = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : undefined
    if (write !== undefined) write(`${PLUGIN_NAME}: ${message}`)
    else if (level === 'error' || level === 'warn') console.warn(`${PLUGIN_NAME}: ${message}`)
  }

  const missing = [
    typeof ctx.systemPrompt?.section === 'function' ? null : 'systemPrompt.section()'
  ].filter((name) => name !== null)
  if (missing.length > 0) {
    throw new Error(`${PLUGIN_NAME}: incompatible DSH runtime, missing ${missing.join(', ')}`)
  }

  let dshRoot
  try {
    const manifest = await readDshPackage(options.entryPath ?? process.argv[1])
    dshRoot = manifest.root
  } catch (error) {
    log('warn', `cannot locate the DSH install, settings integration degraded: ${messageOf(error)}`)
  }

  let z = null
  if (dshRoot !== undefined) {
    try {
      z = await loadSchemastery(dshRoot)
    } catch (error) {
      log('warn', `cannot load schemastery from the DSH install: ${messageOf(error)}`)
    }
  }

  // 无 settings 服务时的兜底：仅更新内存快照（本次进程内仍生效，重启后丢失）。
  const initial = normalizeSettings(config ?? DEFAULT_SETTINGS)
  const schema = z === null ? null : createSettingsSchema(z)
  const runtime = await createRuntime({ ctx, schema, initial, log })
  ctx.effect(() => runtime, `${PLUGIN_NAME}: runtime`)
}

/**
 * 版本门：先核对 DSH 版本，再决定是否装配。
 * 超出兼容线时保持 inert（不注册任何 section），避免在没有逐版本核对的地基上注入提示词。
 * @param {any} ctx
 * @param {string} version
 */
export async function applyForVersion(ctx, version, config = {}, options = {}) {
  const compatibility = classifyDshVersion(version)
  if (!compatibility.supported) {
    ctx.logger?.error?.(
      `${PLUGIN_NAME}: unsupported DSH ${version}; expected ${DSH_COMPATIBILITY_RANGE}. Plugin stays inert.`
    )
    return
  }
  if (!compatibility.verified) {
    ctx.logger?.warn?.(
      `${PLUGIN_NAME}: DSH ${version} is inside ${DSH_COMPATIBILITY_RANGE} but is not individually verified; capability checks remain authoritative`
    )
  }
  return applyCompatibleRuntime(ctx, config, options)
}

/**
 * 入口：定位当前运行的 DSH 版本。
 * @param {any} ctx
 * @param {string} [entryPath]
 */
export async function applyForEntry(ctx, entryPath = process.argv[1] ?? DEFAULT_ENTRY_PATH, config = {}) {
  let manifest
  try {
    manifest = await readDshPackage(entryPath)
  } catch (error) {
    ctx.logger?.error?.(`${PLUGIN_NAME}: cannot verify the running DSH package; plugin remains inert: ${messageOf(error)}`)
    return
  }
  return applyForVersion(ctx, manifest.version, config, { entryPath })
}

/**
 * Cordis 入口。config 即组成这一行时写的配置（本插件不需要它时可为空对象）；
 * 只有 settings 服务缺失时才作为兜底生效值使用。
 * @param {any} ctx
 * @param {object} [config]
 */
export async function apply(ctx, config = {}) {
  return applyForEntry(ctx, process.argv[1], config)
}

export default {
  name: PLUGIN_NAME,
  inject,
  apply
}

export { createRuntime }
