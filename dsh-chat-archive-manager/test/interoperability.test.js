import assert from 'node:assert/strict'
import test from 'node:test'

import { removeLegacyArchiveWorkspace } from '../lib/index.js'
import { installTestInterceptor } from './interceptor-fixture.js'

class Registry {
  constructor(items) { this.items = items }
  list() { return [...this.items] }
  async delete(id) {
    const before = this.items.length
    this.items = this.items.filter(item => item.id !== id)
    return this.items.length !== before
  }
}

test('legacy migration respects an independently installed registry interceptor', async () => {
  const peer = { id: 'peer', path: '/peer', title: 'peer' }
  const archive = { id: 'archive', path: '/legacy/archive', title: '已归档', sessionIds: [] }
  const registry = new Registry([peer, archive])
  const restorePeer = installTestInterceptor(
    registry,
    'delete',
    10,
    (next, id) => id === peer.id ? false : next(id)
  )

  const result = await removeLegacyArchiveWorkspace(registry, {
    path: '/configured/archive',
    realpath: async () => '/legacy/archive'
  })

  assert.equal(result.removed, true)
  assert.deepEqual(registry.list(), [peer])
  assert.equal(await registry.delete(peer.id), false)

  restorePeer()
  assert.equal(await registry.delete(peer.id), true)
})
