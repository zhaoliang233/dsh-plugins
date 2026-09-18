/**
 * 挂载管理器：把 settings 里的服务器清单投影成真正运行的 MCP 客户端实例。
 *
 * 机制（已在本机隔离环境实机验证，见 README 的验证段）：
 * - 动态挂载用 `ctx.plugin(mcpModule, config)`。`@deepseek-ai/dsh-mcp-client`
 *   是「命名导出、无 default」的 ESM 模块，其导出对象同时带 apply 与 Config，
 *   正是 Cordis `plugin()` 接受的插件形状（官方 `dsh-acp` 对会话级 MCP 用的就是这条路）；
 * - 卸载用 `fiber.dispose()`：mcp-client 把连接释放挂在 `ctx.effect` 上，dispose 会
 *   关闭 transport、停掉重连、注销工具与 resource provider、释放 serverName 预留；
 * - 工具注册在调用者所在的注册层。本插件是 host 面插件，因此挂在全局层，
 *   所有会话/子代理都看得到——与 profile 里手写 insert 行的效果一致；
 * - 工具表每个 step 由 system prompt 组装时重新收集，所以增删在**下一步**生效，
 *   不需要重启宿主（host 组合与 bundle 列表不含本插件的改动）。
 *
 * @module dsh-mcp-manager/mount-manager
 */

import { mountConfigFor, substituteCredentials, credentialRefsIn, canonicalJson, validateServer } from './store.js'
import { planReconcile } from './plan.js'

const MAX_LOG_LINES = 12
/** 验证探针的超时：连接 + 首次工具同步都要在这个窗口里完成。 */
export const PROBE_TIMEOUT_MS = 20_000

/**
 * 一个服务器条目的运行态。
 * @typedef {object} MountRecord
 * @property {any} config 交给 mcp-client 的配置
 * @property {string} configKey 配置指纹
 * @property {any} fiber Cordis fiber（用于卸载）
 * @property {'mounted'|'failed'} state
 * @property {string} error
 * @property {number} mountedAt
 */

/**
 * @param {object} options
 * @param {any} options.ctx host 上下文（需要 tools 服务）
 * @param {any} options.mcpModule `@deepseek-ai/dsh-mcp-client` 的模块对象
 * @param {(ref: string) => Promise<{value?: string} | undefined>} [options.resolveCredential]
 * @param {(level: string, message: string) => void} [options.log]
 */
