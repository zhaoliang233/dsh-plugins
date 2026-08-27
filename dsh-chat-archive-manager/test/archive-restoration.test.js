import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ArchiveRestoreError,
  createArchiveRestorationService
} from '../lib/archive-restoration.js'

class WorkspaceRegistry {
  constructor(archivedSessionIds = ['archived']) {
    this.state = {
      initialized: true,
      workspaceIds: ['project'],
      archivedSessionIds,
      marker: 'preserved'
    }
    this.operationTail = Promise.resolve()
    this.writes = []
    this.unarchiveCalls = []
  }

  enqueueOperation(operation) {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  requireState() { return this.state }

  async setState(state) {
    this.state = state
    this.writes.push(state)
  }

  /**
   * 复刻 DSH 0.1.6 `WorkspaceRegistry.unarchiveSession()`：自己 `enqueueOperation`
   * 串行写 state，对未归档 id 幂等 no-op。恢复必须**只**经过这个方法。
   */
  unarchiveSession(sessionId) {
    this.unarchiveCalls.push(sessionId)
    return this.enqueueOperation(async () => {
      if (!this.requireState().archivedSessionIds.includes(sessionId)) return
      await this.setState({
        ...this.state,
        archivedSessionIds: this.state.archivedSessionIds.filter(id => id !== sessionId)
      })
    })
  }
}

test('restores an archived session through the public registry API', async () => {
  const registry = new WorkspaceRegistry(['older', 'target', 'newer'])
  const service = createArchiveRestorationService(registry)

  assert.deepEqual(await service.restore('target'), {
    sessionId: 'target',
    archivedSessionIds: ['older', 'newer']
  })
  // 终点断言：写动作必须走公开的 `unarchiveSession()`，而不是自己 setState。
  // 少了这条，将来有人回退到私有 writer 就不会被发现。
  assert.deepEqual(registry.unarchiveCalls, ['target'])
  assert.deepEqual(registry.state, {
    initialized: true,
    workspaceIds: ['project'],
    archivedSessionIds: ['older', 'newer'],
    marker: 'preserved'
  })
  assert.equal(registry.writes.length, 1)
  await service.dispose()
})

test('fails closed when the public unarchiveSession API is missing', () => {
  const registry = new WorkspaceRegistry(['archived'])
  registry.unarchiveSession = undefined
  assert.throws(
    () => createArchiveRestorationService(registry),
    error => error instanceof ArchiveRestoreError
      && error.code === 'unsupported-runtime'
      && error.status === 501
  )
})

test('rejects invalid and non-archived session ids without writing', async () => {
  const registry = new WorkspaceRegistry(['archived'])
  const service = createArchiveRestorationService(registry)

  await assert.rejects(
    () => service.restore(''),
    error => error instanceof ArchiveRestoreError
      && error.code === 'invalid-session-id'
      && error.status === 400
  )
  await assert.rejects(
    () => service.restore('active'),
    error => error instanceof ArchiveRestoreError
      && error.code === 'session-not-archived'
      && error.status === 409
  )
  // 未归档时连公开 API 都不该调用（它本身是幂等 no-op，会把 409 吞掉）。
  assert.deepEqual(registry.unarchiveCalls, [])
  assert.equal(registry.writes.length, 0)
  await service.dispose()
})

test('stops accepting restoration requests after disposal', async () => {
  const registry = new WorkspaceRegistry(['archived'])
  const service = createArchiveRestorationService(registry)
  await service.dispose()

  await assert.rejects(
    () => service.restore('archived'),
    error => error instanceof ArchiveRestoreError
      && error.code === 'plugin-disposed'
      && error.status === 503
  )
  assert.deepEqual(registry.state.archivedSessionIds, ['archived'])
})
