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

const PRIMITIVES = {
  IconChevronDownOutline14: function IconChevronDownOutline14() {
    return null
  },
  Menu: function Menu() {
    return null
  }
}

/** Effects the React stub recorded, so the driver component can be exercised. */
const reactEffects = []

/**
 * Build the bundle's exports with a minimal module resolver.
 * @returns the client half's exported surface.
 */
function loadBundle() {
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    useEffect: (callback, deps) => {
      const cleanup = callback()
      reactEffects.push({ cleanup: typeof cleanup === 'function' ? cleanup : null, deps })
    }
  }
  const require = (id) => {
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return PRIMITIVES
    throw new Error(`unexpected require: ${id}`)
  }
  return definition.factory(require)
}

const bundle = loadBundle()
const {
  DRIVER_ID,
  DRIVER_SLOT,
  MAX_BINDING_RETRIES,
  SCROLL_SELECTOR,
  STORAGE_KEY,
  advanceStall,
  createAutoLoader,
  createPreferenceStore,
  nextAutoLoadAction,
  parseStoredEnabled,
  readerAtBottom,
  windowHead
} = bundle.__test

/**
 * Wait for a condition to hold, giving scheduled work a chance to run.
 * @param predicate - condition to poll.
 * @param timeoutMs - give-up delay.
 * @returns whether the condition held.
 */
async function waitFor(predicate, timeoutMs = 250) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => {
      setTimeout(resolve, 1)
    })
  }
  return predicate()
}

/**
 * Storage stub with programmable failures.
 * @param initial - initial stored value.
 * @returns storage-like object plus its writes.
 */
function createStorage(initial = null) {
  const state = { value: initial, writes: [], failRead: false, failWrite: false }
  return {
    state,
    getItem(key) {
      if (state.failRead) throw new Error('denied')
      return key === STORAGE_KEY ? state.value : null
    },
    setItem(key, value) {
      if (state.failWrite) throw new Error('quota')
      state.writes.push([key, value])
      state.value = value
    }
  }
}

/**
 * Fake scrollport plus the document that exposes it.
 * @param metrics - initial scrollport metrics.
 * @returns the element, the document, and a scroll dispatcher.
 */
function createFakeDocument(metrics = { scrollHeight: 1000, scrollTop: 0, clientHeight: 500 }) {
  const element = { ...metrics }
  const listeners = new Map()
  const document = {
    element,
    head: { appendChild: () => {} },
    createElement: () => ({ dataset: {}, textContent: '' }),
    querySelector: (selector) => (selector === SCROLL_SELECTOR ? element : null),
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener: (type, listener) => {
      const bucket = listeners.get(type)
      if (bucket !== undefined) bucket.delete(listener)
    },
    listenerCount: (type = 'scroll') => listeners.get(type)?.size ?? 0,
    dispatch: (type) => {
      for (const listener of [...(listeners.get(type) ?? [])]) listener()
    },
    scroll: () => {
      for (const listener of [...(listeners.get('scroll') ?? [])]) listener()
    }
  }
  return { element, document }
}

/**
 * Session/sessions stub that pages a fixed-size window backwards.
 * @param options - window size, head position, and whether pages advance.
 * @returns the sessions stub, the session stub, and observable run state.
 */