export function createMountManager({ ctx, mcpModule, resolveCredential, log }) {
  /** @type {Map<string, MountRecord>} */
  const records = new Map()
  /** @type {Map<string, string[]>} serverName → 最近的 mcp-client 日志行 */
  const recentLogs = new Map()

  const emit = (level, message) => {
    if (typeof log === 'function') log(level, message)
  }

  // 捕获 mcp-client 自己的告警/错误（重连、放弃、连接失败），供状态页诊断。
  if (typeof ctx.logger?.exporter === 'function') {
    ctx.logger.exporter({
      colors: 0,
      export: (message) => {
        try {
          const text = renderLogMessage(message)
          if (!text.includes('mcp-client')) return
          const name = serverNameFromLog(text)
          if (name === undefined) return
          const lines = recentLogs.get(name) ?? []
          lines.push(text)
          recentLogs.set(name, lines.slice(-MAX_LOG_LINES))
        } catch {
          /* 日志捕获绝不向上抛，避免污染宿主日志链路 */
        }
      }
    })
  }

  /** 当前已挂载实例的配置指纹（对账输入）。 */
  const fingerprints = () => {
    /** @type {Map<string, {configKey: string}>} */
    const map = new Map()
    for (const [id, record] of records) map.set(id, { configKey: record.configKey })
    return map
  }

  /**
   * 把条目里的凭据占位符解析成明文替换函数。
   * @param {any} server
   * @returns {Promise<{resolve: (text: string) => {value: string, missing: string[]}}>}
   */
  async function credentialSubstituter(server) {
    /** @type {Map<string, string>} */
    const values = new Map()
    if (typeof resolveCredential === 'function') {
      // URL 也要预解析：mountConfigFor 对 url 同样做替换，这里漏掉就会"认识占位符但永远解析不到"，
      // 条目被误判成缺凭据（本插件实测踩到）。
      const keys = [
        ...new Set([
          ...credentialRefsIn(server.url ?? ''),
          ...Object.values(server.env ?? {}).flatMap(credentialRefsIn),
          ...Object.values(server.headers ?? {}).flatMap(credentialRefsIn)
        ])
      ]
      for (const key of keys) {
        try {
          const resolved = await resolveCredential(key)
          if (typeof resolved?.value === 'string' && resolved.value !== '') values.set(key, resolved.value)
        } catch (error) {
          emit('warn', `解析凭据 ${key} 失败：${String(error?.message ?? error)}`)
        }
      }
    }
    return { resolve: (source) => substituteCredentials(source, (key) => values.get(key)) }
  }

  /**
   * 卸载一个已挂载实例。幂等：不存在时直接返回。
   * @param {string} id
   */
  async function unmount(id) {
    const record = records.get(id)
    if (record === undefined) return
    records.delete(id)
    recentLogs.delete(record.config.serverName)
    try {
      await record.fiber?.dispose?.()
    } catch (error) {
      emit('warn', `卸载 ${record.config.serverName} 失败：${String(error?.message ?? error)}`)
    }
  }

  /**
   * 挂载一个条目。
   * @param {{id: string, serverName: string, config: any, configKey: string}} entry
   */
  async function mount(entry) {
    /** @type {MountRecord} */
    const record = {
      config: entry.config,
      configKey: entry.configKey,
      fiber: undefined,
      state: 'mounted',
      error: '',
      mountedAt: Date.now()
    }
    try {
      const fiber = ctx.plugin(mcpModule, entry.config)
      // 等待 apply 结束：连接与首次工具同步都在这之前完成。
      await fiber
      record.fiber = fiber
      records.set(entry.id, record)
      emit('info', `已挂载 MCP 服务器 ${entry.serverName}`)
    } catch (error) {
      const message = String(error?.message ?? error)
      record.state = 'failed'
      record.error = message
      records.set(entry.id, record)
      emit('error', `挂载 MCP 服务器 ${entry.serverName} 失败：${message}`)
    }
  }

  /**
   * 依据设置对账一次。
   * @param {{enabled: boolean, servers: any[]}} settings
   * @param {Map<string, string>} [profileNames] profile 组合已占用的 serverName → 来源描述
   * @returns {Promise<{mounted: string[], unmounted: string[], blocked: any[], unchanged: string[]}>}
   */
  async function reconcile(settings, profileNames = new Map()) {
    // 先异步解析凭据，再同步算出配置与指纹。
    /** @type {Map<string, {config: any, missing: string[]}>} */
    const prepared = new Map()
    for (const server of settings.servers) {
      const substituter = await credentialSubstituter(server)
      prepared.set(server.id, mountConfigFor(server, substituter.resolve))
    }

    const plan = planReconcile({
      settings,
      actual: fingerprints(),
      profileNames,
      resolveConfig: (server) => ({
        config: prepared.get(server.id)?.config ?? {},
        missing: prepared.get(server.id)?.missing ?? []
      }),
      validate: (server) => validateServer(server, { takenNames: settings.servers.map((item) => item.serverName), idToName: new Map(settings.servers.map((item) => [item.serverName, item.id])) })
    })

    /** @type {string[]} */
    const unmounted = []
    for (const id of plan.unmount) {
      if (records.has(id)) {
        unmounted.push(records.get(id)?.config?.serverName ?? id)
        await unmount(id)
      } else {
        records.delete(id)
      }
    }

    /** @type {any[]} */
    const blocked = [...plan.blocked]
    for (const entry of plan.mount) {
      if (entry.missingCredentials.length > 0) {
        blocked.push({
          id: entry.id,
          serverName: entry.serverName,
          reason: `凭据 ${entry.missingCredentials.join('、')} 未配置；请在条目里填写，或先到设置 > 插件里配置该键`
        })
        continue
      }
      await mount(entry)
    }

    return { mounted: plan.mount.map((entry) => entry.serverName), unmounted, blocked, unchanged: plan.unchanged }
  }

  /**
   * 运行态快照。
   * @returns {any[]}
   */
  function status() {
    /** @type {any[]} */
    const out = []
    for (const [id, record] of records) {
      const serverName = String(record.config?.serverName ?? '')
      out.push({
        id,
        serverName,
        state: record.state,
        error: record.error,
        mountedAt: record.mountedAt,
        tools: toolNamesFor(ctx, serverName).sort(),
        logs: recentLogs.get(serverName) ?? []
      })
    }
    return out
  }


  /**
   * 验证一个**尚未保存**的条目：临时挂载、拿结果、立刻卸载。
   *
   * 两个关键设计：
   * - 用独立的临时 `serverName`（`probe<随机>`）：`serverName` 只是本地命名空间、
   *   不会发给对端（wire 上只用原始工具名），所以探针既不与已挂载实例抢名字，
   *   也不会因为"编辑时保持原名"而撞上自己的预留；
   * - `failOnStartupError: true`：验证要的是确定答案，"连不上"必须变成失败，
   *   而不是像运行期那样静默重连（运行期默认关闭该开关）。
   *
   * 探针失败不影响任何已挂载实例，也永远不写设置。
   *
   * @param {any} server 已规范化的条目
   * @param {{timeoutMs?: number}} [options]
   * @returns {Promise<{ok: boolean, tools?: string[], elapsedMs?: number, error?: string}>}
   */
  async function probe(server, options = {}) {
    const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : PROBE_TIMEOUT_MS
    const substituter = await credentialSubstituter(server)
    const prepared = mountConfigFor(server, substituter.resolve)
    if (prepared.missing.length > 0) {
      return { ok: false, error: `凭据 ${[...new Set(prepared.missing)].join('、')} 未配置` }
    }
    const probeName = makeProbeName()
    const started = Date.now()
    let fiber
    let timer
    try {
      fiber = ctx.plugin(mcpModule, { ...prepared.config, serverName: probeName, failOnStartupError: true })
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`验证超时（${Math.round(timeoutMs / 1000)} 秒内没有连上）`)), timeoutMs)
      })
      await Promise.race([Promise.resolve(fiber), timeout])
    } catch (error) {
      // 失败的 fiber 也要收掉：它会带着失败的连接与可能的子进程。
      if (fiber !== undefined) {
        try {
          await fiber.dispose()
        } catch (cleanupError) {
          emit('warn', `验证失败后清理探针实例也失败：${String(cleanupError?.message ?? cleanupError)}`)
        }
      }
      return { ok: false, error: describeProbeError(error) }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    const tools = toolNamesFor(ctx, probeName).map((name) => name.slice(`mcp__${probeName}__`.length))
    try {
      await fiber.dispose()
    } catch (error) {
      emit('warn', `验证实例清理失败：${String(error?.message ?? error)}`)
    }
    return { ok: true, tools, elapsedMs: Date.now() - started }
  }

  /** 卸载全部实例（插件停用/卸载时调用）。 */
  async function disposeAll() {
    const ids = [...records.keys()]
    for (const id of ids) await unmount(id)
  }

  return { reconcile, status, unmount, disposeAll, probe, fingerprints, sameConfig: (left, right) => canonicalJson(left) === canonicalJson(right) }
}

