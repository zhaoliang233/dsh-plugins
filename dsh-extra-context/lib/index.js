/**
 * dsh-extra-context 宿主半体。
 *
 * 职责：把「额外说明与上下文」注册成进程级的 system prompt section，
 * 让所有会话、子代理、workflow 子步骤都带上它；同时提供设置页所需的状态接口。
 *
 * 关键机制（已按 DSH 0.1.7-alpha.1 源码核对）：
 * - `ctx.systemPrompt.section()` 注册在调用者 fiber 的全局层，对所有 agent 生效；
 *   scoped（agent 级）同名 section 才会覆盖它。本插件只注册全局层，不参与 agent preset。
 * - section 的 `text` 可以是函数，每次组装实时求值，因此设置改动无需重新注册。
 * - 该函数在每次 prompt 组装时被调用，抛错会让模型请求整体失败，故渲染路径全部防御性读取。
 * - **设置就是本插件在 profile 里的条目配置**（0.1.7 起 DSH 的 settings 文档被
 *   profile 配置表单取代）：模块导出 `Config`（schemastery，字段声明 `.volatile()`），
 *   由 loader 做「只改 volatile 字段就不重启插件」的就地更新，插件侧读
 *   `ctx.config.<字段>.get()` 拿实时值；设置页写入走客户端 `configForms`。
 *
 * @module dsh-extra-context
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

import {
  COMPACTION_PURPOSE,
  DEFAULT_SETTINGS,
  PLUGIN_NAME,
  SETTINGS_NAMESPACE,
  SECTION_NAME,
  SECTION_ORDER,
  buildStatus,
  byteLength,
  effectiveSegments,
  normalizeSettings,
  renderCompactionNote,
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
export const DSH_COMPATIBILITY_RANGE = '>=0.1.7-alpha.1 <0.1.8'
/**
 * 设置条目的 id：0.1.7 起「设置」就是 profile 里这个插件条目的配置，
 * 客户端 `ctx.configForms.get(<id>)` 与宿主 `settings.describe()` 的 `ns` 都是它。
 * 与 `SETTINGS_NAMESPACE`（旧的 `settings.yaml` 段名）不同，后者现在只用于读旧数据。
 */
export const SETTINGS_ENTRY = 'dsh-extra-context'

/** 本插件真正用得上的服务；settings 是可选服务，单独用 ctx.inject 管理生命周期。 */
export const inject = ['systemPrompt']

const DEFAULT_ENTRY_PATH = fileURLToPath(import.meta.url)

/**
 * 判定 DSH 版本是否落在已核对契约的兼容线内。
 * @param {unknown} version
 * @returns {{supported: boolean, verified: boolean, normalized?: string}}
 */
export const VERIFIED_DSH_VERSIONS = ['0.1.7-alpha.1']

