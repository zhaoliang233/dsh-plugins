/**
 * 纯逻辑：把 profile 组合里已声明的 MCP 条目整理成只读视图，并支持导入成
 * 官方 mcp-manager 条目。
 *
 * 背景：官方 mcp-manager 只管它自己的 `config.servers` 与插件注册的服务器；
 * 组合层（cordis.patch.yml / bundle）里手写的 `dsh-mcp-client` 行不在它的视野内。
 * 本插件把这些行读出来展示成「启动配置声明（只读）」，并允许导入到官方清单
 * ——不直接改写用户那份文件（它含手写注释与 `!!js` 表达式）。
 *
 * 安全约束：组合层的 config 已经过 `!!js` 求值，Authorization / env 里可能
 * 就是明文密钥。本模块因此只输出「键名 + 端点骨架」，绝不回显值；导入时
 * 敏感值换成 `${credential:键名}` 模板，明文由宿主写进凭据库。
 *
 * @module dsh-mcp-workbench/targets
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

/** 值本身就长得像凭证（`Bearer xxx` / `Basic xxx`）。 */
const CREDENTIAL_VALUE = /^\s*(Bearer|Basic)\s+\S+/iu
/** URL 里带凭证的两种形态：查询串里的敏感参数名，或 userinfo。 */
const CREDENTIAL_URL = /[?&](token|key|secret|password|sig|signature|api[-_]?key)=|\/\/[^/@\s]+:[^/@\s]+@/iu

/**
 * 把组合层里已经声明的一条 MCP 配置转成官方 mcp-manager 条目。
 *
 * 两条硬约束决定了这里的做法：
 * 1. loader 里的 config 已经过 `!!js` 求值——`Authorization` 之类的字段拿到的就是**明文**。
 *    所以导入结果里绝不原样带上它：敏感字段一律换成 `${credential:<键名>}` 模板，
 *    明文由调用方（宿主）写进凭据库，浏览器侧只看得到键名。
 * 2. 非敏感字段（URL、命令、参数、工作目录、超时、普通环境变量/请求头）照抄，
 *    否则"导入"等于让用户重填一遍。
 *
 * @param {object} input
 * @param {any} input.config loader 条目里的 config（已求值）
 * @param {(field: 'env'|'headers'|'url', key: string) => string} input.credentialKeyFor 生成凭据键名
 * @returns {{entry: any, credentials: Array<{ref: string, value: string, field: string, key: string}>, notes: string[]}}
 */
export function importEntryFromConfig({ config, credentialKeyFor }) {
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
        plain[key] = `\${credential:${ref}}`
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
    url = `\${credential:${ref}}`
  }

  if (source.failOnStartupError === true) {
    notes.push('「首次连接失败即拒绝」选项不会迁移（官方管理器改为重连并在状态里报告失败）')
  }

  const timeout = Number(source.toolCallTimeoutMs)
  return {
    entry: {
      serverName,
      transport,
      command: typeof source.command === 'string' ? source.command : '',
      args: Array.isArray(source.args) ? source.args.filter((item) => typeof item === 'string') : [],
      cwd: typeof source.cwd === 'string' ? source.cwd : '',
      env,
      url,
      headers,
      // 导入后先停用：用户确认并保存时再走「探测通过才启用」，避免把一条坏配置直接挂上。
      enabled: false,
      ...(Number.isFinite(timeout) && timeout > 0 ? { toolCallTimeoutMs: Math.floor(timeout) } : {})
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
  const padded = cleaned === '' ? 'MCP_VALUE' : cleaned === 'MCP' ? 'MCP_VALUE' : cleaned
  return padded.slice(0, 60)
}
