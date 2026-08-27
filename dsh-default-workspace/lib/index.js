import { mkdir, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const PLUGIN_NAME = 'dsh-default-workspace'
export const DEFAULT_WORKSPACE_TITLE = '通用会话'
export const LEGACY_WORKSPACE_TITLE = '最近聊天'
export const STATUS_PATH = '/dsh-default-workspace/status'
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

const INTERCEPTOR_REGISTRY = Symbol.for('dsh.workspace-method-interceptors.v1')
const CORDIS_ORIGINAL = Symbol.for('cordis.original')

function interceptorTarget(target) {
  const original = target?.[CORDIS_ORIGINAL]
  return original !== null && (typeof original === 'object' || typeof original === 'function')
    ? original
    : target
}

function interceptorRoot() {
  let root = globalThis[INTERCEPTOR_REGISTRY]
  if (root === undefined) {
    root = new WeakMap()
    Object.defineProperty(globalThis, INTERCEPTOR_REGISTRY, { value: root })
  }
  if (!(root instanceof WeakMap)) throw new Error('incompatible DSH Workspace interceptor registry')
  return root
}

function originalMethod(target, name) {
  target = interceptorTarget(target)
  return interceptorRoot().get(target)?.get(name)?.original || target[name]
}

function restoreOwnDescriptor(target, name, descriptor) {
  const restored = descriptor === undefined
    ? Reflect.deleteProperty(target, name)
    : Reflect.defineProperty(target, name, descriptor)
  if (!restored) throw new Error(`cannot restore DSH Workspace method ${name}() descriptor`)
}

function interceptMethod(target, name, key, order, handler) {
  target = interceptorTarget(target)
  const root = interceptorRoot()
  let methods = root.get(target)
  if (methods === undefined) {
    methods = new Map()
    root.set(target, methods)
  }
  let state = methods.get(name)
  if (state === undefined) {
    const original = target[name]
    const originalDescriptor = Object.getOwnPropertyDescriptor(target, name)
    const entries = new Map()
    state = { original, originalDescriptor, entries, wrapper: undefined }
    state.wrapper = function (...args) {
      const chain = [...entries.values()].sort((left, right) => left.order - right.order)
      const receiver = this
      const dispatch = (index, currentArgs) => {
        const entry = chain[index]
        if (entry === undefined) return Reflect.apply(original, receiver, currentArgs)
        return entry.handler(
          (...nextArgs) => dispatch(index + 1, nextArgs.length === 0 ? currentArgs : nextArgs),
          ...currentArgs
        )
      }
      return dispatch(0, args)
    }
    methods.set(name, state)
    try {
      target[name] = state.wrapper
      if (target[name] !== state.wrapper) throw new Error('method replacement was ignored')
    } catch (error) {
      let failure = error
      try {
        restoreOwnDescriptor(target, name, originalDescriptor)
      } catch (restoreError) {
        failure = new AggregateError([error, restoreError], 'method replacement and rollback both failed')
      }
      methods.delete(name)
      if (methods.size === 0) root.delete(target)
      throw new Error(`cannot intercept DSH Workspace method ${name}()`, { cause: failure })
    }
  }
  state.entries.set(key, { order, handler })
  return () => {
    state.entries.delete(key)
    if (state.entries.size !== 0) return
    if (target[name] === state.wrapper) restoreOwnDescriptor(target, name, state.originalDescriptor)
    methods.delete(name)
    if (methods.size === 0) root.delete(target)
  }
}

export function resolveDshHome(env = process.env, home = homedir()) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return resolve(configured || join(home, '.dsh'))
}

export function defaultWorkspacePath(dshHome = resolveDshHome()) {
  return join(dshHome, 'workspaces', 'default')
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

/**
 * Create or adopt the managed Workspace and pin it before every ordinary
 * Workspace. Existing Workspaces outside the managed path are never mutated.
 */
export async function ensureManagedWorkspace(registry, options = {}) {
  const title = options.title || DEFAULT_WORKSPACE_TITLE
  const managedPath = resolve(options.path || defaultWorkspacePath())
  const makeDirectory = options.mkdir || mkdir

  for (const method of ['create', 'list', 'insertBefore', 'delete']) {
    if (typeof registry?.[method] !== 'function') {
      throw new Error(`incompatible DSH Workspace registry: missing ${method}()`)
    }
  }

  const registryProbe = {
    id: '__dsh-default-workspace-capability-probe__',
    async setTitle() {}
  }
  const disposeRegistryProbe = protectManagedWorkspace(registry, registryProbe, title)
  await disposeRegistryProbe()
  const existingWorkspace = registry.list().find((item) => (
    typeof item?.path === 'string' && resolve(item.path) === managedPath
  ))

  await makeDirectory(managedPath, { recursive: true })

  const workspace = await registry.create(managedPath, title)
  if (!workspace || typeof workspace.id !== 'string' || typeof workspace.path !== 'string'
    || typeof workspace.title !== 'string' || typeof workspace.setTitle !== 'function') {
    throw new Error('incompatible DSH Workspace entity returned by create()')
  }
  if (workspace.title !== LEGACY_WORKSPACE_TITLE && workspace.title !== title) {
    throw new Error(
      `managed Workspace path is already registered as “${workspace.title}”: ${managedPath}`
    )
  }

  try {
    const disposeWorkspaceProbe = protectManagedWorkspace(registry, workspace, title)
    await disposeWorkspaceProbe()
  } catch (error) {
    if (existingWorkspace === undefined) {
      try {
        await registry.delete(workspace.id)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'managed Workspace policy preflight and registration rollback both failed'
        )
      }
    }
    throw error
  }

  if (workspace.title === LEGACY_WORKSPACE_TITLE) {
    await workspace.setTitle(title)
  }

  const first = registry.list()[0]
  if (first !== undefined && first.id !== workspace.id) {
    await registry.insertBefore(workspace.id, first.id)
  }

  return { workspace }
}

