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
/**
 * 兼容发布线：插件只声明**已逐包核对过契约的最窄区间**，范围内可用，范围外保持 inert。
 *
 * 这是工作区规则：一个插件版本只服务它验证过的那一条 DSH 发布线，不支持"同一版本跨两条线"。
 * 需要支持新的 DSH 版本时，重新读源码核对契约差异 → 补适配与回归测试 → 更新四处同源声明
 * （本文件的常量、`package.json#dshCompatibility`、`engines.dsh`、`install.sh`）→ 发新版本。
 * 范围外或版本来源不可验证时保持零副作用（不注册路由、不碰 registry、不做 legacy 迁移）。
 *
 * 能力探测仍然是权威判定：**线内**版本即使未逐条核对，也照常挂载并逐项 fail closed 降级。
 */
export const DSH_COMPATIBILITY_RANGE = '>=0.1.7-alpha.1 <0.1.8'
export const DSH_VERIFIED_VERSIONS = Object.freeze(['0.1.7-alpha.1'])

/**
 * 兼容发布线的**版本三元组**：只有 `0.1.7` 这一条在声明范围内（`0.1.7`、`0.1.7-alpha|beta|rc.N`，
 * 其中 alpha 至少 1）。语义与 `install.sh` 的 `is_compatible_dsh_version()` 逐字对应，并与
 * `DSH_COMPATIBILITY_RANGE=">=0.1.7-alpha.1 <0.1.8"` 一致：**0.1.8 的 prerelease 不算在内**
 * （上一线 0.1.6、下一线 0.1.8 都要重新核对契约后另发版本）。
 */
export const DSH_RELEASE_LINE = Object.freeze({ major: 0, minor: 1, patch: 7 })

/** 解析 `major.minor.patch[-tag.N]`；拒绝其它写法（返回 undefined）。 */
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z]+)\.(\d+))?$/u.exec(version)
  if (match === null) return undefined
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined
      ? undefined
      : { tag: match[4].toLowerCase(), sequence: Number(match[5]) }
  }
}

/**
 * 把运行中的 DSH 版本分类成"在不在兼容发布线上/是否逐条核对过"。
 * @param version - `@deepseek-ai/dsh` 的版本号，或任何未知输入。
 * @returns `{ supported, verified, normalized }`；`supported: false` 时插件保持 inert。
 */
export function classifyDshVersion(version) {
  const normalized = typeof version === 'string' ? version.trim().split('+', 1)[0] : ''
  const parsed = normalized === '' ? undefined : parseVersion(normalized)
  if (parsed === undefined) return { supported: false, verified: false, normalized: undefined }
  const onLine = parsed.numbers[0] === DSH_RELEASE_LINE.major
    && parsed.numbers[1] === DSH_RELEASE_LINE.minor
    && parsed.numbers[2] === DSH_RELEASE_LINE.patch
  if (!onLine) return { supported: false, verified: false, normalized }
  const known = ['alpha', 'beta', 'rc']
  if (parsed.prerelease !== undefined
    && (!known.includes(parsed.prerelease.tag) || (parsed.prerelease.tag === 'alpha' && parsed.prerelease.sequence < 1))) {
    return { supported: false, verified: false, normalized }
  }
  return {
    supported: true,
    verified: DSH_VERIFIED_VERSIONS.includes(normalized),
    normalized
  }
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

export async function applyCompatibleRuntime(ctx, compatibility = classifyDshVersion(undefined)) {
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
    // Version facts are diagnostics only: they never gate a capability. The
    // browser shows them, and `features` documents what this DSH can offer.
    dshVersion: compatibility.normalized ?? null,
    dshVersionVerified: compatibility.verified === true,
    dshCompatibilityRange: DSH_COMPATIBILITY_RANGE,
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
      `${PLUGIN_NAME}: DSH ${compatibility.normalized ?? String(version)} is outside ${DSH_COMPATIBILITY_RANGE}; plugin remains inert`
    )
    return
  }
  if (!compatibility.verified) {
    ctx.logger?.warn?.(
      `${PLUGIN_NAME}: DSH ${compatibility.normalized} is inside ${DSH_COMPATIBILITY_RANGE} but is not individually verified; capability checks remain authoritative`
    )
  }
  return applyCompatibleRuntime(ctx, compatibility)
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
