import assert from 'node:assert/strict'
import test from 'node:test'


/**
 * Interaction-level coverage for the Settings archive manager. The bundle
 * requires the shell's React, so this file drives it through a miniature
 * hook runtime: state updates re-render the whole component, which is enough
 * to exercise handler wiring, frozen selections, and the archive/undo
 * sequence against the real client services.
 */

let definition
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../client.js')

const DAY_MS = 24 * 60 * 60 * 1000

function createMiniReact() {
  const hooks = []
  const pendingEffects = []
  let cursor = 0
  let dirty = false
  let notify = () => {}
  let tree = null
  let renderComponent = null
  let renderProps = null

  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const merged = { ...(props || {}) }
      if (children.length > 0) merged.children = children.length === 1 ? children[0] : children
      return { type, props: merged, children }
    },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (hooks[index] === undefined) {
        hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const slot = hooks[index]
      return [slot.value, (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
        dirty = true
        notify()
      }]
    },
    useRef(initial) {
      const index = cursor
      cursor += 1
      if (hooks[index] === undefined) hooks[index] = { value: { current: initial } }
      return hooks[index].value
    },
    useEffect(callback) {
      const index = cursor
      cursor += 1
      if (hooks[index] === undefined) {
        hooks[index] = { value: true }
        pendingEffects.push(callback)
      }
    },
    useLayoutEffect(callback) { React.useEffect(callback) },
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor
      cursor += 1
      if (hooks[index] === undefined) {
        hooks[index] = { value: true }
        subscribe(() => {
          dirty = true
          notify()
        })
      }
      return getSnapshot()
    }
  }

  return {
    React,
    get tree() { return tree },
    /** Render until no state update is left, running queued effects each pass. */
    async mount(component, props) {
      renderComponent = component
      renderProps = props === undefined ? { close() {} } : props
      notify = () => {}
      for (let pass = 0; pass < 20; pass += 1) {
        if (!dirty && tree !== null) break
        dirty = false
        cursor = 0
        tree = renderComponent(renderProps)
        while (pendingEffects.length > 0) pendingEffects.shift()()
        await new Promise(resolve => setImmediate(resolve))
      }
      return tree
    },
    async settle() {
      for (let pass = 0; pass < 20; pass += 1) {
        await new Promise(resolve => setImmediate(resolve))
        if (!dirty && pendingEffects.length === 0) return tree
        dirty = false
        cursor = 0
        tree = renderComponent(renderProps)
        while (pendingEffects.length > 0) pendingEffects.shift()()
      }
      throw new Error('mini React did not settle')
    }
  }
}

function elements(node, collected = []) {
  if (node === null || node === undefined || node === false || node === true) return collected
  if (Array.isArray(node)) {
    for (const item of node) elements(item, collected)
    return collected
  }
  if (typeof node === 'string' || typeof node === 'number') return collected
  if (typeof node.type === 'function') {
    elements(node.type(node.props), collected)
    return collected
  }
  collected.push(node)
  elements(node.children, collected)
  return collected
}

function texts(node) {
  const out = []
  const walk = (value) => {
    if (value === null || value === undefined || value === false || value === true) return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value === 'string' || typeof value === 'number') {
      out.push(String(value))
      return
    }
    walk(value.children)
  }
  walk(node.children)
  return out.join(' ')
}

function button(node, label) {
  const found = elements(node).find(element => element.type === 'button'
    && texts(element).includes(label))
  assert.notEqual(found, undefined, `button “${label}” not found`)
  return found
}

function noteTexts(node) {
  return classTexts(node, 'dac-note')
}

function classTexts(node, className) {
  return elements(node)
    .filter(element => hasClassToken(element, className))
    .map(element => texts(element))
}