/**
 * Protect the managed Workspace through reversible instance patches. Core API
 * callers continue to use the ordinary Workspace service; the plugin only
 * constrains operations involving this one account.
 */
export function protectManagedWorkspace(registry, workspace, title = DEFAULT_WORKSPACE_TITLE) {
  for (const method of ['create', 'delete', 'insertBefore', 'list']) {
    if (typeof registry?.[method] !== 'function') {
      throw new Error(`incompatible DSH Workspace registry: missing ${method}()`)
    }
  }
  if (typeof workspace?.setTitle !== 'function') {
    throw new Error('incompatible DSH Workspace entity: missing setTitle()')
  }

  const key = Symbol(PLUGIN_NAME)
  const baseInsertBefore = originalMethod(registry, 'insertBefore')
  const workspaceTarget = interceptorTarget(workspace)
  const originalSetTitleDescriptor = Object.getOwnPropertyDescriptor(workspaceTarget, 'setTitle')
  const managedId = workspace.id
  let createTail = Promise.resolve()
  let disposed = false

  async function pinFirst() {
    if (disposed) return
    const first = registry.list()[0]
    if (first !== undefined && first.id !== managedId) {
      await Reflect.apply(baseInsertBefore, registry, [managedId, first.id])
    }
  }

  const cleanups = []
  async function patchedSetTitle(nextTitle) {
    if (String(nextTitle).trim() === title) return
    throw new Error(`the managed Workspace “${title}” cannot be renamed`)
  }

  try {
    cleanups.push(interceptMethod(registry, 'create', key, 10, (next, ...args) => {
      const operation = createTail.then(async () => {
        const created = await next(...args)
        await pinFirst()
        return created
      })
      createTail = operation.then(() => undefined, () => undefined)
      return operation
    }))
    cleanups.push(interceptMethod(registry, 'delete', key, 10, (next, workspaceId) => {
      if (workspaceId === managedId) return Promise.resolve(false)
      return next(workspaceId)
    }))
    cleanups.push(interceptMethod(registry, 'insertBefore', key, 10, (next, workspaceId, beforeWorkspaceId) => {
      if (workspaceId === managedId || beforeWorkspaceId === managedId) {
        return Promise.resolve(registry.list().map(item => item.id))
      }
      return next(workspaceId, beforeWorkspaceId)
    }))
    workspaceTarget.setTitle = patchedSetTitle
    if (workspaceTarget.setTitle !== patchedSetTitle) throw new Error('setTitle replacement was ignored')
  } catch (error) {
    for (const cleanup of cleanups.reverse()) cleanup()
    let failure = error
    try {
      restoreOwnDescriptor(workspaceTarget, 'setTitle', originalSetTitleDescriptor)
    } catch (restoreError) {
      failure = new AggregateError([error, restoreError], 'policy installation and rollback both failed')
    }
    throw new Error('cannot install the managed Workspace policy', { cause: failure })
  }

  return async () => {
    disposed = true
    await createTail
    for (const cleanup of cleanups.reverse()) cleanup()
    if (workspaceTarget.setTitle === patchedSetTitle) {
      restoreOwnDescriptor(workspaceTarget, 'setTitle', originalSetTitleDescriptor)
    }
  }
}

export function statusRequestRejection(req, connection) {
  return connection.requestRejection(req)
}

function registerStatusRoute(ctx, snapshot) {
  ctx.inject(['webServer', 'connection'], (webContext) => {
    const route = {
      kind: 'exact',
      path: STATUS_PATH,
      handler: (req, res) => {
        const rejection = statusRequestRejection(req, webContext.connection)
        if (rejection !== undefined) {
          sendJson(res, rejection, {
            ok: false,
            error: rejection === 401 ? 'browser authentication required' : 'request authority rejected'
          })
          return
        }
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        sendJson(res, 200, snapshot)
      }
    }
    webContext.effect(
      () => webContext.webServer.register(route),
      `${PLUGIN_NAME}: status route`
    )
  })
}

export const inject = ['workspaceRegistry']

export async function applyCompatibleRuntime(ctx) {
  const managedPath = defaultWorkspacePath()
  const ensured = await ensureManagedWorkspace(ctx.workspaceRegistry, { path: managedPath })
  const workspace = ensured.workspace

  ctx.effect(
    () => protectManagedWorkspace(ctx.workspaceRegistry, workspace),
    `${PLUGIN_NAME}: protect managed Workspace`
  )

  registerStatusRoute(ctx, {
    ok: true,
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title
  })

  ctx.logger?.info?.(`${PLUGIN_NAME}: managed Workspace ready at ${workspace.path}`)
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
