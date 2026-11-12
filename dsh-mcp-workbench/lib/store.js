/**
 * 纯逻辑：官方 mcp-manager 条目的规范化、校验、凭据模板与状态投影。
 *
 * 本文件不依赖 Cordis、不碰文件系统，可被 `node --test` 独立驱动。
 * 契约与 `@deepseek-ai/dsh-mcp-manager` 的 `McpManagedServerEntry` 对齐
 * （0.2.2-rc.2 逐字核对）：
 * - `Config.servers` 是 `Record<serverName, Entry>`，key 即 serverName；
 * - serverName 必须匹配 /^[A-Za-z0-9_-]{1,32}$/，且在组合范围内唯一；
 * - stdio 必填 command，streamable-http 必填 url；
 * - `startupTimeoutMs` 默认 30000，`toolCallTimeoutMs`/`closeTimeoutMs` 可省略
 *   （省略时由 mcp-client 用自身默认值），`reconnect` 有默认策略；
 * - 凭据模板语法是 `${credential:REF}`（与旧版本插件自己的 `credential:REF` 不同）。
 *
 * @module dsh-mcp-workbench/store
 */

export const PLUGIN_NAME = 'dsh-mcp-workbench'
/**
 * 本插件在 profile 里的条目 id。
 *
 * 改造后它不再承载服务器清单（那些写入官方 mcp-manager 条目的 `config.servers`），
 * 但仍保留这个条目：Host 半体靠它运行版本门与状态路由，旧版本迁移也读它的
 * `servers` 字段作为迁移源。
 */
export const SETTINGS_ENTRY = 'dsh-mcp-workbench'

/** 官方 MCP 管理器包名。 */
export const MANAGER_MODULE = '@deepseek-ai/dsh-mcp-manager'
/** 官方在 web profile 里给管理器用的默认条目 id。 */
export const DEFAULT_MANAGER_ENTRY = 'mcp-manager'

/** 与 dsh-mcp-client / mcp-manager 的 SERVER_NAME_PATTERN 同源。 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
export const DEFAULT_STARTUP_TIMEOUT_MS = 30_000
export const TRANSPORTS = Object.freeze(['stdio', 'streamable-http'])

/** 官方 mcp-manager 的 reconnect 默认策略（与 `RECONNECT_DEFAULTS` 同源）。 */
export const DEFAULT_RECONNECT = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10
})

/**
 * 官方凭据模板语法：`${credential:REF}`。
 *
 * 这是 `dsh-credentials` / `mcp-client` 的模板约定，不是本插件自己的发明；
 * 旧版本插件用的 `credential:REF`（不带 `${}`）在迁移时逐个转换。
 */
export const CREDENTIAL_TEMPLATE = /\$\{credential:([A-Za-z_][A-Za-z0-9_]*)\}/gu
/** 旧的、不带模板包装的占位符——只在迁移旧数据时识别。 */
export const LEGACY_CREDENTIAL_TOKEN = /(?<![\w$])credential:([A-Za-z_][A-Za-z0-9_]*)(?![\w}])/gu

/**
 * 值里出现的官方凭据键（去重、保持出现顺序）。
 * @param {unknown} text
 * @returns {string[]}
 */
export function credentialRefsIn(text) {
  if (typeof text !== 'string' || text === '') return []
  const keys = []
  for (const match of text.matchAll(CREDENTIAL_TEMPLATE)) {
    if (!keys.includes(match[1])) keys.push(match[1])
  }
  return keys
}

/**
 * 把任意名字收敛成合法的 serverName。
 * @param {unknown} value
 * @returns {string}
 */
export function toServerName(value) {
  const raw = typeof value === 'string' ? value : ''
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return cleaned.slice(0, 32)
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
 * 规范化单个官方条目：未知字段丢弃、类型不符回落默认值。
 * @param {any} raw
 * @param {string} [fallbackName] 名字兜底（dict key 缺失时）
 * @returns {any}
 */
export function normalizeEntry(raw, fallbackName = '') {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const transport = TRANSPORTS.includes(source.transport) ? source.transport : 'stdio'
  const timeout = Number(source.toolCallTimeoutMs)
  const startup = Number(source.startupTimeoutMs)
  const close = Number(source.closeTimeoutMs)
  const reconnect = normalizeReconnect(source.reconnect)
  return {
    transport,
    command: text(source.command),
    args: stringList(source.args),
    env: stringDict(source.env),
    cwd: text(source.cwd),
    url: text(source.url),
    headers: stringDict(source.headers),
    enabled: source.enabled !== false,
    ...(Number.isFinite(timeout) && timeout > 0 ? { toolCallTimeoutMs: Math.floor(timeout) } : {}),
    startupTimeoutMs: Number.isFinite(startup) && startup > 0 ? Math.floor(startup) : DEFAULT_STARTUP_TIMEOUT_MS,
    ...(Number.isFinite(close) && close > 0 ? { closeTimeoutMs: Math.floor(close) } : {}),
    reconnect,
    /** 只用于界面展示的名字（来自 dict key，不写回官方条目）。 */
    serverName: text(fallbackName).trim()
  }
}

/**
 * 规范化 reconnect 策略。
 * @param {unknown} raw
 * @returns {any}
 */
export function normalizeReconnect(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const number = (value, fallback) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
  }
  return {
    enabled: source.enabled !== false,
    initialDelayMs: number(source.initialDelayMs, DEFAULT_RECONNECT.initialDelayMs),
    maxDelayMs: number(source.maxDelayMs, DEFAULT_RECONNECT.maxDelayMs),
    maxAttempts: number(source.maxAttempts, DEFAULT_RECONNECT.maxAttempts)
  }
}

/**
 * 把官方 `servers` dict 规范成有序数组（界面按名字排序，保证稳定）。
 * @param {unknown} value
 * @returns {any[]}
 */
