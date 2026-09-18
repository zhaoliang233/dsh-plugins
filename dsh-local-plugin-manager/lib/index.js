import { randomUUID } from 'node:crypto'

import {
  DEFAULT_PROFILE,
  DSH_COMPATIBILITY_RANGE,
  LocalPluginManagerError,
  LocalPluginProfile,
  PLUGIN_NAME,
  resolveCurrentDshRuntime,
  resolveDshHome
} from './profile-manager.js'

export const STATUS_PATH = '/dsh-local-plugin-manager/status'
export const ACTION_PATH = '/dsh-local-plugin-manager/action'
export const CLIENT_HEADER = 'x-dsh-local-plugin-manager-client'
export const CSRF_HEADER = 'x-dsh-local-plugin-manager-csrf'
export const MAX_BODY_BYTES = 16 * 1024

function requestHeader(req, name) {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' ? value : undefined
}

function loopbackRequest(req) {
  const address = req.socket?.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

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

export function clientRequestRejection(req, connection) {
  const rejection = connection.requestRejection(req)
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

export async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const contentType = requestHeader(req, 'content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new LocalPluginManagerError('invalid-content-type', '请求必须使用 application/json。', 415)
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) {
      throw new LocalPluginManagerError('request-too-large', '请求内容过大。', 413)
    }
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('根节点不是对象')
    return value
  } catch (error) {
    throw new LocalPluginManagerError('invalid-json', `请求不是有效 JSON：${error instanceof Error ? error.message : String(error)}`, 400)
  }
}

/**
 * 观察 loader 是否已经把目标行切到预期状态。
 *
 * 启停本身由 profile patch 的覆盖项驱动：写入后由 profile 配置重载（`patchReload: live`
 * 或 dsh-hmr）重组 loader 树。这里因此只读观察，不再直接调用 Loader 的私有更新接口，
 * 避免与官方 plugin-manager 和 HMR 的重组并发写同一批行。
 */
export async function observeLoaderEntryState(ctx, plugin, disabled, options = {}) {
  const loader = ctx.get('loader')
  if (loader === undefined || typeof loader.entries !== 'function') {
    return { applied: false, matched: 0, observable: false }
  }
  const entryIds = new Set(plugin.rowIds.map((rowId) => `include:${rowId}`))
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs >= 0 ? options.timeoutMs : 1500
  const pollMs = Number.isSafeInteger(options.pollMs) && options.pollMs > 0 ? options.pollMs : 150
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const matched = []
    for (const entry of loader.entries()) {
      if (entryIds.has(entry.id)) matched.push(entry)
    }
    const settled = matched.length > 0 && matched.every((entry) => disabled ? entry.fiber === undefined : entry.fiber !== undefined)
    if (settled) return { applied: true, matched: matched.length, observable: true }
    if (Date.now() >= deadline) return { applied: false, matched: matched.length, observable: true }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs))
  }
}

