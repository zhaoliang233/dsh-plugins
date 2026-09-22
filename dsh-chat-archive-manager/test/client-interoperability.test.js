import assert from 'node:assert/strict'
import test from 'node:test'

import { installTestInterceptor } from './interceptor-fixture.js'

let definition
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../client.js?settings-only-interoperability')

const React = {
  Fragment: Symbol('Fragment'),
  createElement() { return null },
  useEffect() {},
  useState(initial) { return [initial, () => {}] },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot() }
}
const Component = () => null

function archivePlugin() {
  return definition.factory(id => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        IconArchiveOutline20: Component,
        IconLoadingOutline16: Component,
        IconRefreshOutline16: Component,
        IconTrashOutline16: Component,
        Modal: Component
      }
    }
    throw new Error(`unexpected require ${id}`)
  })
}

function pluginContext(workspaces, sessions) {
  const cleanups = []
  return {
    value: {
      workspaces,
      sessions,
      slots: {
        inject(_name, factory) { return factory() },
        register() { return () => {} },
        // 该 bundle 只注册「归档管理」分区与导航图标 helper；设置账本在 0.1.7 里
        // 已经没有原生 `archived-sessions` 分区，这里按同一个账本回答。
        entries() { return [] },
        subscribe() { return () => {} }
      },
      effect(factory) {
        const cleanup = factory()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
    },
    cleanup() { for (const dispose of cleanups.reverse()) dispose() }
  }
}

async function settle() { await new Promise(resolve => setImmediate(resolve)) }

test('Settings-only client does not overwrite a peer Workspace interceptor', async () => {
  const calls = []
  const workspaces = {
    list: {
      getSnapshot() { return { items: [], archivedSessionIds: [] } },
      subscribe() { return () => {} }
    },
    startSession(id) { calls.push(id) },
    async refresh() {}
  }
  const sessions = {
    list: {
      getSnapshot() { return { ids: [], byId: {} } },
      subscribe() { return () => {} }
    },
    async refresh() {}
  }
  const restorePeer = installTestInterceptor(
    workspaces,
    'startSession',
    10,
    (next, id) => id === 'peer' ? undefined : next(id)
  )
  const peerWrapper = workspaces.startSession
  const archiveContext = pluginContext(workspaces, sessions)
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        ok: true,
        workspaceProjection: false,
        deletionSupported: true,
        restorationSupported: true
      }
    }
  })

  try {
    archivePlugin().apply(archiveContext.value)
    await settle()
    assert.equal(workspaces.startSession, peerWrapper)

    workspaces.startSession('peer')
    workspaces.startSession('project')
    assert.deepEqual(calls, ['project'])

    archiveContext.cleanup()
    assert.equal(workspaces.startSession, peerWrapper)
    workspaces.startSession('peer')
    assert.deepEqual(calls, ['project'])

    restorePeer()
    workspaces.startSession('peer')
    assert.deepEqual(calls, ['project', 'peer'])
  } finally {
    globalThis.fetch = previousFetch
  }
})
