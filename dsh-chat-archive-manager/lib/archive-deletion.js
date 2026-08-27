import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const JOURNAL_VERSION = 1
const JOURNAL_DIRECTORY = 'dsh-archived-chats'
const JOURNAL_FILENAME = 'deletions.json'
const TRASH_DIRECTORY = '.dsh-archived-chats-trash'
const LOG_FILENAMES = new Set(['session.v3.jsonl', 'session.v3.jsonl.zstd'])
const CURRENT_GENERATION = 3
// Canonical Session log generation names: v0 keeps the suffix-only name, every
// later generation carries a numeric `vN` component (see dsh-session-format).
const CANONICAL_LOG_PATTERN = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/u
const TRANSACTION_PHASES = new Set(['prepared', 'clearing', 'committed'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// Bounded wait for one already-cancelled agent to settle. The driver abort is
// synchronous, so this only covers a slow teardown; exceeding it leaves the
// session live and the delete refused rather than half-unloaded.
const QUIESCE_TIMEOUT_MS = 30_000
const QUIESCE_LOG_PREFIX = 'dsh-chat-archive-manager'

export class ArchiveDeleteError extends Error {
  constructor(code, message, status = 409, options) {
    super(message, options)
    this.name = 'ArchiveDeleteError'
    this.code = code
    this.status = status
  }
}

function isMissing(error) {
  return error?.code === 'ENOENT'
}

async function syncDirectory(path) {
  let handle
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch (error) {
    if (process.platform === 'win32' && (error?.code === 'EINVAL' || error?.code === 'EPERM')) return
    throw error
  } finally {
    await handle?.close()
  }
}

async function ensureDurableDirectory(path) {
  const directory = resolve(path)
  const created = await mkdir(directory, { recursive: true, mode: 0o700 })
  const state = await lstat(directory)
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw new ArchiveDeleteError('unsafe-transaction-directory', '永久删除事务目录必须是非符号链接的规范目录', 500)
  }
  if (created !== undefined) {
    const stop = dirname(resolve(created))
    let cursor = directory
    while (true) {
      await syncDirectory(cursor)
      if (cursor === stop) break
      const parent = dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
  } else {
    await syncDirectory(directory)
  }
  return state
}

async function writeJsonAtomic(path, value) {
  const directory = dirname(path)
  await ensureDurableDirectory(directory)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
    await syncDirectory(directory)
  } finally {
    await handle?.close()
    await rm(temporary, { force: true })
  }
}

class DeletionJournal {
  constructor(path) {
    this.path = path
  }

  async read() {
    let source
    try {
      source = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(source)
    } catch (error) {
      throw new ArchiveDeleteError(
        'invalid-deletion-journal',
        `删除恢复日志不是有效 JSON：${this.path}`,
        500,
        { cause: error }
      )
    }
    if (parsed?.version !== JOURNAL_VERSION || !Object.hasOwn(parsed, 'transaction')) {
      throw new ArchiveDeleteError(
        'invalid-deletion-journal',
        `删除恢复日志版本不受支持：${this.path}`,
        500
      )
    }
    return parsed.transaction
  }

  write(transaction) {
    return writeJsonAtomic(this.path, { version: JOURNAL_VERSION, transaction })
  }
}

function assertFunction(owner, name, description) {
  if (typeof owner?.[name] !== 'function') {
    throw new ArchiveDeleteError('unsupported-runtime', `当前 DSH 缺少 ${description}`, 501)
  }
}

function assertMap(owner, name, description) {
  if (!(owner?.[name] instanceof Map)) {
    throw new ArchiveDeleteError('unsupported-runtime', `当前 DSH 缺少 ${description}`, 501)
  }
}

export function assertDeletionRuntime(ctx) {
  const registry = ctx.workspaceRegistry
  const persistence = ctx.sessionPersistence
  assertFunction(ctx.sessions, 'get', 'SessionStore.get()')
  assertFunction(ctx.sessions, 'list', 'SessionStore.list()')
  assertFunction(ctx.agents, 'get', 'AgentRegistry.get()')
  assertFunction(registry, 'enqueueOperation', 'WorkspaceRegistry operation chain')
  assertFunction(registry, 'requireState', 'WorkspaceRegistry state reader')
  assertFunction(registry, 'setState', 'WorkspaceRegistry state writer')
  assertMap(registry, 'headers', 'WorkspaceRegistry header cache')
  assertMap(registry, 'sessionPaths', 'WorkspaceRegistry session-path cache')
  assertMap(registry, 'invalidSessionPaths', 'WorkspaceRegistry invalid-path cache')
  assertFunction(persistence, 'list', 'SessionPersistence.list()')
  assertFunction(persistence, 'stat', 'SessionPersistence.stat()')
  assertFunction(persistence, 'create', 'SessionPersistence.create()')
  assertFunction(persistence, 'open', 'SessionPersistence.open()')
  assertFunction(persistence, 'locate', 'SessionPersistence.locate()')

  const tracker = persistence.tracker
  if (registry.constructor?.name !== 'WorkspaceRegistry'
    || persistence.constructor?.name !== 'JsonlSessionPersistence'
    || tracker?.constructor?.name !== 'JsonlBackendTracker'
    || persistence.name !== 'session-persistence-jsonl'
    || typeof persistence.root !== 'string'
    || (persistence.compression !== 'none' && persistence.compression !== 'zstd')
    || !(tracker.openHandles instanceof Set)
    || !(tracker.writers instanceof Map)
    || !(tracker.pending instanceof Map)
    || !(persistence.migrationPreparations instanceof Map)
    || !(persistence.coldLogMemo instanceof Map)
    || typeof tracker.hasPending !== 'function'
    || typeof tracker.pendingEntries !== 'function') {
    throw new ArchiveDeleteError(
      'unsupported-persistence',
      '永久删除只支持当前插件已验证的 JSONL 会话存储契约',
      501
    )
  }

  return {
    registry,
    persistence,
    tracker,
    persistenceRoot: resolve(persistence.root)
  }
}

function tombstoneError(id) {
  return new ArchiveDeleteError('session-deleted', `会话“${id}”已经永久删除`, 404)
}

export function protectDeletedSessions(persistence, tombstones) {
  const installed = new Map()
  const inFlightById = new Map()
  const inFlightGlobal = new Set()
  const install = (name, makePatch) => {
    const ownDescriptor = Object.getOwnPropertyDescriptor(persistence, name)
    const original = persistence[name]
    assertFunction(persistence, name, `SessionPersistence.${name}()`)
    const patched = makePatch(original)
    if (ownDescriptor !== undefined && !Object.hasOwn(ownDescriptor, 'value')) {
      throw new TypeError(`SessionPersistence.${name} must be a data property when owned by the instance`)
    }
    const patchedDescriptor = ownDescriptor === undefined
      ? { configurable: true, enumerable: false, writable: true, value: patched }
      : { ...ownDescriptor, value: patched }
    Object.defineProperty(persistence, name, patchedDescriptor)
    installed.set(name, { ownDescriptor, patched })
  }
  const restore = () => {
    for (const [name, entry] of installed) {
      if (persistence[name] !== entry.patched) continue
      if (entry.ownDescriptor === undefined) delete persistence[name]
      else Object.defineProperty(persistence, name, entry.ownDescriptor)
    }
  }
  const track = (id, result) => {
    if (result === null || typeof result?.then !== 'function') return result
    const operations = typeof id === 'string'
      ? (inFlightById.get(id) || new Set())
      : inFlightGlobal
    const promise = Promise.resolve(result)
    operations.add(promise)
    if (typeof id === 'string') inFlightById.set(id, operations)
    const settled = () => {
      operations.delete(promise)
      if (typeof id === 'string' && operations.size === 0) inFlightById.delete(id)
    }
    void promise.then(settled, settled)
    return result
  }
  const rejectId = (original, idOf) => function (...args) {
    const id = idOf(args)
    if (typeof id === 'string' && tombstones.has(id)) return Promise.reject(tombstoneError(id))
    return track(id, Reflect.apply(original, this, args))
  }
  const waitForIdle = async (id) => {
    while (inFlightById.get(id)?.size > 0 || inFlightGlobal.size > 0) {
      await Promise.allSettled([
        ...(inFlightById.get(id) || []),
        ...inFlightGlobal
      ])
    }
  }

  try {
    install('list', original => async function (...args) {
      const snapshots = await track(undefined, Reflect.apply(original, this, args))
      return snapshots.filter(snapshot => !tombstones.has(snapshot.header.id))
    })
    install('create', original => rejectId(original, args => args[0]?.id))
    for (const name of ['open', 'stat']) {
      install(name, original => rejectId(original, args => args[0]))
    }
  } catch (error) {
    restore()
    throw error
  }

  return { restore, waitForIdle }
}

function pathInside(root, candidate) {
  const suffix = relative(root, candidate)
  return suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

function assertStaticLogLocation(persistence, root, header, sourceDirectory) {
  const location = persistence.locate(header)
  if (location?.kind !== 'jsonl' || typeof location.path !== 'string' || !isAbsolute(location.path)
    || !LOG_FILENAMES.has(basename(location.path))) {
    throw new ArchiveDeleteError('unsafe-artifact-path', '会话日志路径格式与当前 DSH 不匹配', 500)
  }
  const expectedDirectory = resolve(dirname(location.path))
  if (expectedDirectory !== sourceDirectory || !pathInside(root, sourceDirectory)) {
    throw new ArchiveDeleteError('unsafe-artifact-path', '删除恢复路径不属于当前会话存储', 500)
  }
}

async function readPlainHeader(path) {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
  const handle = await open(path, flags)
  try {
    const buffer = Buffer.alloc(64 * 1024)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a)
    if (newline < 0) throw new Error('session header exceeds 64 KiB or has no newline')
    return JSON.parse(buffer.subarray(0, newline).toString('utf8'))
  } finally {
    await handle.close()
  }
}

function sameLifecycle(actual, expected) {
  return (actual?.type === undefined || actual.type === 'session')
    && actual.id === expected.id
    && actual.createdAt === expected.createdAt
    && actual.cwd === expected.cwd
    && actual.version === expected.version
}

function sameFileState(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
}

async function captureArtifactWitness(directory, header, filename) {
  const logPath = join(directory, filename)
  const headerPromise = filename.endsWith('.jsonl') ? readPlainHeader(logPath) : Promise.resolve(header)
  const [parentState, directoryState, logState, actualHeader] = await Promise.all([
    lstat(dirname(directory)),
    lstat(directory),
    lstat(logPath),
    headerPromise
  ])
  if (!parentState.isDirectory() || parentState.isSymbolicLink()
    || !directoryState.isDirectory() || directoryState.isSymbolicLink()
    || !logState.isFile() || logState.isSymbolicLink()
    || !sameLifecycle(actualHeader, header)) {
    throw new ArchiveDeleteError(
      'artifact-identity-mismatch',
      '会话目录或日志 header 已变化，拒绝永久删除',
      500
    )
  }
  return {
    directory: { dev: directoryState.dev, ino: directoryState.ino },
    log: { dev: logState.dev, ino: logState.ino, size: logState.size, filename },
    header: {
      id: actualHeader.id,
      createdAt: actualHeader.createdAt,
      cwd: actualHeader.cwd,
      version: actualHeader.version
    }
  }
}

function sameWitness(actual, expected) {
  return actual.directory.dev === expected.directory.dev
    && actual.directory.ino === expected.directory.ino
    && actual.log.dev === expected.log.dev
    && actual.log.ino === expected.log.ino
    && actual.log.size === expected.log.size
    && actual.log.filename === expected.log.filename
    && actual.header.id === expected.header.id
    && actual.header.createdAt === expected.header.createdAt
    && actual.header.cwd === expected.header.cwd
    && actual.header.version === expected.header.version
}

async function assertArtifactWitness(directory, header, expected) {
  const actual = await captureArtifactWitness(directory, header, expected.log.filename)
  if (!sameWitness(actual, expected)) {
    throw new ArchiveDeleteError(
      'artifact-identity-changed',
      '会话文件 identity 在删除期间发生变化，已停止删除',
      500
    )
  }
}

function generationOf(filename) {
  const match = CANONICAL_LOG_PATTERN.exec(filename)
  if (match === null) return undefined
  return match[1] === undefined ? 0 : Number(match[1])
}

// `JsonlSessionPersistence.locate()` is generation-blind: it derives the
// current-generation path from the header and never inspects which generation
// actually exists on disk. A not-yet-migrated legacy log therefore locates to an
// absent path, and a bare lstat() ENOENT there used to surface as a generic
// "restart dsh web and retry" failure that could never succeed. Refuse the
// artifact explicitly instead, without touching anything on disk.
async function lstatCurrentGenerationArtifact(rawLog, rawDirectory) {
  try {
    return await lstat(rawLog)
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  let entries
  try {
    entries = await readdir(rawDirectory, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) {
      throw new ArchiveDeleteError('session-not-found', '会话日志已经不存在', 404, { cause: error })
    }
    throw error
  }

  const current = generationOf(basename(rawLog))
  const observed = new Set()
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue
    const version = generationOf(entry.name)
    if (version !== undefined && version !== current) observed.add(version)
  }
  if (observed.size === 0) {
    throw new ArchiveDeleteError('session-not-found', '会话日志已经不存在', 404)
  }

  const versions = [...observed].sort((left, right) => left - right)
  const listed = versions.map(version => `v${version}`).join('、')
  throw new ArchiveDeleteError(
    'unsupported-artifact',
    versions.some(version => version < current)
      ? `该聊天的日志仍是旧格式（${listed}），DSH 尚未把它迁移为 v${CURRENT_GENERATION}；永久删除不会代 DSH 迁移会话日志。请先在“已归档”中恢复该聊天并继续一次对话以触发迁移，再重新归档后删除。`
      : `该聊天的日志格式（${listed}）高于当前 DSH 支持的 v${CURRENT_GENERATION}，无法安全永久删除。`,
    501
  )
}

async function validateArtifact(persistence, root, snapshot) {
  const header = snapshot.header
  const location = persistence.locate(header)
  if (location?.kind !== 'jsonl' || typeof location.path !== 'string' || !isAbsolute(location.path)
    || !LOG_FILENAMES.has(basename(location.path))) {
    throw new ArchiveDeleteError('unsupported-artifact', '会话没有可安全删除的 JSONL artifact', 501)
  }
  const rawLog = resolve(location.path)
  const rawDirectory = dirname(rawLog)
  const filename = basename(rawLog)
  const beforeRawRead = await lstatCurrentGenerationArtifact(rawLog, rawDirectory)
  const observed = await persistence.stat(header.id)
  const afterRawRead = await lstat(rawLog)
  if (beforeRawRead.isSymbolicLink() || !beforeRawRead.isFile()
    || !sameFileState(beforeRawRead, afterRawRead)
    || observed === undefined || !sameLifecycle(observed.header, header)
    || observed.revision !== snapshot.revision
    || observed.sizeBytes !== afterRawRead.size) {
    throw new ArchiveDeleteError(
      'artifact-identity-mismatch',
      'JSONL backend 返回的实际 header 或文件 identity 与会话不一致',
      500
    )
  }
  let canonicalRoot
  let canonicalLog
  let canonicalDirectory
  try {
    canonicalRoot = await realpath(root)
    canonicalLog = await realpath(location.path)
    canonicalDirectory = await realpath(rawDirectory)
  } catch (error) {
    if (isMissing(error)) {
      throw new ArchiveDeleteError('session-not-found', '会话日志已经不存在', 404, { cause: error })
    }
    throw error
  }
  const rawSuffix = relative(root, rawDirectory)
  const canonicalSuffix = relative(canonicalRoot, canonicalDirectory)
  if (!pathInside(root, rawDirectory)
    || !pathInside(canonicalRoot, canonicalDirectory)
    || rawSuffix !== canonicalSuffix
    || dirname(canonicalLog) !== canonicalDirectory
    || basename(canonicalLog) !== basename(rawLog)) {
    throw new ArchiveDeleteError(
      'unsafe-artifact-path',
      '会话存储包含符号链接或越界路径，拒绝永久删除',
      500
    )
  }
  const witness = await captureArtifactWitness(rawDirectory, header, filename)
  if (!sameFileState(afterRawRead, witness.log)) {
    throw new ArchiveDeleteError(
      'artifact-identity-changed',
      '会话文件在 backend header 校验后发生变化，已停止删除',
      500
    )
  }
  return { sourceDirectory: rawDirectory, witness }
}

function validWitness(witness) {
  return witness !== null && typeof witness === 'object'
    && Number.isSafeInteger(witness.directory?.dev)
    && Number.isSafeInteger(witness.directory?.ino)
    && Number.isSafeInteger(witness.log?.dev)
    && Number.isSafeInteger(witness.log?.ino)
    && Number.isSafeInteger(witness.log?.size)
    && LOG_FILENAMES.has(witness.log?.filename)
    && typeof witness.header?.id === 'string'
}

function validateTransaction(transaction, persistence, persistenceRoot, trashRoot) {
  if (transaction === null || typeof transaction !== 'object'
    || typeof transaction.id !== 'string' || !UUID_PATTERN.test(transaction.id)
    || typeof transaction.sessionId !== 'string' || transaction.sessionId === ''
    || transaction.header === null || typeof transaction.header !== 'object'
    || transaction.header.id !== transaction.sessionId
    || !validWitness(transaction.witness)
    || transaction.witness.header.id !== transaction.sessionId
    || typeof transaction.sourceDirectory !== 'string' || !isAbsolute(transaction.sourceDirectory)
    || typeof transaction.trashDirectory !== 'string' || !isAbsolute(transaction.trashDirectory)
    || !TRANSACTION_PHASES.has(transaction.phase)) {
    throw new ArchiveDeleteError('invalid-deletion-journal', '删除恢复日志缺少有效事务字段', 500)
  }
  const sourceDirectory = resolve(transaction.sourceDirectory)
  const trashDirectory = resolve(transaction.trashDirectory)
  if (sourceDirectory !== transaction.sourceDirectory
    || trashDirectory !== transaction.trashDirectory
    || dirname(trashDirectory) !== trashRoot
    || basename(trashDirectory) !== transaction.id
    || !pathInside(persistenceRoot, sourceDirectory)
    || !pathInside(trashRoot, trashDirectory)
    || pathInside(persistenceRoot, trashDirectory)) {
    throw new ArchiveDeleteError('unsafe-deletion-journal', '删除恢复日志包含越界路径，已停止恢复', 500)
  }
  assertStaticLogLocation(persistence, persistenceRoot, transaction.header, sourceDirectory)
  return transaction
}

function ensureCold(ctx, persistence, tracker, id) {
  if (ctx.sessions.get(id) !== undefined || ctx.agents.get(id) !== undefined) {
    throw new ArchiveDeleteError(
      'session-live',
      '该会话仍由当前 DSH 进程持有，且当前运行时无法安全卸载它。请重启 dsh web 后再删除。'
    )
  }
  if (tracker.writers.has(id) || tracker.pending.has(id)
    || persistence.migrationPreparations.has(id)
    || [...tracker.openHandles].some(handle => handle?.id === id)) {
    throw new ArchiveDeleteError(
      'session-cached',
      '该会话仍被会话存储 handle 或迁移任务持有。请重启 dsh web 后再删除。'
    )
  }
}

// --- Live-session quiescence ------------------------------------------------
// DSH keeps every Session it has resumed live until the process exits: the
// agent factory registers each agent through a `ctx.effect` anchored on the
// registry's own process-lifetime context, the JSONL write lease stays open for
// the life of that handle, and only the private handle returned by
// `agents.resume()` carries the teardown closure — no RPC and no service method
// unloads a Session. An archived chat this process opened once therefore never
// passes `ensureCold()`, and the only previously honest answer was "restart
// `dsh web`". The functions below replicate the factory's own disposal order for
// exactly one *idle* Session over the same private structures this module
// already validates, so a permanent delete can finish without a restart. Every
// structural assumption is checked before anything is touched, and any mismatch
// keeps the old fail-closed refusal.

function unsupportedQuiescence() {
  return new ArchiveDeleteError(
    'unsupported-runtime',
    '当前 DSH 的会话运行时结构与永久删除的安全卸载路径不匹配，已停止删除。',
    501
  )
}

function busySession(message) {
  return new ArchiveDeleteError('session-busy', message)
}

/**
 * Probe the private surfaces the quiescence path needs. A miss returns
 * `undefined`, which leaves live-session deletes on the original restart
 * refusal instead of disabling deletion for cold sessions.
 */
function detectSessionQuiescence(ctx) {
  const agents = ctx.agents
  const sessions = ctx.sessions
  if (agents?.constructor?.name !== 'AgentRegistry'
    || sessions?.constructor?.name !== 'SessionStore'
    || typeof agents.detachEntered !== 'function'
    || typeof sessions.detachEntered !== 'function'
    || !(agents.store instanceof Map)
    || !(sessions.store instanceof Map)) {
    return undefined
  }
  return { agents, sessions }
}

function assertIdleAgent(agent, id) {
  if (agent?.constructor?.name !== 'ReactLoopAgent'
    || agent.id !== id
    || agent.session?.id !== id
    || typeof agent.cancel !== 'function'
    || typeof agent.whenIdle !== 'function'
    || typeof agent.scope?.dispose !== 'function'
    || typeof agent.inbox?.hasPending !== 'boolean'
    || (agent.status !== 'idle' && agent.status !== 'running')
    || agent.phase === null || typeof agent.phase !== 'object'
    || typeof agent.phase.kind !== 'string') {
    throw unsupportedQuiescence()
  }
  if (agent.phase.kind !== 'idle' || agent.status !== 'idle') {
    throw busySession('该会话仍在运行，不能永久删除。请等它空闲后重试。')
  }
  if (agent.inbox.hasPending) {
    throw busySession('该会话仍有排队中的输入，不能永久删除。请先让它处理完再重试。')
  }
}

/**
 * Decide whether this live session can be unloaded. Returns `null` for an
 * already-cold session and never touches runtime state: the caller quiesces
 * only after every other preflight check passed.
 */
function planSessionQuiescence(ctx, runtime, tracker, persistence, id) {
  const agentEntry = runtime.agents.store.get(id)
  const sessionEntry = runtime.sessions.store.get(id)
  if (agentEntry === undefined && sessionEntry === undefined) return null
  if (agentEntry !== undefined
    && (agentEntry.id !== id || agentEntry.agent === undefined)) {
    throw unsupportedQuiescence()
  }
  if (sessionEntry !== undefined
    && (sessionEntry.id !== id || sessionEntry.session?.id !== id)) {
    throw unsupportedQuiescence()
  }
  if (agentEntry !== undefined) assertIdleAgent(agentEntry.agent, id)
  if (tracker.pending.has(id) || persistence.migrationPreparations.has(id)) {
    throw new ArchiveDeleteError(
      'session-cached',
      '该会话仍有未完成的创建或迁移任务。请重启 dsh web 后再删除。'
    )
  }
  if (tracker.writers.get(id) === null) {
    throw busySession('该会话正在被 DSH 打开写句柄，不能永久删除。请稍后重试。')
  }
  return { agent: agentEntry?.agent, agentEntry, sessionEntry }
}

async function withQuiesceTimeout(operation, id) {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(busySession(
          `等待会话“${id}”结束当前活动超时，已放弃永久删除；请稍后重试。`
        )), QUIESCE_TIMEOUT_MS)
        timer.unref?.()
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

function trackedHandles(tracker, id) {
  const handles = new Set()
  for (const handle of tracker.openHandles) {
    if (handle?.id === id) handles.add(handle)
  }
  const writer = tracker.writers.get(id)
  if (writer !== undefined && writer !== null) handles.add(writer)
  return handles
}

/**
 * Unload one idle live session in the factory's own disposal order: cancel the
 * driver, wait for the settled activity, dispose the agent scope, release the
 * JSONL write lease, then detach the registry entries. Each primitive is
 * idempotent, so the factory's own deferred teardown stays a safe no-op.
 */
async function quiesceSession(ctx, runtime, tracker, plan, id) {
  const { agent } = plan
  ctx.logger?.info?.(`${QUIESCE_LOG_PREFIX}: unloading idle live session ${id} before permanent deletion`)
  if (agent !== undefined) {
    // Re-check under the final state: the user may have prompted this session
    // while the earlier preflight checks ran, and that turn must not be killed.
    assertIdleAgent(agent, id)
    agent.cancel({ kind: 'disposed' })
    await withQuiesceTimeout(agent.whenIdle(), id)
    await agent.scope.dispose()
  }
  for (const handle of trackedHandles(tracker, id)) {
    if (typeof handle.close !== 'function') throw unsupportedQuiescence()
    await handle.close()
  }
  if (plan.agentEntry !== undefined) runtime.agents.detachEntered(plan.agentEntry)
  if (plan.sessionEntry !== undefined) runtime.sessions.detachEntered(plan.sessionEntry)
}

function hasDescendant(snapshots, sessionId) {
  const parentById = new Map(snapshots.map(snapshot => [snapshot.header.id, snapshot.header.parentSession]))
  for (const snapshot of snapshots) {
    let cursor = snapshot.header.id
    const seen = new Set()
    while (cursor !== undefined && !seen.has(cursor)) {
      if (cursor === sessionId && snapshot.header.id !== sessionId) return true
      seen.add(cursor)
      cursor = parentById.get(cursor)
    }
  }
  return false
}

async function clearCoreAccounting(ctx, sessionId) {
  const registry = ctx.workspaceRegistry
  await registry.enqueueOperation(async () => {
    for (const workspace of registry.list()) await workspace.detachSession(sessionId)
    const state = registry.requireState()
    if (state.archivedSessionIds.includes(sessionId)) {
      await registry.setState({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId)
      })
    }
    registry.headers.delete(sessionId)
    registry.sessionPaths.delete(sessionId)
    registry.invalidSessionPaths.delete(sessionId)
  })
}