function createHarness(options = {}) {
  const pageSize = options.pageSize ?? 10
  const resolvableId = options.current ?? 'session-1'
  const state = {
    head: options.startHead ?? 40,
    hasMore: (options.startHead ?? 40) > 0,
    loadingOlder: false,
    pages: 0,
    revision: 0,
    openState: options.openState ?? 'open',
    sessionUnsubscribes: 0
  }
  const listeners = new Set()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  const events = {
    getSnapshot: () => ({
      entries: state.head === null ? [] : [{ event: { seq: state.head } }],
      hasMore: state.hasMore,
      revision: state.revision
    })
  }
  const session = {
    getSnapshot: () => ({
      sessionId: 'session-1',
      openState: state.openState,
      removed: false,
      hasMore: state.hasMore,
      loadingOlder: state.loadingOlder
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        state.sessionUnsubscribes += 1
      }
    },
    loadOlder: () => {
      state.pages += 1
      state.loadingOlder = true
      publish()
      // One page per macrotask, like the real fetch round trip: a run must stay
      // interruptible between pages (a microtask chain would finish it all at once).
      return new Promise((resolve) => {
        setTimeout(() => {
          if (options.advance !== false && typeof state.head === 'number') {
            state.head = Math.max(0, state.head - pageSize)
            state.revision += 1
            if (state.head <= 0) state.hasMore = false
          }
          state.loadingOlder = false
          publish()
          resolve()
        }, 0)
      })
    }
  }
  const harness = { current: { session, eventSource: events } }
  const sessions = {
    // The view hands over the identity; the Controller resolves it only while the
    // Session is retained, so an unknown id is an unretained Session.
    binding: (id) => {
      if (options.missingBinding === true) return undefined
      if (id !== resolvableId) return undefined
      return options.missingCapability === true ? { session: {} } : harness.current
    }
  }
  return { sessions, session, state, harness }
}

// --------------------------------------------------------------- pure decisions

test('resolves the stored preference with the default as the fallback', () => {
  assert.equal(parseStoredEnabled(null), true)
  assert.equal(parseStoredEnabled(undefined), true)
  assert.equal(parseStoredEnabled(''), true)
  assert.equal(parseStoredEnabled('true'), true)
  assert.equal(parseStoredEnabled('on'), true)
  assert.equal(parseStoredEnabled('1'), true)
  assert.equal(parseStoredEnabled('false'), false)
  assert.equal(parseStoredEnabled(' OFF '), false)
  assert.equal(parseStoredEnabled('0'), false)
  assert.equal(parseStoredEnabled('nonsense'), true)
})

test('treats unmeasurable scroll geometry as reading at the bottom', () => {
  assert.equal(readerAtBottom(null), true)
  assert.equal(readerAtBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 500 }), true)
  assert.equal(readerAtBottom({ scrollHeight: 1000, scrollTop: 470, clientHeight: 500 }), true)
  assert.equal(readerAtBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 500 }), false)
  assert.equal(readerAtBottom({ scrollHeight: Number.NaN, scrollTop: 0, clientHeight: 1 }), true)
  assert.equal(readerAtBottom({ scrollHeight: 1000, scrollTop: 436, clientHeight: 500 }, 64), true)
})

test('scores page progress by a moved window head', () => {
  assert.equal(advanceStall(0, 40, 30), 0)
  assert.equal(advanceStall(2, 40, 40), 3)
  assert.equal(advanceStall(2, 40, 41), 3)
  assert.equal(advanceStall(2, null, 40), 2)
  assert.equal(advanceStall(2, 40, null), 2)
})

test('decides the next auto-load action from the Session snapshot', () => {
  const base = {
    enabled: true,
    openState: 'open',
    removed: false,
    hasMore: true,
    loadingOlder: false,
    atBottom: true,
    readerScrolled: false,
    stalled: 0,
    maxStalled: 3
  }
  assert.equal(nextAutoLoadAction(base), 'page')
  assert.equal(nextAutoLoadAction({ ...base, enabled: false }), 'idle')
  assert.equal(nextAutoLoadAction({ ...base, openState: 'cold' }), 'wait')
  assert.equal(nextAutoLoadAction({ ...base, openState: 'loading' }), 'wait')
  assert.equal(nextAutoLoadAction({ ...base, openState: 'error' }), 'wait')
  assert.equal(nextAutoLoadAction({ ...base, removed: true }), 'idle')
  assert.equal(nextAutoLoadAction({ ...base, hasMore: false }), 'done')
  assert.equal(nextAutoLoadAction({ ...base, loadingOlder: true }), 'wait')
  // Away from the bottom only defers once the reader drives the viewport...
  assert.equal(nextAutoLoadAction({ ...base, atBottom: false }), 'page')
  assert.equal(nextAutoLoadAction({ ...base, atBottom: false, readerScrolled: true }), 'defer')
  // ...and a reader at the bottom keeps paging regardless.
  assert.equal(nextAutoLoadAction({ ...base, readerScrolled: true }), 'page')
  assert.equal(nextAutoLoadAction({ ...base, stalled: 3 }), 'idle')
  assert.equal(nextAutoLoadAction({ ...base, stalled: 2 }), 'page')
})

