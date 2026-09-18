/**
 * 纯逻辑：把 profile 组合里已声明的 MCP 条目整理成只读视图。
 *
 * 背景：MCP 服务器目前只能在 profile 的 cordis.patch.yml / bundle 组合里手写。
 * 本插件不去改写用户那份文件（它含手写注释与 `!!js` 表达式），而是把这些行
 * 读出来展示成「配置文件声明（只读）」，让用户看得见全部在跑的服务器。
 *
 * 安全约束：组合层的 config 已经过 `!!js` 求值，Authorization / env 里可能
 * 就是明文密钥。本模块因此只输出「键名 + 端点骨架」，绝不回显值。
 *
 * @module dsh-mcp-manager/targets
 */

const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** 与 dsh-subprocess 的擦洗模式同源：这类名字的值一律不回显。 */
const SENSITIVE_KEY = /KEY|PASSWORD|SECRET|TOKEN|AUTH/iu

/**
 * 把 loader 条目投影成只读的 MCP 目标行。
 * @param {Array<{entryId: string, moduleName: string, config: any, disabled: boolean, phase: string | null}>} entries
 * @returns {any[]}
 */
export function describeProfileTargets(entries) {
  const rows = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    if (entry.moduleName !== MCP_CLIENT_MODULE) continue
    const config = entry.config !== null && typeof entry.config === 'object' ? entry.config : {}
    const transport = config.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
    const env = config.env !== null && typeof config.env === 'object' ? config.env : {}
    const headers = config.headers !== null && typeof config.headers === 'object' ? config.headers : {}
    rows.push({
      source: 'profile',
      entryId: typeof entry.entryId === 'string' ? entry.entryId : '',
      serverName: typeof config.serverName === 'string' ? config.serverName : '',
      transport,
      enabled: entry.disabled !== true,
      phase: entry.phase ?? null,
      endpoint: transport === 'streamable-http' ? safeEndpoint(config.url) : commandSummary(config),
      envKeys: Object.keys(env),
      headerKeys: Object.keys(headers),
      hasSensitiveValues: [...Object.keys(env), ...Object.keys(headers)].some((key) => SENSITIVE_KEY.test(key))
    })
  }
  return rows
}

/**
 * 只保留端点骨架：去掉查询串与凭证（查询串里常有临时 token）。
 * @param {unknown} url
 * @returns {string}
 */
function safeEndpoint(url) {
  if (typeof url !== 'string' || url === '') return ''
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '(无法解析的 URL)'
  }
}

/**
 * stdio 只显示可执行文件名与参数个数：参数里可能有 token。
 * @param {any} config
 * @returns {string}
 */
function commandSummary(config) {
  const command = typeof config.command === 'string' ? config.command : ''
  if (command === '') return ''
  const base = command.split('/').pop() ?? command
  const args = Array.isArray(config.args) ? config.args.length : 0
  return args === 0 ? base : `${base}（${args} 个参数）`
}

/**
 * 判断一个组合条目是否由本插件托管（用于把自己那条排除掉）。
 * @param {{entryId: string, moduleName: string}} entry
 * @param {string} pluginName
 * @returns {boolean}
 */
export function isSelfEntry(entry, pluginName) {
  return entry.entryId === pluginName || entry.moduleName === pluginName
}

/** 值本身就长得像凭证（`Bearer xxx` / `Basic xxx`）。 */
const CREDENTIAL_VALUE = /^\s*(Bearer|Basic)\s+\S+/iu
/** URL 里带凭证的两种形态：查询串里的敏感参数名，或 userinfo。 */
const CREDENTIAL_URL = /[?&](token|key|secret|password|sig|signature|api[-_]?key)=|\/\/[^/@\s]+:[^/@\s]+@/iu

