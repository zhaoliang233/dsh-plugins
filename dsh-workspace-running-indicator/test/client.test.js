import assert from 'node:assert/strict'
import test from 'node:test'

let definition

globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      definition = value
    }
  }
}

await import('../client.js')

// 客户端 bundle 不 require 任何平台模块；一旦它开始依赖别的包，这个 require 会立刻报错，
// 提醒测试也要跟着更新依赖声明。
const client = definition.factory((name) => {
  throw new Error(`unexpected require: ${name}`)
})

const {
  DONE,
  EMPTY_WORKSPACE_KEY,
  ONGOING,
  STATE_ATTRIBUTE,
  STATE_SELECTOR,
  STYLE_SELECTOR,
  STYLE_TEXT,
  WARNING,
  clearIndicators,
  createIndicator,
  ensureStyle,
  findIndicator,
  isCollapsedRow,
  sessionState,
  syncIndicators,
  workspaceKeyOfRow,
  workspaceStates
} = client.__internals

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase()
    this._attributes = new Map()
    this.children = []
    this.parentElement = null
    this.textContent = ''
  }

  getAttribute(name) {
    return this._attributes.has(name) ? this._attributes.get(name) : null
  }

  setAttribute(name, value) {
    this._attributes.set(name, String(value))
  }

  removeAttribute(name) {
    this._attributes.delete(name)
  }

  appendChild(child) {
    if (child.parentElement !== null) child.parentElement.removeChild(child)
    child.parentElement = this
    this.children.push(child)
    return child
  }

  removeChild(child) {
    this.children = this.children.filter((candidate) => candidate !== child)
    child.parentElement = null
  }

  remove() {
    if (this.parentElement !== null) this.parentElement.removeChild(this)
  }

  querySelector(selector) {
    if (selector === STATE_SELECTOR) {
      return this.children.find((child) => child.getAttribute(STATE_ATTRIBUTE) !== null) ?? null
    }
    throw new Error(`unsupported selector: ${selector}`)
  }
}

class FakeRow extends FakeNode {
  constructor(rowKey, expanded) {
    super('div')
    this.setAttribute('role', 'treeitem')
    if (rowKey !== undefined) this.setAttribute('data-row-key', rowKey)
    if (expanded !== undefined) this.setAttribute('aria-expanded', String(expanded))
  }
}

class FakeParent extends FakeNode {
  constructor() {
    super('div')
  }
}

class FakeDocument {
  constructor(rows = []) {
    this.rows = rows
    this.head = new FakeParent()
    this.documentElement = new FakeParent()
  }

