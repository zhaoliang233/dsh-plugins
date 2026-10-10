/**
 * 默认设置覆盖（宿主半体）。
 *
 * 在 DSH Web 的设置里新增一个「默认设置覆盖」分区，把官方插件"写死在 bundle 里的
 * 默认值"变成可配置项。写入走的仍是官方通道 `ctx.configEditor.edit()`：
 * 校验完整候选配置 → 原子写进当前 profile 的 patch（保留注释与 `!!js`）→ Loader 热重载。
 *
 * 客户端通过同源 HTTP 读状态、提交写入（`lib/overrides.js` 里有白名单契约说明）。
 */
import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  ACTION_PATH,
  CLIENT_HEADER,
  CSRF_HEADER,
  ENTRIES,
  PLUGIN_NAME,
  STATUS_PATH,
  describeAdvanced,
  describeSessionEntry,
  describeWhitelist,
  entryDefinition,
  normalizeFieldValue,
  planFieldReset,
  planFieldWrite,
  selectRetitleCandidates,
  sortAndLimitSessions,
  suggestedMaxInputBytes,
  summarizeSessions,
  titleInputBytes
} from './overrides.js'

export { CSRF_HEADER, STATUS_PATH, ACTION_PATH, PLUGIN_NAME }

const MAX_BODY_BYTES = 64 * 1024
/** 会话标题重算列表一次最多展示多少行。 */
const MAX_SESSION_ROWS = 20

/** 宿主抛错的分类：给客户端一个稳定 code，而不是让它猜错误文案。 */
class OverrideError extends Error {
  constructor(code, message, status = 400, detail = undefined) {
    super(message)
    this.name = 'OverrideError'
    this.code = code
    this.status = status
    /** 客户端据此渲染"一键修复"按钮等结构化信息。 */
    this.detail = detail
  }
}

function requestHeader(req, name) {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' ? value : undefined
}

function loopbackRequest(req) {
  const address = req.socket?.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** 同源校验：只接受回环地址上、由本页面发起的请求。 */
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

/** 浏览器来源校验：连接层拒绝 + 同源 + 客户端标记头。 */
export function clientRequestRejection(req, connection) {
  const rejection = connection?.requestRejection?.(req)
  if (rejection !== undefined) return rejection
  return sameOriginRequest(req) && requestHeader(req, CLIENT_HEADER) === '1' ? undefined : 403
}

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

async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const contentType = requestHeader(req, 'content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new OverrideError('invalid-content-type', '请求必须使用 application/json。', 415)
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new OverrideError('request-too-large', '请求内容过大。', 413)
    chunks.push(chunk)
  }
  if (size === 0) throw new OverrideError('empty-body', '请求内容为空。', 400)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new OverrideError('invalid-json', '请求内容不是合法 JSON。', 400)
  }
}

/** 把 configEditor 的原生错误翻译成稳定 code + 用户可读文案。 */
export function translateEditorError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/overridden by a home patch or command-line overlay/iu.test(message)) {
    return new OverrideError(
      'higher-layer-override',
      '该条目被更高优先级的补丁覆盖（home patch 或命令行 --patch），设置页的写入不会生效；请先移除那一层覆盖。',
      409
    )
  }
  if (/no longer available|changed during reload/iu.test(message)) {
    return new OverrideError('entry-unavailable', '条目在写入过程中被替换，请刷新后重试。', 409)
  }
  if (/no longer active/iu.test(message)) {
    return new OverrideError(
      'entry-failed',
      '目标插件当前不是活动状态（常见原因是 patch 里手写了不完整的 config），无法通过设置页写入。',
      409
    )
  }
  return new OverrideError('editor-failed', message, 500)
}

/** 读取一次配置全景，供 status 与写入后的回执复用。 */
function readConfiguration(ctx) {
  const editor = ctx.get('configEditor')
  if (editor === undefined) {
    return { available: false, reason: '当前 profile 没有挂载 config-editor，无法覆盖默认设置。' }
  }
  return {
    available: true,
    documentPath: editor.documentPath,
    rows: editor.configuration()
  }
}

