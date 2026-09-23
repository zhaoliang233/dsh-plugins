import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DEFAULT_WORKSPACE_TITLE,
  LEGACY_WORKSPACE_TITLE,
  applyForVersion,
  classifyDshVersion,
  ensureManagedWorkspace,
  protectManagedWorkspace,
  statusRequestRejection
} from '../lib/index.js'

test('status snapshot reports whether core owns a default-Workspace initializer', async () => {
  // 0.1.7 起核心自带 initializeDefault()（registry 与会话历史皆空时自动建「默认工作区」）。
  // 插件的受管「通用会话」与它不是同一个目录，这里只把能力探测结果如实报出来。
  const managed = new FakeWorkspace('managed', '/managed', DEFAULT_WORKSPACE_TITLE)
  const registry = new FakeRegistry([managed])

  async function statusOf(candidate) {
    let payload
    const ctx = {
      workspaceRegistry: candidate,
      logger: { info() {}, warn() {}, error() {} },
      effect: (factory) => factory(),
      inject: (names, callback) => callback({
        connection: { requestRejection: () => undefined },
        webServer: { register: (route) => { payload = route; return () => {} } },
        effect: (factory) => factory()
      })
    }
    await applyForVersion(ctx, '0.1.7-alpha.1')
    return payload
  }

  const withoutCore = await statusOf(registry)
  assert.equal(withoutCore.handler instanceof Function, true)
  const emptyResponse = { writeHead() {}, end(body) { this.body = JSON.parse(body) } }
  withoutCore.handler({ method: 'GET' }, emptyResponse)
  assert.equal(emptyResponse.body.coreDefaultWorkspace, false)

  const registryWithCore = new FakeRegistry([managed])
  registryWithCore.initializeDefault = async () => managed
  const withCore = await statusOf(registryWithCore)
  const coreResponse = { writeHead() {}, end(body) { this.body = JSON.parse(body) } }
  withCore.handler({ method: 'GET' }, coreResponse)
  assert.equal(coreResponse.body.coreDefaultWorkspace, true)
  assert.equal(coreResponse.body.title, DEFAULT_WORKSPACE_TITLE)
})

class FakeWorkspace {
  constructor(id, path, title) {
    this.id = id
    this.path = path
    this.title = title
    this.sessionIds = []
  }

  async setTitle(title) {
    this.title = title
  }
}

class FakeRegistry {
  constructor(items = []) {
    this.items = items
    this.counter = items.length
  }

  list() {
    return [...this.items]
  }

  async create(path, title) {
    const existing = this.items.find((item) => item.path === path)
    if (existing !== undefined) return existing
    const workspace = new FakeWorkspace(`workspace-${++this.counter}`, path, title)
    this.items.unshift(workspace)
    return workspace
  }

  async delete(id) {
    const before = this.items.length
    this.items = this.items.filter((item) => item.id !== id)
    return this.items.length !== before
  }

  async insertBefore(id, beforeId) {
    const current = this.items.find((item) => item.id === id)
    if (current === undefined) throw new Error('unknown workspace')
    const rest = this.items.filter((item) => item.id !== id)
    const index = beforeId === undefined ? rest.length : rest.findIndex((item) => item.id === beforeId)
    if (index < 0) throw new Error('unknown anchor')
    rest.splice(index, 0, current)
    this.items = rest
    return this.items.map((item) => item.id)
  }
}

test('runtime version gate stays inert outside the audited release line', async () => {
  assert.deepEqual(classifyDshVersion('0.1.7-alpha.1+local'), {
    supported: true, verified: true, normalized: '0.1.7-alpha.1'
  })
  assert.equal(classifyDshVersion('0.1.7-alpha.2').supported, true)
  assert.equal(classifyDshVersion('0.1.7-alpha.2').verified, false, 'same line but not individually verified')
  assert.equal(classifyDshVersion('0.1.7-beta.0').supported, true)
  assert.equal(classifyDshVersion('0.1.7').supported, true)
  assert.equal(classifyDshVersion('0.1.7-alpha.0').supported, false)
  assert.equal(classifyDshVersion('0.1.6-alpha.2').supported, false, 'previous release line is now outside')

  let sideEffects = 0
  await applyForVersion({
    logger: { warn() {}, error() {} },
    effect() { sideEffects += 1 },
    inject() { sideEffects += 1 },
    workspaceRegistry: {
      async create() { sideEffects += 1 },
      list() { sideEffects += 1; return [] }
    }
  }, '0.1.6-alpha.2')
  assert.equal(sideEffects, 0)
})

test('protects the status snapshot with the DSH browser-auth boundary', () => {
  const request = { headers: { host: '127.0.0.1:3080' } }
  assert.equal(statusRequestRejection(request, { requestRejection: () => undefined }), undefined)
  assert.equal(statusRequestRejection(request, { requestRejection: () => 401 }), 401)
  assert.equal(statusRequestRejection(request, { requestRejection: () => 403 }), 403)
})