/**
 * 全局层里属于某个 serverName 的 MCP 工具名。
 * @param {any} ctx
 * @param {string} serverName
 * @returns {string[]}
 */
function toolNamesFor(ctx, serverName) {
  try {
    const view = ctx.tools?.view?.()
    const names = view?.knownNames
    if (names === undefined) return []
    const prefix = `mcp__${serverName}__`
    return [...names].filter((name) => typeof name === 'string' && name.startsWith(prefix))
  } catch {
    return []
  }
}

/** 探针用的临时 serverName：合法字符集、长度 < 32、带随机尾巴避免并发撞名。 */
function makeProbeName() {
  const tail = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.replace(/[^A-Za-z0-9_-]/gu, '')
  return `probe${tail}`.slice(0, 32)
}

/**
 * 把探针失败的原因收敛成一句用户能读懂的话。
 * @param {unknown} error
 * @returns {string}
 */
export function describeProbeError(error) {
  const message = String(error?.message ?? error)
  if (/already in use/u.test(message)) return '这个服务器名已被占用，请换一个'
  if (/timed out|timeout|TimeoutError|验证超时/u.test(message)) return message.includes('验证超时') ? message : '连接超时，服务器没有在预期时间内响应'
  if (/ENOENT|not found|spawn/u.test(message)) return `启动命令无法执行：${message}`
  return message
}

/**
 * 把日志消息渲染成一行文本（字段形状取自 cordis 的 Logger）。
 * @param {any} message
 * @returns {string}
 */
function renderLogMessage(message) {
  if (typeof message === 'string') return message
  const args = Array.isArray(message?.args) ? message.args : []
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.message
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

/**
 * 从 `mcp-client(<name>): ...` 形态的日志里取出服务器名。
 * @param {string} text
 * @returns {string | undefined}
 */
function serverNameFromLog(text) {
  const match = /mcp-client\(([^)]+)\)/u.exec(text)
  return match?.[1]
}
