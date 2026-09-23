/**
 * 纯逻辑：服务器条目的规范化、校验、凭据占位符、挂载配置生成。
 *
 * 本文件不依赖 Cordis、不碰文件系统，可被 `node --test` 独立驱动。
 * 契约与 @deepseek-ai/dsh-mcp-client 的 Config schema 对齐（0.1.7-alpha.2）：
 * - serverName 必须匹配 /^[A-Za-z0-9_-]{1,32}$/，且在一个注册作用域内唯一；
 * - stdio 必填 command，streamable-http 必填 url；
 * - toolCallTimeoutMs 默认 60000，failOnStartupError 默认 false。
 *
 * @module dsh-mcp-manager/store
 */

export const PLUGIN_NAME = 'dsh-mcp-manager'
/**
 * 本插件在 profile 里的条目 id——也是设置的命名空间。
 *
 * 0.1.7 起插件的设置**就是条目本身的 config**：宿主 `settings.describe()` 的 `ns`
 * 与客户端 `ctx.configForms.get(id)` 用的都是这个 id（bundle 提供的条目默认取包名）。
 * 0.1.6 的 `settings.register('mcp-manager', …)` 独立命名空间已不存在，
 * 所以清单的落盘位置从 `~/.dsh/settings.yaml` 变成 profile 的 `cordis.patch.yml`。
 */
export const SETTINGS_ENTRY = 'dsh-mcp-manager'

/** 与 dsh-mcp-client 的 SERVER_NAME_PATTERN 同源。 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000
export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, servers: [] })
export const TRANSPORTS = Object.freeze(['stdio', 'streamable-http'])

/**
 * 凭据占位符语法：值里任何 `credential:<KEY>` 都在挂载时被替换成
 * `ctx.credentials.resolve(KEY)` 的明文。KEY 与 credentials 服务的 ref
 * 语法一致（`/^[A-Za-z_][A-Za-z0-9_]*$/`）。
 *
 * 这样设计的原因：MCP 的 headers/env 需要「最终明文」才能交给传输层，
 * 但明文不该写进 settings.yaml。占位符让 settings 里只有键名，
 * 值存在 ~/.dsh/.credentials.yaml（或环境/.env，只读兜底）。
 */
export const CREDENTIAL_TOKEN = /credential:([A-Za-z_][A-Za-z0-9_]*)/gu

/**
 * 值里出现的凭据键（去重、保持出现顺序）。
 * @param {unknown} text
 * @returns {string[]}
 */
export function credentialRefsIn(text) {
  if (typeof text !== 'string' || text === '') return []
  const keys = []
  for (const match of text.matchAll(CREDENTIAL_TOKEN)) {
    if (!keys.includes(match[1])) keys.push(match[1])
  }
  return keys
}

/**
 * 替换字符串里的凭据占位符。
 * @param {string} text
 * @param {(key: string) => string | undefined} resolve 返回明文；未配置时返回 undefined
 * @returns {{ value: string, missing: string[] }}
 */
export function substituteCredentials(text, resolve) {
  const missing = []
  const value = text.replace(CREDENTIAL_TOKEN, (whole, key) => {
    const resolved = resolve(key)
    if (typeof resolved !== 'string' || resolved === '') {
      missing.push(key)
      return whole
    }
    return resolved
  })
  return { value, missing }
}

/**
 * 把任意名字收敛成合法的 serverName。
 * @param {unknown} value
 * @returns {string}
 */
export function toServerName(value) {
  const raw = typeof value === 'string' ? value : ''
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/gu, '-').replace(/^-+|-+$/gu, '')
  return cleaned.slice(0, 32)
}

/**
 * 生成稳定、可读的条目 id。
 * @param {Iterable<string>} taken
 * @returns {string}
 */
export function newServerId(taken = []) {
  const used = new Set(taken)
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = `srv-${Math.random().toString(16).slice(2, 10)}`
    if (!used.has(candidate)) return candidate
  }
  return `srv-${Date.now().toString(16)}`
}

/** @param {unknown} value @returns {string} */
function text(value) {
  return typeof value === 'string' ? value : ''
}

/** @param {unknown} value @returns {string[]} */
function stringList(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string')
}

/** @param {unknown} value @returns {Record<string, string>} */
function stringDict(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  /** @type {Record<string, string>} */
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry
  }
  return out
}

/**
 * 规范化单个服务器条目：未知字段丢弃、类型不符回落默认值。
 * @param {any} raw
 * @param {number} index 仅用于兜底 serverName
 * @returns {any}
 */
export function normalizeServer(raw, index = 0) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const transport = TRANSPORTS.includes(source.transport) ? source.transport : 'stdio'
  // 名字**不**做静默清洗：非法字符必须由 validateServer 报出来，
  // 否则界面上显示的名字与实际挂载用的名字会不一致。
  const serverName = text(source.serverName).trim() || `server-${index + 1}`
  const timeout = Number(source.toolCallTimeoutMs)
  return {
    id: text(source.id) || `legacy-${index + 1}`,
    label: text(source.label),
    enabled: source.enabled !== false,
    transport,
    serverName,
    command: text(source.command),
    args: stringList(source.args),
    cwd: text(source.cwd),
    env: stringDict(source.env),
    url: text(source.url),
    headers: stringDict(source.headers),
    toolCallTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TOOL_CALL_TIMEOUT_MS,
    failOnStartupError: source.failOnStartupError === true
  }
}