/**
 * 列出当前进程里**需要重算标题**的活跃会话。
 *
 * 只收"兜底截断"那一类（模型命名失败 / 输入超限 / 无凭证）：模型已成功命名或用户手动命名的
 * 会话不进列表，重算成功后来源变成 provider，也就自动从列表消失（用户 2026-09-28 定的口径）。
 * 标题快照只存在于内存，所以这里只看得到当前进程里的 live 会话。
 */
function describeLiveSessions(ctx) {
  const sessions = ctx.get('sessions')
  if (sessions === undefined || typeof sessions.list !== 'function') {
    return { available: false, reason: '当前 profile 没有会话服务。', rows: [], total: 0, needRetitle: 0, overLimit: 0 }
  }
  const sessionTitle = ctx.get('sessionTitle')
  const reader = sessionTitle !== undefined && typeof sessionTitle.get === 'function' ? sessionTitle : undefined
  const inputLimit = readTitleInputLimit(ctx)
  const all = sessions.list().map((session) => {
    const bytes = readSessionInputBytes(ctx, session)
    return describeSessionEntry(session, reader?.get(session), bytes === undefined ? null : { bytes, limit: inputLimit })
  })
  const summary = summarizeSessions(all)
  return {
    available: true,
    reason: '',
    rows: sortAndLimitSessions(selectRetitleCandidates(all), MAX_SESSION_ROWS),
    total: summary.total,
    needRetitle: summary.needRetitle,
    overLimit: summary.overLimit
  }
}

/** 读当前生效的标题输入上限（session-title-llm 的 maxInputBytes）。 */
function readTitleInputLimit(ctx) {
  const editor = ctx.get('configEditor')
  if (editor === undefined || typeof editor.configuration !== 'function') return undefined
  const row = editor.configuration().find((item) => item.entry.options.id === 'session-title-llm')
  const limit = row?.entry?.options?.config?.maxInputBytes
  return typeof limit === 'number' ? limit : undefined
}

/**
 * 读一个会话首条用户消息的"框架后字节数"。
 * 用官方 `titleInput` 投影拿到首条消息，再按官方 `frameMessages()` 的同一算法计算，
 * 这样预检口径与 provider 的 `inputBytes > maxInputBytes` 检查完全一致。
 */
function readSessionInputBytes(ctx, session) {
  const projections = ctx.get('sessionProjections')
  if (projections === undefined || typeof projections.stateOf !== 'function') return undefined
  const state = projections.stateOf(session, 'titleInput')
  const first = state?.first
  if (first === undefined || first === null || typeof first.text !== 'string') return undefined
  return titleInputBytes(first.seq, first.text)
}

/**
 * 把 provider 的超限报错翻译成可操作的中文提示 + 建议上限。
 *
 * `allowPrecheckFallback` 只在**没有抬过上限**时为真：抬过之后重算再失败，
 * 原因就不可能是输入超限（上限已经 ≥ 输入），必须如实透传真实错误——
 * 2026-09-28 踩过：隔离实例里重算因缺少模型凭证失败，却被兜底逻辑误报成"超过上限 4096"。
 * @param error - provider 抛出的原始错误。
 * @param fallbackBytes - 预检出的输入字节数。
 * @param fallbackLimit - 预检时的生效上限。
 * @param allowPrecheckFallback - 是否允许用预检数据兜底成"超限"结论。
 * @param raisedLimit - 本次是否已经把上限抬到了这个值。
 */