function errorPayload(error) {
  if (error instanceof LocalPluginManagerError) {
    return {
      status: error.status,
      body: {
        ok: false,
        code: error.code,
        error: error.message,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    }
  }
  return {
    status: 500,
    body: { ok: false, code: 'internal-error', error: error instanceof Error ? error.message : String(error) }
  }
}

function registerRoutes(ctx, state) {
  const statusRoute = {
    kind: 'exact',
    path: STATUS_PATH,
    handler: async (req, res) => {
      const rejection = clientRequestRejection(req, ctx.connection)
      if (rejection !== undefined) {
        sendJson(res, rejection, { ok: false, error: rejection === 401 ? 'browser authentication required' : 'request origin rejected' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (state.runtimeError !== undefined) {
        sendJson(res, 200, {
          ok: true,
          available: false,
          compatibilityRange: DSH_COMPATIBILITY_RANGE,
          error: state.runtimeError
        })
        return
      }
      if (!state.runtime.supported) {
        sendJson(res, 200, {
          ok: true,
          available: false,
          compatibilityRange: DSH_COMPATIBILITY_RANGE,
          dshVersion: state.runtime.version,
          error: state.runtime.unsupportedReason
        })
        return
      }
      if (state.initializationError !== undefined) {
        sendJson(res, 200, {
          ok: true,
          available: false,
          compatibilityRange: DSH_COMPATIBILITY_RANGE,
          dshVersion: state.runtime.version,
          error: state.initializationError
        })
        return
      }
      try {
        const snapshot = await state.manager.list()
        sendJson(res, 200, {
          ok: true,
          available: true,
          csrfToken: state.csrfToken,
          dshVersion: state.runtime.version,
          compatibilityRange: DSH_COMPATIBILITY_RANGE,
          verifiedVersion: state.runtime.verified,
          ...snapshot
        })
      } catch (error) {
        const payload = errorPayload(error)
        sendJson(res, payload.status, payload.body)
      }
    }
  }

  const actionRoute = {
    kind: 'exact',
    path: ACTION_PATH,
    handler: async (req, res) => {
      const rejection = clientRequestRejection(req, ctx.connection)
      if (rejection !== undefined || requestHeader(req, CSRF_HEADER) !== state.csrfToken) {
        const status = rejection === 401 ? 401 : 403
        sendJson(res, status, {
          ok: false,
          code: 'request-rejected',
          error: status === 401 ? 'browser authentication required' : 'request origin or CSRF token rejected'
        })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (state.manager === undefined || state.runtime?.supported !== true || state.initializationError !== undefined) {
        sendJson(res, 503, { ok: false, code: 'manager-unavailable', error: state.initializationError || state.runtimeError || state.runtime?.unsupportedReason || 'manager unavailable' })
        return
      }
      try {
        const body = await readJsonBody(req)
        const name = typeof body.name === 'string' ? body.name : ''
        let result
        if (body.action === 'enable') result = await state.manager.setEnabled(name, true)
        else if (body.action === 'disable') result = await state.manager.setEnabled(name, false)
        else if (body.action === 'uninstall') result = await state.manager.uninstall(name)
        else throw new LocalPluginManagerError('invalid-action', '不支持的本地插件操作。', 400)
        sendJson(res, 200, result)
      } catch (error) {
        const payload = errorPayload(error)
        sendJson(res, payload.status, payload.body)
      }
    }
  }

  ctx.effect(function* () {
    yield ctx.webServer.register(statusRoute)
    yield ctx.webServer.register(actionRoute)
  }, `${PLUGIN_NAME}: HTTP routes`)
}

export const inject = ['webServer', 'connection']

export async function apply(ctx, config = {}) {
  const profile = typeof config.profile === 'string' && config.profile !== '' ? config.profile : DEFAULT_PROFILE
  const state = {
    csrfToken: randomUUID(),
    runtime: undefined,
    runtimeError: undefined,
    manager: undefined,
    initializationError: undefined
  }

  try {
    state.runtime = await resolveCurrentDshRuntime()
  } catch (error) {
    state.runtimeError = error instanceof Error ? error.message : String(error)
  }

  if (state.runtime?.supported === true) {
    state.manager = new LocalPluginProfile({
      profile,
      dshHome: resolveDshHome(),
      runtime: state.runtime,
      onLiveState: (plugin, disabled) => observeLoaderEntryState(ctx, plugin, disabled)
    })
    try {
      await state.manager.initialize()
    } catch (error) {
      state.initializationError = error instanceof Error ? error.message : String(error)
      ctx.logger?.warn?.(`${PLUGIN_NAME}: initialization unavailable: ${state.initializationError}`)
    }
  }

  registerRoutes(ctx, state)
  ctx.logger?.info?.(`${PLUGIN_NAME}: local plugin manager ready for profile ${profile}`)
}

export default {
  name: PLUGIN_NAME,
  inject,
  apply
}
