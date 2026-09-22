import assert from 'node:assert/strict'
import test from 'node:test'

let definition
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../client.js')

function pluginDefinition() {
  const notifications = []
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useEffect() {},
    useLayoutEffect() {},
    useRef(initial) { return { current: initial } },
    useState(initial) { return [initial, () => {}] },
    useSyncExternalStore(subscribe, getSnapshot) {
      subscribe(() => { notifications.push(getSnapshot()) })
      return getSnapshot()
    }
  }
  const IconArchive = () => null
  const IconFolderClose = () => null
  const IconFolderOpen = () => null
  const IconLoading = () => null
  const IconRefresh = () => null
  const IconSearch = () => null
  const IconTrash = () => null
  const Modal = () => null
  const Switch = props => ({ type: 'switch', props })
  const plugin = definition.factory(id => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        IconArchiveOutline20: IconArchive,
        IconFolderClose16: IconFolderClose,
        IconFolderOpen16: IconFolderOpen,
        IconLoadingOutline16: IconLoading,
        IconRefreshOutline16: IconRefresh,
        IconSearchOutline16: IconSearch,
        IconTrashOutline16: IconTrash,
        IconTriangleRightFill14: () => null,
        Modal,
        Switch
      }
    }
    throw new Error(`unexpected require: ${id}`)
  })
  return {
    plugin,
    internals: plugin.__internals,
    types: { IconArchive, IconFolderClose, IconFolderOpen, IconRefresh, IconSearch, IconTrash, Modal, Switch },
    notifications
  }
}

function store(readState) {
  return {
    readState,
    getSnapshot() { return this.readState() },
    subscribe() {
      this.subscribed = true
      return () => { this.subscribed = false }
    }
  }
}

function context(workspaces, sessions) {
  const cleanups = []
  const registrations = []
  return {
    ctx: {
      workspaces,
      sessions,
      slots: {
        inject(_name, factory) { return factory() },
        register(options, component) {
          registrations.push({ options, component })
          return () => {}
        }
      },
      effect(factory) {
        const cleanup = factory()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
    },
    registrations,
    cleanup() { for (const cleanup of cleanups.reverse()) cleanup() }
  }
}

async function settle() { await new Promise(resolve => setImmediate(resolve)) }

function createStyleDocument() {
  const styles = []
  const head = {
    appendChild(style) {
      style.parentNode = head
      styles.push(style)
    },
    removeChild(style) {
      const index = styles.indexOf(style)
      if (index !== -1) styles.splice(index, 1)
      style.parentNode = null
    }
  }
  return {
    styles,
    document: {
      querySelector() { return null },
      getElementById() { return null },
      createElement() {
        return { id: '', dataset: {}, textContent: '', parentNode: null }
      },
      head
    }
  }
}

function statusResponse(overrides = {}) {
  return {
    ok: true,
    async json() {
      return {
        ok: true,
        workspaceProjection: false,
        deletionSupported: true,
        restorationSupported: true,
        ...overrides
      }
    }
  }
}

function childNodes(node) {
  const out = []
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    out.push(value)
  }
  walk(node?.children ?? [])
  return out
}

function hasClassToken(node, className) {
  const value = node?.props?.className
  return typeof value === 'string' && value.split(/\s+/u).includes(className)
}

function findByClass(node, className) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (hasClassToken(node, className)) return node
  for (const child of childNodes(node)) {
    const found = findByClass(child, className)
    if (found !== undefined) return found
  }
  return undefined
}

function collectByClass(node, className, collected = []) {
  if (node === null || node === undefined || typeof node !== 'object') return collected
  if (hasClassToken(node, className)) collected.push(node)
  for (const child of childNodes(node)) collectByClass(child, className, collected)
  return collected
}

function groupRowOf(node) {
  const row = findByClass(node, 'dac-group-row')
  assert.notEqual(row, undefined, 'group row not found')
  return row
}