/**
 * 规范化整份设置。
 * @param {any} raw
 * @returns {{enabled: boolean, servers: any[]}}
 */
export function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const servers = Array.isArray(source.servers) ? source.servers.map(normalizeServer) : []
  /** @type {Set<string>} */
  const seen = new Set()
  for (const server of servers) {
    while (seen.has(server.id)) server.id = newServerId(seen)
    seen.add(server.id)
  }
  return { enabled: source.enabled !== false, servers }
}

/**
 * 校验一个条目是否可挂载。返回人类可读的问题列表（空数组 = 可挂载）。
 * @param {any} server 已规范化的条目
 * @param {{takenNames?: Iterable<string>, selfId?: string, idToName?: Map<string,string>}} [options]
 * @returns {string[]}
 */
export function validateServer(server, options = {}) {
  const issues = []
  if (server === null || typeof server !== 'object') return ['条目不是对象']
  if (!SERVER_NAME_PATTERN.test(text(server.serverName))) {
    issues.push(`服务器名必须是 1-32 位的字母、数字、下划线或短横线（当前「${text(server.serverName)}」）`)
  }
  if (!TRANSPORTS.includes(server.transport)) issues.push(`未知传输方式「${String(server.transport)}」`)
  if (server.transport === 'stdio') {
    if (text(server.command) === '') issues.push('stdio 传输必须填写可执行命令')
  } else if (server.transport === 'streamable-http') {
    const url = text(server.url)
    if (url === '') {
      issues.push('streamable-http 传输必须填写 URL')
    } else {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') issues.push('URL 只支持 http/https')
      } catch {
        issues.push(`URL「${url}」无法解析`)
      }
    }
  }
  const takenNames = options.takenNames
  if (takenNames !== undefined) {
    for (const name of takenNames) {
      if (name !== server.serverName) continue
      // 名字与他人重复：只有当占用者不是自己时才报错
      const owner = options.idToName?.get(server.serverName)
      if (owner === undefined || owner === server.id) continue
      issues.push(`服务器名「${server.serverName}」已被另一个条目占用`)
    }
  }
  return issues
}

/**
 * 生成交给 @deepseek-ai/dsh-mcp-client 的 Config。
 * @param {any} server 已规范化条目
 * @param {(value: string) => {value: string, missing: string[]}} resolveText 凭据替换
 * @returns {{config: any, missing: string[]}}
 */
export function mountConfigFor(server, resolveText) {
  /** @type {string[]} */
  const missing = []
  const substitute = (value) => {
    const result = resolveText(value)
    missing.push(...result.missing)
    return result.value
  }
  /** @type {Record<string, string>} */
  const env = {}
  for (const [key, value] of Object.entries(server.env ?? {})) env[key] = substitute(value)
  /** @type {Record<string, string>} */
  const headers = {}
  for (const [key, value] of Object.entries(server.headers ?? {})) headers[key] = substitute(value)

  const base = {
    serverName: server.serverName,
    toolCallTimeoutMs: server.toolCallTimeoutMs,
    failOnStartupError: server.failOnStartupError === true
  }
  const config =
    server.transport === 'stdio'
      ? { ...base, transport: 'stdio', command: server.command, args: [...(server.args ?? [])], env, cwd: server.cwd ?? '' }
      : // URL 也过一遍凭据替换：查询串里带 token 的端点在真实部署里很常见
        { ...base, transport: 'streamable-http', url: substitute(server.url ?? ''), headers }
  return { config, missing: [...new Set(missing)] }
}

/**
 * 比较两份挂载配置是否等价（决定是否需要重挂）。
 * @param {any} left
 * @param {any} right
 * @returns {boolean}
 */
export function sameMountConfig(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

/** @param {any} value @returns {string} */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

/**
 * 状态接口用的条目投影：不含凭据明文（settings 里本来也只有占位符）。
 * @param {any} server
 * @returns {any}
 */
export function describeServer(server) {
  return {
    id: server.id,
    label: server.label,
    enabled: server.enabled,
    transport: server.transport,
    serverName: server.serverName,
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    url: server.url,
    toolCallTimeoutMs: server.toolCallTimeoutMs,
    failOnStartupError: server.failOnStartupError,
    envKeys: Object.keys(server.env ?? {}),
    headerKeys: Object.keys(server.headers ?? {}),
    // URL 也要算：`mountConfigFor` 对它同样做替换（查询串里带 token 的端点很常见），
    // 少这一处就会出现"挂载认识它、界面却不给填"的裂缝。
    credentialRefs: [
      ...new Set([
        ...credentialRefsIn(server.url ?? ''),
        ...Object.values(server.env ?? {}).flatMap(credentialRefsIn),
        ...Object.values(server.headers ?? {}).flatMap(credentialRefsIn)
      ])
    ],
    issues: validateServer(server)
  }
}