test('reads the window head defensively', () => {
  assert.equal(windowHead(undefined), null)
  assert.equal(windowHead({}), null)
  assert.equal(windowHead({ getSnapshot: () => ({ entries: [] }) }), null)
  assert.equal(windowHead({ getSnapshot: () => ({ entries: [{ event: { seq: 7 } }] }) }), 7)
  assert.equal(windowHead({
    getSnapshot: () => {
      throw new Error('unreadable')
    }
  }), null)
})

// -------------------------------------------------------------- preference store

test('persists and publishes the preference', () => {
  const storage = createStorage()
  const store = createPreferenceStore(storage)
  assert.equal(store.get(), true)
  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications += 1
  })
  store.set(false)
  assert.equal(store.get(), false)
  assert.deepEqual(storage.state.writes, [[STORAGE_KEY, 'false']])
  assert.equal(notifications, 1)
  store.set(false)
  assert.equal(notifications, 1)
  store.set(true)
  assert.equal(notifications, 2)
  unsubscribe()
  store.set(false)
  assert.equal(notifications, 2)
})

test('keeps working when client storage is unavailable or denied', () => {
  const withoutStorage = createPreferenceStore(null)
  assert.equal(withoutStorage.get(), true)

  const deniedRead = createStorage()
  deniedRead.state.failRead = true
  assert.equal(createPreferenceStore(deniedRead).get(), true)

  const deniedWrite = createStorage('false')
  deniedWrite.state.failWrite = true
  const store = createPreferenceStore(deniedWrite)
  assert.equal(store.get(), false)
  store.set(true)
  assert.equal(store.get(), true)
  assert.deepEqual(deniedWrite.state.writes, [])
})

test('reloads an externally changed preference', () => {
  const storage = createStorage('true')
  const store = createPreferenceStore(storage)
  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })
  storage.state.value = 'false'
  store.reload()
  assert.equal(store.get(), false)
  assert.equal(notifications, 1)
  store.reload()
  assert.equal(notifications, 1)
})

// ---------------------------------------------------------------- history loader

test('pages the whole history in for the viewed Session', async () => {
  const { sessions, state } = createHarness({ startHead: 40, pageSize: 10 })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => null
  })
  loader.start()
  loader.attach('session-1')
  assert.equal(await waitFor(() => state.hasMore === false), true)
  assert.equal(state.pages, 4)
  assert.equal(state.sessionUnsubscribes, 0)
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, 4)
  loader.dispose()
  assert.equal(state.sessionUnsubscribes, 1)
})

test('stays idle while the preference is off and resumes when it turns on', async () => {
  const { sessions, state } = createHarness({ startHead: 20, pageSize: 10 })
  const storage = createStorage('false')
  const preference = createPreferenceStore(storage)
  const loader = createAutoLoader({ sessions, preference, documentRef: () => null })
  loader.start()
  loader.attach('session-1')
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, 0)
  preference.set(true)
  assert.equal(await waitFor(() => state.hasMore === false), true)
  assert.equal(state.pages, 2)
  loader.dispose()
})

test('stops paging when the preference turns off mid-run', async () => {
  const { sessions, state } = createHarness({ startHead: 4000, pageSize: 10 })
  const preference = createPreferenceStore(createStorage())
  const loader = createAutoLoader({ sessions, preference, documentRef: () => null })
  loader.start()
  loader.attach('session-1')
  assert.equal(await waitFor(() => state.pages >= 1), true)
  preference.set(false)
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  const settled = state.pages
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, settled)
  loader.dispose()
})

