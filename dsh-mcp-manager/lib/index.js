/**
 * dsh-mcp-manager 宿主半体。
 *
 * 职责：把「MCP 服务器清单」做成设置页可维护的数据，并在运行时投影成真正
 * 运行的 MCP 客户端实例——不写用户的 profile patch、不需要重启宿主。
 *
 * 关键机制（已按 DSH 0.1.7-alpha.2 源码核对，并在隔离环境实机验证）：
 * - **设置就是本条目在 profile 里的 config**：模块导出 schemastery `Config`，
 *   字段全部 `.volatile()`，loader 在「只有 volatile 字段变化」时就地更新运行中
 *   fiber 的引用并发出 `loader/volatile-update`，插件据此重跑一次对账；
 * - settings 清单仍是唯一真相，挂载状态是它的投影（`lib/plan.js` 对账）；
 * - 挂载走 `ctx.plugin(mcpModule, config)`，卸载走 `fiber.dispose()`；
 * - 凭据占位符 `credential:<KEY>` 在挂载时经 `ctx.credentials.resolve()` 换成明文，
 *   条目 config 里只留键名；
 * - profile 组合里已有的 MCP 行（cordis.patch.yml 手写 insert）只读展示，
 *   不回显任何值（组合层的 `!!js` 求值后可能是明文密钥）。
 *
 * @module dsh-mcp-manager
 */

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import {
  DSH_COMPATIBILITY_RANGE,
  VERIFIED_DSH_VERSIONS,
  classifyDshVersion,
  loadDshModule,
  readDshPackage
} from './dsh.js'
import {
  DEFAULT_SETTINGS,
  PLUGIN_NAME,
  SERVER_NAME_PATTERN,
  SETTINGS_ENTRY,
  describeServer,
  newServerId,
  normalizeServer,
  normalizeSettings,
  validateServer
} from './store.js'
import { createMountManager } from './mount-manager.js'
import { credentialKeyFor, describeProfileTargets, importDraftFromConfig } from './targets.js'

export {
  DSH_COMPATIBILITY_RANGE,
  PLUGIN_NAME,
  SERVER_NAME_PATTERN,
  SETTINGS_ENTRY,
  VERIFIED_DSH_VERSIONS,
  classifyDshVersion,
  describeServer,
  normalizeSettings
}

export const STATUS_PATH = '/dsh-mcp-manager/status'
export const ACTION_PATH = '/dsh-mcp-manager/action'
export const CLIENT_HEADER = 'x-dsh-mcp-manager-client'
export const CSRF_HEADER = 'x-dsh-mcp-manager-csrf'
export const MAX_BODY_BYTES = 16 * 1024
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** tools 是硬依赖：MCP 工具就是注册在它上面的。 */
export const inject = ['tools']

/** 动作白名单：状态接口会把它告诉客户端，双方能力不匹配时能提前说清楚。 */
export const ACTIONS = Object.freeze(['reconcile', 'verify', 'import'])

/**
 * 本插件在 profile 里的条目 schema（0.1.7 起「设置」就是条目本身的 config）。
 *
 * 两个字段都声明 `.volatile()`：loader 遇到「只有 volatile 字段变化」时就地更新运行中
 * fiber 的引用（不重启插件），所以 `config.<字段>.get()` 永远是最新值，设置页的写入
 * 也因此不需要重启宿主。**schema 必须在模块作用域构造**——loader 在 `plugin()` 时读
 * `plugin.Config`，那时 import 已经求值完；放到 `apply()` 里构造等于没有 schema，
 * 条目会进不了 `settings.describe()`（设置页读写被禁用、状态接口 `writable:false`）。
 */
const schemastery = await (async () => {
  try {
    const { root } = await readDshPackage()
    return await loadSchemastery(root)
  } catch {
    return null
  }
})()

export const Config = schemastery === null ? undefined : createConfigSchema(schemastery)

/**
 * 把配置文件里已声明的一条 MCP 配置完整导入成草稿。
 *
 * 值从 loader 条目的 `options.config` 取——它已经过 `!!js` 求值，**可能是明文密钥**，
 * 所以：非敏感字段照抄，敏感字段（含带 token 的 URL）换成 `credential:<键名>` 占位符，
 * 明文只写进凭据库、绝不返回给浏览器。没有凭据服务时保留占位符并提示手动填写。
 *
 * @param {object} input
 * @param {any} input.entryConfig loader 条目里的原始 config
 * @param {Iterable<string>} input.takenIds 现有条目 id（用于生成新 id）
 * @param {any} input.credentials 凭据服务，可为 null
 * @returns {Promise<{ok: boolean, error?: string, draft?: any, notes?: string[]}>}
 */
