import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { ArchiveDeleteError, createArchiveDeletionService } from './archive-deletion.js'
import { ArchiveRestoreError, createArchiveRestorationService } from './archive-restoration.js'

export const PLUGIN_NAME = 'dsh-chat-archive-manager'
export const LEGACY_ARCHIVE_WORKSPACE_TITLE = '已归档'
export const STATUS_PATH = '/dsh-chat-archive-manager/status'
export const DELETE_PATH = '/dsh-chat-archive-manager/delete'
export const RESTORE_PATH = '/dsh-chat-archive-manager/restore'
export const CLIENT_HEADER = 'x-dsh-chat-archive-manager-client'
export const DSH_COMPATIBILITY_RANGE = '>=0.1.6-alpha.1 <0.1.7'

export function classifyDshVersion(version) {
  if (typeof version !== 'string') return { supported: false, verified: false }
  const normalized = version.split('+', 1)[0]
  const verified = normalized === '0.1.6-alpha.1'
  if (normalized === '0.1.6') return { supported: true, verified, normalized }
  const prerelease = /^0\.1\.6-(alpha|beta|rc)\.(0|[1-9]\d*)$/u.exec(normalized)
  if (prerelease === null) return { supported: false, verified: false, normalized }
  const supported = prerelease[1] !== 'alpha' || Number(prerelease[2]) >= 1
  return { supported, verified: supported && verified, normalized }
}

export async function readDshPackage(entryPath = process.argv[1]) {
  if (typeof entryPath !== 'string' || entryPath.trim() === '') {
    throw new Error('cannot locate the DSH CLI entry path')
  }
  let directory = dirname(await realpath(entryPath))
  for (let depth = 0; depth < 4; depth += 1) {
    const manifestPath = join(directory, 'package.json')
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (manifest?.name === '@deepseek-ai/dsh') {
        if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
          throw new Error('@deepseek-ai/dsh package.json has no version')
        }
        return { name: manifest.name, version: manifest.version }
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

export function resolveDshHome(env = process.env, home = homedir()) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return resolve(configured || join(home, '.dsh'))
}

export function legacyArchiveWorkspacePath(dshHome = resolveDshHome()) {
  return join(dshHome, 'workspaces', 'archived')
}

function requestHeader(req, name) {
  const value = req.headers?.[name]
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' ? value : undefined
}

function assertTrustedMutationRequest(req, connection) {
  const rejection = connection.requestRejection(req)
  if (rejection !== undefined) {
    throw new ArchiveDeleteError(
      rejection === 401 ? 'unauthorized-client' : 'forbidden-client',
      rejection === 401 ? '归档修改请求缺少有效的 DSH 浏览器认证' : '归档修改请求未通过 DSH Host 信任校验',
      rejection
    )
  }

  const fetchSite = requestHeader(req, 'sec-fetch-site')
  const origin = requestHeader(req, 'origin')
  const host = requestHeader(req, 'host')
  let sameOrigin = fetchSite === undefined || fetchSite === 'same-origin'
  if (origin !== undefined) {
    try {
      const parsed = new URL(origin)
      sameOrigin = sameOrigin
        && host !== undefined
        && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && parsed.host === host
    } catch {
      sameOrigin = false
    }
  }
  if (!sameOrigin || requestHeader(req, CLIENT_HEADER) !== '1') {
    throw new ArchiveDeleteError('forbidden-client', '归档修改请求未通过同源客户端校验', 403)
  }
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

async function readJsonBody(req, maxBytes = 32 * 1024) {
  const contentType = requestHeader(req, 'content-type') ?? ''
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new ArchiveDeleteError('invalid-content-type', '请求必须使用 application/json', 415)
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new ArchiveDeleteError('request-too-large', '请求内容过大', 413)
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('JSON root must be an object')
    }
    return value
  } catch (error) {
    throw new ArchiveDeleteError('invalid-json', '请求不是有效 JSON 对象', 400, { cause: error })
  }
}