export function translateRetitleError(error, fallbackBytes, fallbackLimit, allowPrecheckFallback = true, raisedLimit = undefined) {
  const message = error instanceof Error ? error.message : String(error)
  const matched = /input is (\d+) bytes, exceeding maxInputBytes (\d+)/u.exec(message)
  if (matched !== null) {
    const bytes = Number(matched[1])
    const limit = Number(matched[2])
    const suggestedLimit = suggestedMaxInputBytes(bytes)
    return new OverrideError(
      'title-input-over-limit',
      `该会话首条消息约 ${String(bytes)} 字节，超过标题输入上限 ${String(limit)}；把「输入上限」调到 ${String(suggestedLimit)} 或更大后就能重算（这会写进当前 profile 的补丁，对所有会话生效）。`,
      409,
      { inputBytes: bytes, inputLimit: limit, suggestedLimit }
    )
  }
  if (allowPrecheckFallback && typeof fallbackBytes === 'number' && typeof fallbackLimit === 'number' && fallbackBytes > fallbackLimit) {
    const suggestedLimit = suggestedMaxInputBytes(fallbackBytes)
    return new OverrideError(
      'title-input-over-limit',
      `该会话首条消息约 ${String(fallbackBytes)} 字节，超过标题输入上限 ${String(fallbackLimit)}；把「输入上限」调到 ${String(suggestedLimit)} 或更大后就能重算。`,
      409,
      { inputBytes: fallbackBytes, inputLimit: fallbackLimit, suggestedLimit }
    )
  }
  // 抬过上限就把这件事说清楚，别让用户以为白点了。
  const prefix = raisedLimit === undefined
    ? '重新生成标题失败'
    : `标题输入上限已调到 ${String(raisedLimit)}，但重算仍失败`
  return new OverrideError('retitle-failed', `${prefix}：${message}`, 500, raisedLimit === undefined ? undefined : { raisedLimit })
}

/** 重新生成一个活跃会话的标题（官方 `sessionTitle.refresh()`，官方 UI 没有入口）。 */
async function retitleSession(ctx, sessionId, raiseLimit = false) {
  const sessions = ctx.get('sessions')
  const sessionTitle = ctx.get('sessionTitle')
  if (sessions === undefined || sessionTitle === undefined) {
    throw new OverrideError('retitle-unavailable', '当前 profile 没有会话标题服务，无法重算标题。', 503)
  }
  const session = sessions.list().find((item) => item.id === sessionId)
  if (session === undefined) {
    throw new OverrideError('session-not-live', '该会话不在当前进程的活跃列表里；标题只能在会话打开时重算。', 404)
  }
  const inputBytes = readSessionInputBytes(ctx, session)
  const inputLimit = readTitleInputLimit(ctx)
  const overLimit = typeof inputBytes === 'number' && typeof inputLimit === 'number' && inputBytes > inputLimit
  let raisedLimit
  if (overLimit && raiseLimit) {
    // 先把上限抬到够用（复用白名单写入路径：完整块 + 校验 + 热生效），再重算。
    raisedLimit = suggestedMaxInputBytes(inputBytes)
    await applyField(ctx, 'session-title-llm', 'maxInputBytes', raisedLimit)
  }
  try {
    await sessionTitle.refresh(session)
  } catch (error) {
    throw translateRetitleError(error, inputBytes, inputLimit, raisedLimit === undefined, raisedLimit)
  }
  const snapshot = sessionTitle.get(session)
  return {
    sessionId,
    title: typeof snapshot?.title === 'string' ? snapshot.title : '',
    sourceKind: snapshot?.source?.kind ?? 'none',
    raisedLimit
  }
}

/** 写入一个白名单字段（写完整配置块）。 */
async function applyField(ctx, entryId, path, rawValue) {
  let value
  try {
    value = normalizeFieldValue(entryId, path, rawValue)
  } catch (error) {
    throw new OverrideError('invalid-value', error instanceof Error ? error.message : String(error), 400)
  }
  const editor = ctx.get('configEditor')
  if (editor === undefined) throw new OverrideError('editor-missing', '当前 profile 没有挂载 config-editor。', 503)
  const entry = editor.entries().find((row) => row.options.id === entryId)
  if (entry === undefined) throw new OverrideError('entry-missing', `当前 profile 里没有条目 "${entryId}"。`, 404)
  try {
    await editor.edit(entry, (current) => planFieldWrite(current, path, value))
  } catch (error) {
    throw translateEditorError(error)
  }
  return { entryId, path, value }
}