export async function importFromProfileEntry({ entryConfig, takenIds, credentials }) {
  if (entryConfig === null || typeof entryConfig !== 'object') {
    return { ok: false, error: '这条配置没有可导入的内容' }
  }
  const serverName = typeof entryConfig.serverName === 'string' ? entryConfig.serverName : ''
  const planned = importDraftFromConfig({
    id: newServerId(takenIds ?? []),
    config: entryConfig,
    credentialKeyFor: (field, key) => credentialKeyFor(serverName, field, key)
  })
  const notes = [...planned.notes]
  if (planned.credentials.length > 0) {
    if (credentials === null || typeof credentials?.set !== 'function') {
      notes.push('宿主没有可用的凭据服务：敏感字段仍是 credential:占位符，请在弹窗的凭据区手动填写值。')
    } else {
      /** @type {string[]} */
      const failed = []
      for (const item of planned.credentials) {
        try {
          await credentials.set(item.ref, item.value)
        } catch (error) {
          failed.push(`${item.ref}（${String(error?.message ?? error)}）`)
        }
      }
      if (failed.length > 0) {
        notes.push(`以下凭据写入失败，请手动补：${failed.join('、')}`)
      }
    }
  }
  return { ok: true, draft: planned.draft, notes }
}

/** Cordis Fiber 状态 → 可读阶段（与 dsh-host-plugin-inventory 同源）。 */
const FIBER_PHASE = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading'
}

/**
 * 宿主入口。
 * @param {any} ctx
 */
