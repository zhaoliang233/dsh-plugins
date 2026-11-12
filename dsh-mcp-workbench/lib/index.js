/**
 * dsh-mcp-workbench 宿主半体（改造后：官方 mcp-manager 管理面的宿主侧）。
 *
 * 职责只剩三件：
 * 1. 运行版本门（与 `package.json#dshCompatibility` / `install.sh` 同源）；
 * 2. 在 Loader 里定位官方 `@deepseek-ai/dsh-mcp-manager` 条目，告诉客户端
 *    真实的设置命名空间 id（浏览器侧拿不到条目名 → 包名的映射）；
 * 3. 提供带鉴权的状态路由。
 *
 * **不**再自己加载 mcp-client、不挂载实例、不对账——那些全部交给官方
 * `ctx.mcpManager`；服务器清单本身存放在官方条目的 `config.servers` 里，
 * 由浏览器经 `configForms` 读写。
 *
 * @module dsh-mcp-workbench
 */

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import {
  DSH_COMPATIBILITY_RANGE,
  VERIFIED_DSH_VERSIONS,
  classifyDshVersion,
  readDshPackage
} from './dsh.js'
import {
  DEFAULT_MANAGER_ENTRY,
  MANAGER_MODULE,
  PLUGIN_NAME,
  SETTINGS_ENTRY
} from './store.js'
import { credentialKeyFor, describeProfileTargets, importEntryFromConfig } from './targets.js'

export {
  DSH_COMPATIBILITY_RANGE,
  MANAGER_MODULE,
  PLUGIN_NAME,
  SETTINGS_ENTRY,
  VERIFIED_DSH_VERSIONS,
  classifyDshVersion
}

export const STATUS_PATH = '/dsh-mcp-workbench/status'
export const ACTION_PATH = '/dsh-mcp-workbench/action'
export const CLIENT_HEADER = 'x-dsh-mcp-workbench-client'
export const CSRF_HEADER = 'x-dsh-mcp-workbench-csrf'
export const MAX_BODY_BYTES = 16 * 1024
/** 动作白名单：只保留「从组合层导入」这一件事；清单写入走官方设置通道。 */
export const ACTIONS = Object.freeze(['import'])

/**
 * 本插件的宿主依赖：只需要 Loader 来定位官方管理器条目。
 * `webServer` / `connection` 在路由注册处按可选服务注入，非 web profile 不阻塞启动。
 */
export const inject = ['loader']

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
 * 本插件在 profile 里的条目 schema。
 *
 * 改造后它**不再承载服务器清单**：`servers` 只作为旧版本数据的迁移源保留，
 * 界面也不写它。保留 schema 的原因有两个：
 * 1. 旧条目必须在 `settings.describe()` 里出现，客户端才能用
 *    `configForms.get('dsh-mcp-workbench')` 读到待迁移的旧清单；
 * 2. `settings.configure({auto:false})` 需要一个有 schema 的条目来声明
 *    「本实例自带设置页」，否则官方会给这个条目再自动生成一页。
 */
const schemastery = await (async () => {
  try {
    const { root } = await readDshPackage()
    return await loadSchemastery(root)
  } catch {
    return null
  }
})()

export const Config = schemastery === null ? undefined : createLegacyConfigSchema(schemastery)

/**
 * 宿主入口。
 * @param {any} ctx
 */