test('defers once the reader drives the viewport away and resumes on return', async () => {
  const { sessions, state } = createHarness({ startHead: 200, pageSize: 10 })
  const { element, document } = createFakeDocument({ scrollHeight: 1000, scrollTop: 500, clientHeight: 500 })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => document
  })
  loader.start()
  loader.attach('session-1')
  assert.equal(await waitFor(() => state.pages >= 2), true)
  // The reader drives the viewport away from the bottom: paging yields.
  element.scrollTop = 0
  document.dispatch('wheel')
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  const paused = state.pages
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, paused)
  assert.equal(document.listenerCount('scroll'), 1)
  // Returning to the bottom resumes.
  element.scrollTop = 500
  document.scroll()
  assert.equal(await waitFor(() => state.pages > paused), true)
  assert.equal(document.listenerCount('scroll'), 0)
  loader.dispose()
})

test('keeps paging while the viewport is away from the bottom but the reader never scrolled', async () => {
  // The Conversation places the viewport itself when a Session opens, and DSH keeps
  // compensating while pages land; neither is a reason to stop before the window
  // covers the whole history (the reader should not have to scroll to trigger it).
  const { sessions, state } = createHarness({ startHead: 20, pageSize: 10 })
  const { document } = createFakeDocument({ scrollHeight: 1000, scrollTop: 0, clientHeight: 500 })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => document
  })
  loader.start()
  loader.attach('session-1')
  assert.equal(await waitFor(() => state.hasMore === false), true)
  assert.equal(state.pages, 2)
  assert.equal(document.listenerCount('scroll'), 0)
  loader.dispose()
})

test('a fresh attach starts without inherited reader intent', async () => {
  const { sessions, state } = createHarness({ startHead: 20, pageSize: 10 })
  const { element, document } = createFakeDocument({ scrollHeight: 1000, scrollTop: 500, clientHeight: 500 })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => document
  })
  loader.start()
  loader.attach('session-1')
  assert.equal(await waitFor(() => state.hasMore === false), true)
  // The reader drives the viewport away from the bottom in this Session...
  element.scrollTop = 0
  document.dispatch('wheel')
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  // ...and the next view (same id, new generation) starts with a clean slate: its
  // viewport placement is the Conversation's again, so paging continues.
  state.hasMore = true
  state.head = 40
  loader.detach('session-1')
  loader.attach('session-1')
  assert.equal(await waitFor(() => state.hasMore === false), true)
  loader.dispose()
})

test('gives up after pages that never extend the window', async () => {
  const { sessions, state } = createHarness({ startHead: 40, advance: false })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => null
  })
  loader.start()
  loader.attach('session-1')
  assert.equal(await waitFor(() => state.pages >= 3), true)
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, 3)
  loader.dispose()
})

test('waits for an open Session before paging', async () => {
  const { sessions, state } = createHarness({ startHead: 20, pageSize: 10, openState: 'cold' })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => null
  })
  loader.start()
  loader.attach('session-1')
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, 0)
  state.openState = 'open'
  loader.drive()
  assert.equal(await waitFor(() => state.hasMore === false), true)
  assert.equal(state.pages, 2)
  loader.dispose()
})

test('stays inert when the Session face lacks the audited capability', async () => {
  const { sessions, state } = createHarness({ missingCapability: true })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => null
  })
  assert.doesNotThrow(() => loader.start())
  assert.doesNotThrow(() => loader.attach('session-1'))
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, 0)
  loader.dispose()
})

test('retries a Session binding the view painted ahead of, then gives up', async () => {
  const { sessions, state } = createHarness({ startHead: 20, pageSize: 10, missingBinding: true })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => null
  })
  loader.start()
  loader.attach('session-1')
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, 0)
  assert.equal(await waitFor(() => state.pages === 0, 50), true)
  loader.dispose()
  assert.equal(MAX_BINDING_RETRIES > 0, true)
})

test('follows the identity the view hands over, not a stored selection', async () => {
  const { sessions, state } = createHarness({ startHead: 20, pageSize: 10, current: 'session-2' })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => null
  })
  loader.start()
  // The unretained identity resolves to nothing, so nothing is paged.
  loader.attach('session-1')
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, 0)
  // Switching the view to the retained Session starts the run.
  loader.attach('session-2')
  assert.equal(await waitFor(() => state.hasMore === false), true)
  assert.equal(state.pages, 2)
  // The unmount of the replaced view must not unbind the Session that replaced it.
  loader.detach('session-1')
  assert.equal((await waitFor(() => state.pages === 2, 20)), true)
  loader.dispose()
})