export function apply(ctx, config = {}) {
  const log = (level, message) => {
    try {
      ctx.logger?.[level]?.(`${PLUGIN_NAME}: ${message}`)
    } catch {
      /* 日志失败不影响功能 */
    }
  }

  const state = {
    /** @type {string | undefined} */
    version: undefined,
    versionSupported: false,
    runtime: 'starting',
    /** @type {any} */
    module: null,
    moduleStrategy: undefined,
    /** @type {string[]} */
    loadErrors: [],
    /** @type {any} */
    mountManager: null,
    /** @type {any} */
    settingsService: null,
    settingsAvailable: false,
    /** @type {any} */
    credentials: null,
    /** @type {any} */
    lastReconcile: null,
    lastError: ''
  }

  state.csrfToken = randomToken()

  /**
   * 读 volatile 字段的实时值。
   *
   * 0.1.7 里条目 config 的字段是 volatile 引用（cosmokit）：loader 遇到「只有 volatile
   * 字段变化」时就地更新它们，所以 `ref.get()` 永远是最新值——不需要订阅事件来维护
   * 本地快照。测试桩会直接给普通值，所以两种形态都要认。
   */
  const readField = (name, fallback) => {
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

  /** 清单的实时值（= 本条目 config 解析后的结果）。 */
  const settingsView = () => {
    try {
      return normalizeSettings({
        enabled: readField('enabled', DEFAULT_SETTINGS.enabled),
        servers: readField('servers', DEFAULT_SETTINGS.servers)
      })
    } catch (error) {
      state.lastError = `读取设置失败：${String(error?.message ?? error)}`
      return normalizeSettings(DEFAULT_SETTINGS)
    }
  }

  /** profile 组合里已声明的 MCP 行（只读视图）。 */
  const profileTargets = () => {
    const loader = typeof ctx.get === 'function' ? ctx.get('loader') : undefined
    if (typeof loader?.entries !== 'function') return []
    /** @type {any[]} */
    const entries = []
    for (const entry of loader.entries()) {
      const options = entry?.options ?? {}
      if (options.group) continue
      const fiber = entry.fiber
      entries.push({
        entryId: typeof entry.id === 'string' ? entry.id : '',
        moduleName: typeof options.name === 'string' ? options.name : '',
        config: options.config ?? {},
        disabled: entry.disabled === true,
        phase: fiber === undefined || fiber === null ? null : FIBER_PHASE[fiber.state] ?? null
      })
    }
    return describeProfileTargets(entries)
  }

  /** 被 profile 占用的 serverName（用于冲突提示）。 */
  const reservedNames = () => {
    /** @type {Map<string, string>} */
    const map = new Map()
    for (const row of profileTargets()) {
      if (row.enabled && row.serverName !== '') map.set(row.serverName, '配置文件中的 MCP 条目')
    }
    return map
  }

  /** 对账一次：把设置投影成运行中的实例。 */
  const reconcile = async (reason) => {
    if (state.mountManager === null) return
    try {
      const settings = settingsView()
      const summary = await state.mountManager.reconcile(settings, reservedNames())
      state.lastReconcile = { reason, at: Date.now(), ...summary }
      if (summary.blocked.length > 0) {
        log('warn', `${summary.blocked.length} 个条目未挂载：${summary.blocked.map((item) => `${item.serverName || item.id}（${item.reason}）`).join('；')}`)
      }
    } catch (error) {
      state.lastError = String(error?.message ?? error)
      log('error', `对账失败：${state.lastError}`)
    }
  }

  ctx.effect(() => () => {
    void state.mountManager?.disposeAll?.()
  }, `${PLUGIN_NAME}: mounts`)

  // ── 启动装配（异步：先做版本门与模块定位）────────────────────────────────
  void (async () => {
    try {
      const pkg = await readDshPackage()
      const verdict = classifyDshVersion(pkg.version)
      state.version = pkg.version
      state.versionSupported = verdict.supported
      if (!verdict.supported) {
        state.runtime = 'unsupported-dsh'
        log('error', `DSH ${pkg.version} 不在兼容范围 ${DSH_COMPATIBILITY_RANGE} 内，插件不装配`)
        return
      }
      if (!verdict.verified) {
        log('warn', `DSH ${pkg.version} 位于兼容发布线内但未逐版本验证，继续装配`)
      }
    } catch (error) {
      state.runtime = 'unsupported-dsh'
      log('error', `无法定位 DSH 安装：${String(error?.message ?? error)}`)
      return
    }

    const loaded = await loadDshModule(ctx, { specifier: MCP_CLIENT_MODULE })
    state.loadErrors = loaded.errors
    if (!loaded.ok) {
      state.runtime = 'mcp-client-unavailable'
      log('error', `无法加载 ${MCP_CLIENT_MODULE}：${loaded.errors.join(' | ')}`)
      return
    }
    state.module = loaded.module
    state.moduleStrategy = loaded.strategy

    // 凭据服务（可选）：缺失时占位符一律视为未配置。
    ctx.inject(['credentials'], (credentialsCtx) => {
      state.credentials = credentialsCtx.credentials
      credentialsCtx.effect(() => () => {
        state.credentials = null
      }, `${PLUGIN_NAME}: credentials`)
      // 凭据值变化（界面写入或文件被外部编辑）后自动重新对账：
      // 否则「刚填完 token 却还是被拦」需要用户再点一次「重新对账」。
      // 对账本身幂等，无条件触发不会造成多余挂载。
      if (typeof credentialsCtx.on === 'function') {
        credentialsCtx.on('credentials/reference-updated', () => {
          void reconcile('credentials')
        })
      }
    })

    state.mountManager = createMountManager({
      ctx,
      mcpModule: state.module,
      resolveCredential: async (ref) => {
        const credentials = state.credentials
        if (credentials === null || typeof credentials.resolve !== 'function') return undefined
        return await credentials.resolve(ref)
      },
      log
    })
    state.runtime = 'ready'

    // 0.1.7 起设置就是本条目 config：没有需要注册的命名空间，只需要向壳层声明
    // 「本实例自带设置页」（`settings.section` 里已有 `mcp-manager`），否则官方表单
    // 会再自动生成一页，同一个条目出现两个设置页。
    ctx.inject(['settings'], (settingsCtx) => {
      const settings = settingsCtx.settings
      state.settingsService = settings ?? null
      state.settingsAvailable = settings !== undefined && Config !== undefined
      settingsCtx.effect(() => () => {
        state.settingsService = null
        state.settingsAvailable = false
      }, `${PLUGIN_NAME}: settings reference`)
      if (Config === undefined) {
        log('warn', 'schemastery 不可用：本条目没有可编辑 schema，设置页无法持久化改动')
      }
      if (typeof settings?.configure === 'function') {
        settingsCtx.effect(
          () => settings.configure({ auto: false }, ctx.fiber),
          `${PLUGIN_NAME}: settings presentation`
        )
      }
    })

    // 设置写入落成条目 config 的 volatile 字段：loader 就地更新运行中 fiber 的引用后
    // 发出这个事件，它就是"改设置 → 重新对账"的触发源（0.1.6 的 settings scope watch 已不存在）。
    ctx.on('loader/volatile-update', () => {
      void reconcile('settings')
    })

    // 启动对账：清单（条目 config，含组合层默认值）→ 运行实例。
    // 与设置服务是否可用无关：没有 settings 服务时照样按条目 config 挂载服务器。
    void reconcile('startup')

    registerRoutes(ctx, state, {
      profileTargets,
      reconcile,
      settingsView,
      log,
      /**
       * 验证一份还没保存的条目。
       *
       * 客户端会把整条表单原样送进来，因此这里必须自己规范化 + 校验：
       * 走的是与保存完全同一条通路（`normalizeServer` → `validateServer` → 探针），
       * 保证"验证通过"与"存下去能用"是同一个口径。
       */
      verify: async (rawServer) => {
        const normalized = normalizeServer(rawServer ?? {}, 0)
        if (state.mountManager === null) {
          return { ok: false, error: '宿主还没装配好 MCP 客户端模块，暂时无法验证' }
        }
        const settings = settingsView()
        const issues = validateServer(normalized, {
          takenNames: settings.servers.filter((item) => item.id !== normalized.id).map((item) => item.serverName),
          idToName: new Map(settings.servers.filter((item) => item.id !== normalized.id).map((item) => [item.serverName, item.id]))
        })
        const owner = reservedNames().get(normalized.serverName)
        if (owner !== undefined) {
          issues.push(`服务器名「${normalized.serverName}」已被 ${owner} 使用`)
        }
        if (issues.length > 0) return { ok: false, error: issues.join('；') }
        return await state.mountManager.probe(normalized)
      }
    })
  })()
}

/**
 * 注册浏览器侧要用的状态与动作路由。
 *
 * `webServer` 与 `connection` 都按可选服务注入：非 web profile 下本插件仍然
 * 会挂载服务器（它本来就是 host 面的），只是没有浏览器状态页。
 *
 * @param {any} ctx
 * @param {any} state
 * @param {{profileTargets: () => any[], reconcile: (reason: string) => Promise<void>, settingsView: () => any, log: (level: string, message: string) => void}} hooks
 */
function registerRoutes(ctx, state, hooks) {
  ctx.inject(['webServer'], (webCtx) => {
    const connection = typeof webCtx.get === 'function' ? webCtx.get('connection') : undefined
    const webServer = webCtx.webServer
    if (typeof webServer?.register !== 'function') return

    webCtx.effect(() => webServer.register({
      kind: 'exact',
      path: STATUS_PATH,
      handler: async (req, res) => {
        const rejection = clientRequestRejection(req, connection)
        if (rejection !== undefined) return sendJson(res, rejection, { ok: false, error: 'forbidden' })
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return sendJson(res, 200, statusPayload(state, hooks))
      }
    }), `${PLUGIN_NAME}: status route`)

    webCtx.effect(() => webServer.register({
      kind: 'exact',
      path: ACTION_PATH,
      handler: async (req, res) => {
        const rejection = clientRequestRejection(req, connection)
        if (rejection !== undefined) return sendJson(res, rejection, { ok: false, error: 'forbidden' })
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        if (requestHeader(req, CSRF_HEADER) !== state.csrfToken) return sendJson(res, 403, { ok: false, error: 'bad-csrf' })
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          return sendJson(res, error?.status ?? 400, { ok: false, error: String(error?.message ?? error) })
        }
        // 统一兜底：动作里任何异常都要变成可读 JSON。
        // 曾经漏掉这一层，未捕获的拒绝让 node:http 直接回了一个**空 body 的 400**，
        // 页面上只看到"宿主拒绝了该操作"，完全没法排查（本次实测踩到）。
        try {
          if (!ACTIONS.includes(body.action)) {
            return sendJson(res, 400, { ok: false, error: `unknown action "${String(body.action)}"` })
          }
          if (body.action === 'reconcile') {
            await hooks.reconcile('manual')
            return sendJson(res, 200, { ok: true })
          }
          if (body.action === 'import') {
            const found = findMcpEntryConfig(ctx, String(body.entryId ?? ''))
            if (found === undefined) {
              return sendJson(res, 200, { ok: true, value: { ok: false, error: '找不到这条配置（可能刚被改动），刷新页面后再试' } })
            }
            if (found.config === null) {
              return sendJson(res, 200, {
                ok: true,
                value: {
                  ok: false,
                  error: '这一条当前没有运行实例，读不到它的实际取值（!!js 表达式要等它运行才求值）。请在配置文件里先启用它，或手动填写。'
                }
              })
            }
            const result = await importFromProfileEntry({
              entryConfig: found.config,
              takenIds: hooks.settingsView().servers.map((item) => item.id),
              credentials: state.credentials
            })
            return sendJson(res, 200, { ok: true, value: result })
          }
          if (body.action === 'verify') {
            // 只验证、不保存：用一个临时挂载的探针实例试连，拿到工具清单后立刻卸载。
            const result = await hooks.verify(body.server)
            return sendJson(res, 200, { ok: true, value: result })
          }
          return sendJson(res, 400, { ok: false, error: `unknown action "${String(body.action)}"` })
        } catch (error) {
          hooks.log('error', `动作 ${String(body.action)} 失败：${String(error?.stack ?? error)}`)
          return sendJson(res, 200, { ok: true, value: { ok: false, error: `动作执行失败：${String(error?.message ?? error)}` } })
        }
      }
    }), `${PLUGIN_NAME}: action route`)
  })
}