function archivedRow(overrides = {}) {
  return {
    id: 'archived',
    displayTitle: '旧聊天',
    updatedAt: 10,
    cwd: '/project',
    origin: undefined,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('derives archived rows from the authoritative archive set and accounting', () => {
  const { internals } = pluginDefinition()
  const workspaceState = {
    items: [
      { workspaceId: 'w1', path: '/one', title: 'one', sessionIds: ['a', 'b'] },
      { workspaceId: 'w2', path: '/two', title: 'two', sessionIds: ['c'] }
    ],
    archivedSessionIds: ['b', 'c', 'stray', 'missing', 'sub']
  }
  const sessionState = {
    ids: ['a', 'b', 'c', 'stray', 'sub'],
    byId: {
      a: archivedRow({ id: 'a', updatedAt: 1 }),
      b: archivedRow({ id: 'b', updatedAt: 2 }),
      c: archivedRow({ id: 'c', updatedAt: 3, cwd: '/two' }),
      stray: archivedRow({ id: 'stray', updatedAt: 4, cwd: '/elsewhere' }),
      sub: archivedRow({ id: 'sub', updatedAt: 5, origin: 'subagent' })
    }
  }

  const { rows, unreadable } = internals.buildArchivedRows(workspaceState, sessionState)
  assert.equal(unreadable, 1)
  assert.deepEqual(rows.map(row => row.id), ['b', 'c', 'stray'])
  assert.deepEqual(rows.map(row => row.archiveOrder), [0, 1, 2])
  assert.equal(rows[0].workspaceTitle, 'one')
  assert.equal(rows[0].workspaceId, 'w1')
  assert.equal(rows[2].workspaceId, '')
  // Restore position is display-only state the native-shaped row no longer carries.
  assert.equal(rows[0].position, undefined)
})

test('labels last activity the way the native archived-session page does', () => {
  const { internals } = pluginDefinition()
  const now = Date.UTC(2026, 8, 15, 12, 0, 0)
  const label = (elapsed) => internals.relativeTimeLabel(now - elapsed, now)
  assert.equal(label(0), '刚刚')
  assert.equal(label(59 * 1000), '刚刚')
  assert.equal(label(60 * 1000), '1 分钟')
  assert.equal(label(59 * 60 * 1000), '59 分钟')
  assert.equal(label(60 * 60 * 1000), '1 小时')
  assert.equal(label(23 * 60 * 60 * 1000), '23 小时')
  assert.equal(label(24 * 60 * 60 * 1000), '1 天')
  assert.equal(label(20 * 24 * 60 * 60 * 1000), '20 天')
  assert.equal(label(29 * 24 * 60 * 60 * 1000), '29 天')
  assert.equal(label(30 * 24 * 60 * 60 * 1000), '1 个月')
  assert.equal(label(40 * 24 * 60 * 60 * 1000), '1 个月')
  assert.equal(label(364 * 24 * 60 * 60 * 1000), '12 个月')
  assert.equal(label(365 * 24 * 60 * 60 * 1000), '1 年')
  assert.equal(label(-5 * 1000), '刚刚')
  // An unknown activity timestamp yields no label at all rather than 1970's.
  assert.equal(internals.relativeTimeLabel(0, now), '')
  assert.equal(internals.relativeTimeLabel(undefined, now), '')
})

test('groups archived rows by workspace in Host order plus one ungrouped bucket', () => {
  const { internals } = pluginDefinition()
  const workspaceState = {
    items: [
      { workspaceId: 'w2', path: '/two', title: 'two', sessionIds: ['c'] },
      { workspaceId: 'w3', path: '/three', title: 'three', sessionIds: [] },
      { workspaceId: 'w1', path: '/one', title: 'one', sessionIds: ['a'] }
    ]
  }
  const rows = [
    { id: 'c', workspaceId: 'w2', title: 'C' },
    { id: 'stray', workspaceId: '', title: 'S' },
    { id: 'a', workspaceId: 'w1', title: 'A' }
  ]

  const groups = internals.groupRowsByWorkspace(rows, workspaceState)
  assert.deepEqual(groups.map(group => group.title), ['two', 'one', '未分组'])
  assert.deepEqual(groups.map(group => group.rows.map(row => row.id)), [['c'], ['a'], ['stray']])
})

test('sorts by recency or by archive order', () => {
  const { internals } = pluginDefinition()
  const rows = [
    { id: 'a', updatedAt: 5, archiveOrder: 2 },
    { id: 'b', updatedAt: 9, archiveOrder: 0 },
    { id: 'c', updatedAt: 1, archiveOrder: 1 }
  ]
  assert.deepEqual(internals.sortRows(rows, 'updated').map(row => row.id), ['b', 'a', 'c'])
  assert.deepEqual(internals.sortRows(rows, 'archived').map(row => row.id), ['b', 'c', 'a'])
})

test('filters rows by title, directory, and workspace title', () => {
  const { internals } = pluginDefinition()
  const row = { id: 'a', title: 'DeepSeek 调研', cwd: '/Users/me/Alpha', workspaceTitle: 'Plugins' }
  assert.equal(internals.matchesQuery(row, ''), true)
  assert.equal(internals.matchesQuery(row, 'deepseek'), true)
  assert.equal(internals.matchesQuery(row, 'alpha'), true)
  assert.equal(internals.matchesQuery(row, 'plugins'), true)
  assert.equal(internals.matchesQuery(row, 'missing'), false)
})

test('resolves rolling, day-boundary, and custom-date cutoffs', () => {
  const { internals } = pluginDefinition()
  const now = new Date(2026, 4, 10, 15, 30, 0, 0).getTime()
  assert.deepEqual(internals.BATCH_PRESETS.map(preset => preset.id),
    ['all', '24h', '1d', '7d', '15d', '30d', '90d', 'date'])
  assert.equal(internals.resolveCutoff('all', '', now), Number.POSITIVE_INFINITY)
  assert.equal(internals.resolveCutoff('all', '2026-02-31', now), Number.POSITIVE_INFINITY)
  assert.equal(internals.resolveCutoff('24h', '', now), now - 24 * 60 * 60 * 1000)
  assert.equal(internals.resolveCutoff('1d', '', now), new Date(2026, 4, 10, 0, 0, 0, 0).getTime())
  assert.equal(internals.resolveCutoff('7d', '', now), now - 7 * 24 * 60 * 60 * 1000)
  assert.equal(internals.resolveCutoff('15d', '', now), now - 15 * 24 * 60 * 60 * 1000)
  assert.equal(internals.resolveCutoff('30d', '', now), now - 30 * 24 * 60 * 60 * 1000)
  assert.equal(internals.resolveCutoff('90d', '', now), now - 90 * 24 * 60 * 60 * 1000)
  assert.equal(internals.resolveCutoff('date', '2026-01-02', now), new Date(2026, 0, 2, 0, 0, 0, 0).getTime())
  assert.equal(internals.resolveCutoff('date', '2026-02-31', now), undefined)
  assert.equal(internals.resolveCutoff('date', '', now), undefined)
  assert.equal(internals.resolveCutoff('unknown', '', now), undefined)
})

test('treats 24 小时前 as a rolling window and 1 天前 as yesterday and earlier', () => {
  const { internals } = pluginDefinition()
  const now = new Date(2026, 4, 10, 15, 30, 0, 0).getTime()
  const workspaceState = { items: [], archivedSessionIds: [] }
  // DSH 0.1.6-alpha.2 list shape: no `current` field, no main-view retention.
  const sessionState = {
    ids: ['today-morning', 'yesterday-evening', 'yesterday-morning'],
    byId: {
      'today-morning': archivedRow({
        id: 'today-morning',
        updatedAt: new Date(2026, 4, 10, 9, 0, 0, 0).getTime()
      }),
      'yesterday-evening': archivedRow({
        id: 'yesterday-evening',
        updatedAt: new Date(2026, 4, 9, 20, 0, 0, 0).getTime()
      }),
      'yesterday-morning': archivedRow({
        id: 'yesterday-morning',
        updatedAt: new Date(2026, 4, 9, 10, 0, 0, 0).getTime()
      })
    }
  }
  const pick = (presetId) => internals.batchCandidates({
    workspaceState,
    sessionState,
    cutoff: internals.resolveCutoff(presetId, '', now),
    scope: { kind: 'all' },
    include: { running: false, blank: false, current: false }
  }).map(row => row.id)

  // Distances from 5/10 15:30: today 09:00 is 6.5h ago, yesterday 20:00 is 19.5h
  // ago, yesterday 10:00 is 29.5h ago.
  // Rolling 24 hours (cutoff 5/9 15:30) only reaches yesterday morning, so both
  // today's chat and yesterday evening stay untouched.
  assert.deepEqual(pick('24h'), ['yesterday-morning'])
  // Yesterday and earlier (cutoff 5/10 00:00) also reaches yesterday evening,
  // which is exactly the set the rolling window cannot express.
  assert.deepEqual(pick('1d'), ['yesterday-evening', 'yesterday-morning'])
})

test('selects batch candidates with explicit exclusions and a strict cutoff', () => {
  const { internals } = pluginDefinition()
  const workspaceState = {
    items: [{ workspaceId: 'w1', path: '/one', title: 'one', sessionIds: ['old', 'edge'] }],
    archivedSessionIds: ['archived']
  }
  // The open chat is expressed the alpha.2 way: local main-view retention on the
  // row, which is exactly what the shipped sidebar and layout read.
  const sessionState = {
    ids: ['old', 'edge', 'new', 'archived', 'child', 'blank', 'running', 'current'],
    byId: {
      old: archivedRow({ id: 'old', updatedAt: 100 }),
      edge: archivedRow({ id: 'edge', updatedAt: 500 }),
      new: archivedRow({ id: 'new', updatedAt: 600 }),
      archived: archivedRow({ id: 'archived', updatedAt: 100 }),
      child: archivedRow({ id: 'child', updatedAt: 100, origin: 'subagent' }),
      blank: archivedRow({ id: 'blank', updatedAt: 100, blank: true }),
      running: archivedRow({ id: 'running', updatedAt: 100, running: true }),
      current: archivedRow({ id: 'current', updatedAt: 100, retainedBy: { mainView: 1 } })
    }
  }
  const cutoff = 500

  const strict = internals.batchCandidates({
    workspaceState,
    sessionState,
    cutoff,
    scope: { kind: 'all' },
    include: { running: false, blank: false, current: false }
  })
  assert.deepEqual(strict.map(row => row.id), ['old'])

  const permissive = internals.batchCandidates({
    workspaceState,
    sessionState,
    cutoff,
    scope: { kind: 'all' },
    include: { running: true, blank: true, current: true }
  })
  assert.deepEqual(permissive.map(row => row.id), ['blank', 'current', 'old', 'running'])

  const scoped = internals.batchCandidates({
    workspaceState,
    sessionState,
    cutoff: 700,
    scope: { kind: 'workspace', workspaceId: 'w1' },
    include: { running: true, blank: true, current: true }
  })
  assert.deepEqual(scoped.map(row => row.id), ['edge', 'old'])

  const ungrouped = internals.batchCandidates({
    workspaceState,
    sessionState,
    cutoff: 700,
    scope: { kind: 'ungrouped' },
    include: { running: true, blank: true, current: true }
  })
  assert.deepEqual(ungrouped.map(row => row.id), ['new', 'blank', 'current', 'running'])

  assert.deepEqual(internals.batchCandidates({
    workspaceState,
    sessionState,
    cutoff: undefined,
    scope: { kind: 'all' },
    include: {}
  }), [])
})

test('treats 所有时间 as no time filter instead of an empty candidate set', () => {
  const { internals } = pluginDefinition()
  const now = new Date(2026, 4, 10, 15, 30, 0, 0).getTime()
  const workspaceState = {
    items: [{ workspaceId: 'w1', path: '/one', title: 'one', sessionIds: ['just-now'] }],
    archivedSessionIds: ['archived', 'fresh-archived']
  }
  const sessionState = {
    ids: ['just-now', 'archived', 'fresh-archived', 'child', 'blank', 'running'],
    byId: {
      'just-now': archivedRow({ id: 'just-now', updatedAt: now }),
      archived: archivedRow({ id: 'archived', updatedAt: 100 }),
      'fresh-archived': archivedRow({ id: 'fresh-archived', updatedAt: now }),
      child: archivedRow({ id: 'child', updatedAt: 100, origin: 'subagent' }),
      blank: archivedRow({ id: 'blank', updatedAt: 100, blank: true }),
      running: archivedRow({ id: 'running', updatedAt: 100, running: true })
    }
  }
  const none = { running: false, blank: false, current: false }
  const everything = { running: true, blank: true, current: true }
  const all = internals.resolveCutoff('all', '', now)
  const pick = (cutoff, include) => internals.batchCandidates({
    workspaceState, sessionState, cutoff, scope: { kind: 'all' }, include
  }).map(row => row.id)
  const pickDeleted = (cutoff, include) => internals.deletionCandidates({
    workspaceState, sessionState, cutoff, scope: { kind: 'all' }, include
  }).map(row => row.id)

  // 所有时间 reaches a chat updated a moment ago — which no rolling preset can
  // express — while the explicit default exclusions still apply.
  assert.deepEqual(pick(all, none), ['just-now'])
  assert.deepEqual(pick(all, everything), ['just-now', 'blank', 'running'])
  // Permanent deletion draws from the archived set, and there the same option is
  // what makes an archived-but-recent chat deletable at all.
  assert.deepEqual(pickDeleted(all, none), ['fresh-archived', 'archived'])
  assert.deepEqual(pickDeleted(internals.resolveCutoff('24h', '', now), none), ['archived'])
  // An unparsable custom date still fails closed to no candidates.
  assert.deepEqual(pick(internals.resolveCutoff('date', '2026-02-31', now), everything), [])
  assert.deepEqual(pickDeleted(internals.resolveCutoff('unknown', '', now), everything), [])
})

test('selects permanent-deletion candidates from the archived set only', () => {
  const { internals } = pluginDefinition()
  const workspaceState = {
    items: [
      { workspaceId: 'w1', path: '/one', title: 'one', sessionIds: ['old', 'edge'] },
      { workspaceId: 'w2', path: '/two', title: 'two', sessionIds: [] }
    ],
    // `live` is archived as well, so the open-chat exclusion has something real
    // to exclude on this page: the chat on stage must never be deleted.
    archivedSessionIds: ['old', 'edge', 'new', 'blank', 'running', 'child', 'gone', 'live']
  }
  // Alpha.2 shape: the open chat is the row the main view retains.
  const sessionState = {
    ids: ['old', 'edge', 'new', 'blank', 'running', 'child', 'live'],
    byId: {
      old: archivedRow({ id: 'old', updatedAt: 100 }),
      edge: archivedRow({ id: 'edge', updatedAt: 500, cwd: '/two' }),
      new: archivedRow({ id: 'new', updatedAt: 600, cwd: '/two' }),
      blank: archivedRow({ id: 'blank', updatedAt: 100, blank: true }),
      running: archivedRow({ id: 'running', updatedAt: 100, running: true }),
      child: archivedRow({ id: 'child', updatedAt: 100, origin: 'subagent' }),
      live: archivedRow({ id: 'live', updatedAt: 100, retainedBy: { mainView: 1 } })
    }
  }
  const pick = (options) => internals.deletionCandidates({
    workspaceState,
    sessionState,
    cutoff: 500,
    scope: { kind: 'all' },
    include: { running: false, blank: false, current: false },
    ...options
  }).map(row => row.id)

  // Only the archived set is eligible: `gone` has no readable summary and the
  // subagent chat never participates.
  assert.deepEqual(pick(), ['old'])
  assert.deepEqual(pick({ include: { running: true, blank: true, current: true } }),
    ['blank', 'live', 'old', 'running'])
  assert.deepEqual(pick({ scope: { kind: 'workspace', workspaceId: 'w1' } }), ['old'])
  assert.deepEqual(pick({ scope: { kind: 'ungrouped' }, cutoff: 700 }), ['new'])
  assert.deepEqual(pick({ cutoff: undefined }), [])
  // The alpha.1 list shape answers through its own `current` field instead.
  assert.deepEqual(pick({ sessionState: { ...sessionState, current: 'live' } }), ['old'])
})

test('reads the open chat from whichever generation of the list store provides it', () => {
  const { internals } = pluginDefinition()
  const row = (id, overrides = {}) => archivedRow({ id, ...overrides })

  // Alpha.1 rode an explicit selection, including the deliberate "nothing on
  // stage" undefined — which must not be second-guessed through retention.
  assert.equal(internals.currentSessionId({ current: 'picked', byId: {} }), 'picked')
  assert.equal(internals.currentSessionId({
    current: undefined,
    byId: { other: row('other', { retainedBy: { mainView: 1 } }) }
  }), undefined)

  // Alpha.2 removed the field; main-view retention is the same fact source the
  // shipped layout, sidebar and settings read.
  assert.equal(internals.currentSessionId({
    byId: { a: row('a'), b: row('b', { retainedBy: { mainView: 1 } }) }
  }), 'b')
  assert.equal(internals.currentSessionId({
    byId: { a: row('a', { retainedBy: { sidebar: 2 } }) }
  }), undefined)
  assert.equal(internals.currentSessionId({ byId: {} }), undefined)
  assert.equal(internals.currentSessionId(undefined), undefined)
})

// ---------------------------------------------------------------------------
// Batch executors
// ---------------------------------------------------------------------------

test('archives a frozen batch sequentially and reports progress', async () => {
  const { internals } = pluginDefinition()
  const items = [
    { id: 'a', title: 'A', updatedAt: 10 },
    { id: 'b', title: 'B', updatedAt: 20 },
    { id: 'c', title: 'C', updatedAt: 30 }
  ]
  const archived = []
  const progress = []
  const result = await internals.runArchiveBatch(items, {
    shouldStop: () => false,
    isArchived: id => id === 'b',
    latestActivity: () => undefined,
    archive: async (id) => { archived.push(id) },
    onProgress: entry => progress.push(entry)
  })

  assert.deepEqual(archived, ['a', 'c'])
  assert.deepEqual(result.archived.map(item => item.id), ['a', 'c'])
  assert.deepEqual(result.skipped.map(entry => [entry.item.id, entry.reason]), [['b', '已在归档列表中']])
  assert.deepEqual(result.failed, [])
  assert.equal(result.stopped, false)
  assert.equal(result.processed, 3)
  assert.deepEqual(progress[0], { processed: 0, total: 3, current: 'A' })
  assert.deepEqual(progress[progress.length - 1], { processed: 3, total: 3, current: undefined })
})

test('skips a chat that gained activity after the preview', async () => {
  const { internals } = pluginDefinition()
  const archived = []
  const result = await internals.runArchiveBatch([{ id: 'a', title: 'A', updatedAt: 10 }], {
    shouldStop: () => false,
    isArchived: () => false,
    latestActivity: () => 11,
    archive: async (id) => { archived.push(id) }
  })
  assert.deepEqual(archived, [])
  assert.deepEqual(result.skipped.map(entry => entry.reason), ['预览后有了新活动'])
})

test('permanently deletes a frozen batch and skips rows that moved under it', async () => {
  const { internals } = pluginDefinition()
  const items = [
    { id: 'a', title: 'A', updatedAt: 10 },
    { id: 'b', title: 'B', updatedAt: 10 },
    { id: 'c', title: 'C', updatedAt: 10 },
    { id: 'd', title: 'D', updatedAt: 10 }
  ]
  const deleted = []
  const progress = []
  const result = await internals.runDeletionBatch(items, {
    shouldStop: () => false,
    // `c` left the archive set and `d` gained activity after the preview.
    isArchived: id => id !== 'c',
    latestActivity: id => (id === 'd' ? 999 : 10),
    remove: async (id) => { deleted.push(id) },
    onProgress: entry => progress.push(entry)
  })

  assert.deepEqual(deleted, ['a', 'b'])
  assert.deepEqual(result.deleted.map(item => item.id), ['a', 'b'])
  assert.deepEqual(result.skipped.map(entry => [entry.item.id, entry.reason]),
    [['c', '已不在归档列表'], ['d', '预览后有了新活动']])
  assert.deepEqual(result.failed, [])
  assert.equal(result.stopped, false)
  assert.equal(result.processed, 4)
  assert.deepEqual(progress[progress.length - 1], { processed: 4, total: 4, current: undefined })
})

test('keeps deleting after a refusal, treats a vanished row as skipped, and stops between items', async () => {
  const { internals } = pluginDefinition()
  const items = [
    { id: 'a', title: 'A', updatedAt: 1 },
    { id: 'b', title: 'B', updatedAt: 1 },
    { id: 'c', title: 'C', updatedAt: 1 }
  ]
  const attempted = []
  const failed = await internals.runDeletionBatch(items, {
    shouldStop: () => false,
    isArchived: () => true,
    latestActivity: () => undefined,
    remove: async (id) => {
      attempted.push(id)
      if (id === 'b') {
        const error = new Error('host refused')
        error.code = 'archive-delete-refused'
        throw error
      }
      if (id === 'c') {
        const error = new Error('404')
        error.code = 'session-not-archived'
        throw error
      }
    }
  })
  assert.deepEqual(attempted, ['a', 'b', 'c'])
  assert.deepEqual(failed.deleted.map(item => item.id), ['a'])
  assert.deepEqual(failed.failed.map(entry => [entry.item.id, entry.message]), [['b', 'host refused']])
  assert.deepEqual(failed.skipped.map(entry => [entry.item.id, entry.reason]), [['c', '已不在归档列表']])

  let calls = 0
  const stopped = await internals.runDeletionBatch(items, {
    shouldStop: () => calls >= 1,
    isArchived: () => true,
    latestActivity: () => undefined,
    remove: async () => { calls += 1 }
  })
  assert.equal(stopped.stopped, true)
  assert.deepEqual(stopped.deleted.map(item => item.id), ['a'])
  assert.equal(stopped.processed, 1)
})

test('records failures and keeps going, and stops between items', async () => {
  const { internals } = pluginDefinition()
  const items = [
    { id: 'a', title: 'A', updatedAt: 1 },
    { id: 'b', title: 'B', updatedAt: 1 },
    { id: 'c', title: 'C', updatedAt: 1 }
  ]
  const attempted = []
  const failed = await internals.runArchiveBatch(items, {
    shouldStop: () => false,
    isArchived: () => false,
    latestActivity: () => undefined,
    archive: async (id) => {
      attempted.push(id)
      if (id === 'b') throw new Error('host refused')
    }
  })
  assert.deepEqual(attempted, ['a', 'b', 'c'])
  assert.deepEqual(failed.archived.map(item => item.id), ['a', 'c'])
  assert.deepEqual(failed.failed.map(entry => [entry.item.id, entry.message]), [['b', 'host refused']])

  let calls = 0
  const stopped = await internals.runArchiveBatch(items, {
    shouldStop: () => calls >= 1,
    isArchived: () => false,
    latestActivity: () => undefined,
    archive: async () => { calls += 1 }
  })
  assert.equal(stopped.stopped, true)
  assert.deepEqual(stopped.archived.map(item => item.id), ['a'])
  assert.equal(stopped.processed, 1)
})

test('undoes a batch by restoring each archived chat', async () => {
  const { internals } = pluginDefinition()
  const items = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }]
  const restored = []
  const result = await internals.runRestoreBatch(items, {
    shouldStop: () => false,
    isArchived: () => true,
    restore: async (id) => {
      if (id === 'b') {
        const error = new Error('该会话不在归档列表中')
        error.code = 'session-not-archived'
        throw error
      }
      restored.push(id)
    }
  })
  assert.deepEqual(restored, ['a', 'c'])
  assert.deepEqual(result.restored.map(item => item.id), ['a', 'c'])
  assert.deepEqual(result.skipped.map(entry => [entry.item.id, entry.reason]), [['b', '已不在归档列表']])
  assert.deepEqual(result.failed, [])
})

