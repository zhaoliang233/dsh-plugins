export class ArchiveRestoreError extends Error {
  constructor(code, message, status = 409, options) {
    super(message, options)
    this.name = 'ArchiveRestoreError'
    this.code = code
    this.status = status
  }
}

function assertFunction(owner, name, description) {
  if (typeof owner?.[name] !== 'function') {
    throw new ArchiveRestoreError('unsupported-runtime', `当前 DSH 缺少 ${description}`, 501)
  }
}

function readArchiveState(registry) {
  const state = registry.requireState()
  const archivedSessionIds = state?.archivedSessionIds
  if (!Array.isArray(archivedSessionIds)
    || archivedSessionIds.some(id => typeof id !== 'string' || id.trim() === '')
    || new Set(archivedSessionIds).size !== archivedSessionIds.length) {
    throw new ArchiveRestoreError(
      'invalid-archive-state',
      '当前 DSH 的归档状态格式不受支持',
      501
    )
  }
  return { state, archivedSessionIds }
}

/**
 * 恢复一条归档会话。
 *
 * 写动作走 DSH 的**公开 API** `WorkspaceRegistry.unarchiveSession(sessionId)`
 * （0.1.6 起在 `dsh-workspace/lib/types/index.d.ts` 里公开）：它自己
 * `enqueueOperation` 串行写 registry state，只从归档集合里摘掉目标 id，
 * 保留 Workspace 记账席位与顺序——因此本模块**不再自己 `setState`**，
 * 也不再把 registry 的私有 writer 当成前置条件。
 *
 * 仍然保留的部分：运行时结构门（fail closed）、与永久删除共用的
 * `runExclusive` 串行队列、未归档时的 409 `session-not-archived`、以及
 * dispose 时等待在途操作。
 * @param registry - `ctx.workspaceRegistry`
 * @param options - `{ runExclusive }` 可选的共享串行队列
 * @returns `{ restore, dispose }`
 */
export function createArchiveRestorationService(registry, options = {}) {
  if (registry?.constructor?.name !== 'WorkspaceRegistry') {
    throw new ArchiveRestoreError('unsupported-runtime', '当前 DSH 的 Workspace 注册表不受支持', 501)
  }
  assertFunction(registry, 'unarchiveSession', 'WorkspaceRegistry.unarchiveSession()')
  assertFunction(registry, 'requireState', 'WorkspaceRegistry state reader')
  readArchiveState(registry)
  const runExclusive = typeof options.runExclusive === 'function'
    ? options.runExclusive
    : operation => operation()

  const inFlight = new Set()
  let accepting = true
  let disposePromise

  async function restore(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      throw new ArchiveRestoreError('invalid-session-id', '缺少要恢复的会话 ID', 400)
    }
    if (!accepting) {
      throw new ArchiveRestoreError('plugin-disposed', '插件正在卸载，不能恢复会话', 503)
    }

    const operation = Promise.resolve(runExclusive(async () => {
      // 先读一遍权威集合：`unarchiveSession()` 对未归档 id 是幂等 no-op
      // （不报错、不写盘），不先判定就会把"本来就没归档"和"恢复成功"混为
      // 一谈，丢掉路由依赖的 409 `session-not-archived` 语义。
      const { archivedSessionIds } = readArchiveState(registry)
      if (!archivedSessionIds.includes(sessionId)) {
        throw new ArchiveRestoreError('session-not-archived', '该会话不在归档列表中')
      }
      await registry.unarchiveSession(sessionId)
      const restored = readArchiveState(registry).archivedSessionIds
      return { sessionId, archivedSessionIds: [...restored] }
    }))
    inFlight.add(operation)
    try {
      return await operation
    } finally {
      inFlight.delete(operation)
    }
  }

  function dispose() {
    accepting = false
    disposePromise ??= Promise.allSettled([...inFlight]).then(() => undefined)
    return disposePromise
  }

  return { restore, dispose }
}