/**
 * 按 entryId 取 profile 里那条 mcp-client 条目**实际在跑的** config。
 *
 * 为什么读 `entry.fiber.config` 而不是 `entry.options.config`：
 * 后者存的是**未求值的** `!!js` 表达式对象（`{ __jsExpr: "…" }`），求值发生在插件构造时——
 * 用 `options.config` 导入会得到一个"看起来没有请求头"的结果（本插件实测踩过：
 * 导入 jira 时 URL 与 Authorization 全丢，因为 `Authorization` 的值不是字符串而是表达式对象）。
 * `fiber.config` 是 `_resolveConfig()` 之后的产物（内部 `internal/config` 瀑布先 interpolate，
 * 再按插件 Config schema 补默认值），正是这一行真实使用的配置。
 *
 * @param {any} ctx
 * @param {string} entryId
 * @returns {{entry: any, config: any} | undefined}
 */
function findMcpEntryConfig(ctx, entryId) {
  const loader = typeof ctx.get === 'function' ? ctx.get('loader') : undefined
  if (typeof loader?.entries !== 'function' || entryId === '') return undefined
  for (const entry of loader.entries()) {
    if (entry?.id !== entryId) continue
    if (entry.options?.name !== MCP_CLIENT_MODULE) return undefined
    const config = entry.fiber?.config
    return { entry, config: config !== null && typeof config === 'object' ? config : null }
  }
  return undefined
}

