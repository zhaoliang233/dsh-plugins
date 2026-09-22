import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

import { ArchiveDeleteError, createArchiveDeletionService, protectDeletedSessions } from '../lib/archive-deletion.js'
import { ArchiveRestoreError, createArchiveRestorationService } from '../lib/archive-restoration.js'

class FakeWorkspace {
  constructor(sessionId) { this.sessionIds = [sessionId] }
  async detachSession(sessionId) {
    this.sessionIds = this.sessionIds.filter(id => id !== sessionId)
  }
}

class WorkspaceRegistry {
  constructor(sessionId, workspace) {
    this.state = { initialized: true, workspaceIds: ['project'], archivedSessionIds: [sessionId] }
    this.workspace = workspace
    this.headers = new Map([[sessionId, { id: sessionId }]])
    this.sessionPaths = new Map([[sessionId, '/project']])
    this.invalidSessionPaths = new Map()
  }
  get archivedSessionIds() { return this.state.archivedSessionIds }
  list() { return [this.workspace] }
  enqueueOperation(operation) { return operation() }
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

function fakeTracker() {
  return {
    constructor: { name: 'JsonlBackendTracker' },
    openHandles: new Set(),
    writers: new Map(),
    pending: new Map(),
    hasPending(id) { return this.pending.has(id) },
    pendingEntries() { return this.pending.entries() }
  }
}

function fakePersistence(root, snapshots, options = {}) {
  const generation = options.generation ?? CURRENT_GENERATION
  return {
    constructor: { name: 'JsonlSessionPersistence' },
    name: 'session-persistence-jsonl',
    root,
    compression: snapshots.some(snapshot => snapshot.header.path.endsWith('.zstd')) ? 'zstd' : 'none',
    tracker: fakeTracker(),
    migrationPreparations: new Map(),
    coldLogMemo: new Map(),
    // Mirrors the real JsonlSessionPersistence.locate(): generation-blind, derived
    // from the Session directory and id, and never from the selected on-disk
    // generation. Returning `header.path` here hid the not-yet-migrated legacy
    // generation regression, which only showed up as a raw ENOENT at runtime.
    locate(header) {
      const suffix = header.path.endsWith('.zstd') ? '.zstd' : ''
      return { kind: 'jsonl', path: join(dirname(header.path), `session.v${generation}.jsonl${suffix}`) }
    },
    async list() { return snapshots },
    async stat(id) {
      return snapshots.find(snapshot => snapshot.header.id === id)
    },
    async create() {},
    async open() {}
  }
}

function fakeContext({ sessionId, persistence, live = false, liveRuntime, queryFails = false }) {
  const workspace = new FakeWorkspace(sessionId)
  const registry = new WorkspaceRegistry(sessionId, workspace)
  const sidecarDeletes = []
  const domains = new Map(['session_projcache', 'message_feedback'].map(name => [name, {
    table(table) {
      assert.equal(table, 'sessions')
      return { async delete(id) { sidecarDeletes.push([name, id]) } }
    }
  }]))
  let reconciles = 0
  const session = { id: sessionId, header: { id: sessionId } }
  const ctx = {
    workspaceRegistry: registry,
    sessionPersistence: persistence,
    sessions: liveRuntime?.sessions ?? {
      get(id) { return live && id === sessionId ? session : undefined },
      list() { return live ? [session] : [] }
    },
    agents: liveRuntime?.agents ?? { get() { return undefined }, list() { return [] } },
    storageDomain: { get(name) { return domains.get(name) } },
    get(name) {
      if (name !== 'sessionQuery') return undefined
      return { async searchSessions() { reconciles += 1; if (queryFails) throw new Error('query disabled') } }
    },
    logger: { warn() {} }
  }
  return { ctx, registry, workspace, sidecarDeletes, reconciles: () => reconciles }
}

// Mirrors the real private shape of dsh-agent's AgentRegistry, dsh-session's
// SessionStore and dsh-agent-loop's ReactLoopAgent, which the quiescence path
// probes: without this shape the plugin must keep refusing live sessions.
function fakeLiveRuntime(sessionId, { phaseKind = 'idle', status = 'idle', pending = false } = {}) {
  const session = { id: sessionId, header: { id: sessionId } }
  const calls = { cancel: [], whenIdle: 0, scopeDispose: 0 }
  const agent = {
    constructor: { name: 'ReactLoopAgent' },
    id: sessionId,
    session,
    phase: { kind: phaseKind },
    status,
    inbox: { hasPending: pending },
    cancel(cause) { calls.cancel.push(cause) },
    async whenIdle() { calls.whenIdle += 1 },
    scope: { async dispose() { calls.scopeDispose += 1 } }
  }
  const agentEntry = { id: sessionId, agent }
  const sessionEntry = { id: sessionId, session }
  const agentStore = new Map([[sessionId, agentEntry]])
  const sessionStore = new Map([[sessionId, sessionEntry]])
  const agents = {
    constructor: { name: 'AgentRegistry' },
    store: agentStore,
    get(id) { return agentStore.get(id)?.agent },
    list() { return [...agentStore.values()].map(entry => entry.agent) },
    detachEntered(entry) { if (agentStore.get(entry.id) === entry) agentStore.delete(entry.id) }
  }
  const sessions = {
    constructor: { name: 'SessionStore' },
    store: sessionStore,
    get(id) { return sessionStore.get(id)?.session },
    list() { return [...sessionStore.values()].map(entry => entry.session) },
    detachEntered(entry) { if (sessionStore.get(entry.id) === entry) sessionStore.delete(entry.id) }
  }
  return { agent, agentEntry, session, sessionEntry, agentStore, sessionStore, agents, sessions, calls }
}

function trackWriteHandle(persistence, id) {
  const handle = {
    id,
    closes: 0,
    async close() {
      this.closes += 1
      persistence.tracker.openHandles.delete(this)
      if (persistence.tracker.writers.get(id) === this) persistence.tracker.writers.delete(id)
    }
  }
  persistence.tracker.openHandles.add(handle)
  persistence.tracker.writers.set(id, handle)
  return handle
}


async function exists(path) {
  try { await stat(path); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * DSH 0.1.6 wrote `session.v3.jsonl[.zstd]`; 0.1.7 writes `session.v4.jsonl[.zstd]`.
 * The deletion transaction must follow whatever the running build writes, so the
 * fixture defaults to the current line and every generation-specific test passes
 * its own value instead of inheriting a pinned literal.
 */
const CURRENT_GENERATION = 4

async function fixture({ compressed = false, generation = CURRENT_GENERATION, siblings = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-archive-delete-'))
  const persistenceRoot = join(root, 'sessions')
  const sessionDirectory = join(persistenceRoot, '--project--', 'session-1')
  const logPath = join(sessionDirectory, compressed ? `session.v${generation}.jsonl.zstd` : `session.v${generation}.jsonl`)
  await mkdir(sessionDirectory, { recursive: true })
  await writeFile(logPath, compressed
    ? Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00])
    : `{"type":"session","version":${generation},"id":"session-1","createdAt":1,"cwd":"/project","isSeeded":false,"delegationDepth":0}\n`)
  // Extra artifacts in the same session directory: DSH publishes a migration on
  // write-open and keeps the source log, so v3 and v4 legitimately coexist.
  for (const name of siblings) await writeFile(join(sessionDirectory, name), '{}\n', 'utf8')
  const header = {
    version: generation,
    id: 'session-1',
    createdAt: 1,
    cwd: '/project',
    isSeeded: false,
    delegationDepth: 0,
    path: logPath
  }
  const logState = await stat(logPath)
  return {
    root, persistenceRoot, sessionDirectory, logPath, header, generation,
    snapshots: [{ header, revision: 'revision-1', sizeBytes: logState.size }],
    dshHome: join(root, 'dsh-home')
  }
}

test('permanently deletes one cold archived JSONL session', async () => {
  const data = await fixture()
  try {
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await service.initialize()
    assert.deepEqual(await service.delete(data.header.id), { sessionId: data.header.id })
    assert.equal(await exists(data.sessionDirectory), false)
    assert.deepEqual(harness.registry.archivedSessionIds, [])
    assert.deepEqual(harness.workspace.sessionIds, [])
    assert.deepEqual(harness.sidecarDeletes, [
      ['session_projcache', data.header.id], ['message_feedback', data.header.id]
    ])
    assert.deepEqual(await persistence.list(), [])
    await service.dispose()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('deletes a zstd artifact after matching backend list and stat verification', async () => {
  const data = await fixture({ compressed: true })
  try {
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await service.initialize()
    await service.delete(data.header.id)
    assert.equal(await exists(data.sessionDirectory), false)
    assert.deepEqual(harness.registry.archivedSessionIds, [])
    await service.dispose()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('rejects an older physical generation until DSH migrates it', async () => {
  for (const compressed of [false, true]) {
    const data = await fixture({ compressed })
    try {
      // The real backend migrates a legacy log to v3 only when the Session is
      // opened for write, so an archived chat can still hold a v0 artifact.
      const legacyPath = join(data.sessionDirectory, compressed ? 'session.jsonl.zstd' : 'session.jsonl')
      await writeFile(legacyPath, compressed
        ? Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00])
        : '{"type":"session","version":0,"id":"session-1","createdAt":1,"cwd":"/project","delegationDepth":0}\n')
      await rm(data.logPath)
      data.header.path = legacyPath
      data.snapshots[0].sizeBytes = (await stat(legacyPath)).size
      const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
      const harness = fakeContext({ sessionId: data.header.id, persistence })
      const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
      await service.initialize()
      await assert.rejects(
        () => service.delete(data.header.id),
        error => error instanceof ArchiveDeleteError
          && error.code === 'unsupported-artifact'
          && error.status === 501
          && error.message.includes('迁移')
          && !error.message.includes('重启')
      )
      // A legacy artifact must stay a plain preflight refusal: no journal, no
      // quarantine, and a retry must repeat the accurate message rather than the
      // misleading generic "restart dsh web" failure.
      await assert.rejects(
        () => service.delete(data.header.id),
        error => error instanceof ArchiveDeleteError && error.code === 'unsupported-artifact'
      )
      assert.equal(service.status().quarantined, false)
      assert.equal(await exists(join(data.dshHome, 'dsh-archived-chats', 'deletions.json')), false)
      assert.equal(await exists(data.sessionDirectory), true)
      assert.deepEqual(harness.registry.archivedSessionIds, [data.header.id])
      await service.dispose()
    } finally {
      await rm(data.root, { recursive: true, force: true })
    }
  }
})

test('reports a vanished artifact as missing instead of leaking ENOENT', async () => {
  const data = await fixture()
  try {
    await rm(data.logPath)
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await service.initialize()
    await assert.rejects(
      () => service.delete(data.header.id),
      error => error instanceof ArchiveDeleteError
        && error.code === 'session-not-found'
        && error.status === 404
    )
    assert.equal(service.status().quarantined, false)
    await service.dispose()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('query-index failure does not block core deletion', async () => {
  const data = await fixture()
  try {
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence, queryFails: true })
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await service.initialize()
    await service.delete(data.header.id)
    assert.equal(await exists(data.sessionDirectory), false)
    assert.equal(harness.reconciles(), 1)
    await service.dispose()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('rejects live, persistence-held and descendant sessions', async () => {
  for (const mode of ['live', 'cached', 'descendant']) {
    const data = await fixture()
    try {
      const snapshots = mode === 'descendant'
        ? [...data.snapshots, {
            header: {
              id: 'child', createdAt: 2, cwd: '/project', delegationDepth: 1,
              parentSession: data.header.id,
              path: join(data.persistenceRoot, '--project--', 'child', `session.v${CURRENT_GENERATION}.jsonl`)
            },
            revision: 'child'
          }]
        : data.snapshots
      const persistence = fakePersistence(data.persistenceRoot, snapshots)
      if (mode === 'cached') persistence.tracker.openHandles.add({ id: data.header.id })
      const harness = fakeContext({ sessionId: data.header.id, persistence, live: mode === 'live' })
      const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
      await service.initialize()
      const expected = mode === 'live' ? 'session-live'
        : mode === 'cached' ? 'session-cached' : 'session-has-descendants'
      await assert.rejects(
        () => service.delete(data.header.id),
        error => error instanceof ArchiveDeleteError && error.code === expected
      )
      assert.equal(await exists(data.logPath), true)
      await service.dispose()
    } finally {
      await rm(data.root, { recursive: true, force: true })
    }
  }
})

test('unloads an idle live session and then permanently deletes it', async () => {
  const data = await fixture()
  try {
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const handle = trackWriteHandle(persistence, data.header.id)
    const runtime = fakeLiveRuntime(data.header.id)
    const harness = fakeContext({ sessionId: data.header.id, persistence, liveRuntime: runtime })
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await service.initialize()

    assert.deepEqual(await service.delete(data.header.id), { sessionId: data.header.id })

    // The factory's disposal order, over the registry entries and the lease.
    assert.deepEqual(runtime.calls.cancel, [{ kind: 'disposed' }])
    assert.equal(runtime.calls.whenIdle, 1)
    assert.equal(runtime.calls.scopeDispose, 1)
    assert.equal(handle.closes, 1)
    assert.equal(runtime.agentStore.size, 0)
    assert.equal(runtime.sessionStore.size, 0)
    assert.equal(await exists(data.sessionDirectory), false)
    assert.deepEqual(harness.registry.archivedSessionIds, [])
    await service.dispose()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('refuses a live session that is running or holds queued input', async () => {
  for (const mode of ['running', 'pending']) {
    const data = await fixture()
    try {
      const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
      const handle = trackWriteHandle(persistence, data.header.id)
      const runtime = fakeLiveRuntime(data.header.id, mode === 'running'
        ? { phaseKind: 'running', status: 'running' }
        : { pending: true })
      const harness = fakeContext({ sessionId: data.header.id, persistence, liveRuntime: runtime })
      const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
      await service.initialize()

      await assert.rejects(
        () => service.delete(data.header.id),
        error => error instanceof ArchiveDeleteError
          && error.code === 'session-busy'
          && error.status === 409
      )
      // Nothing was unloaded and nothing was touched on disk.
      assert.equal(runtime.calls.cancel.length, 0)
      assert.equal(handle.closes, 0)
      assert.equal(runtime.agentStore.size, 1)
      assert.equal(runtime.sessionStore.size, 1)
      assert.equal(await exists(data.sessionDirectory), true)
      assert.deepEqual(harness.registry.archivedSessionIds, [data.header.id])
      assert.equal(service.status().quarantined, false)
      await service.dispose()
    } finally {
      await rm(data.root, { recursive: true, force: true })
    }
  }
})

test('keeps an earlier preflight refusal from unloading the live session', async () => {
  for (const compressed of [false, true]) {
    const data = await fixture({ compressed })
    try {
      const legacyPath = join(data.sessionDirectory, compressed ? 'session.jsonl.zstd' : 'session.jsonl')
      await writeFile(legacyPath, compressed
        ? Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00])
        : '{"type":"session","version":0,"id":"session-1","createdAt":1,"cwd":"/project","delegationDepth":0}\n')
      await rm(data.logPath)
      data.header.path = legacyPath
      data.snapshots[0].sizeBytes = (await stat(legacyPath)).size
      const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
      const runtime = fakeLiveRuntime(data.header.id)
      const harness = fakeContext({ sessionId: data.header.id, persistence, liveRuntime: runtime })
      const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
      await service.initialize()

      await assert.rejects(
        () => service.delete(data.header.id),
        error => error instanceof ArchiveDeleteError && error.code === 'unsupported-artifact'
      )
      // The unload runs only after every read-only check, so a refused artifact
      // must leave the session exactly as live as it was.
      assert.equal(runtime.calls.cancel.length, 0)
      assert.equal(runtime.agentStore.size, 1)
      assert.equal(runtime.sessionStore.size, 1)
      assert.equal(await exists(data.sessionDirectory), true)
      await service.dispose()
    } finally {
      await rm(data.root, { recursive: true, force: true })
    }
  }
})

test('re-checks idleness right before unloading the live session', async () => {
  const data = await fixture()
  try {
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const runtime = fakeLiveRuntime(data.header.id)
    const originalStat = persistence.stat.bind(persistence)
    // The backend header check runs inside preflight, so flipping the agent to
    // running here models a prompt that lands between planning and unloading.
    persistence.stat = async (id) => {
      const observed = await originalStat(id)
      runtime.agent.phase = { kind: 'running' }
      runtime.agent.status = 'running'
      return observed
    }
    const harness = fakeContext({ sessionId: data.header.id, persistence, liveRuntime: runtime })
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await service.initialize()

    await assert.rejects(
      () => service.delete(data.header.id),
      error => error instanceof ArchiveDeleteError && error.code === 'session-busy'
    )
    assert.equal(runtime.calls.cancel.length, 0)
    assert.equal(runtime.agentStore.size, 1)
    assert.equal(await exists(data.sessionDirectory), true)
    await service.dispose()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('refuses to unload when the runtime shape is unverified', async () => {
  for (const mode of ['service', 'agent']) {
    const data = await fixture()
    try {
      const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
      const runtime = fakeLiveRuntime(data.header.id)
      if (mode === 'service') {
        // A service proxy without the verified class identity must fall back to
        // the restart refusal rather than touching unknown internals.
        runtime.agents.constructor = { name: 'Object' }
      } else {
        // A loop instance missing its teardown surface is a structural mismatch
        // that a restart cannot fix, so it must not be reported as "restart".
        delete runtime.agent.cancel
      }
      const harness = fakeContext({ sessionId: data.header.id, persistence, liveRuntime: runtime })
      const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
      await service.initialize()

      await assert.rejects(
        () => service.delete(data.header.id),
        mode === 'service'
          ? error => error instanceof ArchiveDeleteError
              && error.code === 'session-live'
              && error.message.includes('重启 dsh web')
          : error => error instanceof ArchiveDeleteError
              && error.code === 'unsupported-runtime'
              && error.status === 501
      )
      assert.equal(runtime.agentStore.size, 1)
      assert.equal(await exists(data.sessionDirectory), true)
      await service.dispose()
    } finally {
      await rm(data.root, { recursive: true, force: true })
    }
  }
})

test('quarantines a valid interrupted transaction without moving files', async () => {
  const data = await fixture()
  try {
    const directoryState = await lstat(data.sessionDirectory)
    const logState = await lstat(data.logPath)
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    const journalDirectory = join(data.dshHome, 'dsh-archived-chats')
    await mkdir(journalDirectory, { recursive: true })
    const id = '11111111-1111-4111-8111-111111111111'
    await writeFile(join(journalDirectory, 'deletions.json'), JSON.stringify({
      version: 1,
      transaction: {
        id,
        sessionId: data.header.id,
        header: data.header,
        witness: {
          directory: { dev: directoryState.dev, ino: directoryState.ino },
          log: { dev: logState.dev, ino: logState.ino, size: logState.size, filename: basename(data.logPath) },
          header: { id: data.header.id, createdAt: 1, cwd: '/project' }
        },
        sourceDirectory: data.sessionDirectory,
        trashDirectory: join(data.root, '.dsh-archived-chats-trash', id),
        phase: 'prepared'
      }
    }))
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await assert.rejects(
      () => service.initialize(),
      error => error instanceof ArchiveDeleteError && error.code === 'deletion-recovery-required'
    )
    assert.equal(await exists(data.logPath), true)
    assert.deepEqual(harness.registry.archivedSessionIds, [data.header.id])
    service.disable()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('rejects a journal whose trash path escapes the fixed root', async () => {
  const data = await fixture()
  const outside = join(data.root, 'must-not-delete')
  try {
    await mkdir(outside)
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    const journalDirectory = join(data.dshHome, 'dsh-archived-chats')
    await mkdir(journalDirectory, { recursive: true })
    await writeFile(join(journalDirectory, 'deletions.json'), JSON.stringify({
      version: 1,
      transaction: {
        id: '11111111-1111-4111-8111-111111111111',
        sessionId: data.header.id,
        header: data.header,
        witness: {
          directory: { dev: 1, ino: 1 },
          log: { dev: 1, ino: 2, size: 1, filename: basename(data.logPath) },
          header: { id: data.header.id }
        },
        sourceDirectory: data.sessionDirectory,
        trashDirectory: outside,
        phase: 'committed'
      }
    }))
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await assert.rejects(
      () => service.initialize(),
      error => error instanceof ArchiveDeleteError && error.code === 'unsafe-deletion-journal'
    )
    assert.equal(await exists(outside), true)
    service.disable()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('keeps an interrupted moved artifact outside the JSONL scan root', async () => {
  const data = await fixture()
  try {
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    const service = createArchiveDeletionService(harness.ctx, {
      dshHome: data.dshHome,
      afterArtifactRename: async () => { throw new Error('simulated crash after rename') }
    })
    await service.initialize()
    await assert.rejects(
      () => service.delete(data.header.id),
      error => error instanceof ArchiveDeleteError && error.code === 'archive-delete-quarantined'
    )

    assert.equal(await exists(data.sessionDirectory), false)
    assert.deepEqual(await readdir(data.persistenceRoot), ['--project--'])
    const trashRoot = join(data.root, '.dsh-archived-chats-trash')
    const trashEntries = await readdir(trashRoot)
    assert.equal(trashEntries.length, 1)
    assert.equal(await exists(join(trashRoot, trashEntries[0], basename(data.logPath))), true)
    const journal = JSON.parse(await readFile(join(data.dshHome, 'dsh-archived-chats', 'deletions.json'), 'utf8'))
    assert.equal(journal.transaction.trashDirectory, join(trashRoot, trashEntries[0]))
    service.disable()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('drains admitted persistence operations and rejects new calls after tombstoning', async () => {
  const data = await fixture()
  try {
    let releaseOpen
    const openBarrier = new Promise(resolve => { releaseOpen = resolve })
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    persistence.open = async () => openBarrier
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    let renameStarted = false
    let tombstoneReached
    const atTombstone = new Promise(resolve => { tombstoneReached = resolve })
    const service = createArchiveDeletionService(harness.ctx, {
      dshHome: data.dshHome,
      afterTombstone: async () => { tombstoneReached() },
      beforeArtifactRename: async () => { renameStarted = true }
    })
    await service.initialize()

    const admitted = persistence.open(data.header.id, 'read')
    const deletion = service.delete(data.header.id)
    await atTombstone
    assert.equal(service.tombstones.has(data.header.id), true)
    assert.equal(renameStarted, false)
    await assert.rejects(() => persistence.open(data.header.id, 'read'), /已经永久删除/)
    await assert.rejects(() => persistence.stat(data.header.id), /已经永久删除/)
    await assert.rejects(() => persistence.create({ id: data.header.id }), /已经永久删除/)

    releaseOpen()
    await admitted
    await deletion
    assert.equal(renameStarted, true)
    await service.dispose()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('serializes restore behind a destructive transaction', async () => {
  const data = await fixture()
  try {
    let tail = Promise.resolve()
    const runExclusive = operation => {
      const result = tail.then(operation)
      tail = result.then(() => undefined, () => undefined)
      return result
    }
    let releaseRename
    let renameReached
    const renameBarrier = new Promise(resolve => { releaseRename = resolve })
    const atRename = new Promise(resolve => { renameReached = resolve })
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    const deletion = createArchiveDeletionService(harness.ctx, {
      dshHome: data.dshHome,
      runExclusive,
      beforeArtifactRename: async () => {
        renameReached()
        await renameBarrier
      }
    })
    const restoration = createArchiveRestorationService(harness.registry, { runExclusive })
    await deletion.initialize()

    const deleting = deletion.delete(data.header.id)
    await atRename
    const restoring = restoration.restore(data.header.id)
    releaseRename()
    assert.deepEqual(await deleting, { sessionId: data.header.id })
    await assert.rejects(
      () => restoring,
      error => error instanceof ArchiveRestoreError && error.code === 'session-not-archived'
    )
    assert.deepEqual(harness.registry.archivedSessionIds, [])
    await Promise.all([deletion.dispose(), restoration.dispose()])
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('removes inherited persistence wrappers without shadowing the prototype', async () => {
  const prototype = {}
  const methods = ['list', 'create', 'open', 'stat']
  for (const name of methods) {
    Object.defineProperty(prototype, name, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: name === 'list' ? async () => [] : async () => undefined
    })
  }
  const persistence = Object.create(prototype)
  const guard = protectDeletedSessions(persistence, new Set())
  for (const name of methods) assert.equal(Object.hasOwn(persistence, name), true)

  guard.restore()
  for (const name of methods) {
    assert.equal(Object.hasOwn(persistence, name), false)
    assert.equal(persistence[name], prototype[name])
  }
})

test('restores only persistence methods still owned by the plugin', async () => {
  const data = await fixture()
  try {
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await service.initialize()
    const pluginList = persistence.list
    const laterList = async function () { return pluginList.call(this) }
    persistence.list = laterList
    await service.dispose()
    assert.equal(persistence.list, laterList)
    assert.equal((await readFile(data.logPath, 'utf8')).includes('session'), true)
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('follows whatever generation the running DSH writes instead of a pinned literal', async () => {
  for (const generation of [4, 5]) {
    const data = await fixture({ generation })
    try {
      const persistence = fakePersistence(data.persistenceRoot, data.snapshots, { generation })
      const harness = fakeContext({ sessionId: data.header.id, persistence })
      const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
      await service.initialize()
      assert.deepEqual(await service.delete(data.header.id), { sessionId: data.header.id })
      assert.equal(await exists(data.sessionDirectory), false)
      await service.dispose()
    } finally {
      await rm(data.root, { recursive: true, force: true })
    }
  }
})

test('moves the whole session directory when an unmigrated older log sits beside the current one', async () => {
  const data = await fixture({ siblings: ['session.v3.jsonl.zstd'] })
  try {
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    let moved = []
    const service = createArchiveDeletionService(harness.ctx, {
      dshHome: data.dshHome,
      afterArtifactRename: async (transaction) => {
        moved = (await readdir(transaction.trashDirectory)).sort()
        throw new Error('stop after the artifact moved, before the trash is removed')
      }
    })
    await service.initialize()
    await assert.rejects(
      () => service.delete(data.header.id),
      error => error instanceof ArchiveDeleteError && error.code === 'archive-delete-quarantined'
    )
    // DSH 发布迁移时会保留源日志，所以目录里可以同时有 v3 与 v4；删除的对象是
    // 整段会话目录，不是"某一个 generation 的文件"。
    assert.deepEqual(moved, ['session.v3.jsonl.zstd', 'session.v4.jsonl'])
    service.disable()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('still recognises a deletion journal recorded under the previous generation', async () => {
  const data = await fixture()
  try {
    const directoryState = await lstat(data.sessionDirectory)
    const logState = await lstat(data.logPath)
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    const journalDirectory = join(data.dshHome, 'dsh-archived-chats')
    await mkdir(journalDirectory, { recursive: true })
    const id = '22222222-2222-4222-8222-222222222222'
    await writeFile(join(journalDirectory, 'deletions.json'), JSON.stringify({
      version: 1,
      transaction: {
        id,
        sessionId: data.header.id,
        header: data.header,
        witness: {
          directory: { dev: directoryState.dev, ino: directoryState.ino },
          // 0.1.6 写下的 journal：witness 里记的是 v3 文件名，现在进程写 v4。
          log: { dev: logState.dev, ino: logState.ino, size: logState.size, filename: 'session.v3.jsonl' },
          header: { id: data.header.id, createdAt: 1, cwd: '/project' }
        },
        sourceDirectory: data.sessionDirectory,
        trashDirectory: join(data.root, '.dsh-archived-chats-trash', id),
        phase: 'prepared'
      }
    }))
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await assert.rejects(
      () => service.initialize(),
      // 升级不能把旧 journal 变成"没有事务"：必须继续 quarantine，绝不自动动文件。
      error => error instanceof ArchiveDeleteError && error.code === 'deletion-recovery-required'
    )
    assert.equal(await exists(data.logPath), true)
    service.disable()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('clears the 0.1.7 pinnedSessionIds slot when this build has one', async () => {
  const data = await fixture()
  try {
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    // DSH 0.1.7 的 Workspace state 多了 pinnedSessionIds；留着已删除的 id 会让侧栏
    // 为一个不存在的会话补出置顶成员。
    harness.registry.state = {
      ...harness.registry.state,
      pinnedSessionIds: [data.header.id, 'other-session']
    }
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await service.initialize()
    await service.delete(data.header.id)
    assert.deepEqual(harness.registry.state.pinnedSessionIds, ['other-session'])
    assert.deepEqual(harness.registry.state.archivedSessionIds, [])
    await service.dispose()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})

test('leaves a build without pinnedSessionIds untouched', async () => {
  const data = await fixture()
  try {
    const persistence = fakePersistence(data.persistenceRoot, data.snapshots)
    const harness = fakeContext({ sessionId: data.header.id, persistence })
    // 0.1.6 没有这个字段：删除后的 state 形状必须与旧行为一致（不凭空多出键）。
    const service = createArchiveDeletionService(harness.ctx, { dshHome: data.dshHome })
    await service.initialize()
    await service.delete(data.header.id)
    assert.deepEqual(Object.keys(harness.registry.state).sort(), ['archivedSessionIds', 'initialized', 'workspaceIds'])
    await service.dispose()
  } finally {
    await rm(data.root, { recursive: true, force: true })
  }
})