export function apply(ctx, _config = {}) {
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
    versionVerified: false,
    runtime: 'starting',
    csrfToken: randomToken(),
    /** @type {any} */
    credentials: null,
    lastError: ''
  }

  /** 只读探测官方 mcp-manager 条目。 */
  const managerEntry = () => {
    const loader = typeof ctx.get === 'function' ? ctx.get('loader') : undefined
    if (typeof loader?.entries !== 'function') {
      return { available: false, entryId: DEFAULT_MANAGER_ENTRY, moduleName: MANAGER_MODULE, phase: null, reason: 'loader-unavailable' }
    }
    let found
    try {
      for (const entry of loader.entries()) {
        if (entry?.options?.name !== MANAGER_MODULE) continue
        found = entry
        break
      }
    } catch (error) {
      state.lastError = `读取 Loader 条目失败：${String(error?.message ?? error)}`
      return { available: false, entryId: DEFAULT_MANAGER_ENTRY, moduleName: MANAGER_MODULE, phase: null, reason: 'loader-error' }
    }
    if (found === undefined) {
      return { available: false, entryId: DEFAULT_MANAGER_ENTRY, moduleName: MANAGER_MODULE, phase: null, reason: 'missing' }
    }
    const fiber = found.fiber
    const phase = fiber === undefined || fiber === null ? null : FIBER_PHASE[fiber.state] ?? null
    const disabled = found.disabled === true
    // **设置命名空间是 `options.id`，不是 loader 行 id**：include 展开后 `entry.id`
    // 形如 `include:mcp-manager`，而 `settings.describe()` 的 `ns` 用的是
    // `entry.options.id`（web-app 补丁里那一行 `- id: mcp-manager`）。客户端
    // `configForms.get(<ns>)` 必须拿到后者，否则会得到 `unavailable`。
    const entryId =
      typeof found.options?.id === 'string' && found.options.id !== ''
        ? found.options.id
        : typeof found.id === 'string' && found.id !== ''
          ? found.id
          : DEFAULT_MANAGER_ENTRY
    const reason = disabled ? 'disabled' : phase === 'active' ? 'found' : phase === null ? 'inactive' : phase
    return {
      available: !disabled && phase === 'active',
      entryId,
      moduleName: MANAGER_MODULE,
      phase,
      reason
    }
  }

  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    if (typeof settings?.configure !== 'function') return
    settingsCtx.effect(
      () => settings.configure({ auto: false }, ctx.fiber),
      `${PLUGIN_NAME}: settings presentation`
    )
  })

  // 凭据服务（可选）：导入组合层条目时把明文写进凭据库，浏览器只拿到模板键名。
  ctx.inject(['credentials'], (credentialsCtx) => {
    state.credentials = credentialsCtx.credentials ?? null
    credentialsCtx.effect(
      () => () => {
        state.credentials = null
      },
      `${PLUGIN_NAME}: credentials`
    )
  })

  /** profile 组合里已声明的 MCP 行（只读视图，脱敏）。 */
  const profileTargets = () => {
    const loader = typeof ctx.get === 'function' ? ctx.get('loader') : undefined
    if (typeof loader?.entries !== 'function') return []
    /** @type {any[]} */
    const entries = []
    try {
      for (const entry of loader.entries()) {
        const options = entry?.options ?? {}
        if (options.group) continue
        entries.push({
          entryId: typeof entry.id === 'string' ? entry.id : '',
          moduleName: typeof options.name === 'string' ? options.name : '',
          config: options.config ?? {},
          disabled: entry.disabled === true,
          phase: entry.fiber === undefined || entry.fiber === null ? null : FIBER_PHASE[entry.fiber.state] ?? null
        })
      }
    } catch (error) {
      state.lastError = `读取 Loader 条目失败：${String(error?.message ?? error)}`
      return []
    }
    return describeProfileTargets(entries)
  }

  /**
   * 把组合层一条 MCP 行完整导入成官方条目（敏感值 → 凭据库 + 模板）。
   * @param {string} entryId
   * @returns {Promise<{ok: boolean, error?: string, entry?: any, notes?: string[]}>}
   */
  const importEntry = async (entryId) => {
    const found = findMcpEntryConfig(ctx, entryId)
    if (found === undefined) {
      return { ok: false, error: '找不到这条配置（可能刚被改动），刷新页面后再试' }
    }
    if (found.config === null) {
      return {
        ok: false,
        error: '这一条当前没有运行实例，读不到它的实际取值（!!js 表达式要等它运行才求值）。请先在启动配置里启用它，或手动填写。'
      }
    }
    const serverName = typeof found.config.serverName === 'string' ? found.config.serverName : ''
    const planned = importEntryFromConfig({
      config: found.config,
      credentialKeyFor: (field, key) => credentialKeyFor(serverName, field, key)
    })
    /** @type {string[]} */
    const notes = [...planned.notes]
    if (planned.credentials.length > 0) {
      if (state.credentials === null || typeof state.credentials?.set !== 'function') {
        notes.push('宿主没有可用的凭据服务：敏感字段仍是模板占位符，请在弹窗的凭据区手动填写值。')
      } else {
        /** @type {string[]} */
        const failed = []
        for (const item of planned.credentials) {
          try {
            await state.credentials.set(item.ref, item.value)
          } catch (error) {
            failed.push(`${item.ref}（${String(error?.message ?? error)}）`)
          }
        }
        if (failed.length > 0) notes.push(`以下凭据写入失败，请手动补：${failed.join('、')}`)
      }
    }
    return { ok: true, entry: planned.entry, notes }
  }

  // 启动装配：只做版本门（同步定位失败也不影响路由注册，status 会报告原因）。
  void (async () => {
    try {
      const pkg = await readDshPackage()
      const verdict = classifyDshVersion(pkg.version)
      state.version = pkg.version
      state.versionSupported = verdict.supported
      state.versionVerified = verdict.verified
      if (!verdict.supported) {
        state.runtime = 'unsupported-dsh'
        log('error', `DSH ${pkg.version} 不在兼容范围 ${DSH_COMPATIBILITY_RANGE} 内，插件不装配状态路由`)
        return
      }
      if (!verdict.verified) {
        log('warn', `DSH ${pkg.version} 位于兼容发布线内但未逐版本验证，继续装配`)
      }
      const manager = managerEntry()
      if (!manager.available) {
        state.runtime = 'manager-missing'
        log('warn', `没有找到可用的官方 MCP 管理器条目（reason: ${manager.reason}）；设置页会提示需要 DSH 0.2.2-rc.2 及以上`)
      } else {
        state.runtime = 'ready'
      }
      registerRoutes(ctx, state, { managerEntry, profileTargets, importEntry, log })
    } catch (error) {
      state.runtime = 'unsupported-dsh'
      state.lastError = `无法定位 DSH 安装：${String(error?.message ?? error)}`
      log('error', state.lastError)
    }
  })()
}