/**
 * 状态载荷：设置视图 + 运行投影 + profile 只读行。
 * @param {any} state
 * @param {any} hooks
 * @returns {any}
 */
export function statusPayload(state, hooks) {
  const settings = hooks.settingsView()
  const profileTargets = hooks.profileTargets()
  /** @type {Map<string, string>} */
  const live = new Map()
  for (const item of state.mountManager?.status?.() ?? []) live.set(item.id, item)
  /** @type {Map<string, string>} */
  const blocked = new Map()
  for (const item of state.lastReconcile?.blocked ?? []) blocked.set(item.id, item.reason)
  // 与配置文件同名的提示走**纯读**路径：patch 改动会热加载，用户在页面上刷新就能看到
  // 冲突，不必等到下一次对账。（对账本身仍只在设置/凭据写入或手动动作时跑。）
  /** @type {Map<string, string>} */
  const profileNames = new Map()
  for (const row of profileTargets) if (row.serverName !== '') profileNames.set(row.serverName, row.entryId)
  return {
    ok: true,
    csrf: state.csrfToken,
    // 宿主声明的动作白名单：客户端据此提前禁用按钮，避免"点了才发现宿主是旧版"
    //（老宿主不返回这个字段，客户端按未知处理、仍可点击并靠 400 的错误映射兜住）
    actions: ACTIONS,
    runtime: state.runtime,
    dshVersion: state.version,
    versionSupported: state.versionSupported,
    compatibilityRange: DSH_COMPATIBILITY_RANGE,
    verifiedVersions: VERIFIED_DSH_VERSIONS,
    settingsAvailable: state.settingsAvailable === true,
    mcpModule: { ok: state.module !== null, strategy: state.moduleStrategy ?? '', errors: state.loadErrors },
    lastError: state.lastError,
    lastReconcile: state.lastReconcile,
    defaults: DEFAULT_SETTINGS,
    servers: settings.servers.map((server) => ({
      ...describeServer(server),
      live: live.get(server.id) ?? null,
      blockedReason: blocked.get(server.id) ?? '',
      conflictNote:
        profileNames.has(server.serverName)
          ? `配置文件里也声明了同名服务器「${server.serverName}」（${profileNames.get(server.serverName)}）；两边只能留一个，否则配置文件那一条会加载失败`
          : ''
    })),
    totalEnabled: settings.enabled,
    profileTargets
  }
}

