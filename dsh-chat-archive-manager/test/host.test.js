import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  CLIENT_HEADER,
  DELETE_PATH,
  LEGACY_ARCHIVE_WORKSPACE_TITLE,
  RESTORE_PATH,
  STATUS_PATH,
  applyCompatibleRuntime as apply,
  applyForVersion,
  classifyDshVersion,
  legacyArchiveWorkspacePath,
  removeLegacyArchiveWorkspace,
  resolveDshHome
} from '../lib/index.js'

class FakeRegistry {
  constructor(items = [], archivedSessionIds = []) {
    this.items = items
    this.archivedSessionIds = archivedSessionIds
    this.deleted = []
  }

  list() { return [...this.items] }

  async delete(id) {
    this.deleted.push(id)
    const before = this.items.length
    this.items = this.items.filter(item => item.id !== id)
    return this.items.length !== before
  }
}

test('resolves the legacy archive path below DSH_HOME', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '  /tmp/custom-dsh  ' }, '/unused'), '/tmp/custom-dsh')
  assert.equal(legacyArchiveWorkspacePath('/tmp/custom-dsh'), '/tmp/custom-dsh/workspaces/archived')
})

test('removes only the exact legacy archive Workspace registration', async () => {
  const archivedSessionIds = ['session-archived']
  const legacy = {
    id: 'legacy-archive',
    path: '/canonical/dsh/workspaces/archived',
    title: LEGACY_ARCHIVE_WORKSPACE_TITLE,
    sessionIds: []
  }
  const project = {
    id: 'project',
    path: '/project',
    title: 'project',
    sessionIds: ['session-active', 'session-archived']
  }
  const registry = new FakeRegistry([project, legacy], archivedSessionIds)

  const result = await removeLegacyArchiveWorkspace(registry, {
    path: '/configured/dsh/workspaces/archived',
    realpath: async () => '/canonical/dsh/workspaces/archived'
  })

  assert.deepEqual(result, {
    removed: true,
    workspaceId: 'legacy-archive',
    path: '/canonical/dsh/workspaces/archived'
  })
  assert.deepEqual(registry.deleted, ['legacy-archive'])
  assert.deepEqual(registry.list(), [project])
  assert.equal(project.sessionIds.includes('session-archived'), true)
  assert.equal(registry.archivedSessionIds, archivedSessionIds)
})

test('retains a path-and-title legacy collision when it still owns sessions', async () => {
  const legacy = {
    id: 'legacy-archive',
    path: '/canonical/archive',
    title: LEGACY_ARCHIVE_WORKSPACE_TITLE,
    sessionIds: ['user-session']
  }
  const registry = new FakeRegistry([legacy])
  const result = await removeLegacyArchiveWorkspace(registry, {
    path: '/canonical/archive',
    realpath: async value => value
  })

  assert.deepEqual(result, {
    removed: false,
    retained: true,
    workspaceId: 'legacy-archive',
    path: '/canonical/archive'
  })
  assert.deepEqual(registry.deleted, [])
})

test('leaves unrelated and user-renamed Workspace registrations alone', async () => {
  const sameTitle = {
    id: 'same-title', path: '/other', title: LEGACY_ARCHIVE_WORKSPACE_TITLE, sessionIds: []
  }
  const samePath = {
    id: 'same-path', path: '/canonical/archive', title: '个人归档', sessionIds: []
  }
  const registry = new FakeRegistry([sameTitle, samePath])

  const result = await removeLegacyArchiveWorkspace(registry, {
    path: '/configured/archive',
    realpath: async () => '/canonical/archive'
  })

  assert.deepEqual(result, { removed: false, path: '/canonical/archive' })
  assert.deepEqual(registry.deleted, [])
  assert.deepEqual(registry.list(), [sameTitle, samePath])
})