/**
 * 把 profile 里已经声明的一条 MCP 配置**完整**转成草稿。
 *
 * 两条硬约束决定了这里的做法：
 * 1. loader 里的 config 已经过 `!!js` 求值——`Authorization` 之类的字段拿到的就是**明文**。
 *    所以草稿里绝不原样带上它：敏感字段一律换成 `credential:<键名>` 占位符，
 *    明文由调用方（宿主）写进凭据库，浏览器侧只看得到键名。
 * 2. 非敏感字段（URL、命令、参数、工作目录、超时、普通环境变量/请求头）照抄，
 *    否则"导入"等于让用户重填一遍（用户实测反馈：导进来只有名字和传输方式，配置全丢了）。
 *
 * @param {object} input
 * @param {string} input.id 新条目的 id
 * @param {any} input.config loader 条目里的 config（已求值）
 * @param {(field: 'env'|'headers', key: string) => string} input.credentialKeyFor 生成凭据键名
 * @returns {{draft: any, credentials: Array<{ref: string, value: string, field: string, key: string}>, notes: string[]}}
 */
export function importDraftFromConfig({ id, config, credentialKeyFor }) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const serverName = typeof source.serverName === 'string' ? source.serverName : ''
  const transport = source.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  /** @type {Array<{ref: string, value: string, field: string, key: string}>} */
  const credentials = []
  /** @type {string[]} */
  const notes = []

  const split = (field, values) => {
    /** @type {Record<string, string>} */
    const plain = {}
    for (const [key, value] of Object.entries(values ?? {})) {
      if (typeof value !== 'string') continue
      if (SENSITIVE_KEY.test(key) || CREDENTIAL_VALUE.test(value)) {
        const ref = credentialKeyFor(field, key)
        credentials.push({ ref, value, field, key })
        plain[key] = `credential:${ref}`
      } else {
        plain[key] = value
      }
    }
    return plain
  }

  const env = split('env', source.env)
  const headers = split('headers', source.headers)

  // URL 里带 token/userinfo 时，整条 URL 也只能进凭据库：它没法像请求头那样只替换一段。
  let url = typeof source.url === 'string' ? source.url : ''
  if (transport === 'streamable-http' && CREDENTIAL_URL.test(url)) {
    const ref = credentialKeyFor('url', 'URL')
    credentials.push({ ref, value: url, field: 'url', key: 'URL' })
    url = `credential:${ref}`
  }

  // 说明文案放在最后生成：这样 URL 那条凭据也会被列进来
  if (credentials.length > 0) {
    // 刻意不在这里生成"敏感字段已转入凭据库…"这类提示：字段旁边的说明已经讲清值去哪，
    // 而且用户把凭据键删掉之后那句话就成了假消息（用户实测反馈过）。
  }

  const timeout = Number(source.toolCallTimeoutMs)
  return {
    draft: {
      id,
      enabled: false,
      label: `${serverName}（导入自配置文件）`,
      transport,
      serverName,
      command: typeof source.command === 'string' ? source.command : '',
      args: Array.isArray(source.args) ? source.args.filter((item) => typeof item === 'string') : [],
      cwd: typeof source.cwd === 'string' ? source.cwd : '',
      env,
      url,
      headers,
      toolCallTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 60_000,
      failOnStartupError: source.failOnStartupError === true
    },
    credentials,
    notes
  }
}

/**
 * 由服务器名与字段名生成合法的凭据键名（credentials 的 ref 语法是 POSIX 标识符）。
 * @param {string} serverName
 * @param {string} field
 * @param {string} key
 * @returns {string}
 */
export function credentialKeyFor(serverName, field, key) {
  const cleaned = `MCP_${serverName}_${field}_${key}`
    .replace(/[^A-Za-z0-9_]/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toUpperCase()
  // 输入全空时只会剩下前缀，补一段后缀让它仍然可读且合法
  const padded = cleaned === '' ? 'MCP_VALUE' : cleaned === 'MCP' ? 'MCP_VALUE' : cleaned
  return padded.slice(0, 60)
}