export async function removeLegacyArchiveWorkspace(registry, options = {}) {
  const expectedTitle = options.title || LEGACY_ARCHIVE_WORKSPACE_TITLE
  const configuredPath = resolve(options.path || legacyArchiveWorkspacePath())
  const resolveRealpath = options.realpath || realpath
  let canonicalPath = configuredPath
  try {
    canonicalPath = await resolveRealpath(configuredPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const workspace = registry.list().find(item =>
    item.title === expectedTitle
      && (item.path === canonicalPath || item.path === configuredPath))
  if (workspace === undefined) return { removed: false, path: canonicalPath }
  if (!Array.isArray(workspace.sessionIds)
    || workspace.sessionIds.some(id => typeof id !== 'string' || id.trim() === '')) {
    throw new Error('legacy archive Workspace has an unsupported sessionIds shape')
  }
  if (workspace.sessionIds.length > 0) {
    return { removed: false, retained: true, workspaceId: workspace.id, path: workspace.path }
  }

  const removed = await registry.delete(workspace.id)
  return { removed, workspaceId: workspace.id, path: workspace.path }
}

function registerRoutes(ctx, snapshot, services) {
  const { connection, deletionService, deletionUnavailable, restorationService, restorationUnavailable } = services
  const recoveryRestoreError = () => new ArchiveRestoreError(
    'deletion-recovery-required',
    '永久删除恢复日志需要人工检查，处理完成并重启 dsh web 后才能恢复聊天。',
    503
  )
  const deletionQuarantined = () => deletionService?.status().quarantined === true

  function currentSnapshot() {
    if (!deletionQuarantined()) return snapshot
    return {
      ...snapshot,
      deletionSupported: false,
      deletionCode: 'archive-delete-quarantined',
      deletionUnavailable: '永久删除已进入 quarantine；请人工检查恢复日志后重启 dsh web。',
      sessionQuiescenceSupported: false,
      restorationSupported: false,
      restorationCode: 'deletion-recovery-required',
      restorationUnavailable: recoveryRestoreError().message
    }
  }
  const statusRoute = {
    kind: 'exact',
    path: STATUS_PATH,
    handler: (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        sendJson(res, rejection, {
          ok: false,
          code: rejection === 401 ? 'unauthorized-client' : 'forbidden-client',
          error: rejection === 401 ? '归档状态请求缺少有效的 DSH 浏览器认证' : '归档状态请求未通过 DSH Host 信任校验'
        })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      sendJson(res, 200, currentSnapshot())
    }
  }
  const deleteRoute = {
    kind: 'exact',
    path: DELETE_PATH,
    handler: (req, res) => {
      void (async () => {
        assertTrustedMutationRequest(req, connection)
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'method-not-allowed', error: 'method not allowed' })
          return
        }
        if (deletionService === undefined) throw deletionUnavailable
        const body = await readJsonBody(req)
        const result = await deletionService.delete(body.sessionId)
        sendJson(res, 200, { ok: true, ...result })
      })().catch((error) => {
        if (error instanceof ArchiveDeleteError) {
          sendJson(res, error.status, { ok: false, code: error.code, error: error.message })
          return
        }
        ctx.logger?.error?.(`${PLUGIN_NAME}: deletion failed: ${String(error)}`)
        sendJson(res, 500, {
          ok: false,
          code: 'archive-delete-incomplete',
          error: '永久删除未完成；恢复日志已保留，请重启 dsh web 后重试。'
        })
      })
    }
  }
  const restoreRoute = {
    kind: 'exact',
    path: RESTORE_PATH,
    handler: (req, res) => {
      void (async () => {
        assertTrustedMutationRequest(req, connection)
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'method-not-allowed', error: 'method not allowed' })
          return
        }
        if (deletionQuarantined()) throw recoveryRestoreError()
        if (restorationService === undefined) throw restorationUnavailable
        const body = await readJsonBody(req)
        const result = await restorationService.restore(body.sessionId)
        sendJson(res, 200, { ok: true, ...result })
      })().catch((error) => {
        if (error instanceof ArchiveRestoreError || error instanceof ArchiveDeleteError) {
          sendJson(res, error.status, { ok: false, code: error.code, error: error.message })
          return
        }
        ctx.logger?.error?.(`${PLUGIN_NAME}: restoration failed: ${String(error)}`)
        sendJson(res, 500, {
          ok: false,
          code: 'archive-restore-incomplete',
          error: '恢复归档聊天失败；请刷新页面后重试。'
        })
      })
    }
  }

  ctx.inject(['webServer'], (webContext) => {
    webContext.effect(function* () {
      yield webContext.webServer.register(statusRoute)
      yield webContext.webServer.register(deleteRoute)
      yield webContext.webServer.register(restoreRoute)
    }, `${PLUGIN_NAME}: HTTP routes`)
  })
}

export const inject = [
  'workspaceRegistry',
  'sessionPersistence',
  'sessions',
  'agents',
  'storageDomain',
  'connection'
]