/** Find a raw element (component elements included) without invoking components. */
function rawFind(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = rawFind(item, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (predicate(node)) return node
  return rawFind(node.children, predicate)
}

function expandGroup(tree) {
  const row = elements(tree).find(element => hasClassToken(element, 'dac-group-row'))
  assert.notEqual(row, undefined, 'group row not found')
  row.props.onClick()
}

function hasClassToken(node, className) {
  const value = node?.props?.className
  return typeof value === 'string' && value.split(/\s+/u).includes(className)
}

function hasClass(node, className) {
  return elements(node).some(element => hasClassToken(element, className))
}

function checkboxFor(node, label) {
  const found = elements(node).filter(element => element.type === 'label'
    && texts(element).includes(label))
  assert.equal(found.length, 1, `label “${label}” not found exactly once`)
  return elements(found[0]).find(element => element.type === 'input')
}

function createFixtures(now) {
  const listeners = new Set()
  const archived = new Set()
  const workspaceState = {
    items: [{ workspaceId: 'w1', path: '/project', title: 'project', sessionIds: ['fresh', 'old', 'busy'] }],
    archivedSessionIds: []
  }
  const summaries = {
    fresh: { id: 'fresh', displayTitle: '刚聊过', updatedAt: now - DAY_MS, cwd: '/Users/me/proj-dir' },
    old: { id: 'old', displayTitle: '很久没动', updatedAt: now - 40 * DAY_MS, cwd: '/Users/me/proj-dir' },
    busy: { id: 'busy', displayTitle: '还在跑', updatedAt: now - 60 * DAY_MS, cwd: '/Users/me/proj-dir', running: true }
  }
  // DSH 0.1.6-alpha.2 list shape: the snapshot has no `current` field.
  const sessionState = { ids: ['fresh', 'old', 'busy'], byId: summaries }
  const archiveCalls = []
  const restoreCalls = []
  const deleteCalls = []
  const notifyAll = () => { for (const listener of listeners) listener() }

  const workspaces = {
    list: {
      getSnapshot: () => workspaceState,
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }
    },
    async archiveSession(id) {
      archiveCalls.push(id)
      archived.add(id)
      workspaceState.archivedSessionIds = [...archived]
      notifyAll()
    },
    async refresh() {}
  }
  const sessions = {
    list: {
      getSnapshot: () => sessionState,
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }
    },
    async refresh() {}
  }
  return {
    workspaces,
    sessions,
    workspaceState,
    summaries,
    archiveCalls,
    restoreCalls,
    deleteCalls,
    archived,
    notify: notifyAll
  }
}