/**
 * 注册浏览器侧要用的状态路由。
 *
 * `webServer` 与 `connection` 都按可选服务注入：非 web profile 下本插件只是
 * 没有浏览器状态页，不阻塞宿主启动。`connection` 必须作为**注入依赖**等待就绪，
 * 不能在 `ctx.inject(['webServer'])` 的回调里 `ctx.get('connection')` 抓一次——
 * cordis 的 `get(name, strict)` 在服务 fiber 未 active 时直接返回 undefined，
 * 而 webServer 与 connection 是兄弟服务，谁先就绪没有保证。
 *
 * @param {any} ctx
 * @param {any} state
 * @param {{managerEntry: () => any, profileTargets: () => any[], importEntry: (entryId: string) => Promise<any>, log: (level: string, message: string) => void}} hooks
 */
function registerRoutes(ctx, state, hooks) {
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    const connection = webCtx.connection
    const webServer = webCtx.webServer
    if (typeof webServer?.register !== 'function') return

    webCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: STATUS_PATH,
          handler: async (req, res) => {
            const rejection = clientRequestRejection(req, connection)
            if (rejection !== undefined) return sendJson(res, rejection, { ok: false, error: 'forbidden' })
            if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
            return sendJson(res, 200, statusPayload(state, hooks))
          }
        }),
      `${PLUGIN_NAME}: status route`
    )

    webCtx.effect(
      () =>
        webServer.register({
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
            // 统一兜底：动作里任何异常都要变成可读 JSON。少这一层时未捕获的拒绝会让
            // node:http 直接回一个空 body 的 400，页面只显示"宿主拒绝了该操作"。
            try {
              if (!ACTIONS.includes(body.action)) {
                return sendJson(res, 400, { ok: false, error: `unknown action "${String(body.action)}"` })
              }
              const value = await hooks.importEntry(String(body.entryId ?? ''))
              return sendJson(res, 200, { ok: true, value })
            } catch (error) {
              hooks.log('error', `动作 ${String(body.action)} 失败：${String(error?.stack ?? error)}`)
              return sendJson(res, 200, { ok: true, value: { ok: false, error: `动作执行失败：${String(error?.message ?? error)}` } })
            }
          }
        }),
      `${PLUGIN_NAME}: action route`
    )
  })
}

/**
 * 按 entryId 取 profile 里那条 MCP 条目**实际在跑的** config。
 *
 * 读 `entry.fiber.config` 而不是 `entry.options.config`：后者是**未求值**的 `!!js`
 * 表达式对象，用它导入会静默丢掉字段（旧版本实测踩过：导入 jira 时 URL 与
 * Authorization 全没了）。`fiber.config` 是 `_resolveConfig()` 之后的产物。
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
    if (entry.options?.name !== '@deepseek-ai/dsh-mcp-client') return undefined
    const config = entry.fiber?.config
    return { entry, config: config !== null && typeof config === 'object' ? config : null }
  }
  return undefined
}

/**
 * 状态载荷：版本门 + 官方管理器条目定位 + 组合层只读行。
 * @param {any} state
 * @param {{managerEntry: () => any, profileTargets: () => any[]}} hooks
 * @returns {any}
 */
export function statusPayload(state, hooks) {
  const manager = hooks.managerEntry()
  return {
    ok: true,
    csrf: state.csrfToken,
    actions: ACTIONS,
    runtime: state.runtime,
    dshVersion: state.version,
    versionSupported: state.versionSupported,
    versionVerified: state.versionVerified,
    compatibilityRange: DSH_COMPATIBILITY_RANGE,
    verifiedVersions: VERIFIED_DSH_VERSIONS,
    manager,
    settingsEntry: SETTINGS_ENTRY,
    profileTargets: typeof hooks.profileTargets === 'function' ? hooks.profileTargets() : [],
    lastError: state.lastError
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
  // 连接层是这类路由的鉴权来源：拿不到就 fail closed，不能退化成"只校验同源 + 固定头"。
  if (typeof connection?.requestRejection !== 'function') return 401
  const rejection = connection.requestRejection(req)
  if (rejection !== undefined) return rejection
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

/** @param {any} req @param {number} [maxBytes] @returns {Promise<any>} */
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
 * 旧条目的 schema：只用于让迁移源出现在 `settings.describe()` 里。
 *
 * 字段与 0.1.x 的 `store.normalizeServer` 一致（保持旧数据可读），
 * 但**所有字段都不需要 volatile**——界面不再写它，Host 也不监听它的变化。
 *
 * @param {any} z
 * @returns {any}
 */
export function createLegacyConfigSchema(z) {
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
    enabled: z.boolean().default(true),
    servers: z.array(server).default([])
  })
}