/** 把一个白名单字段还原成继承层的值（整块相等时官方会自动删掉覆盖）。 */
async function resetField(ctx, entryId, path) {
  if (entryDefinition(entryId) === undefined) throw new OverrideError('entry-not-managed', `条目 "${entryId}" 不在可覆盖白名单里。`, 400)
  const editor = ctx.get('configEditor')
  if (editor === undefined) throw new OverrideError('editor-missing', '当前 profile 没有挂载 config-editor。', 503)
  const entry = editor.entries().find((row) => row.options.id === entryId)
  if (entry === undefined) throw new OverrideError('entry-missing', `当前 profile 里没有条目 "${entryId}"。`, 404)
  try {
    await editor.edit(entry, (current, inherited) => planFieldReset(current, inherited, path))
  } catch (error) {
    throw translateEditorError(error)
  }
  return { entryId, path, value: undefined }
}

/** 高级模式：把某个条目的整块覆盖退回继承层（会删掉该条目在 patch 里的 config）。 */
async function resetEntry(ctx, entryId) {
  const editor = ctx.get('configEditor')
  if (editor === undefined) throw new OverrideError('editor-missing', '当前 profile 没有挂载 config-editor。', 503)
  const entry = editor.entries().find((row) => row.options.id === entryId)
  if (entry === undefined) throw new OverrideError('entry-missing', `当前 profile 里没有条目 "${entryId}"。`, 404)
  try {
    await editor.edit(entry, (_current, inherited) => ({ ...inherited }))
  } catch (error) {
    throw translateEditorError(error)
  }
  return { entryId }
}

/**
 * 注册 HTTP 路由。
 * @param ctx - 宿主插件上下文（已注入 configEditor / webServer / connection）。
 */
function registerRoutes(ctx) {
  const state = { csrfToken: randomUUID() }

  // status 只校验"请求来自本页面"：CSRF 令牌正是它下发的，第一次请求必然还没有令牌。
  // action 才追加令牌比对（令牌由 status 响应带给页面）。
  const guardOrigin = (req, res) => {
    const rejection = clientRequestRejection(req, ctx.connection)
    if (rejection === undefined) return true
    sendJson(res, rejection === 401 ? 401 : 403, {
      ok: false,
      code: 'request-rejected',
      error: rejection === 401 ? '需要浏览器认证' : '请求来源被拒绝'
    })
    return false
  }

  const guardAction = (req, res) => {
    if (!guardOrigin(req, res)) return false
    if (requestHeader(req, CSRF_HEADER) === state.csrfToken) return true
    sendJson(res, 403, { ok: false, code: 'csrf-rejected', error: 'CSRF 令牌不匹配，请刷新设置面板后重试' })
    return false
  }

  const statusRoute = {
    kind: 'exact',
    path: STATUS_PATH,
    handler: (req, res) => {
      if (!guardOrigin(req, res)) return
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: '只支持 GET' })
        return
      }
      try {
        const snapshot = readConfiguration(ctx)
        const sessions = describeLiveSessions(ctx)
        if (!snapshot.available) {
          sendJson(res, 200, {
            ok: true,
            available: false,
            error: snapshot.reason,
            csrfToken: state.csrfToken,
            sessions: sessions.rows,
            sessionsAvailable: sessions.available,
            sessionsReason: sessions.reason,
            sessionsTotal: sessions.total,
            sessionsNeedRetitle: sessions.needRetitle,
            sessionsOverLimit: sessions.overLimit
          })
          return
        }
        sendJson(res, 200, {
          ok: true,
          available: true,
          csrfToken: state.csrfToken,
          documentPath: snapshot.documentPath,
          entries: describeWhitelist(snapshot.rows),
          advanced: describeAdvanced(snapshot.rows),
          totalEntries: snapshot.rows.length,
          managedEntries: ENTRIES.length,
          sessions: sessions.rows,
          sessionsAvailable: sessions.available,
          sessionsReason: sessions.reason,
          sessionsTotal: sessions.total,
          sessionsNeedRetitle: sessions.needRetitle,
          sessionsOverLimit: sessions.overLimit
        })
      } catch (error) {
        const payload = error instanceof OverrideError ? error : new OverrideError('status-failed', String(error), 500)
        sendJson(res, payload.status, { ok: false, code: payload.code, error: payload.message })
      }
    }
  }

  const actionRoute = {
    kind: 'exact',
    path: ACTION_PATH,
    handler: async (req, res) => {
      if (!guardAction(req, res)) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: '只支持 POST' })
        return
      }
      try {
        const body = await readJsonBody(req)
        let result
        if (body.action === 'apply') {
          result = await applyField(ctx, String(body.entryId ?? ''), String(body.path ?? ''), body.value)
        } else if (body.action === 'reset') {
          result = await resetField(ctx, String(body.entryId ?? ''), String(body.path ?? ''))
        } else if (body.action === 'reset-entry') {
          result = await resetEntry(ctx, String(body.entryId ?? ''))
        } else if (body.action === 'retitle') {
          result = await retitleSession(ctx, String(body.sessionId ?? ''), body.raiseLimit === true)
        } else {
          throw new OverrideError('invalid-action', `不支持的操作 "${String(body.action)}"。`, 400)
        }
        const snapshot = readConfiguration(ctx)
        const sessions = describeLiveSessions(ctx)
        sendJson(res, 200, {
          ok: true,
          result,
          entries: snapshot.available ? describeWhitelist(snapshot.rows) : [],
          advanced: snapshot.available ? describeAdvanced(snapshot.rows) : [],
          sessions: sessions.rows,
          sessionsTotal: sessions.total,
          sessionsNeedRetitle: sessions.needRetitle,
          sessionsOverLimit: sessions.overLimit
        })
      } catch (error) {
        const payload = error instanceof OverrideError ? error : translateEditorError(error)
        sendJson(res, payload.status, {
          ok: false,
          code: payload.code,
          error: payload.message,
          ...payload.detail === undefined ? {} : { detail: payload.detail }
        })
      }
    }
  }

  return ctx.effect(function* registerOverrideRoutes() {
    yield ctx.webServer.register(statusRoute)
    yield ctx.webServer.register(actionRoute)
  }, `${PLUGIN_NAME}: HTTP routes`)
}

