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

/**
 * primitives 桩的图标成员：按**命名法**分别给出，一次只给一套。
 *
 * bundle 现在按能力解析图标（`iconOf('…OutlineMedium', '…OutlineRegular', '…Outline16')`），
 * 所以同一个版本要在 0.1.6（数字档位 `…Outline16`）与 0.1.7（档位词 `…OutlineMedium`）
 * 上都能画出图标。两套名字同时塞进一个桩就测不出"优先顺序写错"，因此用 `icons` 选项切换。
 * 桩里只放 bundle 真正解析的成员，多放会掩盖"引用了不存在的东西"。
 */
function iconStubs(naming, { IconLoading, IconNewChat, IconWarning }) {
  return naming === 'legacy'
    ? {
        IconLoadingOutline16: IconLoading,
        IconNewChatOutline16: IconNewChat,
        IconWarningOutline16: IconWarning
      }
    : {
        IconLoadingOutlineMedium: IconLoading,
        IconNewChatOutlineMedium: IconNewChat,
        IconWarningOutlineMedium: IconWarning
      }
}

function createPlugin(options = {}) {
  let cursor = 0
  let states = []
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value
      }]
    }
  }
  const IconLoading = () => null
  const IconNewChat = () => null
  const IconWarning = () => null
  const Tooltip = () => null
  const primitives = { ...iconStubs(options.icons, { IconLoading, IconNewChat, IconWarning }), Tooltip }
  return {
    plugin: definition.factory((id) => {
      if (id === 'react') return React
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
      throw new Error(`unexpected require: ${id}`)
    }),
    render(component, props) {
      cursor = 0
      return component(props)
    },
    reset() {
      cursor = 0
      states = []
    },
    types: { IconLoading, IconNewChat, IconWarning, Tooltip }
  }
}

function createContext(workspaces, uiWorkspace = { startSession() {} }) {
  const cleanups = []
  const registrations = []
  return {
    ctx: {
      uiWorkspace,
      workspaces,
      slots: {
        inject(name, factory) {
          assert.equal(name, 'sidebar.footer.action')
          return factory()
        },
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
    cleanup() {
      for (const cleanup of cleanups.reverse()) cleanup()
    }
  }
}

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
        workspaceId: 'stale-managed-id',
        path: '/managed',
        title: '通用会话',
        ...overrides
      }
    }
  }
}

function traceable(target) {
  const originalSymbol = Symbol.for('cordis.original')
  return new Proxy(target, {
    get(inner, property, receiver) {
      if (property === originalSymbol) return inner
      const value = Reflect.get(inner, property, receiver)
      return typeof value === 'function' ? value.bind(receiver) : value
    },
    set(inner, property, value, receiver) {
      return Reflect.set(inner, property, value, receiver)
    }
  })
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve))
}