async function clearDerivedState(ctx, sessionId) {
  for (const domainName of ['session_projcache', 'message_feedback']) {
    try {
      const domain = ctx.storageDomain.get(domainName)
      if (domain !== undefined) await domain.table('sessions').delete(sessionId)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-chat-archive-manager: failed to clear ${domainName} for ${sessionId}: ${String(error)}`)
    }
  }
  try {
    const query = ctx.get?.('sessionQuery')
    if (typeof query?.searchSessions === 'function') {
      await query.searchSessions({ query: '__dsh_archived_chats_reconcile__', limit: 1 })
    }
  } catch (error) {
    ctx.logger?.warn?.(`dsh-chat-archive-manager: session-query reconcile deferred: ${String(error)}`)
  }
}

async function renameDurably(source, target) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await rename(source, target)
  await Promise.all([syncDirectory(dirname(source)), syncDirectory(dirname(target))])
}

async function removeTrash(path) {
  await rm(path, { recursive: true, force: true })
  await syncDirectory(dirname(path))
}

export function createArchiveDeletionService(ctx, options = {}) {
  const { persistence, tracker, persistenceRoot } = assertDeletionRuntime(ctx)
  const quiescenceRuntime = detectSessionQuiescence(ctx)
  if (quiescenceRuntime === undefined) {
    ctx.logger?.warn?.(
      `${QUIESCE_LOG_PREFIX}: live Session unload unavailable; an archived chat this process opened still needs a dsh web restart`
    )
  }
  const dshHome = resolve(options.dshHome)
  const journal = new DeletionJournal(join(dshHome, JOURNAL_DIRECTORY, JOURNAL_FILENAME))
  // Keep interrupted artifacts outside the JSONL scan root. The directory is a
  // sibling so rename remains same-filesystem while cold boot never sees trash
  // as a project/session candidate before this plugin can quarantine it.
  const trashRoot = join(dirname(persistenceRoot), TRASH_DIRECTORY)
  const tombstones = new Set()
  const persistenceGuard = protectDeletedSessions(persistence, tombstones)
  const runExclusive = typeof options.runExclusive === 'function'
    ? options.runExclusive
    : operation => operation()
  let operationTail = Promise.resolve()
  let disposed = false
  let quarantined = false
  let disposePromise

  async function updatePhase(transaction, phase) {
    const updated = { ...transaction, phase }
    await journal.write(updated)
    return updated
  }

  async function assertNoPendingTransaction() {
    const value = await journal.read()
    if (value === null) return
    validateTransaction(value, persistence, persistenceRoot, trashRoot)
    quarantined = true
    throw new ArchiveDeleteError(
      'deletion-recovery-required',
      '检测到未完成的永久删除。为避免根据日志自动移动或删除文件，删除功能已停止；请人工检查恢复日志。',
      503
    )
  }

  async function preflight(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      throw new ArchiveDeleteError('invalid-session-id', '缺少要删除的会话 ID', 400)
    }
    if (!ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) {
      throw new ArchiveDeleteError('session-not-archived', '只能永久删除已经归档的会话')
    }
    // A live session is unloaded only through the verified private runtime, and
    // only while it is idle. Everything else keeps the fail-closed refusal, and
    // the unload itself happens after every read-only check below.
    const isLive = ctx.sessions.get(sessionId) !== undefined || ctx.agents.get(sessionId) !== undefined
    let quiescence = null
    if (isLive && quiescenceRuntime !== undefined) {
      quiescence = planSessionQuiescence(ctx, quiescenceRuntime, tracker, persistence, sessionId)
    } else {
      ensureCold(ctx, persistence, tracker, sessionId)
    }
    const snapshots = await persistence.list()
    const matches = snapshots.filter(snapshot => snapshot.header.id === sessionId)
    if (matches.length !== 1) {
      throw new ArchiveDeleteError(
        matches.length === 0 ? 'session-not-found' : 'duplicate-session-id',
        matches.length === 0 ? '会话日志不存在' : '会话存储中存在重复 ID，拒绝删除',
        matches.length === 0 ? 404 : 500
      )
    }
    if (hasDescendant(snapshots, sessionId)
      || ctx.sessions.list().some(session => session.header?.parentSession === sessionId)) {
      throw new ArchiveDeleteError(
        'session-has-descendants',
        '该会话仍有派生会话或子代理记录，不能单独删除。请先处理后代会话。'
      )
    }
    const header = matches[0].header
    const artifact = await validateArtifact(persistence, persistenceRoot, matches[0])
    if (quiescence !== null) {
      await quiesceSession(ctx, quiescenceRuntime, tracker, quiescence, sessionId)
    }
    ensureCold(ctx, persistence, tracker, sessionId)
    return { header, artifact }
  }

  async function deleteOne(sessionId) {
    if (disposed) throw new ArchiveDeleteError('plugin-disposed', '插件正在卸载，不能删除会话', 503)
    await assertNoPendingTransaction()
    const { header, artifact } = await preflight(sessionId)
    const [sourceState, trashState] = await Promise.all([
      lstat(artifact.sourceDirectory),
      ensureDurableDirectory(trashRoot),
      ensureDurableDirectory(dirname(journal.path))
    ])
    if (sourceState.dev !== trashState.dev) {
      throw new ArchiveDeleteError(
        'cross-device-transaction',
        '会话存储与永久删除暂存目录不在同一文件系统，已在写入事务日志前停止删除',
        501
      )
    }
    const id = randomUUID()
    let transaction = {
      id,
      sessionId,
      header,
      witness: artifact.witness,
      sourceDirectory: artifact.sourceDirectory,
      trashDirectory: join(trashRoot, id),
      phase: 'prepared'
    }
    await journal.write(transaction)
    tombstones.add(sessionId)
    try {
      await options.afterTombstone?.(transaction)
      await persistenceGuard.waitForIdle(sessionId)
      ensureCold(ctx, persistence, tracker, sessionId)
      await assertArtifactWitness(transaction.sourceDirectory, header, transaction.witness)
      await options.beforeArtifactRename?.(transaction)
      await renameDurably(transaction.sourceDirectory, transaction.trashDirectory)
      await assertArtifactWitness(transaction.trashDirectory, header, transaction.witness)
      await options.afterArtifactRename?.(transaction)
      transaction = await updatePhase(transaction, 'clearing')
      await clearCoreAccounting(ctx, sessionId)
      transaction = await updatePhase(transaction, 'committed')
      await clearDerivedState(ctx, sessionId)
      await assertArtifactWitness(transaction.trashDirectory, header, transaction.witness)
      await removeTrash(transaction.trashDirectory)
      await journal.write(null)
      return { sessionId }
    } catch (error) {
      quarantined = true
      throw new ArchiveDeleteError(
        'archive-delete-quarantined',
        '永久删除未完成，恢复日志和现有文件状态已保留；插件不会自动继续或回滚。',
        500,
        { cause: error }
      )
    }
  }

  return {
    tombstones,
    initialize: assertNoPendingTransaction,
    status() {
      return { quarantined, quiescenceSupported: quiescenceRuntime !== undefined }
    },
    delete(sessionId) {
      const result = operationTail.then(() => runExclusive(() => deleteOne(sessionId)))
      operationTail = result.then(() => undefined, () => undefined)
      return result
    },
    disable() {
      disposed = true
      persistenceGuard.restore()
    },
    dispose() {
      disposePromise ??= (async () => {
        disposed = true
        await operationTail
        persistenceGuard.restore()
      })()
      return disposePromise
    }
  }
}