/**
 * 本插件已逐版本核对过契约的 DSH 发布线。
 *
 * 与 `package.json#dshCompatibility.range` / `engines.dsh` / `install.sh` 的
 * `DSH_COMPATIBILITY_RANGE` **同源**，改一处必须四处一起改。
 */
export const DSH_COMPATIBILITY_RANGE = '>=0.2.1-alpha.2 <0.2.2'

/** 发布线本体；兼容线只覆盖这一个 patch 系列。 */
export const DSH_RELEASE_LINE = '0.2.1'

/**
 * 兼容线下界（`0.2.1-alpha.2`）：同线内更低 channel 或更小序列号的 prerelease
 * 都低于下界，判为不支持。跨线时改这三个常量即可，判定逻辑不用动。
 */
export const DSH_RELEASE_FLOOR = { channel: 'alpha', sequence: 2 }

/** prerelease channel 的先后顺序；下标即优先级。 */
const PRERELEASE_CHANNELS = ['alpha', 'beta', 'rc']

/**
 * 逐版本核对清单，与 `package.json#dshCompatibility.verifiedVersions` 和
 * `install.sh` 的 `DSH_VERIFIED_VERSIONS` 同源。
 */
export const VERIFIED_DSH_VERSIONS = ['0.2.1-alpha.2']

/**
 * 判定 DSH 版本是否落在兼容线内。
 *
 * 判据只看版本号形状，不猜「看起来差不多」的版本：正式版与
 * `0.2.1-{alpha,beta,rc}.N` 里够到或高于下界的那些算同线，其余一律
 * `supported: false`。同线内的 prerelease 必须靠 channel 优先级比较挡住——
 * 旧的 `channel !== 'alpha' || seq >= N` 写法只能表达「下界是 alpha」，
 * 下界换成 rc 后会把 `0.2.0-alpha.9` 判成兼容。
 *
 * @param {unknown} version
 * @returns {{supported: boolean, verified: boolean, normalized?: string}}
 */