test('removes a stale legacy registration even when its directory is missing', async () => {
  const legacy = {
    id: 'stale-archive', path: '/missing/archive', title: LEGACY_ARCHIVE_WORKSPACE_TITLE, sessionIds: []
  }
  const registry = new FakeRegistry([legacy])
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })

  const result = await removeLegacyArchiveWorkspace(registry, {
    path: '/missing/archive',
    realpath: async () => { throw missing }
  })

  assert.deepEqual(result, {
    removed: true,
    workspaceId: 'stale-archive',
    path: '/missing/archive'
  })
  assert.deepEqual(registry.deleted, ['stale-archive'])
})

test('treats an absent unregistered legacy directory as an already-complete migration', async () => {
  const registry = new FakeRegistry([])
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })

  const result = await removeLegacyArchiveWorkspace(registry, {
    path: '/missing/archive',
    realpath: async () => { throw missing }
  })

  assert.deepEqual(result, { removed: false, path: '/missing/archive' })
  assert.deepEqual(registry.deleted, [])
})

class WorkspaceRegistry {
  constructor() {
    this.state = {
      initialized: true,
      workspaceIds: [],
      archivedSessionIds: ['archived']
    }
    this.operationTail = Promise.resolve()
  }

  list() { return [] }

  enqueueOperation(operation) {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  requireState() { return this.state }

  async setState(state) { this.state = state }

  /** 复刻 DSH 0.1.6 的公开 API：自己串行、对未归档 id 幂等 no-op。 */
  unarchiveSession(sessionId) {
    return this.enqueueOperation(async () => {
      if (!this.requireState().archivedSessionIds.includes(sessionId)) return
      await this.setState({
        ...this.state,
        archivedSessionIds: this.state.archivedSessionIds.filter(id => id !== sessionId)
      })
    })
  }
}

function invokeRoute(route, method, body, options = {}) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    request.method = method
    request.authenticated = options.authenticated !== false
    request.headers = method === 'POST' && options.trusted !== false
      ? {
          host: '127.0.0.1:3080',
          origin: 'http://127.0.0.1:3080',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          [CLIENT_HEADER]: '1',
          ...options.headers
        }
      : (options.headers || {})
    let status
    const response = {
      writeHead(value) { status = value },
      end(value) {
        try {
          resolve({ status, body: JSON.parse(String(value)) })
        } catch (error) {
          reject(error)
        }
      }
    }
    route.handler(request, response)
  })
}

test('runtime version gate stays inert outside the audited release line', async () => {
  assert.deepEqual(classifyDshVersion('0.1.7-alpha.1+local'), {
    supported: true, verified: true, normalized: '0.1.7-alpha.1'
  })
  assert.equal(classifyDshVersion('0.1.7-alpha.2').supported, true)
  assert.equal(classifyDshVersion('0.1.7-alpha.2').verified, false)
  assert.equal(classifyDshVersion('0.1.7-alpha.0').supported, false)
  assert.equal(classifyDshVersion('0.1.6-alpha.2').supported, false, 'previous release line is outside')
  assert.equal(classifyDshVersion('0.1.8-rc.1').supported, false, 'the next line needs a re-verified release')

  let sideEffects = 0
  const ctx = {
    logger: { warn() {}, error() {} },
    inject() { sideEffects += 1 },
    effect() { sideEffects += 1 },
    workspaceRegistry: {
      list() { sideEffects += 1; return [] },
      async delete() { sideEffects += 1 }
    }
  }
  await applyForVersion(ctx, '0.1.8-rc.1')
  assert.equal(sideEffects, 0)
})