test('survives a rejected page and a throwing loadOlder', async () => {
  const listeners = new Set()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  let pages = 0
  const session = {
    getSnapshot: () => ({
      sessionId: 'session-1',
      openState: 'open',
      removed: false,
      hasMore: true,
      loadingOlder: false
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    loadOlder: () => {
      pages += 1
      if (pages === 1) return Promise.reject(new Error('transport'))
      throw new Error('synchronous failure')
    }
  }
  const sessions = {
    binding: (id) => (id === 'session-1'
      ? { session, eventSource: { getSnapshot: () => ({ entries: [{ event: { seq: 40 } }] }) } }
      : undefined)
  }
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => null
  })
  loader.start()
  loader.attach('session-1')
  assert.equal(await waitFor(() => pages >= 3), true)
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(pages, 3)
  loader.dispose()
})

test('rebinds when the Session face behind the current id is replaced', async () => {
  const { sessions, state, harness } = createHarness({ startHead: 20, pageSize: 10 })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => null
  })
  loader.start()
  loader.attach('session-1')
  assert.equal(await waitFor(() => state.hasMore === false), true)
  assert.equal(state.pages, 2)

  // A reopened Session mints a new face for the same id; the loader must follow it.
  const replacementListeners = new Set()
  let replacementPages = 0
  state.hasMore = true
  harness.current = {
    session: {
      getSnapshot: () => ({
        sessionId: 'session-1',
        openState: 'open',
        removed: false,
        hasMore: true,
        loadingOlder: false
      }),
      subscribe: (listener) => {
        replacementListeners.add(listener)
        return () => replacementListeners.delete(listener)
      },
      loadOlder: () => {
        replacementPages += 1
        return Promise.resolve()
      }
    },
    eventSource: { getSnapshot: () => ({ entries: [{ event: { seq: 10 } }] }) }
  }
  loader.drive()
  assert.equal(state.sessionUnsubscribes, 1)
  assert.equal(await waitFor(() => replacementPages >= 1), true)
  loader.dispose()
})

test('a fresh enable gives the run its stall budget back', async () => {
  const { sessions, state } = createHarness({ startHead: 40, advance: false })
  const preference = createPreferenceStore(createStorage())
  const loader = createAutoLoader({ sessions, preference, documentRef: () => null })
  loader.start()
  loader.attach('session-1')
  assert.equal(await waitFor(() => state.pages >= 3), true)
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, 3)
  preference.set(false)
  preference.set(true)
  assert.equal(await waitFor(() => state.pages >= 6), true)
  loader.dispose()
})

test('stops reacting once disposed', async () => {
  const { sessions, state } = createHarness({ startHead: 200, pageSize: 10 })
  const loader = createAutoLoader({
    sessions,
    preference: createPreferenceStore(createStorage()),
    documentRef: () => null
  })
  loader.start()
  loader.attach('session-1')
  assert.equal(await waitFor(() => state.pages >= 1), true)
  loader.dispose()
  const settled = state.pages
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
  assert.equal(state.pages, settled)
  assert.doesNotThrow(() => loader.drive())
})

// ---------------------------------------------------------------------- mounting

/**
 * Run the bundle's apply against fake client services and a fake document.
 * @returns what the mount created, registered, and disposed.
 */
function mountBundle() {
  const created = []
  const effects = []
  const disposers = []
  const registrations = []
  const dictionaryCalls = []
  const injectedSlots = []
  const previousDocument = globalThis.document
  globalThis.document = {
    head: { appendChild: (tag) => created.push(tag) },
    createElement: () => ({ dataset: {}, textContent: '' }),
    querySelector: () => null
  }
  const ctx = {
    slots: {
      inject: (key, callback) => {
        injectedSlots.push(key)
        callback()
        return () => {}
      },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      }
    },
    sessions: {
      binding: () => undefined
    },
    locale: {
      register: (ns, dicts) => {
        dictionaryCalls.push({ ns, dicts })
        return () => {}
      }
    },
    effect: (callback, label) => {
      effects.push(label)
      const disposer = callback()
      const finalDisposer = typeof disposer === 'function' ? disposer : () => {}
      disposers.push(finalDisposer)
      return finalDisposer
    }
  }
  try {
    bundle.apply(ctx)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
  return { created, effects, disposers, registrations, dictionaryCalls, injectedSlots }
}