function context(workspaces, sessions, registrations) {
  const cleanups = []
  return {
    ctx: {
      workspaces,
      sessions,
      slots: {
        inject(_name, factory) { return factory() },
        register(options, component) {
          registrations.push({ options, component })
          return () => {}
        },
      },
      effect(factory) {
        const cleanup = factory()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
    },
    cleanup() { for (const cleanup of cleanups.reverse()) cleanup() }
  }
}

function installPrimitives(mini) {
  const { React } = mini
  const stub = () => null
  return {
    IconArchiveOutline20: stub,
    IconFolderClose16: stub,
    IconFolderOpen16: stub,
    IconLoadingOutline16: stub,
    IconRefreshOutline16: stub,
    IconSearchOutline16: stub,
    IconTrashOutline16: stub,
    IconTriangleRightFill14: stub,
    Modal: props => React.createElement('div', { className: 'dac-modal' },
      props.children === undefined || props.children === null ? null : props.children,
      props.footer === undefined ? null : props.footer),
    Switch: props => React.createElement('button', {
      type: 'switch',
      className: 'dac-switch',
      checked: props.checked,
      label: props.label,
      onClick: () => {
        props.onChange(props.checked !== true)
      }
    })
  }
}

async function mountSection(options = {}) {
  const now = options.now ?? Date.now()
  const fixtures = createFixtures(now)
  const mini = createMiniReact()
  const primitives = installPrimitives(mini)
  const plugin = definition.factory(id => {
    if (id === 'react') return mini.React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require: ${id}`)
  })
  const registrations = []
  const harness = context(fixtures.workspaces, fixtures.sessions, registrations)

  const previousFetch = globalThis.fetch
  const fetchCalls = []
  globalThis.fetch = async (path, init = {}) => {
    fetchCalls.push({ path, init })
    if (path === '/dsh-chat-archive-manager/restore' || path === '/dsh-chat-archive-manager/delete') {
      const { sessionId } = JSON.parse(init.body)
      if (path === '/dsh-chat-archive-manager/restore') fixtures.restoreCalls.push(sessionId)
      else fixtures.deleteCalls.push(sessionId)
      fixtures.archived.delete(sessionId)
      fixtures.workspaceState.archivedSessionIds = [...fixtures.archived]
      fixtures.notify()
      return {
        ok: true,
        async json() { return { ok: true, sessionId, archivedSessionIds: fixtures.workspaceState.archivedSessionIds } }
      }
    }
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          workspaceProjection: false,
          deletionSupported: true,
          restorationSupported: true
        }
      }
    }
  }

  plugin.apply(harness.ctx)
  const registration = registrations.find(entry => entry.options.name === 'settings.section')
  const tree = await mini.mount(registration.component)
  return {
    ...fixtures,
    Modal: primitives.Modal,
    mini,
    fetchCalls,
    tree,
    async close() {
      harness.cleanup()
      globalThis.fetch = previousFetch
    }
  }
}

test('batch-archives the chats older than the chosen cutoff and can undo it', async () => {
  const flow = await mountSection()
  try {
    assert.equal(classTexts(flow.tree, 'dac-description').some(text =>
      text.includes('按工作区分组或单列表浏览归档聊天')
      && text.includes('批量归档支持按时间条件筛选')
      && text.includes('恢复会回到原来的工作区')
      && text.includes('原 Workspace 已删除时进入未分组')
      && text.includes('永久删除会移除会话日志，但不删除共享附件')), true)
    assert.equal(elements(flow.tree).some(element => element.props?.className === 'dac-empty'), true)

    button(flow.tree, '批量归档').props.onClick()
    let tree = await flow.mini.settle()
    const matches = classTexts(tree, 'dac-note').find(text => text.includes('匹配'))
    assert.equal(matches, '匹配 1 条。另有 1 条因上述排除项未计入。')
    assert.equal(button(tree, '下一步').props.disabled, false)

    button(tree, '下一步').props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(classTexts(tree, 'dac-batch-summary'), ['将归档 1 条，共 1 条候选。'])
    assert.equal(button(tree, '全不选').props.className, 'dac-button dac-button-small')
    const previewText = elements(tree)
      .filter(element => hasClassToken(element, 'dac-preview-title'))
      .map(element => texts(element))
    assert.deepEqual(previewText, ['很久没动'])
    const startButton = button(tree, '开始归档')
    assert.equal(startButton.props.disabled, false)

    startButton.props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(flow.archiveCalls, ['old'])
    assert.deepEqual(classTexts(tree, 'dac-progress'), ['已归档 1 条。'])
    assert.notEqual(button(tree, '撤销本次归档(1)').props.disabled, true)

    button(tree, '撤销本次归档(1)').props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(flow.restoreCalls, ['old'])
    assert.deepEqual(classTexts(tree, 'dac-progress'), ['已归档 1 条。', '已恢复 1 条。'])
    assert.equal(flow.fetchCalls.filter(call => call.path === '/dsh-chat-archive-manager/restore').length, 1)
  } finally {
    await flow.close()
  }
})

test('keeps the chat on stage out of the default batch until it is explicitly included', async () => {
  const flow = await mountSection()
  try {
    // DSH 0.1.6-alpha.2 carries the open chat as local main-view retention on the
    // list row (`sessions.list.current` is gone); that chat must still stay out
    // of the default batch and remain an explicit opt-in.
    flow.summaries.old.retainedBy = { mainView: 1 }
    flow.notify()
    let tree = await flow.mini.settle()

    button(tree, '批量归档').props.onClick()
    tree = await flow.mini.settle()
    assert.equal(classTexts(tree, 'dac-note').some(text =>
      text.includes('匹配 0 条') && text.includes('另有 2 条因上述排除项未计入')), true)
    assert.equal(button(tree, '下一步').props.disabled, true)

    checkboxFor(tree, '包含当前打开的会话').props.onChange({ target: { checked: true } })
    tree = await flow.mini.settle()
    assert.equal(classTexts(tree, 'dac-note').some(text =>
      text.includes('匹配 1 条') && text.includes('另有 1 条因上述排除项未计入')), true)
    assert.equal(button(tree, '下一步').props.disabled, false)

    button(tree, '下一步').props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(elements(tree)
      .filter(element => hasClassToken(element, 'dac-preview-title'))
      .map(element => texts(element)), ['很久没动'])

    button(tree, '开始归档').props.onClick()
    await flow.mini.settle()
    assert.deepEqual(flow.archiveCalls, ['old'])
  } finally {
    await flow.close()
  }
})

test('scopes a batch to one workspace group and lists newly archived rows', async () => {
  const flow = await mountSection()
  try {
    button(flow.tree, '批量归档').props.onClick()
    let tree = await flow.mini.settle()
    button(tree, '取消').props.onClick()
    tree = await flow.mini.settle()
    assert.equal(elements(tree).filter(element => hasClassToken(element, 'dac-preview-row')).length, 0)

    button(tree, '批量归档').props.onClick()
    tree = await flow.mini.settle()
    const defaultScope = elements(tree).find(element => element.props?.['aria-label'] === '批量归档范围')
    assert.equal(defaultScope.props.value, 'all')
    defaultScope.props.onChange({ target: { value: 'workspace:w1' } })
    tree = await flow.mini.settle()
    const scopeSelect = elements(tree).find(element => element.props?.['aria-label'] === '批量归档范围')
    assert.equal(scopeSelect.props.value, 'workspace:w1')
    assert.deepEqual(
      elements(scopeSelect).filter(element => element.type === 'option').map(option => option.props.value),
      ['all', 'workspace:w1', 'ungrouped']
    )
    const presetSelect = elements(tree).find(element => element.props?.['aria-label'] === '批量归档时间条件')
    assert.deepEqual(
      elements(presetSelect).filter(element => element.type === 'option').map(option => option.children[0]),
      ['所有时间', '24 小时前', '1 天前', '7 天前', '15 天前', '30 天前', '90 天前', '自定义日期']
    )
    assert.equal(classTexts(tree, 'dac-note').some(text => text.includes('匹配 1 条')), true)

    checkboxFor(tree, '包含运行中或等待交互的会话').props.onChange({ target: { checked: true } })
    tree = await flow.mini.settle()
    assert.equal(classTexts(tree, 'dac-note').some(text => text.includes('匹配 2 条')), true)

    button(tree, '下一步').props.onClick()
    tree = await flow.mini.settle()
    const previewGroup = elements(tree).find(element => hasClassToken(element, 'dac-preview-head'))
    assert.equal(texts(previewGroup), 'project · 2/2')

    button(tree, '开始归档').props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(flow.archiveCalls, ['old', 'busy'])
    assert.equal(flow.workspaceState.archivedSessionIds.length, 2)

    button(tree, '完成').props.onClick()
    tree = await flow.mini.settle()
    const count = elements(tree).find(element => element.props?.className === 'dac-section-count')
    assert.equal(texts(count), '2 条聊天')
    const groupCount = elements(tree).find(element => element.props?.className === 'dac-group-count')
    assert.equal(texts(groupCount), '2 条')
    assert.equal(hasClass(tree, 'dac-group-body'), false)
    expandGroup(tree)
    tree = await flow.mini.settle()
    const rowTitles = elements(tree)
      .filter(element => element.props?.className === 'dac-row-title')
      .map(element => texts(element))
    assert.deepEqual(rowTitles, ['很久没动', '还在跑'])
  } finally {
    await flow.close()
  }
})

test('requires the acknowledgment above the bulk threshold', async () => {
  const now = Date.now()
  const flow = await mountSection({ now })
  try {
    const many = {}
    for (let index = 0; index < 60; index += 1) {
      many[`c${index}`] = {
        id: `c${index}`,
        displayTitle: `聊天 ${index}`,
        updatedAt: now - 40 * DAY_MS,
        cwd: '/Users/me/proj-dir'
      }
    }
    for (const [id, summary] of Object.entries(many)) {
      flow.sessions.list.getSnapshot().byId[id] = summary
      flow.sessions.list.getSnapshot().ids.push(id)
    }
    flow.workspaceState.items[0].sessionIds.push(...Object.keys(many))
    await flow.mini.settle()

    button(flow.tree, '批量归档').props.onClick()
    let tree = await flow.mini.settle()
    assert.equal(classTexts(tree, 'dac-note').some(text => text.includes('匹配 61 条')), true)

    button(tree, '下一步').props.onClick()
    tree = await flow.mini.settle()
    const startButton = button(tree, '开始归档(61)')
    assert.equal(startButton.props.disabled, true)

    checkboxFor(tree, '我已核对清单，确认归档 61 条聊天').props.onChange({ target: { checked: true } })
    tree = await flow.mini.settle()
    assert.equal(button(tree, '开始归档(61)').props.disabled, false)
  } finally {
    await flow.close()
  }
})

test('keeps the batch header and footer fixed and scrolls only the list', async () => {
  const flow = await mountSection()
  try {
    const batchModal = node => {
      const found = rawFind(node, element => element.type === flow.Modal
        && element.props.open === true
        && element.props.contentClassName === 'dac-content-batch')
      assert.notEqual(found, undefined, 'batch modal not rendered')
      return found
    }

    button(flow.tree, '批量归档').props.onClick()
    let tree = await flow.mini.settle()
    let modal = batchModal(tree)
    assert.equal(modal.props.contentClassName, 'dac-content-batch')
    assert.notEqual(modal.props.footer, undefined, 'actions must live in the footer slot')
    assert.equal(hasClass(modal.props.footer, 'dac-button'), true)
    assert.equal(hasClass(modal.children, 'dac-batch-scroll'), true)
    assert.equal(elements(modal.children).some(element => texts(element) === '下一步'), false)

    button(tree, '下一步').props.onClick()
    tree = await flow.mini.settle()
    modal = batchModal(tree)
    assert.equal(hasClass(modal.children, 'dac-preview'), true)
    assert.equal(hasClass(modal.children, 'dac-batch-scroll'), false)
    assert.equal(elements(modal.children).some(element => element.type === 'button'
      && texts(element).includes('开始归档')), false)
    assert.equal(elements(modal.props.footer).some(element => element.type === 'button'
      && texts(element).includes('开始归档')), true)

    button(tree, '开始归档(1)').props.onClick()
    tree = await flow.mini.settle()
    modal = batchModal(tree)
    assert.equal(elements(modal.props.footer).some(element => texts(element) === '完成'), true)
    assert.equal(hasClass(modal.children, 'dac-batch-scroll'), true)
  } finally {
    await flow.close()
  }
})

test('toggles the whole preview selection from one inline button', async () => {
  const flow = await mountSection()
  try {
    button(flow.tree, '批量归档').props.onClick()
    let tree = await flow.mini.settle()
    button(tree, '下一步').props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(classTexts(tree, 'dac-batch-summary'), ['将归档 1 条，共 1 条候选。'])
    assert.notEqual(button(tree, '全不选').props.disabled, true)

    button(tree, '全不选').props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(classTexts(tree, 'dac-batch-summary'), ['尚未勾选任何聊天，共 1 条候选。'])
    assert.equal(button(tree, '开始归档').props.disabled, true)
    const rows = elements(tree).filter(element => hasClassToken(element, 'dac-check')
      && element.type === 'input')
    assert.deepEqual(rows.map(row => row.props.checked), [false])

    button(tree, '全选').props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(classTexts(tree, 'dac-batch-summary'), ['将归档 1 条，共 1 条候选。'])
    assert.equal(button(tree, '开始归档(1)').props.disabled, false)
  } finally {
    await flow.close()
  }
})

test('nests grouped rows under their workspace and names the workspace only in the flat view', async () => {
  const flow = await mountSection()
  try {
    button(flow.tree, '批量归档').props.onClick()
    let tree = await flow.mini.settle()
    button(tree, '下一步').props.onClick()
    tree = await flow.mini.settle()
    button(tree, '开始归档(1)').props.onClick()
    tree = await flow.mini.settle()
    button(tree, '完成').props.onClick()
    tree = await flow.mini.settle()

    assert.equal(hasClass(tree, 'dac-group-body'), false)
    expandGroup(tree)
    tree = await flow.mini.settle()
    assert.equal(hasClass(tree, 'dac-group-body'), true)
    const groupedMeta = classTexts(tree, 'dac-row-meta')[0]
    // The group header already names the Workspace; the row adds only the
    // relative last activity, like DSH's own archived-session list.
    assert.equal(groupedMeta, '1 个月')
    assert.equal(groupedMeta.includes('原位'), false)
    assert.equal(groupedMeta.includes('proj-dir'), false)

    const viewSelect = elements(tree).find(element => element.props?.['aria-label'] === '归档列表视图')
    viewSelect.props.onChange({ target: { value: 'flat' } })
    tree = await flow.mini.settle()
    assert.equal(hasClass(tree, 'dac-group-body'), false)
    const flatMeta = classTexts(tree, 'dac-row-meta')[0]
    assert.equal(flatMeta, 'project · 1 个月')
    assert.equal(flatMeta.includes('proj-dir'), false)
  } finally {
    await flow.close()
  }
})

test('restores and permanently deletes a row from the expanded group', async () => {
  const flow = await mountSection()
  try {
    flow.archived.add('old')
    flow.workspaceState.archivedSessionIds = ['old']
    flow.notify()
    await flow.mini.settle()
    expandGroup(flow.mini.tree)
    const tree = await flow.mini.settle()

    const actions = elements(tree).find(element => hasClassToken(element, 'dac-row-actions'))
    const deleteButton = elements(actions).find(element => element.type === 'button'
      && hasClassToken(element, 'danger'))
    const restoreButton = elements(actions).find(element => element.type === 'button'
      && !hasClassToken(element, 'danger'))
    assert.equal(deleteButton.props['aria-label'], '永久删除“很久没动”')
    assert.equal(restoreButton.props.title, '恢复到聊天列表')

    restoreButton.props.onClick()
    await flow.mini.settle()
    assert.deepEqual(flow.restoreCalls, ['old'])
    const restoreCall = flow.fetchCalls.find(call => call.path === '/dsh-chat-archive-manager/restore')
    assert.equal(restoreCall.init.method, 'POST')
    assert.deepEqual(JSON.parse(restoreCall.init.body), { sessionId: 'old' })
    assert.deepEqual(restoreCall.init.headers, {
      'Content-Type': 'application/json',
      'x-dsh-chat-archive-manager-client': '1'
    })
  } finally {
    await flow.close()
  }
})

test('renders the custom date condition as a themed date field', async () => {
  const flow = await mountSection()
  try {
    button(flow.tree, '批量归档').props.onClick()
    let tree = await flow.mini.settle()
    assert.equal(hasClass(tree, 'dac-select-field-date'), false)

    const presetSelect = elements(tree).find(element => element.props?.['aria-label'] === '批量归档时间条件')
    presetSelect.props.onChange({ target: { value: 'date' } })
    tree = await flow.mini.settle()

    const dateField = elements(tree).find(element => hasClassToken(element, 'dac-select-field-date'))
    assert.notEqual(dateField, undefined, 'date field wrapper missing')
    const dateInput = elements(dateField).find(element => hasClassToken(element, 'dac-date'))
    assert.equal(dateInput.props.type, 'date')
    assert.equal(dateInput.props['aria-label'], '批量归档自定义日期')
    dateInput.props.onChange({ target: { value: '2026-01-02' } })
    tree = await flow.mini.settle()
    assert.equal(classTexts(tree, 'dac-note').some(text => text.includes('匹配 0 条')), true)
  } finally {
    await flow.close()
  }
})

test('offers 所有时间 and reaches chats the rolling presets cannot', async () => {
  const flow = await mountSection()
  const timeLabel = (node) => elements(node)
    .filter(element => element.props?.className === 'dac-field-label')
    .map(element => texts(element))
    .find(text => text.includes('时间条件'))
  try {
    button(flow.tree, '批量归档').props.onClick()
    let tree = await flow.mini.settle()
    assert.equal(timeLabel(tree), '时间条件（归档最近更新早于该时间点的聊天）')
    assert.equal(classTexts(tree, 'dac-note').some(text => text.includes('匹配 1 条')), true)

    const presetSelect = elements(tree).find(element => element.props?.['aria-label'] === '批量归档时间条件')
    assert.equal(presetSelect.props.value, '30d')
    presetSelect.props.onChange({ target: { value: 'all' } })
    tree = await flow.mini.settle()
    assert.equal(timeLabel(tree), '时间条件（不做时间过滤）')
    assert.equal(classTexts(tree, 'dac-note').some(text =>
      text.includes('匹配 2 条') && text.includes('另有 1 条因上述排除项未计入')), true)

    button(tree, '下一步').props.onClick()
    tree = await flow.mini.settle()
    // The chat from a day ago is a candidate now; the running one stays excluded.
    assert.deepEqual(elements(tree)
      .filter(element => hasClassToken(element, 'dac-preview-title'))
      .map(element => texts(element)), ['刚聊过', '很久没动'])
    button(tree, '开始归档(2)').props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(flow.archiveCalls, ['fresh', 'old'])
    assert.deepEqual(classTexts(tree, 'dac-progress'), ['已归档 2 条。'])

    // Permanent deletion gets the same reach: with the two chats archived, the
    // recent one is only deletable under 所有时间.
    button(tree, '完成').props.onClick()
    tree = await flow.mini.settle()
    button(tree, '批量删除').props.onClick()
    tree = await flow.mini.settle()
    assert.equal(classTexts(tree, 'dac-note').some(text => text.includes('匹配 1 条')), true)
    const deletePresetSelect = elements(tree).find(element => element.props?.['aria-label'] === '批量删除时间条件')
    deletePresetSelect.props.onChange({ target: { value: 'all' } })
    tree = await flow.mini.settle()
    assert.equal(timeLabel(tree), '时间条件（不做时间过滤）')
    assert.equal(classTexts(tree, 'dac-note').some(text => text.includes('匹配 2 条')), true)
    button(tree, '下一步').props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(classTexts(tree, 'dac-batch-summary'), ['将永久删除 2 条，共 2 条候选。'])
  } finally {
    await flow.close()
  }
})

test('permanently deletes a reviewed batch, requires an explicit acknowledgment, and offers no undo', async () => {
  const flow = await mountSection()
  try {
    for (const id of ['old', 'busy']) flow.archived.add(id)
    flow.workspaceState.archivedSessionIds = ['old', 'busy']
    flow.notify()
    let tree = await flow.mini.settle()

    button(tree, '批量删除').props.onClick()
    tree = await flow.mini.settle()
    // `busy` is running, so the default exclusions keep it out of the batch.
    assert.equal(classTexts(tree, 'dac-note').some(text => text.includes('匹配 1 条')), true)
    assert.equal(classTexts(tree, 'dac-note').some(text =>
      text.includes('永久删除不可撤销：会话日志会被移除，共享附件不会被删除。')), true)

    button(tree, '下一步').props.onClick()
    tree = await flow.mini.settle()
    assert.deepEqual(classTexts(tree, 'dac-batch-summary'), ['将永久删除 1 条，共 1 条候选。'])
    assert.equal(button(tree, '开始删除(1)').props.disabled, true)

    // Permanent deletion is acknowledged for every size, not only above 50.
    checkboxFor(tree, '确认永久删除这 1 条聊天').props.onChange({ target: { checked: true } })
    tree = await flow.mini.settle()
    const startButton = button(tree, '开始删除(1)')
    assert.equal(startButton.props.disabled, false)
    startButton.props.onClick()
    tree = await flow.mini.settle()

    assert.deepEqual(flow.deleteCalls, ['old'])
    const deleteCall = flow.fetchCalls.find(call => call.path === '/dsh-chat-archive-manager/delete')
    assert.equal(deleteCall.init.method, 'POST')
    assert.deepEqual(JSON.parse(deleteCall.init.body), { sessionId: 'old' })
    assert.equal(classTexts(tree, 'dac-progress').includes('已永久删除 1 条。'), true)
    assert.equal(elements(tree).some(element => element.type === 'button'
      && texts(element).includes('撤销本次归档')), false)
  } finally {
    await flow.close()
  }
})

// ---------------------------------------------------------------------------
// General-settings switch for the native archived-sessions page
// ---------------------------------------------------------------------------

/**
 * Settings DOM double: one `role=dialog` nav whose buttons mirror the section
 * entries, plus the head the bundle injects its stylesheet into. The nav keeps
 * the shell's own two children — title seat first, section list last.
 */
function createSettingsDocument(labels, options = {}) {
  const buttons = labels.map(label => ({ textContent: label, dataset: {} }))
  const titleButtons = options.titleButton === undefined ? [] : [{ dataset: {}, ...options.titleButton }]
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
    styles,
    document: {
      body: {},
      head,
      querySelector(selector) {
        return selector === '[role="dialog"][aria-modal="true"] nav' ? nav : null
      },
      getElementById() { return null },
      createElement() {
        return { id: '', dataset: {}, textContent: '', parentNode: null }
      }
    }
  }
}

/** Replace `globalThis.localStorage` for one test and hand back the restore. */
function installStorage(values = new Map()) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const stub = {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: key => {
      values.delete(key)
    }
  }
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true })
  return {
    stub,
    values,
    restore() {
      if (previous === undefined) delete globalThis.localStorage
      else Object.defineProperty(globalThis, 'localStorage', previous)
    }
  }
}