export function createArchiveMutationCoordinator() {
  let tail = Promise.resolve()
  return function runExclusive(operation) {
    const result = tail.then(operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}

export async function applyCompatibleRuntime(ctx) {
  if (typeof ctx.connection?.requestRejection !== 'function') {
    throw new Error('incompatible DSH connection service: missing requestRejection()')
  }
  const dshHome = resolveDshHome()
  const legacyWorkspace = await removeLegacyArchiveWorkspace(ctx.workspaceRegistry, {
    path: legacyArchiveWorkspacePath(dshHome)
  })
  const runArchiveMutation = createArchiveMutationCoordinator()

  let deletionService
  let deletionUnavailable
  let candidate
  try {
    candidate = createArchiveDeletionService(ctx, { dshHome, runExclusive: runArchiveMutation })
    await candidate.initialize()
    deletionService = candidate
    ctx.effect(
      () => () => deletionService.dispose(),
      `${PLUGIN_NAME}: deletion transaction guard`
    )
  } catch (error) {
    candidate?.disable()
    deletionUnavailable = error instanceof ArchiveDeleteError
      ? error
      : new ArchiveDeleteError(
          'deletion-recovery-required',
          '永久删除恢复需要人工检查；归档管理功能仍可使用。',
          503,
          { cause: error }
        )
    ctx.logger?.warn?.(`${PLUGIN_NAME}: deletion unavailable: ${String(error)}`)
  }

  let restorationService
  let restorationUnavailable
  if (candidate !== undefined && deletionService === undefined) {
    restorationUnavailable = new ArchiveRestoreError(
      'deletion-recovery-required',
      '永久删除恢复日志需要人工检查，处理完成并重启 dsh web 后才能恢复聊天。',
      503
    )
  } else {
    try {
      restorationService = createArchiveRestorationService(ctx.workspaceRegistry, { runExclusive: runArchiveMutation })
      ctx.effect(
        () => () => restorationService.dispose(),
        `${PLUGIN_NAME}: restoration transaction guard`
      )
    } catch (error) {
      restorationUnavailable = error instanceof ArchiveRestoreError
        ? error
        : new ArchiveRestoreError(
            'unsupported-runtime',
            '当前 DSH 不支持恢复归档聊天。',
            501,
            { cause: error }
          )
      ctx.logger?.warn?.(`${PLUGIN_NAME}: restoration unavailable: ${String(error)}`)
    }
  }

  registerRoutes(ctx, {
    ok: true,
    workspaceProjection: false,
    legacyWorkspaceRemoved: legacyWorkspace.removed,
    deletionSupported: deletionService !== undefined,
    sessionQuiescenceSupported: deletionService?.status().quiescenceSupported === true,
    restorationSupported: restorationService !== undefined,
    ...(deletionUnavailable === undefined
      ? {}
      : { deletionCode: deletionUnavailable.code, deletionUnavailable: deletionUnavailable.message }),
    ...(restorationUnavailable === undefined
      ? {}
      : {
          restorationCode: restorationUnavailable.code,
          restorationUnavailable: restorationUnavailable.message
        })
  }, {
    connection: ctx.connection,
    deletionService,
    deletionUnavailable,
    restorationService,
    restorationUnavailable
  })

  if (legacyWorkspace.removed) {
    ctx.logger?.info?.(`${PLUGIN_NAME}: removed legacy archive Workspace registration at ${legacyWorkspace.path}`)
  } else if (legacyWorkspace.retained) {
    ctx.logger?.warn?.(`${PLUGIN_NAME}: retained non-empty legacy archive Workspace at ${legacyWorkspace.path}`)
  }
  ctx.logger?.info?.(`${PLUGIN_NAME}: Settings archive manager ready`)
}

export async function applyForVersion(ctx, version) {
  const compatibility = classifyDshVersion(version)
  if (!compatibility.supported) {
    ctx.logger?.warn?.(
      `${PLUGIN_NAME}: DSH ${version} is outside ${DSH_COMPATIBILITY_RANGE}; plugin remains inert`
    )
    return
  }
  if (!compatibility.verified) {
    ctx.logger?.warn?.(
      `${PLUGIN_NAME}: DSH ${version} is inside ${DSH_COMPATIBILITY_RANGE} but is not individually verified; capability checks remain authoritative`
    )
  }
  return applyCompatibleRuntime(ctx)
}

export async function applyForEntry(ctx, entryPath) {
  let manifest
  try {
    manifest = await readDshPackage(entryPath)
  } catch (error) {
    ctx.logger?.error?.(`${PLUGIN_NAME}: cannot verify the running DSH package; plugin remains inert: ${String(error)}`)
    return
  }
  return applyForVersion(ctx, manifest.version)
}

export async function apply(ctx) {
  return applyForEntry(ctx, process.argv[1])
}

export default {
  name: PLUGIN_NAME,
  inject,
  apply
}