test('exports a client plugin that mounts the loader and the preference row', () => {
  assert.deepEqual(bundle.inject, ['slots', 'sessions', 'locale'])
  assert.equal(typeof bundle.apply, 'function')
  assert.equal(definition.id, 'dsh-auto-load-history')

  const { created, effects, disposers, registrations, dictionaryCalls, injectedSlots } = mountBundle()
  assert.equal(created.length, 1)
  assert.equal(created[0].dataset.plugin, 'dsh-auto-load-history')
  assert.match(created[0].dataset.pluginCss, /^dsh-auto-load-history\//u)
  assert.match(created[0].textContent, /dshalh_selector/u)
  assert.equal(dictionaryCalls.length, 1)
  assert.equal(dictionaryCalls[0].ns, 'dsh-auto-load-history')
  assert.equal(typeof dictionaryCalls[0].dicts.zh['row.title'], 'string')
  assert.equal(typeof dictionaryCalls[0].dicts.en['row.title'], 'string')
  assert.deepEqual(effects, [
    'dsh-auto-load-history: styles',
    'dsh-auto-load-history: dictionaries',
    'dsh-auto-load-history: history loader',
    'dsh-auto-load-history: preference sync'
  ])
  assert.deepEqual(injectedSlots, [DRIVER_SLOT, 'settings.general.item'])
  assert.equal(registrations.length, 2)
  const driver = registrations.find((registration) => registration.options.name === DRIVER_SLOT)
  assert.equal(driver.options.id, DRIVER_ID)
  assert.equal(driver.options.order, 0)
  const row = registrations.find((registration) => registration.options.name === 'settings.general.item')
  assert.equal(row.options.id, 'dsh-auto-load-history')
  assert.equal(row.options.order, 13)
  assert.equal(row.options.locale, 'dsh-auto-load-history')
  const injected = row.options.inject()
  assert.equal(injected.getEnabled(), true)
  assert.equal(typeof injected.subscribeEnabled, 'function')
  assert.equal(typeof injected.setEnabled, 'function')
  for (const disposer of disposers) disposer()
})

test('drives paging from the Session identity the view hands over', () => {
  const { registrations, disposers } = mountBundle()
  const driver = registrations.find((registration) => registration.options.name === DRIVER_SLOT)
  const handles = driver.options.inject()
  assert.equal(typeof handles.attach, 'function')
  assert.equal(typeof handles.detach, 'function')
  reactEffects.length = 0
  assert.equal(driver.component({ sessionId: 'session-9', ...handles }), null)
  assert.equal(reactEffects.length, 1)
  assert.deepEqual(reactEffects[0].deps, ['session-9', handles.attach, handles.detach])
  assert.doesNotThrow(() => reactEffects[0].cleanup())
  reactEffects.length = 0
  for (const disposer of disposers) disposer()
})

test('renders the preference row through the shipped settings chrome', () => {
  const { registrations, disposers } = mountBundle()
  const row = registrations.find((registration) => registration.options.name === 'settings.general.item')
  const element = row.component({
    getEnabled: () => true,
    subscribeEnabled: () => () => {},
    setEnabled: () => {},
    t: (key) => key
  })
  assert.equal(element.props['data-dsh-auto-load-history-row'], '')
  assert.equal(element.children[0].children[0].children[0], 'row.title')
  assert.equal(element.children[0].children[1].children[0], 'row.description')
  assert.equal(element.children[1].props.selectedId, 'on')
  assert.deepEqual(element.children[1].props.items, [
    { id: 'on', label: 'row.option.automatic' },
    { id: 'off', label: 'row.option.manual' }
  ])
  assert.equal(element.children[1].props.anchor.props.className, 'dshalh_selector')
  for (const disposer of disposers) disposer()
})