test('registers a dedicated general-session action without replacing native New Session', async () => {
  assert.equal(definition.id, 'dsh-default-workspace')
  const calls = []
  const workspace = {
    workspaceId: 'managed',
    path: '/managed',
    title: '通用会话',
    sessionIds: []
  }
  const workspacesTarget = {
    list: {
      getSnapshot() {
        return { items: [workspace] }
      }
    },
    async rename(id, title) {
      calls.push(['rename', id, title])
    },
    async delete(id) {
      calls.push(['delete', id])
    },
    async insertBefore(id, beforeId) {
      calls.push(['move', id, beforeId])
    },
    async refresh() {}
  }
  const originalDescriptors = Object.fromEntries(
    ['rename', 'delete', 'insertBefore'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(workspacesTarget, name)
    ])
  )
  const workspaces = traceable(workspacesTarget)
  const uiWorkspace = {
    startSession(id) {
      calls.push(['start', id])
    }
  }
  const nativeStartSession = uiWorkspace.startSession
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => statusResponse()

  try {
    const { plugin, render, reset, types } = createPlugin()
    const harness = createContext(workspaces, uiWorkspace)
    plugin.apply(harness.ctx)
    await settle()

    assert.deepEqual(plugin.inject, ['uiWorkspace', 'workspaces', 'slots'])
    assert.equal(uiWorkspace.startSession, nativeStartSession)
    uiWorkspace.startSession()
    assert.deepEqual(calls, [['start', undefined]])

    assert.equal(harness.registrations.length, 1)
    const registration = harness.registrations[0]
    assert.deepEqual({
      name: registration.options.name,
      id: registration.options.id,
      order: registration.options.order,
      label: registration.options.label
    }, {
      name: 'sidebar.footer.action',
      id: 'dsh-default-workspace.new-session',
      order: 100,
      label: '新建通用会话'
    })
    assert.equal(typeof registration.options.inject, 'function')

    const wide = render(registration.component, { wide: true, onStart() {} })
    const wideTooltip = wide.children[0]
    const wideButton = wideTooltip.props.children
    assert.equal(wide.props.className, 'dgw-action')
    assert.equal(wideTooltip.type, types.Tooltip)
    assert.equal(wideButton.props['aria-label'], '新建通用会话')
    assert.equal(wideButton.children[0].type, types.IconNewChat)
    assert.equal(wideButton.children[1].children[0], '新建通用会话')

    reset()
    const rail = render(registration.component, { wide: false, onStart() {} })
    assert.equal(rail.props.className, 'dgw-action dgw-action-rail')
    assert.equal(rail.children[0].props.disabled, false)
    assert.equal(rail.children[0].props.children.children.length, 2)
    assert.equal(rail.children[0].props.children.children[1], false)

    reset()
    const failingStart = async () => { throw new Error('status unavailable') }
    let failed = render(registration.component, { wide: true, onStart: failingStart })
    failed.children[0].props.children.props.onClick()
    await settle()
    failed = render(registration.component, { wide: true, onStart: failingStart })
    const failedButton = failed.children[0].props.children
    assert.equal(failedButton.props['data-error'], true)
    assert.equal(failedButton.props['aria-label'], '新建失败，点击重试')
    assert.equal(failedButton.children[0].type, types.IconWarning)
    assert.equal(failedButton.children[1].children[0], '新建失败，点击重试')

    const action = registration.options.inject()
    await Promise.all([action.onStart(), action.onStart()])
    assert.deepEqual(calls, [
      ['start', undefined],
      ['start', 'managed']
    ])

    await assert.rejects(() => workspaces.rename('managed', 'x'), /不能执行此操作/)
    await assert.rejects(() => workspaces.delete('managed'), /不能执行此操作/)
    await assert.rejects(
      () => workspaces.insertBefore('managed', 'project'),
      /不能执行此操作/
    )
    assert.equal(calls.some(call => call[0] === 'move'), false)

    harness.cleanup()
    assert.equal(uiWorkspace.startSession, nativeStartSession)
    for (const [name, descriptor] of Object.entries(originalDescriptors)) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(workspacesTarget, name), descriptor)
    }
    await workspaces.rename('managed', 'after cleanup')
    assert.deepEqual(calls.at(-1), ['rename', 'managed', 'after cleanup'])
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('does not start a managed session after disposal', async () => {
  const calls = []
  let resolveFetch
  const workspaces = {
    list: {
      getSnapshot() {
        return {
          items: [{ workspaceId: 'managed', path: '/managed', title: '通用会话', sessionIds: [] }]
        }
      }
    },
    async rename() {},
    async delete() {},
    async insertBefore() {},
    async refresh() {}
  }
  const uiWorkspace = {
    startSession(id) {
      calls.push(id)
    }
  }
  const previousFetch = globalThis.fetch
  globalThis.fetch = () => new Promise((resolve) => {
    resolveFetch = resolve
  })

  try {
    const { plugin } = createPlugin()
    const harness = createContext(workspaces, uiWorkspace)
    plugin.apply(harness.ctx)
    const action = harness.registrations[0].options.inject()
    const start = action.onStart()
    harness.cleanup()
    resolveFetch(statusResponse())
    await start
    assert.deepEqual(calls, [])
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('fails closed when the current navigation capability is unavailable', () => {
  const workspaces = {
    list: { getSnapshot() { return { items: [] } } },
    async rename() {},
    async delete() {},
    async insertBefore() {}
  }
  const { plugin } = createPlugin()
  const harness = createContext(workspaces, {})

  assert.throws(
    () => plugin.apply(harness.ctx),
    /incompatible DSH uiWorkspace service: missing startSession\(\)/
  )
})

test('rolls back partial client patches when policy installation fails', () => {
  const workspaces = {
    list: { getSnapshot() { return { items: [] } } },
    async rename() {},
    async delete() {},
    async insertBefore() {}
  }
  const originalRename = workspaces.rename
  const originalDelete = workspaces.delete
  const originalInsertBefore = workspaces.insertBefore
  Object.defineProperty(workspaces, 'delete', {
    configurable: true,
    get() { return originalDelete },
    set() { throw new Error('read-only delete') }
  })
  const { plugin } = createPlugin()
  const harness = createContext(workspaces)

  assert.throws(
    () => plugin.apply(harness.ctx),
    /cannot install the managed Workspace client policy/
  )
  assert.equal(workspaces.rename, originalRename)
  assert.equal(workspaces.delete, originalDelete)
  assert.equal(workspaces.insertBefore, originalInsertBefore)
})

test('resolves icons by capability so both the numeric and the tier-word naming draw', async () => {
  // 回归护栏（DSH 0.1.6 → 0.1.7 图标改名）：旧名字在 0.1.7 里完全不存在，直接解构回来
  // 是 undefined（图标静默变空白）；新名字在 0.1.6 里也不存在。两个方向各测一遍，
  // 哪一边的兜底丢了都必红。名字缺失时 `iconOf` 会给出空组件，断言的类型立刻不符。
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => statusResponse()
  try {
    for (const icons of ['current', 'legacy']) {
      const workspaces = {
        list: { getSnapshot() { return { items: [] } } },
        async rename() {},
        async delete() {},
        async insertBefore() {},
        async refresh() {}
      }
      const { plugin, render, reset, types } = createPlugin({ icons })
      const harness = createContext(workspaces)
      plugin.apply(harness.ctx)
      await settle()
      const registration = harness.registrations[0]

      const wide = render(registration.component, { wide: true, onStart() {} })
      assert.equal(wide.children[0].props.children.children[0].type, types.IconNewChat,
        `${icons}: 默认态必须解析出新建会话图标`)

      reset()
      const failingStart = async () => { throw new Error('status unavailable') }
      let failed = render(registration.component, { wide: true, onStart: failingStart })
      failed.children[0].props.children.props.onClick()
      await settle()
      failed = render(registration.component, { wide: true, onStart: failingStart })
      assert.equal(failed.children[0].props.children.children[0].type, types.IconWarning,
        `${icons}: 失败态必须解析出警告图标`)

      harness.cleanup()
    }
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('installs and removes dedicated sidebar styles', async () => {
  const workspaces = {
    list: { getSnapshot() { return { items: [] } } },
    async rename() {},
    async delete() {},
    async insertBefore() {},
    async refresh() {}
  }
  const fixture = createStyleDocument()
  const previousDocument = globalThis.document
  const previousFetch = globalThis.fetch
  globalThis.document = fixture.document
  globalThis.fetch = async () => statusResponse()

  try {
    const { plugin } = createPlugin()
    const harness = createContext(workspaces)
    plugin.apply(harness.ctx)
    await settle()

    assert.equal(fixture.styles.length, 1)
    assert.equal(fixture.styles[0].id, 'dsh-default-workspace-style')
    // Untagged sheets are claimed by whichever bundle materializes next, and HMR removes
    // style[data-plugin=<id>]: the sheet must declare this plugin as its owner.
    assert.equal(fixture.styles[0].dataset.plugin, 'dsh-default-workspace')
    assert.equal(fixture.styles[0].textContent.includes('.dgw-action-rail .dgw-button'), true)
    harness.cleanup()
    assert.equal(fixture.styles.length, 0)
  } finally {
    globalThis.fetch = previousFetch
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})