export function classifyDshVersion(version) {
  if (typeof version !== 'string') return { supported: false, verified: false }
  const normalized = version.split('+', 1)[0]
  const verified = VERIFIED_DSH_VERSIONS.includes(normalized)
  if (normalized === '0.1.7') return { supported: true, verified, normalized }
  const prerelease = /^0\.1\.7-(alpha|beta|rc)\.(0|[1-9]\d*)$/u.exec(normalized)
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
 * 从 DSH 安装里加载一个 Node 包（schemastery / js-yaml）。
 *
 * 宿主插件不声明 @deepseek-ai/* 依赖，裸 import 会 ERR_MODULE_NOT_FOUND；
 * 而 profile 条目的 schema 必须是真正的 schemastery 对象
 * （`settings.describe()` 会调 `schema.toJSON()`，浏览器用同一方言 rehydrate），
 * 所以按 DSH 安装内的绝对路径动态 import。
 *
 * **必须经 `pathToFileURL` 转成 file:// URL 再 import（Windows 上的真实缺陷）**：
 * `require.resolve` 返回的是**文件系统路径**，而 ESM 装载器只接受带协议的说明符。
 * Windows 下 `import('C:\\…\\schemastery\\lib\\index.cjs')` 会把 `C:` 当成协议，
 * 抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（Node 24 实测）。异常被吞掉后 schema 变 null，
 * 条目在 `settings.describe()` 里不出现 → 设置页读写被禁用（用户实测反馈）。
 * POSIX 上裸绝对路径能 import，所以这个缺陷只在 Windows 暴露——**别再退回 `import(resolved)`**。
 * @param {string} dshRoot
 * @param {string} name
 * @returns {Promise<any>}
 */
export async function loadDshModule(dshRoot, name) {
  const anchor = join(dshRoot, 'package.json')
  const require = createRequire(anchor)
  const resolved = require.resolve(name)
  const imported = await import(pathToFileURL(resolved).href)
  return imported.default ?? imported
}

async function loadSchemastery(dshRoot) {
  return loadDshModule(dshRoot, '@deepseek-ai/schemastery')
}

/**
 * 同步定位正在运行的 DSH 安装根目录。
 *
 * 首选与工作区其它插件同款的方式：`process.argv[1]`（CLI 入口）realpath 后向上 ≤4 层。
 * 测试进程（`node --test`）与从别处加载插件时 argv[1] 不是 DSH 入口，因此补一条
 * **PATH 上的 `dsh`** 的兜底——它同样指向真正的安装（bin 软链 realpath 后即包内 lib/bin.js）。
 * 两条都失败时返回 undefined：调用方按"没有 schema"降级，绝不抛错。
 * @param {string} [entryPath]
 * @returns {string|undefined}
 */
export function locateDshRootSync(entryPath = process.argv[1]) {
  const walkUp = (start) => {
    let directory = start
    for (let depth = 0; depth < 4; depth += 1) {
      try {
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
        if (manifest?.name === '@deepseek-ai/dsh') return directory
      } catch {
        // 读不到/不是 JSON：继续向上
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    return undefined
  }
  if (typeof entryPath === 'string' && entryPath.trim() !== '') {
    try {
      const found = walkUp(dirname(realpathSync(entryPath)))
      if (found !== undefined) return found
    } catch {
      // 入口不存在：落到 PATH 探测
    }
  }
  const pathValue = typeof process.env.PATH === 'string' ? process.env.PATH : ''
  for (const entry of pathValue.split(delimiter)) {
    if (entry === '') continue
    try {
      const candidate = realpathSync(join(entry, 'dsh'))
      const found = walkUp(dirname(candidate))
      if (found !== undefined) return found
    } catch {
      // 该目录下没有可执行的 dsh
    }
  }
  return undefined
}

/**
 * 本插件在 profile 里的条目 schema。
 *
 * 三个字段都声明 `.volatile()`：Cordis loader 遇到「只有 volatile 字段变化」时就地更新
 * 运行中 fiber 的引用（不重启插件），所以我们读 `ctx.config.<字段>.get()` 永远是最新值。
 * 数组字段同样可以整体声明 volatile（客户端把 `segments` 当作一个字段整份写回）。
 * schema 在模块作用域构造：loader 在 `plugin()` 时读 `plugin.Config`，那时 import 已求值完。
 */
const schemastery = await (async () => {
  try {
    const root = locateDshRootSync()
    if (root === undefined) return null
    return await loadSchemastery(root)
  } catch {
    return null
  }
})()

export const Config = schemastery === null ? undefined : createConfigSchema(schemastery)

/**
 * 构造条目 schema。分段只有 id / enabled / text：`label`（分段名称）已从界面、
 * 客户端规范化与这里一并移除。schemastery 对未知键是"原样保留"
 * （object 非 strict 时会 merge），所以老数据里的 label 键不会让校验失败，
 * 只是不再被声明、也不再被读写。
 * @param {any} z
 * @returns {any}
 */
export function createConfigSchema(z) {
  const segment = z.object({
    id: z.string().default(''),
    enabled: z.boolean().default(true),
    text: z.string().default('')
  })
  return z.object({
    enabled: z.boolean().default(DEFAULT_SETTINGS.enabled).volatile(),
    segments: z.array(segment).default([]).volatile(),
    maxBytes: z.number().default(DEFAULT_SETTINGS.maxBytes).volatile()
  })
}

/**
 * 字段级合成生效值。
 *
 * 三个来源的优先级（0.1.7 的原生设置模型 + 一次性迁移读取）：
 * 1. 用户在设置页写过的字段（profile 条目配置里的 override，`describe().user` 的键）——最高；
 * 2. 旧 `$DSH_HOME/settings.yaml.imported` 里 `extra-context:` 段的同名字段——只在用户
 *    还没在设置页写过该字段时生效（0.1.7 的设置文档被 profile 配置取代，段名与条目 id
 *    不同名，DSH 自己的迁移没能带上它，所以这里做只读兜底）；
 * 3. 其余字段用实时解析值（schema 默认 + 组合层）。
 *
 * 字段级而不是整份替换：用户只动总开关时，迁移来的 `segments` 必须留下——
 * 整份替换会让“只切了个开关，规则全没了”。
 * @param {object} resolved 实时解析值（normalizeSettings 口径）
 * @param {Set<string>} explicitFields 用户在设置页显式写过的字段名
 * @param {object|undefined} legacySection 旧 settings.yaml.imported 的 extra-context 段
 * @returns {ReturnType<typeof normalizeSettings>}
 */
export function mergeEffectiveSettings(resolved, explicitFields, legacySection) {
  const base = normalizeSettings(resolved)
  const legacy = legacySection !== null && typeof legacySection === 'object' ? legacySection : undefined
  const pick = (field) => {
    if (explicitFields.has(field)) return base[field]
    if (legacy !== undefined && Object.prototype.hasOwnProperty.call(legacy, field)) return legacy[field]
    return base[field]
  }
  return normalizeSettings({
    enabled: pick('enabled'),
    segments: pick('segments'),
    maxBytes: pick('maxBytes')
  })
}

/** 读取请求头（兼容不同 Node 请求实现）。 */
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
 * 构造追加给压缩摘要请求的用户消息。
 *
 * 形状照抄 DSH 的 `createUserMessage()`（`@deepseek-ai/dsh-llm` 的
 * `createMessage`）：带稳定 id 与 `source`，适配器与遥测都按这两处读。
 * 本插件不引入 `@deepseek-ai/*` 依赖，所以只复刻形状、不 import 那个辅助函数。
 * @param {string} text
 * @returns {object}
 */
function createCompactionNoteMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: PLUGIN_NAME }
  }
}