test('registers a restoration route even when permanent deletion is unsupported', async () => {
  const routes = []
  const cleanups = []
  const registry = new WorkspaceRegistry()
  const webContext = {
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      }
    },
    effect(factory) {
      for (const cleanup of factory()) cleanups.push(cleanup)
    }
  }
  const context = {
    workspaceRegistry: registry,
    sessionPersistence: {},
    sessions: {},
    agents: {},
    storageDomain: {},
    connection: {
      requestRejection(request) {
        if (request.authenticated === false) return 401
        return request.headers?.host === '127.0.0.1:3080' ? undefined : 403
      }
    },
    logger: { info() {}, warn() {}, error() {} },
    effect(factory) { cleanups.push(factory()) },
    inject(names, callback) {
      assert.deepEqual(names, ['webServer'])
      callback(webContext)
    }
  }

  await apply(context)
  const statusRoute = routes.find(route => route.path === STATUS_PATH)
  const deleteRoute = routes.find(route => route.path === DELETE_PATH)
  const restoreRoute = routes.find(route => route.path === RESTORE_PATH)
  assert.ok(statusRoute)
  assert.ok(deleteRoute)
  assert.ok(restoreRoute)

  const unauthenticatedStatus = await invokeRoute(statusRoute, 'GET', undefined, {
    authenticated: false,
    headers: { host: '127.0.0.1:3080' }
  })
  assert.equal(unauthenticatedStatus.status, 401)
  assert.equal(unauthenticatedStatus.body.code, 'unauthorized-client')
  assert.equal(unauthenticatedStatus.body.deletionUnavailable, undefined)

  const attackerStatus = await invokeRoute(statusRoute, 'GET', undefined, {
    headers: { host: 'attacker.example' }
  })
  assert.equal(attackerStatus.status, 403)
  assert.equal(attackerStatus.body.code, 'forbidden-client')

  const status = await invokeRoute(statusRoute, 'GET', undefined, {
    headers: { host: '127.0.0.1:3080' }
  })
  assert.equal(status.status, 200)
  assert.equal(status.body.deletionSupported, false)
  assert.equal(status.body.restorationSupported, true)

  const restored = await invokeRoute(restoreRoute, 'POST', { sessionId: 'archived' })
  assert.deepEqual(restored, {
    status: 200,
    body: { ok: true, sessionId: 'archived', archivedSessionIds: [] }
  })
  assert.deepEqual(registry.state.archivedSessionIds, [])

  const repeated = await invokeRoute(restoreRoute, 'POST', { sessionId: 'archived' })
  assert.equal(repeated.status, 409)
  assert.equal(repeated.body.code, 'session-not-archived')

  registry.state = { ...registry.state, archivedSessionIds: ['archived'] }
  const crossSite = await invokeRoute(
    restoreRoute,
    'POST',
    { sessionId: 'archived' },
    { headers: { 'sec-fetch-site': 'cross-site' } }
  )
  assert.equal(crossSite.status, 403)
  assert.equal(crossSite.body.code, 'forbidden-client')
  assert.deepEqual(registry.state.archivedSessionIds, ['archived'])

  const unauthenticated = await invokeRoute(
    restoreRoute,
    'POST',
    { sessionId: 'archived' },
    { authenticated: false }
  )
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.body.code, 'unauthorized-client')
  assert.deepEqual(registry.state.archivedSessionIds, ['archived'])

  const attackerAuthority = await invokeRoute(
    restoreRoute,
    'POST',
    { sessionId: 'archived' },
    {
      trusted: false,
      headers: {
        host: 'attacker.example',
        origin: 'http://attacker.example',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        [CLIENT_HEADER]: '1'
      }
    }
  )
  assert.equal(attackerAuthority.status, 403)
  assert.equal(attackerAuthority.body.code, 'forbidden-client')
  assert.deepEqual(registry.state.archivedSessionIds, ['archived'])

  const missingClient = await invokeRoute(
    restoreRoute,
    'POST',
    { sessionId: 'archived' },
    { trusted: false, headers: { 'content-type': 'application/json' } }
  )
  assert.equal(missingClient.status, 403)
  assert.equal(missingClient.body.code, 'forbidden-client')

  const invalidRoot = await invokeRoute(restoreRoute, 'POST', null)
  assert.equal(invalidRoot.status, 400)
  assert.equal(invalidRoot.body.code, 'invalid-json')

  const wrongContentType = await invokeRoute(
    restoreRoute,
    'POST',
    { sessionId: 'archived' },
    { headers: { 'content-type': 'text/plain' } }
  )
  assert.equal(wrongContentType.status, 415)
  assert.equal(wrongContentType.body.code, 'invalid-content-type')

  for (const cleanup of cleanups.reverse()) await cleanup?.()
})