export function classifyDshVersion(version) {
  if (typeof version !== 'string') return { supported: false, verified: false }
  const normalized = version.split('+', 1)[0]
  const verified = VERIFIED_DSH_VERSIONS.includes(normalized)
  if (normalized === DSH_RELEASE_LINE) return { supported: true, verified, normalized }
  const prerelease = new RegExp(`^${DSH_RELEASE_LINE.replace(/\./gu, '\\.')}-(alpha|beta|rc)\\.(0|[1-9]\\d*)$`, 'u').exec(
    normalized
  )
  if (prerelease === null) return { supported: false, verified: false, normalized }
  const rank = PRERELEASE_CHANNELS.indexOf(prerelease[1])
  const floorRank = PRERELEASE_CHANNELS.indexOf(DSH_RELEASE_FLOOR.channel)
  const supported =
    rank > floorRank || (rank === floorRank && Number(prerelease[2]) >= DSH_RELEASE_FLOOR.sequence)
  return { supported, verified: supported && verified, normalized }
}

/**
 * 从 DSH CLI 入口向上找 `@deepseek-ai/dsh` 的安装目录。
 *
 * 复用工作区既有的位置探测方式：`dsh` 是全局 bin 软链，realpath 后向上最多 4 层
 * 即可命中包根。测试进程（`node --test`）里 `process.argv[1]` 不是 DSH 入口，
 * 那时必须显式传入真实入口路径。
 *
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
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 版本门放行后真正装配插件。
 *
 * configEditor 只在带配置编辑器的 profile 出现；webServer/connection 只在 Web 出现。
 * 三者齐备才注册路由，其余组合下插件安静地不工作（其余功能仍是纯前端页面）。
 */
function applyCompatibleRuntime(ctx) {
  ctx.inject(['configEditor', 'webServer', 'connection'], registerRoutes)
}

/**
 * 版本门：先核对 DSH 版本，再决定是否装配。
 *
 * 范围外保持 **inert**（不注册路由、不读 profile、不写任何文件）。这条是硬要求而不是
 * 保守习惯：本插件会整块改写 profile 补丁里的 `config`，写错的后果是目标条目因
 * `required` 校验失败而加载失败（`fiber.state = 3`），此时 `configEditor` 会拒绝服务
 * （"Configuration plugin is no longer active"），只能手改文件救回来。
 *
 * @param {any} ctx
 * @param {unknown} version
 */
export async function applyForVersion(ctx, version) {
  const compatibility = classifyDshVersion(version)
  if (!compatibility.supported) {
    ctx.logger?.error?.(
      `${PLUGIN_NAME}: unsupported DSH ${String(version)}; expected ${DSH_COMPATIBILITY_RANGE}. Plugin stays inert.`
    )
    return
  }
  if (!compatibility.verified) {
    ctx.logger?.warn?.(
      `${PLUGIN_NAME}: DSH ${String(version)} is inside ${DSH_COMPATIBILITY_RANGE} but is not individually verified; capability checks remain authoritative`
    )
  }
  return applyCompatibleRuntime(ctx)
}

/**
 * 入口：定位当前运行的 DSH 版本。定位失败同样保持 inert——宁可整块不工作，
 * 也不要在未知版本上写 profile 补丁。
 *
 * @param {any} ctx
 * @param {string} [entryPath]
 */
export async function applyForEntry(ctx, entryPath = process.argv[1]) {
  let manifest
  try {
    manifest = await readDshPackage(entryPath)
  } catch (error) {
    ctx.logger?.error?.(`${PLUGIN_NAME}: cannot verify the running DSH package; plugin remains inert: ${messageOf(error)}`)
    return
  }
  return applyForVersion(ctx, manifest.version)
}

/**
 * 插件入口。
 * @param {any} ctx - 插件上下文。
 */
export async function apply(ctx) {
  return applyForEntry(ctx, process.argv[1])
}

export const name = PLUGIN_NAME