/**
 * 组装插件运行时。
 * @param {{ ctx: any, config: object, legacy: { path: string, present: boolean, section?: object, error?: string }, log: (level: string, message: string) => void }} input
 * @returns {Promise<() => Promise<void>>}
 */
async function createRuntime(input) {
  const { ctx, config, legacy, log } = input
  let settingsService = null

  /**
   * 读 volatile 字段的实时值。
   *
   * 0.1.7 里这些字段在运行中的 config 上是 volatile 引用（cosmokit），
   * loader 就地更新它们，所以 `ref.get()` 永远是最新值——不需要订阅
   * `loader/volatile-update`，也不需要维护本地快照。测试桩会直接给普通值。
   */
  function readField(name, fallback) {
    const value = config?.[name]
    if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
      try {
        return value.get()
      } catch {
        return fallback
      }
    }
    return value === undefined ? fallback : value
  }

  /** 实时解析值（schema 默认 + 组合层 + 用户 override，全部由 loader 合成）。 */
  function liveResolved() {
    return normalizeSettings({
      enabled: readField('enabled', DEFAULT_SETTINGS.enabled),
      segments: readField('segments', DEFAULT_SETTINGS.segments),
      maxBytes: readField('maxBytes', DEFAULT_SETTINGS.maxBytes)
    })
  }

  /** `settings.describe()` 里本插件这一条（供"用户写过哪些字段"与诊断使用）。 */
  function ownEntry() {
    if (typeof settingsService?.describe !== 'function') return undefined
    try {
      const rows = settingsService.describe({ redactSecrets: true }) ?? []
      return rows.find((row) => row.ns === SETTINGS_ENTRY)
    } catch (error) {
      // describe 抛错时判据未知：保守地当作用户没写过，保留迁移值与解析值。
      log('warn', `settings.describe() failed (${messageOf(error)}); treating user settings as unconfigured`)
      return undefined
    }
  }

  /** 生效设置：用户 override → 旧 settings.yaml 迁移段 → 实时解析值（字段级）。 */
  function effectiveSettings() {
    const entry = ownEntry()
    const explicit = entry?.user !== null && typeof entry?.user === 'object'
      ? new Set(Object.keys(entry.user))
      : new Set()
    return mergeEffectiveSettings(liveResolved(), explicit, legacy.section)
  }

  // 全局 system prompt section：进程级，一次注册对所有 agent 生效。
  // text 用函数形式，每次组装实时读取 volatile 引用，因此设置改动即时生效、无需重注册。
  /** 实际贡献给 system prompt 的内容（防御性读取，脏数据退化为空串）。 */
  function renderForPrompt() {
    return renderExtraContext(effectiveSettings())
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
   * 压缩摘要请求的补充指令（用户实测反馈：压缩之后模型的过程性回复变成英文）。
   *
   * 压缩用一次独立的模型调用把整段会话压成 checkpoint；那次调用的**最后一条
   * user 消息**是 DSH 固定的英文指令（`dsh-compaction-basic` 的
   * "Write concise English engineering prose"），而 checkpoint 随后替换掉整段
   * 会话，成为系统提示词之后最近的上下文。用户的中文额外上下文本身没丢
   * （system prompt 的节点 0 受 surface 保护，压缩区间不含它；压缩后每个回合的
   * 最终答复仍带 ✅ 就是它在生效的证据），但那条英文指令决定了摘要的语言，
   * 模型接下来几轮的过程性回复就跟着摘要变成英文。
   *
   * 这里在 `llm/stream` 上只对 `purpose === 'compaction'` 的请求追加一条 user
   * 消息（排在 DSH 指令之后），把用户的额外上下文原文重排到最靠后的位置。
   * 同一份文本此前在 system prompt 里，这次只是位置更靠后、优先级更高，
   * 因此不制造"两套要求并存"。
   *
   * 三条刻意的边界：
   * - 只改这次请求的 `options.messages`，不写 session：这条消息不会进入会话记录，
   *   界面上看不到，也不需要专门的清理逻辑。
   * - 任何异常都吞掉并放行原请求（压缩失败或摘要变差的代价远大于缺一条补充说明）。
   * - 不进顶层 `inject`：`llm` 缺失时整块跳过，插件其余能力（section / 设置 / 状态接口）照常。
   */
  ctx.inject(['llm'], (llmCtx) => {
    llmCtx.on('llm/stream', (options, next) => {
      try {
        // 只认摘要调用；session-title 等其它 purpose 一律不动。
        if (options?.purpose === COMPACTION_PURPOSE && Array.isArray(options.messages)) {
          const note = renderCompactionNote(effectiveSettings())
          if (note !== '') {
            // 追加而不是替换：只有排在 DSH 那条英文指令之后才可能覆盖它。
            // `options` 是 summarizer 每次新建的普通对象（未冻结），而 `llm/stream`
            // 的 waterfall 终段读的就是同一个对象，所以就地改字段即可生效。
            options.messages = [...options.messages, createCompactionNoteMessage(note)]
            log('info', `extra context attached to a compaction summary request (${String(byteLength(note))} bytes)`)
          }
        }
      } catch (error) {
        log('warn', `cannot attach the extra context to a compaction request: ${messageOf(error)}`)
      }
      return next()
    })
  })

  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    settingsService = settings
    settingsCtx.effect(() => () => {
      settingsService = null
    }, `${PLUGIN_NAME}: settings reference`)
    if (typeof settings?.configure !== 'function') {
      log('warn', 'settings service present but not usable; the settings page stays read-only for this process')
      return
    }
    // 本插件自己提供设置分区（id `extra-context`），所以不要壳层再按 schema
    // 自动生成一个通用页面：同一个条目出现两个设置页会让人不知道该信哪个。
    // 这条策略与 schema 无关（没有 schema 时本来也不会自动生成页），所以**无条件注册**——
    // 否则"没定位到 DSH 安装"的环境（CI、测试进程）会连策略都不注册，行为随环境漂移。
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      `${PLUGIN_NAME}: settings presentation`
    )
    if (Config === undefined) {
      log('warn', 'schemastery schema unavailable; the plugin entry exposes no editable fields')
    }
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
          const status = buildStatus(effectiveSettings(), { sectionOrder: SECTION_ORDER })
          const body = {
            ok: true,
            // 可写 = 本插件条目在 describe 里（schema 已导出且条目处于活动状态）。
            // 满足这一条，客户端的 `configForms.get(<条目 id>)` 就能读能写。
            writable: ownEntry() !== undefined,
            ...status
          }
          if (debug) {
            // `?debug=1`：把宿主真实看到的条目描述原样返回。
            // 用于比对"宿主存的"与"浏览器读的"，避免在两侧之间来回猜。
            body.debug = describeHostEntry()
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
   * 宿主侧权威视图：本条目在 settings 服务里的 value / user / base 与 revision，
   * 加上旧 settings.yaml 迁移段的读取状态。与浏览器 configForms 的响应同源，
   * 用于定位"存了但读到 0"这类分层故障。
   */
  function describeHostEntry() {
    const live = liveResolved()
    const out = {
      servicePresent: settingsService !== null,
      entry: SETTINGS_ENTRY,
      schemaPresent: Config !== undefined,
      appliedSegments: effectiveSettings().segments.length,
      renderedBytes: byteLength(renderForPrompt()),
      liveSegments: live.segments.length
    }
    const entry = ownEntry()
    try {
      out.describeSupported = typeof settingsService?.describe === 'function'
      out.entryPresent = entry !== undefined
      out.autoGenerate = entry?.autoGenerate
      out.resolvedValue = entry?.value
      out.userValue = entry?.user
      out.baseValue = entry?.base
      out.revision = entry?.revision
    } catch (error) {
      out.error = messageOf(error)
    }
    out.legacyPath = legacy.path
    out.legacyPresent = legacy.present === true
    if (legacy.error !== undefined) out.legacyError = legacy.error
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

  if (Config === undefined) {
    log('warn', 'schemastery unavailable; the plugin entry exposes no editable settings (the settings page stays read-only)')
  }

  const legacy = await readLegacySection(options.entryPath ?? process.argv[1], log)
  const runtime = await createRuntime({ ctx, config, legacy, log })
  ctx.effect(() => runtime, `${PLUGIN_NAME}: runtime`)
}

/**
 * 读取旧 `$DSH_HOME/settings.yaml.imported` 里 `extra-context:` 段（只读，一次性迁移）。
 *
 * 0.1.7 把「设置文档」换成了 profile 配置表单：DSH 自己的迁移按**条目 id** 找目标，
 * 而本插件旧的 settings 段名是 `extra-context`、条目 id 是 `dsh-extra-context`，
 * 于是那一段留在 `settings.yaml.imported` 里没有被带过来。用户在设置页首次保存后，
 * 值就落到条目配置里（`describe().user` 出现该字段），迁移段即不再参与。
 * 任何读取/解析失败都只降级为"没有迁移值"，绝不影响 section 注册。
 * @param {string} entryPath
 * @param {(level: string, message: string) => void} log
 * @returns {Promise<{path: string, present: boolean, section?: object, error?: string}>}
 */
export async function readLegacySection(entryPath, log) {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  const path = join(home, 'settings.yaml.imported')
  if (!existsSync(path)) return { path, present: false }
  try {
    const root = locateDshRootSync(entryPath)
    if (root === undefined) return { path, present: false, error: 'cannot locate the DSH install to parse the legacy settings file' }
    const yaml = await loadDshModule(root, 'js-yaml')
    const document = yaml.load(await readFile(path, 'utf8')) ?? {}
    const section = document !== null && typeof document === 'object' ? document[SETTINGS_NAMESPACE] : undefined
    if (section === undefined || section === null || typeof section !== 'object') return { path, present: false }
    log('info', `legacy settings section "${SETTINGS_NAMESPACE}" found in ${path}; it applies until each field is saved from the settings page`)
    return { path, present: true, section }
  } catch (error) {
    log('warn', `cannot read the legacy settings file ${path}: ${messageOf(error)}`)
    return { path, present: false, error: messageOf(error) }
  }
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
  // **Config 必须挂在这里**：Cordis 的 `Loader.unwrapExports()` 对"同时有 default 与命名导出"的
  // 模块返回的是 `default` 对象（`e = e.default ?? e` 之后 `!e.__esModule` 即为它），
  // 而 `registry.plugin()` 只从**那个对象**上读 `runtime.Config`。只导出命名 `Config`
  // 会让 `settings.describe()` 认为本条目没有 schema，于是条目不进表单：
  // 状态接口 `writable:false`、设置页「+ 添加上下文」与总开关永久禁用、
  // 任何写入被拒（真实缺陷，用户实测反馈）。
  Config,
  apply
}

export { createRuntime }