export function normalizeServers(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value)
    .sort()
    .map((name) => normalizeEntry(value[name], name))
}

/**
 * 官方条目 → dict 记录（写回 config.servers 时用）。
 * 去掉界面专用的 `serverName` 字段。
 * @param {any} entry
 * @param {string} name
 * @returns {any}
 */
export function entryRecord(entry, name) {
  const normalized = normalizeEntry(entry, name)
  const { serverName: _ignored, ...record } = normalized
  return record
}

/**
 * 校验一个条目是否可写入。返回人类可读的问题列表（空数组 = 可写入）。
 * @param {any} entry 已规范化的条目
 * @param {{name?: string, takenNames?: Iterable<string>, takenNameIsSelf?: boolean}} [options]
 * @returns {string[]}
 */
export function validateEntry(entry, options = {}) {
  const issues = []
  if (entry === null || typeof entry !== 'object') return ['条目不是对象']
  const name = text(options.name ?? entry.serverName)
  if (!SERVER_NAME_PATTERN.test(name)) {
    issues.push(`服务器名必须是 1-32 位的字母、数字、下划线或短横线（当前「${name}」）`)
  }
  if (!TRANSPORTS.includes(entry.transport)) issues.push(`未知传输方式「${String(entry.transport)}」`)
  if (entry.transport === 'stdio') {
    if (text(entry.command) === '') issues.push('stdio 传输必须填写可执行命令')
  } else if (entry.transport === 'streamable-http') {
    const url = text(entry.url)
    if (url === '') {
      issues.push('streamable-http 传输必须填写 URL')
    } else if (!/\$\{credential:/u.test(url)) {
      // URL 里允许凭据模板；只有不含模板时才要求它是可解析的 http(s) URL。
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') issues.push('URL 只支持 http/https')
      } catch {
        issues.push(`URL「${url}」无法解析`)
      }
    }
  }
  if (options.takenNameIsSelf !== true) {
    for (const taken of options.takenNames ?? []) {
      if (taken === name) {
        issues.push(`服务器名「${name}」已被另一个条目占用`)
        break
      }
    }
  }
  if (Number(entry.startupTimeoutMs) <= 0) issues.push('启动超时必须大于 0 毫秒')
  return issues
}

/**
 * 状态接口用的条目投影：不含凭据明文（模板里只有键名）。
 * @param {string} name
 * @param {any} entry
 * @returns {any}
 */
export function describeEntry(name, entry) {
  const normalized = normalizeEntry(entry, name)
  return {
    serverName: name,
    transport: normalized.transport,
    command: normalized.command,
    args: normalized.args,
    cwd: normalized.cwd,
    url: normalized.url,
    enabled: normalized.enabled,
    toolCallTimeoutMs: normalized.toolCallTimeoutMs,
    startupTimeoutMs: normalized.startupTimeoutMs,
    closeTimeoutMs: normalized.closeTimeoutMs,
    reconnect: normalized.reconnect,
    envKeys: Object.keys(normalized.env ?? {}),
    headerKeys: Object.keys(normalized.headers ?? {}),
    credentialRefs: [
      ...new Set([
        ...credentialRefsIn(normalized.command ?? ''),
        ...(normalized.args ?? []).flatMap(credentialRefsIn),
        ...Object.values(normalized.env ?? {}).flatMap(credentialRefsIn),
        ...credentialRefsIn(normalized.cwd ?? ''),
        ...credentialRefsIn(normalized.url ?? ''),
        ...Object.values(normalized.headers ?? {}).flatMap(credentialRefsIn)
      ])
    ]
  }
}

/**
 * 旧版本插件的条目（`config.servers` 数组项）→ 官方条目。
 *
 * 旧字段与官方字段的差异：
 * - `id`/`label`/`serverName` 是旧插件的展示与身份字段，官方用 dict key 作身份；
 * - `failOnStartupError` 在官方条目里不存在（管理器不因首次连接失败拒绝挂载）；
 * - 凭据占位符是 `credential:KEY`，官方模板是 `${credential:KEY}`。
 *
 * @param {any} legacy
 * @param {string} [fallbackName]
 * @returns {{entry: any, notes: string[]}}
 */
export function legacyToManagedEntry(legacy, fallbackName = '') {
  const source = legacy !== null && typeof legacy === 'object' ? legacy : {}
  const notes = []
  const rawName = text(source.serverName).trim() || toServerName(text(source.label)) || fallbackName
  const convert = (value) => String(value).replace(LEGACY_CREDENTIAL_TOKEN, '${credential:$1}')
  const converted = {
    transport: source.transport,
    command: convert(text(source.command)),
    args: (source.args ?? []).map((item) => convert(text(item))),
    cwd: convert(text(source.cwd)),
    env: Object.fromEntries(Object.entries(stringDict(source.env)).map(([key, value]) => [key, convert(value)])),
    url: convert(text(source.url)),
    headers: Object.fromEntries(Object.entries(stringDict(source.headers)).map(([key, value]) => [key, convert(value)])),
    enabled: source.enabled !== false,
    ...(Number.isFinite(Number(source.toolCallTimeoutMs)) && Number(source.toolCallTimeoutMs) > 0
      ? { toolCallTimeoutMs: Math.floor(Number(source.toolCallTimeoutMs)) }
      : {})
  }
  if (source.label !== undefined && text(source.label) !== '') notes.push(`展示名「${text(source.label)}」不会迁移（官方条目只以服务器名标识）`)
  if (source.failOnStartupError === true) notes.push('「首次连接失败即拒绝」选项不会迁移（官方管理器改为重连并在状态里报告失败）')
  return { entry: normalizeEntry(converted, rawName), notes }
}