test('adopts the legacy managed path, updates its title, and pins it first', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-default-workspace-'))
  try {
    const managedPath = join(root, 'dsh-home', 'workspaces', 'default')
    const project = new FakeWorkspace('project', join(root, 'project'), 'project')
    const legacy = new FakeWorkspace('legacy-managed', managedPath, LEGACY_WORKSPACE_TITLE)
    const registry = new FakeRegistry([project, legacy])

    const result = await ensureManagedWorkspace(registry, { path: managedPath })

    assert.equal(DEFAULT_WORKSPACE_TITLE, '通用会话')
    assert.equal(result.workspace.id, legacy.id)
    assert.equal(result.workspace.title, DEFAULT_WORKSPACE_TITLE)
    assert.equal(registry.list()[0].id, legacy.id)
    assert.equal(registry.list().length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses to overwrite an unrelated Workspace at the managed path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-default-workspace-conflict-'))
  try {
    const managedPath = join(root, 'dsh-home', 'workspaces', 'default')
    const project = new FakeWorkspace('project', join(root, 'project'), 'project')
    const custom = new FakeWorkspace('custom', managedPath, '我的默认目录')
    const registry = new FakeRegistry([project, custom])

    await assert.rejects(
      () => ensureManagedWorkspace(registry, { path: managedPath }),
      /already registered as “我的默认目录”/
    )

    assert.equal(custom.title, '我的默认目录')
    assert.deepEqual(registry.list().map(item => item.id), ['project', 'custom'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fails closed on incompatible Workspace capabilities before creating the directory', async () => {
  let mkdirCalls = 0
  await assert.rejects(
    () => ensureManagedWorkspace({
      async create() {},
      list() { return [] }
    }, {
      path: '/managed',
      async mkdir() { mkdirCalls += 1 }
    }),
    /missing insertBefore\(\)/
  )
  assert.equal(mkdirCalls, 0)

  const registry = new FakeRegistry()
  const create = registry.create.bind(registry)
  registry.create = async (...args) => {
    const workspace = await create(...args)
    Object.defineProperty(workspace, 'setTitle', {
      configurable: true,
      value: workspace.setTitle,
      writable: false
    })
    return workspace
  }
  await assert.rejects(
    () => ensureManagedWorkspace(registry, { path: '/managed', async mkdir() {} }),
    /cannot install the managed Workspace policy/
  )
  assert.deepEqual(registry.list(), [])

  assert.throws(
    () => protectManagedWorkspace({
      async create() {},
      async insertBefore() {},
      list() { return [] }
    }, new FakeWorkspace('managed', '/managed', DEFAULT_WORKSPACE_TITLE)),
    /missing delete\(\)/
  )
})

test('rolls back partial registry patches when policy installation fails', async () => {
  const managed = new FakeWorkspace('managed', '/managed', DEFAULT_WORKSPACE_TITLE)
  const registry = new FakeRegistry([managed])
  const originalCreate = registry.create
  const originalDelete = registry.delete
  const originalInsertBefore = registry.insertBefore
  const originalSetTitle = managed.setTitle

  Object.defineProperty(registry, 'delete', {
    configurable: true,
    get() { return originalDelete },
    set() { throw new Error('read-only delete') }
  })

  assert.throws(() => protectManagedWorkspace(registry, managed), /cannot install the managed Workspace policy/)
  assert.equal(registry.create, originalCreate)
  assert.equal(registry.delete, originalDelete)
  assert.equal(registry.insertBefore, originalInsertBefore)
  assert.equal(managed.setTitle, originalSetTitle)

  delete registry.delete
  const restore = protectManagedWorkspace(registry, managed)
  await restore()
})

test('patches Cordis traceable proxies through their underlying service target', async () => {
  const originalSymbol = Symbol.for('cordis.original')
  const traceable = (target) => new Proxy(target, {
    get(inner, property, receiver) {
      if (property === originalSymbol) return inner
      const value = Reflect.get(inner, property, receiver)
      return typeof value === 'function' ? value.bind(receiver) : value
    },
    set(inner, property, value, receiver) {
      return Reflect.set(inner, property, value, receiver)
    }
  })
  const managed = new FakeWorkspace('managed', '/managed', DEFAULT_WORKSPACE_TITLE)
  const registry = new FakeRegistry([managed])
  const originalDelete = registry.delete
  const originalSetTitle = managed.setTitle
  const restore = protectManagedWorkspace(traceable(registry), traceable(managed))

  assert.equal(await registry.delete(managed.id), false)
  await assert.rejects(() => managed.setTitle('renamed'), /cannot be renamed/)
  await restore()
  assert.equal(registry.delete, originalDelete)
  assert.equal(managed.setTitle, originalSetTitle)
})

test('protects the managed Workspace and keeps it pinned after creates', async () => {
  const managed = new FakeWorkspace('managed', '/managed', DEFAULT_WORKSPACE_TITLE)
  const project = new FakeWorkspace('project', '/project', 'project')
  const registry = new FakeRegistry([managed, project])
  assert.equal(Object.hasOwn(registry, 'create'), false)
  assert.equal(Object.hasOwn(registry, 'delete'), false)
  assert.equal(Object.hasOwn(registry, 'insertBefore'), false)
  assert.equal(Object.hasOwn(managed, 'setTitle'), false)
  const restore = protectManagedWorkspace(registry, managed)
  assert.equal(Object.hasOwn(registry, 'create'), true)
  assert.equal(Object.hasOwn(managed, 'setTitle'), true)

  assert.equal(await registry.delete(managed.id), false)
  assert.equal(registry.list()[0].id, managed.id)
  await assert.rejects(() => managed.setTitle('renamed'), /cannot be renamed/)

  await registry.create('/new-project', 'new-project')
  assert.equal(registry.list()[0].id, managed.id)

  const before = registry.list().map((item) => item.id)
  await registry.insertBefore(project.id, managed.id)
  assert.deepEqual(registry.list().map((item) => item.id), before)

  await restore()
  assert.equal(Object.hasOwn(registry, 'create'), false)
  assert.equal(Object.hasOwn(registry, 'delete'), false)
  assert.equal(Object.hasOwn(registry, 'insertBefore'), false)
  assert.equal(Object.hasOwn(managed, 'setTitle'), false)
  assert.equal(await registry.delete(managed.id), true)
})