// ── HTTP 细节（与 dsh-local-plugin-manager 同款安全姿态）───────────────────

/** @param {any} req @param {string} name @returns {string | undefined} */
function requestHeader(req, name) {
  const value = req.headers?.[name]
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' ? value : undefined
}

/** @param {any} req @returns {boolean} */
function loopbackRequest(req) {
  const address = req.socket?.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * 同源判断。
 * @param {any} req
 * @returns {boolean}
 */
export function sameOriginRequest(req) {
  if (!loopbackRequest(req)) return false
  const fetchSite = requestHeader(req, 'sec-fetch-site')
  if (fetchSite !== undefined && fetchSite !== 'same-origin') return false
  const origin = requestHeader(req, 'origin')
  if (origin === undefined) return fetchSite === undefined || fetchSite === 'same-origin'
  const host = requestHeader(req, 'host')
  if (host === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

/**
 * 复用 DSH 自身的浏览器鉴权边界，再叠加同源与固定客户端头。
 * @param {any} req
 * @param {any} connection
 * @returns {number | undefined} 非空即拒绝时的状态码
 */
export function clientRequestRejection(req, connection) {
  if (typeof connection?.requestRejection === 'function') {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) return rejection
  }
  return sameOriginRequest(req) && requestHeader(req, CLIENT_HEADER) === '1' ? undefined : 403
}

/** @param {any} res @param {number} status @param {any} value */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(body)
}

/**
 * 读取并校验 JSON 请求体。
 * @param {any} req
 * @param {number} [maxBytes]
 * @returns {Promise<any>}
 */
export async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const contentType = requestHeader(req, 'content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw Object.assign(new Error('请求必须使用 application/json。'), { status: 415 })
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw Object.assign(new Error('请求内容过大。'), { status: 413 })
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('根节点不是对象')
    return value
  } catch (error) {
    throw Object.assign(new Error(`请求不是有效 JSON：${String(error?.message ?? error)}`), { status: 400 })
  }
}

/** @returns {string} */
function randomToken() {
  try {
    return randomUUID()
  } catch {
    return `t${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  }
}

/**
 * 按 DSH 安装的绝对路径加载 schemastery（宿主侧 schema 必须是真正的 schemastery 对象）。
 *
 * 在**模块作用域**调用：loader 在 `plugin()` 时读 `plugin.Config`，所以 schema 必须
 * 在模块求值期就构造好。装载失败时 `Config` 为 undefined——插件照常运行（挂载与
 * 状态页都可用），只是设置页写不进去，状态接口会给出 `settingsAvailable:false`。
 *
 * @param {string} root `@deepseek-ai/dsh` 的安装目录
 * @returns {Promise<any | null>}
 */
async function loadSchemastery(root) {
  try {
    const require = createRequire(join(root, 'package.json'))
    const imported = await import(require.resolve('@deepseek-ai/schemastery'))
    return imported.default ?? imported
  } catch {
    return null
  }
}

/**
 * 本条目（= 设置命名空间）的 schema。字段与 store.normalizeServer 一一对应。
 *
 * 所有可写字段都 `.volatile()`：只有这样 loader 才会把「设置页写入」当作 volatile
 * 变化就地更新（不重启插件、已挂载的连接不闪断）；漏掉 `.volatile()` 的字段会让更新
 * 走"重启插件"的生命周期，全部实例重建。
 *
 * @param {any} z
 * @returns {any}
 */
export function createConfigSchema(z) {
  const server = z.object({
    id: z.string().default(''),
    label: z.string().default(''),
    enabled: z.boolean().default(true),
    transport: z.union([z.const('stdio'), z.const('streamable-http')]).default('stdio'),
    serverName: z.string().default(''),
    command: z.string().default(''),
    args: z.array(String).default([]),
    cwd: z.string().default(''),
    env: z.dict(String).default({}),
    url: z.string().default(''),
    headers: z.dict(String).default({}),
    toolCallTimeoutMs: z.number().default(60_000),
    failOnStartupError: z.boolean().default(false)
  })
  return z.object({
    enabled: z.boolean().default(true).volatile(),
    servers: z.array(server).default([]).volatile()
  })
}