// ---------------------------------------------------------------------------
// Rendered surface
// ---------------------------------------------------------------------------

test('registers the Settings section and archive nav icon marker with reversible styles', async () => {
  assert.equal(definition.id, 'dsh-chat-archive-manager')
  const workspaces = {
    list: store(() => ({ items: [], archivedSessionIds: [] })),
    async refresh() {}
  }
  const sessions = {
    list: store(() => ({ ids: [], byId: {} })),
    async refresh() {}
  }
  const fixture = createStyleDocument()
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  const { plugin, types } = pluginDefinition()
  const harness = context(workspaces, sessions)
  globalThis.document = fixture.document
  globalThis.fetch = async () => statusResponse()

  try {
    plugin.apply(harness.ctx)
    await settle()

    assert.equal(harness.registrations.length, 3)
    const sectionRegistration = harness.registrations.find(entry => entry.options.name === 'settings.section')
    const navIconRegistration = harness.registrations.find(entry => entry.options.name === 'settings.action')
    const suppressionRegistration = harness.registrations.find(entry => entry.options.name === 'settings.general.item')
    assert.deepEqual(sectionRegistration.options, {
      name: 'settings.section',
      id: 'archived-chats',
      // 插件分区必须排到 DSH 自带分区（最大 archived-sessions 25）之后。
      order: 120,
      label: '归档管理'
    })
    assert.deepEqual(navIconRegistration.options, {
      name: 'settings.action',
      id: 'dsh-chat-archive-manager.nav-icon',
      order: 120
    })
    assert.equal(suppressionRegistration.options.id, 'dsh-chat-archive-manager.native-archived-sessions')
    // 通用设置行同理：内置行是 -20..20，插件行排在所有内置行之后。
    assert.equal(suppressionRegistration.options.order, 100)
    const navIconTemplate = navIconRegistration.component()
    assert.equal(navIconTemplate.props.className, 'dac-nav-icon-template')
    assert.equal(navIconTemplate.children[0].type, types.IconArchive)
    // The General row is the shell's own row shape: title + description on the
    // left, the shell's Switch primitive on the right (never a self-drawn control).
    const suppressionRow = suppressionRegistration.component({
      getSuppressed: () => true,
      getApplied: () => true,
      subscribeSuppressed: () => () => {},
      setSuppressed: () => {}
    })
    assert.equal(suppressionRow.props.className, 'dac-general-row')
    assert.equal(suppressionRow.props['data-dac-native-archive-row'], '')
    assert.equal(suppressionRow.children[0].props.className, 'dac-general-row-text')
    assert.equal(suppressionRow.children[0].children[0].children[0], '屏蔽自带归档页')
    assert.equal(suppressionRow.children[0].children[1].children[0].includes('隐藏 DSH 自带的「已归档会话」设置页'), true)
    // No notice while the patch is actually applied.
    assert.equal(suppressionRow.children[0].children[2], false)
    const suppressionSwitch = suppressionRow.children[1].type(suppressionRow.children[1].props)
    assert.equal(suppressionRow.children[1].type, types.Switch)
    assert.equal(suppressionSwitch.type, 'switch')
    assert.equal(suppressionSwitch.props.checked, true)
    assert.equal(suppressionSwitch.props.label, '屏蔽自带归档页')
    // With the switch on but the patch unapplied, the row reports it instead of
    // pretending the native page is hidden.
    const degradedRow = suppressionRegistration.component({
      getSuppressed: () => true,
      getApplied: () => false,
      subscribeSuppressed: () => () => {},
      setSuppressed: () => {}
    })
    assert.equal(degradedRow.children[0].children[2].props.className, 'dac-general-row-note')
    assert.equal(degradedRow.children[0].children[2].props.role, 'status')
    assert.equal(degradedRow.children[0].children[2].children[0], '未能定位 DSH 自带的「已归档会话」菜单项，原生页保持显示。')
    assert.equal(fixture.styles.length, 1)
    // Untagged sheets are claimed by whichever bundle materializes next, and HMR removes
    // style[data-plugin=<id>]: the sheet must declare this plugin as its owner.
    assert.equal(fixture.styles[0].dataset.plugin ?? fixture.styles[0].getAttribute?.('data-plugin'), 'dsh-chat-archive-manager')
    assert.equal(fixture.styles[0].textContent.includes('[data-dac-archive-nav]::before'), true)
    // The native-page suppression hides the shell's own nav row with a marked
    // attribute rule, and its General row copies the shell's row metrics.
    assert.equal(fixture.styles[0].textContent.includes('[data-dac-native-archive-hidden]{display:none!important}'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-general-row{display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-general-row-text{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0;padding-right:48px}'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-general-row-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-general-row-description{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}'), true)
    // The degradation notice uses the shell's warn label colour, never a self-invented one.
    assert.equal(fixture.styles[0].textContent.includes('.dac-general-row-note{color:var(--dsw-alias-state-warn-label);font-size:12px;font-weight:400;line-height:18px}'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-section-heading{display:flex;align-items:baseline;gap:8px;'), true)
    // The batch dialog is portaled to document.body, so the glyph variables must
    // live on the control itself rather than on an ancestor it cannot inherit.
    const glyphRule = /\.dac-select-field\{([^}]*)\}/u.exec(fixture.styles[0].textContent)
    assert.notEqual(glyphRule, null)
    assert.equal(glyphRule[1].includes('--dac-chevron-glyph'), true)
    assert.equal(glyphRule[1].includes('--dac-calendar-glyph'), true)
    assert.equal(glyphRule[1].includes('--dac-field-glyph:var(--dac-chevron-glyph)'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-select-field-date{--dac-field-glyph:var(--dac-calendar-glyph)}'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-section{--dac'), false)
    const glyphUris = glyphRule[1].match(/data:image\/svg\+xml,[^")]+/gu) ?? []
    assert.equal(glyphUris.length, 2)
    for (const uri of glyphUris) {
      assert.equal(/[ "'<>#]/u.test(uri), false, `unescaped character in ${uri}`)
    }
    assert.equal(fixture.styles[0].textContent.includes('.dac-select-field::after'), true)
    assert.equal(fixture.styles[0].textContent.includes('padding:0 30px 0 10px'), true)
    assert.equal(fixture.styles[0].textContent.includes('--dac-calendar-glyph'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-date::-webkit-calendar-picker-indicator'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-group-row{display:flex'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-group-row:hover .dac-group-folder{display:none}'), true)
    // Rows are cards: the Workspace group header is the only separator, so the
    // sheet must carry no rule that draws a line between groups or rows.
    assert.equal(fixture.styles[0].textContent.includes('.dac-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:8px 10px;border-radius:8px}'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-row:hover{background:var(--dsw-alias-interactive-bg-hover)}'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-group-body{display:flex;flex-direction:column;min-width:0;gap:2px;padding-left:20px}'), true)
    // Both bulk entry points share the list action row: the row itself supplies
    // the 8px gap between them, and the collapse toggle is pushed to the end.
    assert.equal(fixture.styles[0].textContent.includes('.dac-list-actions{display:flex;align-items:center;gap:8px;min-width:0}'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-list-toggle{margin-left:auto}'), true)
    assert.equal(fixture.styles[0].textContent.includes('.dac-button.danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted)}'), true)
    assert.equal(/\.dac-(row|group|list|groups)[^{]*\{[^}]*border-(top|bottom|left)/u.test(fixture.styles[0].textContent), false)
    assert.equal(fixture.styles[0].textContent.includes('.dac-group+.dac-group'), false)
    assert.equal(fixture.styles[0].textContent.includes('dac-trigger'), false)
    assert.equal(plugin.__internals.BATCH_CONFIRM_THRESHOLD, 50)
  } finally {
    harness.cleanup()
    globalThis.fetch = previousFetch
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }

  assert.equal(fixture.styles.length, 0)
})

test('renders grouped archive management inside Settings and leaves core list services untouched', async () => {
  const workspaceState = {
    items: [
      { workspaceId: 'project', path: '/project', title: 'project', sessionIds: ['active', 'archived'] }
    ],
    archivedSessionIds: ['archived']
  }
  const archived = archivedRow()
  const active = archivedRow({
    id: 'active',
    displayTitle: '当前聊天',
    updatedAt: 20,
    retainedBy: { mainView: 1 }
  })
  const sessionState = { ids: ['active', 'archived'], byId: { active, archived } }
  const workspaces = {
    list: store(() => workspaceState),
    startSession() {},
    async rename() {},
    async delete() {},
    async insertBefore() {},
    async insertSessionBefore() {},
    async archiveSession() {},
    async refresh() {}
  }
  const sessions = {
    list: store(() => sessionState),
    open() {},
    async fork() {},
    async refresh() {}
  }
  const original = {
    workspaceGetSnapshot: workspaces.list.getSnapshot,
    workspaceSubscribe: workspaces.list.subscribe,
    startSession: workspaces.startSession,
    rename: workspaces.rename,
    delete: workspaces.delete,
    insertBefore: workspaces.insertBefore,
    insertSessionBefore: workspaces.insertSessionBefore,
    archiveSession: workspaces.archiveSession,
    sessionGetSnapshot: sessions.list.getSnapshot,
    sessionSubscribe: sessions.list.subscribe,
    open: sessions.open,
    fork: sessions.fork
  }
  const previousFetch = globalThis.fetch
  const fetchCalls = []
  globalThis.fetch = async (path, options = {}) => {
    fetchCalls.push({ path, options })
    if (path === '/dsh-chat-archive-manager/restore') {
      return {
        ok: true,
        async json() { return { ok: true, sessionId: 'archived', archivedSessionIds: [] } }
      }
    }
    return statusResponse()
  }

  try {
    const { plugin, types, notifications } = pluginDefinition()
    const harness = context(workspaces, sessions)
    plugin.apply(harness.ctx)

    assert.equal(harness.registrations.length, 3)
    const sectionRegistration = harness.registrations.find(entry => entry.options.name === 'settings.section')
    const { options, component: ArchiveSettingsSection } = sectionRegistration
    assert.deepEqual(options, {
      name: 'settings.section',
      id: 'archived-chats',
      order: 120,
      label: '归档管理'
    })

    const initial = ArchiveSettingsSection({ close() {} })
    const initialSection = initial.children[0]
    assert.equal(initialSection.type, 'section')
    assert.equal(initialSection.children[1].children[0].endsWith('正在读取归档操作能力…'), true)
    assert.equal(initial.children[1].props.open, false)

    await settle()
    assert.equal(notifications.length, 1)
    assert.equal(fetchCalls[0].path, '/dsh-chat-archive-manager/status')

    assert.equal(workspaces.list.getSnapshot, original.workspaceGetSnapshot)
    assert.equal(workspaces.list.subscribe, original.workspaceSubscribe)
    assert.equal(workspaces.startSession, original.startSession)
    assert.equal(workspaces.rename, original.rename)
    assert.equal(workspaces.delete, original.delete)
    assert.equal(workspaces.insertBefore, original.insertBefore)
    assert.equal(workspaces.insertSessionBefore, original.insertSessionBefore)
    assert.equal(workspaces.archiveSession, original.archiveSession)
    assert.equal(sessions.list.getSnapshot, original.sessionGetSnapshot)
    assert.equal(sessions.list.subscribe, original.sessionSubscribe)
    assert.equal(sessions.open, original.open)
    assert.equal(sessions.fork, original.fork)
    assert.equal(workspaces.list.getSnapshot(), workspaceState)
    assert.equal(sessions.list.getSnapshot(), sessionState)

    const rendered = ArchiveSettingsSection({ close() {} })
    const section = rendered.children[0]
    const confirmation = rendered.children[1]
    const heading = section.children[0]
    assert.equal(section.props['aria-label'], '归档管理')
    assert.equal(heading.children[0].type, 'h2')
    assert.equal(heading.children[0].children[0], '归档管理')
    assert.equal(heading.children[1].children[0], '1 条聊天')
    assert.equal(heading.children.some(child => child?.props?.className === 'dac-section-icon'), false)

    // The paragraph sits directly under the heading, above every control.
    const description = section.children[1]
    assert.equal(description.props.className, 'dac-description')
    assert.equal(description.children[0].includes('按工作区分组或单列表浏览归档聊天'), true)
    assert.equal(description.children[0].includes('批量归档支持按时间条件筛选'), true)
    assert.equal(description.children[0].includes('恢复会回到原来的工作区'), true)
    assert.equal(description.children[0].includes('永久删除会移除会话日志，但不删除共享附件'), true)
    assert.equal(section.children[2].props.className, 'dac-toolbar')
    assert.equal(collectByClass(section, 'dac-note').length, 0)

    const toolbar = findByClass(section, 'dac-toolbar')
    // Search box carries the shell's own search glyph, pinned left inside the field.
    const search = findByClass(toolbar, 'dac-search')
    assert.equal(search.children[0].type, types.IconSearch)
    assert.equal(search.children[0].props['aria-hidden'], true)
    assert.equal(search.children[1].type, 'input')
    assert.equal(search.children[1].props.placeholder, '搜索标题、目录或工作区…')
    assert.equal(search.children[1].props.value, '')
    assert.equal(collectByClass(toolbar, 'dac-select').length, 2)
    assert.equal(collectByClass(toolbar, 'dac-select-field').length, 2)
    assert.equal(findByClass(section, 'dac-scope-row'), undefined)

    // One action row above the list: both bulk entry points on the left (the
    // destructive one second and error-colored), the collapse toggle on the
    // right, and no duplicate in the toolbar.
    const listActions = findByClass(section, 'dac-list-actions')
    const actionButtons = listActions.children.filter(Boolean)
    assert.deepEqual(actionButtons.map(child => child.children[0]), ['批量归档', '批量删除'])
    assert.equal(actionButtons[0].props.disabled, false)
    assert.equal(actionButtons[0].props.className, 'dac-button dac-button-small')
    assert.equal(actionButtons[1].props.disabled, false)
    assert.equal(actionButtons[1].props.className, 'dac-button dac-button-small danger')
    assert.equal(actionButtons[1].props.title, '永久删除一批归档聊天（不可撤销）')
    assert.equal(findByClass(toolbar, 'dac-list-actions'), undefined)
    assert.equal(toolbar.children.some(child => child?.children?.[0] === '批量归档'), false)
    assert.equal(section.children[5], listActions)

    const groups = findByClass(section, 'dac-groups')
    const groupTitle = findByClass(groups, 'dac-group-title')
    assert.equal(groupTitle.children[0], 'project')
    const groupCount = findByClass(groups, 'dac-group-count')
    assert.equal(groupCount.children[0], '1 条')
    assert.equal(findByClass(section, 'dac-list'), undefined)

    // Groups start collapsed, so the session rows are not rendered yet.
    assert.equal(groupRowOf(section).props['aria-expanded'], false)
    assert.equal(findByClass(groupRowOf(section), 'dac-group-folder').children[0].type, types.IconFolderClose)
    assert.equal(findByClass(groupRowOf(section), 'dac-group-chevron').children[0].props.className,
      'dac-group-arrow')
    assert.equal(findByClass(section, 'dac-group-body'), undefined)
    assert.equal(findByClass(section, 'dac-row'), undefined)
    // A single group renders no collapse toggle, so the action row keeps both
    // bulk entry points rather than disappearing with it.
    assert.deepEqual(findByClass(section, 'dac-list-actions').children.filter(Boolean).length, 2)

    assert.equal(confirmation.type, types.Modal)
    assert.equal(confirmation.props.open, false)
    assert.equal(confirmation.props.title, '永久删除聊天？')

    harness.cleanup()
    assert.equal(workspaces.list.getSnapshot, original.workspaceGetSnapshot)
    assert.equal(sessions.list.getSnapshot, original.sessionGetSnapshot)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('disables batch archiving when the client controller has no archive command', async () => {
  const workspaces = {
    list: store(() => ({ items: [], archivedSessionIds: [] })),
    async refresh() {}
  }
  const sessions = {
    list: store(() => ({ ids: [], byId: {} })),
    async refresh() {}
  }
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => statusResponse()

  try {
    const { plugin } = pluginDefinition()
    const harness = context(workspaces, sessions)
    plugin.apply(harness.ctx)
    await settle()

    const section = harness.registrations
      .find(entry => entry.options.name === 'settings.section').component({ close() {} }).children[0]
    const batchButton = findByClass(section, 'dac-list-actions').children
      .find(child => child?.type === 'button' && child.children[0] === '批量归档')
    assert.equal(batchButton.props.disabled, true)
    // Deletion does not depend on the archive command: the Host status still
    // advertises it here, so that entry point stays usable.
    const deleteButton = findByClass(section, 'dac-list-actions').children
      .find(child => child?.type === 'button' && child.children[0] === '批量删除')
    assert.equal(deleteButton.props.disabled, false)
    assert.equal(findByClass(section, 'dac-description').children[0].includes('当前 DSH 客户端不支持批量归档'), true)
    harness.cleanup()
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('caps the visible archive count after 99 chats', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `archived-${index}`)
  const byId = Object.fromEntries(ids.map((id, index) => [id, archivedRow({
    id,
    displayTitle: id,
    updatedAt: index
  })]))
  let visibleCount = 99
  const workspaces = {
    list: store(() => ({ items: [], archivedSessionIds: ids.slice(0, visibleCount) })),
    async refresh() {}
  }
  const sessions = {
    list: store(() => ({ ids, byId })),
    async refresh() {}
  }
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => statusResponse()
  const { plugin } = pluginDefinition()
  const harness = context(workspaces, sessions)

  try {
    plugin.apply(harness.ctx)
    await settle()
    const ArchiveSettingsSection = harness.registrations
      .find(entry => entry.options.name === 'settings.section').component

    let heading = ArchiveSettingsSection({ close() {} }).children[0].children[0]
    assert.equal(heading.children[1].children[0], '99 条聊天')

    visibleCount = 100
    heading = ArchiveSettingsSection({ close() {} }).children[0].children[0]
    assert.equal(heading.children[1].children[0], '99+ 条聊天')
  } finally {
    harness.cleanup()
    globalThis.fetch = previousFetch
  }
})

test('accepts deletion-unavailable status without managed Workspace fields', async () => {
  const workspaces = {
    list: store(() => ({ items: [], archivedSessionIds: [] })),
    async refresh() {}
  }
  const sessions = {
    list: store(() => ({ ids: [], byId: {} })),
    async refresh() {}
  }
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => statusResponse({
    deletionSupported: false,
    deletionUnavailable: '删除暂不可用',
    restorationSupported: false,
    restorationUnavailable: '恢复暂不可用'
  })

  try {
    const { plugin } = pluginDefinition()
    const harness = context(workspaces, sessions)
    plugin.apply(harness.ctx)
    await settle()

    const rendered = harness.registrations
      .find(entry => entry.options.name === 'settings.section').component({ close() {} })
    const section = rendered.children[0]
    assert.equal(
      findByClass(section, 'dac-description').children[0],
      '按工作区分组或单列表浏览归档聊天；当前 DSH 客户端不支持批量归档。恢复暂不可用。删除暂不可用。'
    )
    // No permanent-deletion route means no permanent-deletion entry point.
    const deleteButton = findByClass(section, 'dac-list-actions').children
      .find(child => child?.type === 'button' && child.children[0] === '批量删除')
    assert.equal(deleteButton.props.disabled, true)
    assert.equal(deleteButton.props.title, '删除暂不可用')
    assert.equal(collectByClass(section, 'dac-note').length, 0)
    assert.equal(findByClass(section, 'dac-empty').children[0], '暂无归档聊天')
    harness.cleanup()
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('reports archive entries whose session summary is unreadable', async () => {
  const workspaces = {
    list: store(() => ({ items: [], archivedSessionIds: ['missing', 'present'] })),
    async refresh() {}
  }
  const sessions = {
    list: store(() => ({
      ids: ['present'],
      byId: { present: archivedRow({ id: 'present' }) }
    })),
    async refresh() {}
  }
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => statusResponse()

  try {
    const { plugin } = pluginDefinition()
    const harness = context(workspaces, sessions)
    plugin.apply(harness.ctx)
    await settle()

    const section = harness.registrations
      .find(entry => entry.options.name === 'settings.section').component({ close() {} }).children[0]
    const notes = collectByClass(section, 'dac-note').map(node => node.children[0])
    assert.equal(notes.some(text => text.includes('另有 1 条归档记录暂时读不到会话摘要')), true)
    assert.equal(findByClass(section, 'dac-section-count').children[0], '1 条聊天')
    harness.cleanup()
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('offers the manual bulk entry point and collapse-all on one row above the list', async () => {
  const workspaceState = {
    items: [
      { workspaceId: 'w1', path: '/one', title: 'one', sessionIds: ['a'] },
      { workspaceId: 'w2', path: '/two', title: 'two', sessionIds: ['b'] }
    ],
    archivedSessionIds: ['a', 'b']
  }
  const sessionState = {
    ids: ['a', 'b'],
    byId: { a: archivedRow({ id: 'a' }), b: archivedRow({ id: 'b', cwd: '/two' }) }
  }
  const workspaces = {
    list: store(() => workspaceState),
    async refresh() {}
  }
  const sessions = {
    list: store(() => sessionState),
    async refresh() {}
  }
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => statusResponse()

  try {
    const { plugin } = pluginDefinition()
    const harness = context(workspaces, sessions)
    plugin.apply(harness.ctx)
    await settle()

    const section = harness.registrations
      .find(entry => entry.options.name === 'settings.section').component({ close() {} }).children[0]
    const listActions = findByClass(section, 'dac-list-actions')
    const actionButtons = listActions.children.filter(Boolean)
    assert.deepEqual(actionButtons.map(child => child.children[0]), ['批量归档', '批量删除', '展开全部'])
    assert.equal(actionButtons[2].props.className, 'dac-button dac-button-small dac-list-toggle')
    assert.equal(findByClass(section, 'dac-section-heading').children.length, 2)
    assert.equal(findByClass(findByClass(section, 'dac-toolbar'), 'dac-list-actions'), undefined)
    assert.equal(collectByClass(section, 'dac-group-body').length, 0)
    assert.deepEqual(
      collectByClass(section, 'dac-group-row').map(row => row.props['aria-expanded']),
      [false, false]
    )
    harness.cleanup()
  } finally {
    globalThis.fetch = previousFetch
  }
})

// ---------------------------------------------------------------------------
// Native archived-sessions suppression
// ---------------------------------------------------------------------------

/** Storage double for the browser-local suppression preference. */
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) }
  }
}

/**
 * Settings-panel DOM double: one role=dialog nav whose buttons mirror the
 * section entries, in entry order (the join the patch relies on). The nav has
 * the shell's own two children — the title seat first, the section list last —
 * so `options.titleButton` reproduces a third-party plugin that replaced
 * `settings.header` with its own control.
 */
function settingsDom(labels, options = {}) {
  const buttons = labels.map(label => ({ textContent: label, dataset: {} }))
  const titleButtons = options.titleButton === undefined ? [] : [{ dataset: {}, ...options.titleButton }]
  const list = {
    querySelectorAll(selector) {
      return selector === 'button' ? buttons : []
    }
  }
  const title = {
    querySelectorAll(selector) {
      return selector === 'button' ? titleButtons : []
    }
  }
  const nav = {
    children: [title, list],
    querySelectorAll(selector) {
      return selector === 'button' ? [...titleButtons, ...buttons] : []
    }
  }
  return {
    buttons,
    titleButtons,
    nav,
    document: {
      body: {},
      querySelector(selector) {
        return selector === '[role="dialog"][aria-modal="true"] nav' ? nav : null
      }
    }
  }
}

/** Window double carrying a MutationObserver a test can fire by hand. */
function observerWindow() {
  const observers = []
  const listeners = new Map()
  return {
    observers,
    listeners,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback
        this.disconnected = false
        observers.push(this)
      }
      observe(target, options) {
        this.target = target
        this.options = options
      }
      disconnect() { this.disconnected = true }
      fire() { this.callback() }
    },
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type) { listeners.delete(type) }
  }
}

function suppressionHarness(internals) {
  const dom = settingsDom(['通用', '模型', '已归档会话', '归档管理'])
  const view = observerWindow()
  const storage = memoryStorage()
  const preference = internals.createNativeSuppressionStore(storage)
  const cleanups = []
  const ctx = {
    slots: {
      entries(name) {
        return name === 'settings.section'
          ? ['general', 'models', 'archived-sessions', 'archived-chats'].map(id => ({ options: { id } }))
          : []
      }
    },
    effect(factory) {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    }
  }
  internals.installNativeArchiveSuppression(ctx, { document: dom.document, window: view, preference })
  return {
    ...dom,
    view,
    storage,
    preference,
    key: internals.NATIVE_SUPPRESS_DATASET_KEY,
    unload() {
      for (const cleanup of cleanups.reverse()) cleanup()
      cleanups.length = 0
    }
  }
}

test('defaults the native-page suppression on and keeps the preference browser-local', () => {
  const { internals } = pluginDefinition()
  const key = internals.NATIVE_SUPPRESS_STORAGE_KEY
  assert.equal(internals.NATIVE_ARCHIVE_SECTION_ID, 'archived-sessions')
  // Absent, unparsable, or unreadable storage all mean "on": the native page
  // duplicates this manager's own section, so a fresh install shows one entry.
  assert.equal(internals.readNativeSuppression(null), true)
  assert.equal(internals.readNativeSuppression(memoryStorage()), true)
  assert.equal(internals.readNativeSuppression(memoryStorage({ [key]: 'true' })), true)
  assert.equal(internals.readNativeSuppression(memoryStorage({ [key]: 'false' })), false)
  assert.equal(internals.readNativeSuppression(memoryStorage({ [key]: 'maybe' })), true)
  assert.equal(internals.readNativeSuppression({ getItem() { throw new Error('denied') } }), true)

  const storage = memoryStorage()
  const preference = internals.createNativeSuppressionStore(storage)
  const seen = []
  const unsubscribe = preference.subscribe(() => seen.push(preference.get()))
  assert.equal(preference.get(), true)
  preference.set(false)
  assert.equal(storage.getItem(key), 'false')
  assert.equal(preference.get(), false)
  preference.set(false)
  assert.deepEqual(seen, [false], 'an unchanged value publishes nothing')
  // Another tab writing the key is the same intent as this tab writing it.
  storage.setItem(key, 'true')
  preference.reload()
  assert.equal(preference.get(), true)
  assert.deepEqual(seen, [false, true])
  unsubscribe()
  preference.set(false)
  assert.deepEqual(seen, [false, true], 'unsubscribed listeners stay quiet')

  // A denied write keeps the in-memory value instead of throwing.
  const denied = internals.createNativeSuppressionStore({ getItem: () => null, setItem() { throw new Error('denied') } })
  denied.set(false)
  assert.equal(denied.get(), false)
})

test('resolves the native nav row by slot position and refuses every uncertain shape', () => {
  const { internals } = pluginDefinition()
  const ids = ['general', 'models', 'archived-sessions', 'archived-chats']
  const buttons = ['通用', '模型', '已归档会话', '归档管理'].map(label => ({ textContent: label }))
  assert.equal(internals.resolveNativeArchiveNavButton(buttons, ids), buttons[2])
  // Another installation's menu may hold more sections, in a different order, with
  // other labels or another language: the join is position, so it still lands on
  // the native entry — and this manager's own row is never a target.
  const foreignIds = ['general', 'third-party-a', 'models', 'archived-sessions', 'archived-chats', 'third-party-b']
  const foreignButtons = ['通用设置', '第三方菜单', '模型', '已归档会话', '归档管理', 'Third-party omega']
    .map(label => ({ textContent: label }))
  assert.equal(internals.resolveNativeArchiveNavButton(foreignButtons, foreignIds), foreignButtons[3])
  const englishIds = ['general', 'archived-sessions', 'archived-chats']
  const englishButtons = ['General', 'Archived sessions', 'Archive manager'].map(label => ({ textContent: label }))
  assert.equal(internals.resolveNativeArchiveNavButton(englishButtons, englishIds), englishButtons[1])
  // Fail closed on every shape the patch cannot prove: an extra section control (a
  // future shell affordance), a shorter list, no native entry at all, an empty
  // label that is not a projected section row, and this manager's own row.
  assert.equal(internals.resolveNativeArchiveNavButton([...buttons, { textContent: '额外' }], ids), undefined)
  assert.equal(internals.resolveNativeArchiveNavButton(buttons.slice(0, 3), ids), undefined)
  assert.equal(internals.resolveNativeArchiveNavButton(buttons, ids.slice(0, 3)), undefined)
  assert.equal(internals.resolveNativeArchiveNavButton(buttons, ['general', 'models', 'archived-chats']), undefined)
  assert.equal(internals.resolveNativeArchiveNavButton([...buttons.slice(0, 2), { textContent: '  ' }, buttons[3]], ids), undefined)
  assert.equal(internals.resolveNativeArchiveNavButton([...buttons.slice(0, 2), { textContent: '归档管理' }, buttons[3]], ids), undefined)
  assert.equal(internals.resolveNativeArchiveNavButton(null, ids), undefined)
  assert.equal(internals.resolveNativeArchiveNavButton(buttons, null), undefined)
})

test('reads the section list out of the nav and ignores a replaced title seat', () => {
  const { internals } = pluginDefinition()
  const ids = ['general', 'models', 'archived-sessions', 'archived-chats']
  const plain = settingsDom(['通用设置', '模型', '已归档会话', '归档管理'])
  assert.deepEqual(internals.settingsNavListButtons(plain.nav).map(button => button.textContent),
    ['通用设置', '模型', '已归档会话', '归档管理'])
  // A third-party plugin may replace `settings.header` with its own button: that
  // button sits in the title seat (the nav's first child), so the section list —
  // and the position join — must stay intact.
  const replaced = settingsDom(['通用设置', '模型', '已归档会话', '归档管理'], { titleButton: { textContent: '标题按钮' } })
  assert.deepEqual(internals.settingsNavListButtons(replaced.nav).map(button => button.textContent),
    ['通用设置', '模型', '已归档会话', '归档管理'])
  assert.equal(internals.resolveNativeArchiveNavButton(internals.settingsNavListButtons(replaced.nav), ids),
    replaced.buttons[2])
  assert.equal(replaced.titleButtons[0].dataset[internals.NATIVE_SUPPRESS_DATASET_KEY], undefined)
  // Unreadable structures yield nothing, which keeps the patch disabled.
  assert.deepEqual(internals.settingsNavListButtons(null), [])
  assert.deepEqual(internals.settingsNavListButtons({ children: [] }), [])
  assert.deepEqual(internals.settingsNavListButtons({ children: [{ querySelectorAll: () => [] }] }), [])
})

test('reports a switch that could not locate the native row instead of claiming success', () => {
  const { internals } = pluginDefinition()
  const dom = settingsDom(['通用设置', '模型', '归档管理'])
  const view = observerWindow()
  const preference = internals.createNativeSuppressionStore(memoryStorage())
  const cleanups = []
  internals.installNativeArchiveSuppression({
    slots: { entries: () => ['general', 'models', 'archived-chats'].map(id => ({ options: { id } })) },
    effect(factory) {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    }
  }, { document: dom.document, window: view, preference })

  // The switch is on, but this DSH has no native archive section: the row must
  // say the suppression did not happen rather than looking enabled and doing nothing.
  assert.equal(preference.get(), true)
  assert.equal(preference.getApplied(), false)
  assert.equal(dom.buttons.some(button => button.dataset[internals.NATIVE_SUPPRESS_DATASET_KEY] !== undefined), false)
  for (const cleanup of cleanups) cleanup()
  assert.equal(preference.getApplied(), false, 'unloading keeps the last report')

  // Turning the switch off clears the report: there is nothing to be unavailable.
  const second = suppressionHarness(internals)
  assert.equal(second.preference.getApplied(), true)
  second.preference.set(false)
  assert.equal(second.preference.getApplied(), null)
  second.unload()
})

test('hides only the native nav row and restores it when the switch turns off or the plugin unloads', () => {
  const { internals } = pluginDefinition()
  const harness = suppressionHarness(internals)

  assert.equal(harness.buttons[2].dataset[harness.key], '', 'the native row is hidden by default')
  assert.equal(harness.buttons[0].dataset[harness.key], undefined)
  assert.equal(harness.buttons[1].dataset[harness.key], undefined)
  assert.equal(harness.buttons[3].dataset[harness.key], undefined, 'the archive manager row stays visible')
  assert.equal(harness.view.observers.length, 1)
  assert.deepEqual(harness.view.observers[0].options, { childList: true, subtree: true })

  // The General switch off restores the shell's row; on hides it again.
  harness.preference.set(false)
  assert.equal(harness.buttons[2].dataset[harness.key], undefined)
  harness.preference.set(true)
  assert.equal(harness.buttons[2].dataset[harness.key], '')

  // A later Settings open re-renders the nav with fresh nodes: the observer
  // re-applies the mark to the new button and releases the replaced one.
  const reRendered = { textContent: '已归档会话', dataset: {} }
  const replaced = harness.buttons[2]
  harness.buttons[2] = reRendered
  harness.view.observers[0].fire()
  assert.equal(reRendered.dataset[harness.key], '')
  assert.equal(replaced.dataset[harness.key], undefined)

  // Another tab turning the preference off lands through the storage event.
  harness.storage.setItem(internals.NATIVE_SUPPRESS_STORAGE_KEY, 'false')
  harness.view.listeners.get('storage')({ key: internals.NATIVE_SUPPRESS_STORAGE_KEY })
  assert.equal(harness.buttons[2].dataset[harness.key], undefined)
  harness.view.listeners.get('storage')({ key: 'unrelated' })
  assert.equal(harness.buttons[2].dataset[harness.key], undefined)

  harness.unload()
  assert.equal(harness.buttons[2].dataset[harness.key], undefined)
  assert.equal(harness.view.observers[0].disconnected, true)
  assert.equal(harness.view.listeners.size, 0)
})

test('keeps the mark while another live bundle generation still suppresses it', () => {
  const { internals } = pluginDefinition()
  const dom = settingsDom(['通用', '已归档会话', '归档管理'])
  const view = observerWindow()
  const sections = ['general', 'archived-sessions', 'archived-chats'].map(id => ({ options: { id } }))
  const instances = [
    internals.createNativeSuppressionStore(memoryStorage()),
    internals.createNativeSuppressionStore(memoryStorage())
  ]
  const unloads = []
  for (const preference of instances) {
    const cleanups = []
    internals.installNativeArchiveSuppression({
      slots: { entries: () => sections },
      effect(factory) {
        const cleanup = factory()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
    }, { document: dom.document, window: view, preference })
    unloads.push(() => {
      for (const cleanup of cleanups.reverse()) cleanup()
    })
  }

  const key = internals.NATIVE_SUPPRESS_DATASET_KEY
  assert.equal(dom.buttons[1].dataset[`${key}References`], '2')
  assert.equal(dom.buttons[1].dataset[key], '')
  unloads[0]()
  assert.equal(dom.buttons[1].dataset[key], '', 'one unload must not restore a row the other still hides')
  unloads[1]()
  assert.equal(dom.buttons[1].dataset[key], undefined)
  assert.equal(dom.buttons[1].dataset[`${key}References`], undefined)
})