  querySelectorAll(selector) {
    if (selector === STYLE_SELECTOR) return this.head.children
    if (selector === STATE_SELECTOR) {
      return this.rows.flatMap((row) => row.children.filter((child) => child.getAttribute(STATE_ATTRIBUTE) !== null))
    }
    if (selector === '[role="treeitem"][data-row-key^="workspace:"]') {
      return this.rows.filter((row) => {
        const key = row.getAttribute('data-row-key')
        return typeof key === 'string' && key.startsWith('workspace:')
      })
    }
    throw new Error(`unsupported selector: ${selector}`)
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  createElement(tagName) {
    return new FakeNode(tagName)
  }

  createElementNS(namespace, tagName) {
    if (namespace !== 'http://www.w3.org/2000/svg') throw new Error(`unexpected namespace: ${namespace}`)
    return new FakeNode(tagName)
  }
}

test('the bundle registers itself under the published package id', () => {
  assert.equal(definition.id, 'dsh-workspace-running-indicator')
  assert.deepEqual(client.inject, ['sessions', 'workspaces'])
  assert.equal(typeof client.apply, 'function')
})

test('data-row-key parsing only accepts workspace rows', () => {
  assert.equal(workspaceKeyOfRow('workspace:abc'), 'abc')
  assert.equal(workspaceKeyOfRow('workspace:'), EMPTY_WORKSPACE_KEY)
  assert.equal(workspaceKeyOfRow('session:s-1'), undefined)
  assert.equal(workspaceKeyOfRow('overflow:abc'), undefined)
  assert.equal(workspaceKeyOfRow('empty'), undefined)
  assert.equal(workspaceKeyOfRow(undefined), undefined)
})

test('only an explicit aria-expanded="false" counts as collapsed', () => {
  assert.equal(isCollapsedRow(new FakeRow('workspace:a', false)), true)
  assert.equal(isCollapsedRow(new FakeRow('workspace:a', true)), false)
  assert.equal(isCollapsedRow(new FakeRow('workspace:a')), false, 'a missing attribute must not be treated as collapsed')
})

test('session states follow the shipped priority order', () => {
  assert.equal(sessionState({ pendingInteraction: { kind: 'approval' } }, false), WARNING)
  assert.equal(sessionState({ pendingInteraction: { kind: 'plan-review' } }, false), WARNING)
  assert.equal(sessionState({ pendingInteraction: { kind: 'question' } }, false), WARNING)
  assert.equal(
    sessionState({ pendingInteraction: { kind: 'approval' }, running: true }, false),
    WARNING,
    'a blocking prompt outranks live activity, exactly like sessionStatuses()'
  )
  assert.equal(sessionState({ running: true }, false), ONGOING)
  assert.equal(sessionState({}, true), ONGOING, 'a running subagent reads as ongoing')
  assert.equal(sessionState({ completionUnread: true }, false), DONE)
  assert.equal(sessionState({}, false), undefined, 'idle never shows on the workspace row')
  assert.equal(sessionState(undefined, false), undefined)
  assert.equal(
    sessionState({ pendingInteraction: { kind: 'unknown-kind' }, running: true }, false),
    ONGOING,
    'an unrecognised pending kind falls through instead of inventing a state'
  )
})

test('a workspace shows only its highest-priority session state', () => {
  const workspaces = {
    items: [
      { workspaceId: 'w-warn', sessionIds: ['s-done', 's-run', 's-warn'] },
      { workspaceId: 'w-run', sessionIds: ['s-done', 's-run'] },
      { workspaceId: 'w-done', sessionIds: ['s-done'] },
      { workspaceId: 'w-idle', sessionIds: ['s-idle'] }
    ],
    archivedSessionIds: []
  }
  const sessions = {
    ids: ['s-done', 's-run', 's-warn', 's-idle', 'stray'],
    byId: {}
  }
  const statuses = new Map([
    ['s-done', { completionUnread: true }],
    ['s-run', { running: true }],
    ['s-warn', { pendingInteraction: { kind: 'question' } }],
    ['s-idle', {}],
    ['stray', { running: true }]
  ])

  const states = workspaceStates(workspaces, sessions, statuses)

  assert.equal(states.get('w-warn'), WARNING, 'warning beats running and done in the same group')
  assert.equal(states.get('w-run'), ONGOING, 'running beats done')
  assert.equal(states.get('w-done'), DONE)
  assert.equal(states.has('w-idle'), false, 'an idle-only workspace has nothing to show')
  assert.equal(states.get(EMPTY_WORKSPACE_KEY), ONGOING, 'loose sessions light up the ungrouped bucket')
})

test('archived sessions never light up a workspace', () => {
  const workspaces = {
    items: [{ workspaceId: 'w1', sessionIds: ['s1'] }],
    archivedSessionIds: ['s1']
  }
  const sessions = { ids: ['s1'], byId: {} }
  const statuses = new Map([['s1', { running: true }]])

  assert.equal(workspaceStates(workspaces, sessions, statuses).size, 0)
})

test('without uiSession the plugin falls back to the list snapshot', () => {
  const workspaces = { items: [{ workspaceId: 'w1', sessionIds: ['s1'] }], archivedSessionIds: [] }
  const sessions = { ids: ['s1'], byId: { s1: { running: true } } }

  const states = workspaceStates(workspaces, sessions, undefined)

  assert.equal(states.get('w1'), ONGOING, 'running still works from sessions.list alone')
})

test('running subagents keep their parent workspace in the ongoing state', () => {
  const workspaces = { items: [{ workspaceId: 'w1', sessionIds: ['parent'] }], archivedSessionIds: [] }
  const sessions = {
    ids: ['parent', 'child'],
    byId: {},
    projectionsBySession: {
      parent: { values: { subagentCatalog: [{ id: 'child' }] } }
    }
  }
  const statuses = new Map([['parent', {}], ['child', { running: true }]])

  assert.equal(workspaceStates(workspaces, sessions, statuses).get('w1'), ONGOING)
})

test('malformed snapshots fail closed instead of marking anything', () => {
  assert.equal(workspaceStates(undefined, undefined, undefined).size, 0)
  assert.equal(workspaceStates({ items: null }, { ids: [] }, undefined).size, 0)
  assert.equal(
    workspaceStates({ items: [{ workspaceId: 'w1' }] }, { ids: [] }, new Map()).size,
    0,
    'a Workspace without sessionIds has no members to inspect'
  )
})

test('the three indicator shapes mirror the shipped StateDot', () => {
  const doc = new FakeDocument()

  const spinner = createIndicator(doc, ONGOING)
  assert.equal(spinner.getAttribute('data-state'), ONGOING)
  assert.equal(spinner.getAttribute('width'), '14', 'the shipped ongoing dot is 14px')
  assert.equal(spinner.getAttribute('viewBox'), '0 0 24 24')
  const [track, arc] = spinner.children[0].children
  assert.equal(track.getAttribute('r'), '9.5')
  assert.equal(arc.getAttribute('r'), '9.5')

  for (const state of [WARNING, DONE]) {
    const dot = createIndicator(doc, state)
    assert.equal(dot.tagName, 'SPAN')
    assert.equal(dot.getAttribute('data-state'), state)
    assert.equal(dot.getAttribute('aria-hidden'), 'true')
  }
})

test('the indicator degrades to inert when the document cannot build the node', () => {
  assert.equal(createIndicator({}, ONGOING), null, 'a spinner needs createElementNS')
  assert.equal(createIndicator({}, WARNING), null)
  assert.equal(createIndicator(null, ONGOING), null)
})

test('only collapsed rows with a state get an indicator', () => {
  const collapsedRunning = new FakeRow('workspace:w1', false)
  const expandedRunning = new FakeRow('workspace:w2', true)
  const collapsedIdle = new FakeRow('workspace:w3', false)
  const sessionRow = new FakeRow('session:s1', false)
  const doc = new FakeDocument([collapsedRunning, expandedRunning, collapsedIdle, sessionRow])

  const shown = syncIndicators(doc, new Map([['w1', ONGOING], ['w2', ONGOING]]))

  assert.equal(shown, 1)
  assert.notEqual(findIndicator(collapsedRunning), null)
  assert.equal(findIndicator(expandedRunning), null, 'an expanded group keeps the shipped per-session indicator')
  assert.equal(findIndicator(collapsedIdle), null)
  assert.equal(findIndicator(sessionRow), null, 'session rows are never touched')
})

test('the indicator is appended last so it never shifts shipped children', () => {
  const title = new FakeNode('span')
  const actions = new FakeNode('span')
  const row = new FakeRow('workspace:w1', false)
  row.appendChild(title)
  row.appendChild(actions)
  const doc = new FakeDocument([row])

  syncIndicators(doc, new Map([['w1', ONGOING]]))

  assert.equal(row.children.length, 3)
  assert.equal(row.children[0], title)
  assert.equal(row.children[1], actions)
  assert.equal(row.children[2].getAttribute(STATE_ATTRIBUTE), ONGOING)
})

test('state changes rebuild the node with the right shape', () => {
  const row = new FakeRow('workspace:w1', false)
  const doc = new FakeDocument([row])

  syncIndicators(doc, new Map([['w1', ONGOING]]))
  assert.equal(findIndicator(row).getAttribute('data-state'), ONGOING)

  syncIndicators(doc, new Map([['w1', WARNING]]))
  assert.equal(findIndicator(row).getAttribute('data-state'), WARNING)
  assert.equal(row.children.length, 1, 'the old node is replaced, not stacked')

  syncIndicators(doc, new Map([['w1', DONE]]))
  assert.equal(findIndicator(row).getAttribute('data-state'), DONE)

  syncIndicators(doc, new Map())
  assert.equal(findIndicator(row), null, 'a settled session must clear the indicator')

  syncIndicators(doc, new Map([['w1', ONGOING]]))
  row.setAttribute('aria-expanded', 'true')
  syncIndicators(doc, new Map([['w1', ONGOING]]))
  assert.equal(findIndicator(row), null, 'expanding a group must drop the indicator')
})

test('repeated syncs reuse the same node while the state is unchanged', () => {
  const row = new FakeRow('workspace:w1', false)
  const doc = new FakeDocument([row])

  syncIndicators(doc, new Map([['w1', ONGOING]]))
  const first = findIndicator(row)
  syncIndicators(doc, new Map([['w1', ONGOING]]))

  assert.equal(row.children.length, 1)
  assert.equal(findIndicator(row), first, 'an unchanged state must not restart the animation')
})

test('the ungrouped bucket is addressable through its empty key', () => {
  const ungrouped = new FakeRow('workspace:', false)
  const doc = new FakeDocument([ungrouped])
  syncIndicators(doc, new Map([[EMPTY_WORKSPACE_KEY, DONE]]))
  assert.equal(findIndicator(ungrouped).getAttribute('data-state'), DONE)
})

test('clearIndicators removes every node so uninstalling leaves no trace', () => {
  const first = new FakeRow('workspace:a', false)
  const second = new FakeRow('workspace:b', false)
  const doc = new FakeDocument([first, second])
  syncIndicators(doc, new Map([['a', ONGOING], ['b', WARNING]]))
  assert.notEqual(findIndicator(first), null)

  clearIndicators(doc)

  assert.equal(findIndicator(first), null)
  assert.equal(findIndicator(second), null)
})

test('the stylesheet mirrors the shipped dot palette and hides on hover', () => {
  const doc = new FakeDocument()
  const remove = ensureStyle(doc)

  assert.equal(doc.head.children.length, 1)
  assert.equal(doc.head.children[0].getAttribute('data-plugin'), 'dsh-workspace-running-indicator')
  assert.match(STYLE_TEXT, /--dsw-alias-label-tertiary/u, 'ongoing uses the shipped status colour')
  assert.match(STYLE_TEXT, /--dsw-alias-state-warn-primary/u, 'warning uses the shipped warning colour')
  assert.match(STYLE_TEXT, /--dsw-alias-state-success-primary/u, 'done uses the shipped success colour')
  assert.match(STYLE_TEXT, /stroke-dasharray: 12 150/u, 'the arc keeps the shipped dash pattern')
  assert.match(STYLE_TEXT, /1\.5s linear infinite/u, 'the shipped spin period is 1.5s')
  assert.match(STYLE_TEXT, /width: 14px/u)
  assert.match(STYLE_TEXT, /width: 10px/u, 'dots are 10px, like the shipped non-ongoing states')
  assert.match(STYLE_TEXT, /inset: 20%/u, 'the dot fill keeps the shipped inset')
  assert.match(STYLE_TEXT, /:hover/u)
  assert.match(STYLE_TEXT, /display: none/u, 'hover must remove the indicator entirely')
  assert.match(STYLE_TEXT, /@media \(hover: hover\)/u, 'hover hiding belongs to pointer devices, like the shipped rules')
  assert.match(STYLE_TEXT, /prefers-reduced-motion/u)
  assert.match(STYLE_TEXT, /stroke-dasharray: 18 150/u, 'reduced motion freezes the shipped static arc')

  const removeAgain = ensureStyle(doc)
  assert.equal(doc.head.children.length, 1, 'a second activation must not duplicate the stylesheet')
  removeAgain()

  remove()
  assert.equal(doc.head.children.length, 0)
})

test('apply stays inert without the client snapshot services', () => {
  let effects = 0
  const ctx = {
    effect() {
      effects += 1
      return () => {}
    },
    get() {
      return undefined
    }
  }
  client.apply(ctx)
  assert.equal(effects, 0, 'a profile without the expected client services must not install anything')

  const partial = {
    effect() {
      effects += 1
      return () => {}
    },
    get(name) {
      return name === 'sessions' ? { list: { getSnapshot: () => ({}), subscribe: () => () => {} } } : undefined
    }
  }
  client.apply(partial)
  assert.equal(effects, 0, 'a missing Workspace source is still inert')
})

test('apply reacts to session status and fully cleans up on dispose', async () => {
  const rows = [new FakeRow('workspace:w1', false), new FakeRow('workspace:w2', true)]
  const doc = new FakeDocument(rows)
  const statusListeners = new Set()
  let statusMap = new Map([
    ['s1', { pendingInteraction: { kind: 'question' } }],
    ['s2', { running: true }]
  ])
  const sessionList = {
    getSnapshot: () => ({ ids: ['s1', 's2'], byId: {} }),
    subscribe: () => () => {}
  }
  const workspaceList = {
    getSnapshot: () => ({
      items: [
        { workspaceId: 'w1', sessionIds: ['s1'] },
        { workspaceId: 'w2', sessionIds: ['s2'] }
      ],
      archivedSessionIds: []
    }),
    subscribe: () => () => {}
  }
  const statusSource = {
    getSnapshot: () => statusMap,
    subscribe(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    }
  }
  let dispose
  let disposeStatus
  const ctx = {
    effect(fn) {
      dispose = fn()
      return dispose
    },
    get(name) {
      if (name === 'sessions') return { list: sessionList }
      if (name === 'workspaces') return { list: workspaceList }
      return undefined
    },
    // 动态注入：服务就绪时回调，返回的 disposer 随 fiber 清理。
    inject(deps, callback) {
      if (deps.includes('uiSession') === false) return () => {}
      disposeStatus = callback({ uiSession: { sessionStatus: statusSource } })
      return disposeStatus
    }
  }

  const previousDocument = globalThis.document
  globalThis.document = doc
  try {
    client.apply(ctx)
    await delay(50)

    assert.equal(findIndicator(rows[0]).getAttribute('data-state'), WARNING, 'the pending session wins its group')
    assert.equal(findIndicator(rows[1]), null, 'the expanded workspace keeps the shipped indicator')

    // 后台会话完成 → done，且必须经 uiSession 的订阅实时反映出来。
    statusMap = new Map([['s1', { completionUnread: true }], ['s2', { running: true }]])
    for (const listener of statusListeners) listener()
    await delay(50)
    assert.equal(findIndicator(rows[0]).getAttribute('data-state'), DONE)

    dispose()
    assert.equal(findIndicator(rows[0]), null, 'disposing removes the indicator')
    assert.equal(doc.head.children.length, 0, 'disposing removes the stylesheet')
  } finally {
    if (typeof disposeStatus === 'function') disposeStatus()
    globalThis.document = previousDocument
  }
})

test('a uiSession that arrives after apply upgrades the indicator', async () => {
  const row = new FakeRow('workspace:w1', false)
  const doc = new FakeDocument([row])
  let statuses = new Map([['s1', { pendingInteraction: { kind: 'approval' } }]])
  let notify
  const sessionList = {
    // 降级源：没有 uiSession 时靠 list 的 running 显示转圈。
    getSnapshot: () => ({ ids: ['s1'], byId: { s1: { running: true } } }),
    subscribe: () => () => {}
  }
  const workspaceList = {
    getSnapshot: () => ({ items: [{ workspaceId: 'w1', sessionIds: ['s1'] }], archivedSessionIds: [] }),
    subscribe: () => () => {}
  }
  const statusSource = {
    getSnapshot: () => statuses,
    subscribe(listener) {
      notify = listener
      return () => {
        notify = undefined
      }
    }
  }
  let pendingInjection
  const ctx = {
    effect(fn) {
      return fn()
    },
    get(name) {
      if (name === 'sessions') return { list: sessionList }
      if (name === 'workspaces') return { list: workspaceList }
      return undefined
    },
    inject(deps, callback) {
      // 先不回调，模拟服务在 apply 之后才就绪。
      pendingInjection = () => callback({ uiSession: { sessionStatus: statusSource } })
      return () => {}
    }
  }

  const previousDocument = globalThis.document
  globalThis.document = doc
  try {
    client.apply(ctx)
    await delay(50)
    assert.equal(findIndicator(row).getAttribute('data-state'), ONGOING, 'degraded mode still shows running')

    pendingInjection()
    await delay(50)
    assert.equal(findIndicator(row).getAttribute('data-state'), WARNING, 'the late status source takes over')

    statuses = new Map([['s1', { completionUnread: true }]])
    assert.equal(typeof notify, 'function')
    notify()
    await delay(50)
    assert.equal(findIndicator(row).getAttribute('data-state'), DONE, 'its subscription drives further updates')
  } finally {
    globalThis.document = previousDocument
  }
})
