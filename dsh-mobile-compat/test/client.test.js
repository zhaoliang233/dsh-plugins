import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

class FakeElement {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName.toUpperCase()
    this.attributes = new Map(Object.entries(attributes))
    this.children = []
    this.parentElement = null
    this.dataset = {}
    this.textContent = ''
    this.isConnected = true
  }

  get id() { return this.getAttribute('id') || '' }
  set id(value) { this.setAttribute('id', value) }
  get firstElementChild() { return this.children[0] || null }
  get lastElementChild() { return this.children[this.children.length - 1] || null }
  get nextElementSibling() {
    if (this.parentElement === null) return null
    const index = this.parentElement.children.indexOf(this)
    return this.parentElement.children[index + 1] || null
  }

  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  removeAttribute(name) { this.attributes.delete(name) }
  hasAttribute(name) { return this.attributes.has(name) }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  insertBefore(child, before) {
    child.parentElement = this
    const index = this.children.indexOf(before)
    if (index < 0) this.children.push(child)
    else this.children.splice(index, 0, child)
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentElement = null
    return child
  }

  remove() {
    this.parentElement?.removeChild(this)
    this.isConnected = false
  }

  matches(selector) {
    if (selector === '[data-shell-overlay]') return this.hasAttribute('data-shell-overlay')
    const slot = selector.match(/^\[data-slot='([^']+)'\]$/)
    if (slot) return this.getAttribute('data-slot') === slot[1]
    if (selector === 'button[aria-expanded]') return this.tagName === 'BUTTON' && this.hasAttribute('aria-expanded')
    const className = selector.match(/^\.([A-Za-z0-9_-]+)$/)
    if (className) return (this.getAttribute('class') || '').split(/\s+/).includes(className[1])
    return false
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }

  querySelectorAll(selector) {
    return this.descendants().filter((node) => node.matches(selector))
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  closest(selector) {
    let current = this
    while (current !== null) {
      if (current.matches(selector)) return current
      current = current.parentElement
    }
    return null
  }
}

function createShell(valid = true) {
  const frame = new FakeElement('div', { 'data-sidebar-collapsed': '' })
  const sidebar = frame.appendChild(new FakeElement())
  const center = frame.appendChild(new FakeElement())
  const rightbar = frame.appendChild(new FakeElement('div', { 'data-rightbar-col': '' }))
  const overlay = frame.appendChild(new FakeElement('div', { 'data-shell-overlay': '' }))

  const sidebarSeat = sidebar.appendChild(new FakeElement('div', { 'data-slot': 'sidebar' }))
  const sidebarRoot = sidebarSeat.appendChild(new FakeElement())
  const workspaceSeat = sidebarRoot.appendChild(new FakeElement('div', { 'data-slot': 'sidebar.workspaces' }))
  const workspaceRoot = workspaceSeat.appendChild(new FakeElement())
  const workspaceHeader = workspaceRoot.appendChild(new FakeElement())
  const searchSlot = workspaceHeader.appendChild(new FakeElement())
  searchSlot.appendChild(new FakeElement('button', { 'aria-expanded': 'false' }))
  workspaceHeader.appendChild(new FakeElement())

  const mainSeat = center.appendChild(new FakeElement('div', { 'data-slot': 'main' }))
  const conversationPanelSeat = mainSeat.appendChild(new FakeElement('div', { 'data-slot': 'main.conversation' }))
  const conversationRoot = conversationPanelSeat.appendChild(new FakeElement())
  conversationRoot.appendChild(new FakeElement())
  const conversationBody = conversationRoot.appendChild(new FakeElement())
  conversationBody.appendChild(new FakeElement('div', { 'data-conversation-scroll': '' }))
  rightbar.appendChild(new FakeElement('div', { 'data-slot': 'rightbar' }))

  let invalidNode = null
  if (!valid) invalidNode = frame.insertBefore(new FakeElement(), sidebar)
  return { frame, sidebar, center, conversationRoot, rightbar, overlay, workspaceSeat, invalidNode }
}

function makeHarness({ version = '0.1.6-alpha.1', validStructure = true, connectionCapability = true } = {}) {
  let definition
  let runtimeVersion = version
  let currentStyle = null
  const shell = createShell(validStructure)
  const viewport = new FakeElement('meta', { content: 'width=device-width, initial-scale=1' })
  const body = new FakeElement('body')
  const documentElement = new FakeElement('html')
  documentElement.appendChild(body)
  body.appendChild(shell.frame)
  const head = new FakeElement('head')
  head.appendChild = (style) => {
    currentStyle = style
    style.parentElement = head
    style.remove = () => {
      if (currentStyle === style) currentStyle = null
    }
    return style
  }

  const documentListeners = new Map()
  const document = {
    activeElement: null,
    body,
    documentElement,
    head,
    getElementById(id) { return currentStyle?.id === id ? currentStyle : null },
    createElement(tag) { return new FakeElement(tag) },
    querySelector(selector) {
      if (selector === "meta[name='viewport']") return viewport
      return documentElement.querySelector(selector)
    },
    querySelectorAll(selector) { return documentElement.querySelectorAll(selector) },
    addEventListener(name, listener) {
      const listeners = documentListeners.get(name) || new Set()
      listeners.add(listener)
      documentListeners.set(name, listeners)
    },
    removeEventListener(name, listener) { documentListeners.get(name)?.delete(listener) }
  }

  const mediaListeners = new Set()
  const media = {
    matches: true,
    addEventListener(_name, listener) { mediaListeners.add(listener) },
    removeEventListener(_name, listener) { mediaListeners.delete(listener) },
    addListener(listener) { mediaListeners.add(listener) },
    removeListener(listener) { mediaListeners.delete(listener) }
  }
  const window = {
    innerWidth: 390,
    __ModuleLoader__: { load(value) { definition = value } },
    matchMedia() { return media }
  }

  const observers = new Set()
  class MutationObserver {
    constructor(callback) { this.callback = callback }
    observe(root, options) {
      this.root = root
      this.options = options
      observers.add(this)
    }
    disconnect() { observers.delete(this) }
  }

  const warnings = []
  const consoleStub = {
    ...console,
    warn(message) { warnings.push(String(message)) }
  }
  const fetch = async (path) => {
    assert.equal(path, '/dsh-mobile-compat/status')
    return {
      ok: runtimeVersion !== undefined,
      status: runtimeVersion === undefined ? 503 : 200,
      async json() {
        return runtimeVersion === undefined
          ? { ok: false, error: 'version unavailable' }
          : { ok: true, package: '@deepseek-ai/dsh', version: runtimeVersion }
      }
    }
  }
  const animationFrames = []
  const requestAnimationFrame = (callback) => {
    animationFrames.push(callback)
    return animationFrames.length
  }
  const context = vm.createContext({ AbortController, console: consoleStub, document, window, MutationObserver, fetch, requestAnimationFrame })
  vm.runInContext(source, context, { filename: 'client.js' })
  assert.equal(definition.id, 'dsh-mobile-compat')

  const componentEffects = []
  const componentSubscriptions = []
  const layer = new FakeElement()
  shell.overlay.appendChild(layer)
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...(props || {}), children } } },
    useRef() { return { current: layer } },
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
    useEffect(callback) { componentEffects.push(callback) },
    useSyncExternalStore(subscribe, getSnapshot) {
      componentSubscriptions.push(subscribe(() => {}))
      return getSnapshot()
    }
  }
  const primitives = {
    IconCloseOutline16: function IconCloseOutline16() {},
    IconPanelLeftOutline16: function IconPanelLeftOutline16() {}
  }
  const plugin = definition.factory((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected module ${id}`)
  })

  let generation = { id: 1, host: { home: '/tmp' } }
  const generationListeners = new Set()
  const connection = {
    ...(connectionCapability ? {
      generation: {
        getSnapshot() { return generation },
        subscribe(listener) {
          generationListeners.add(listener)
          return () => { generationListeners.delete(listener) }
        }
      }
    } : {}),
    publish(next) {
      if (next === undefined) generation = undefined
      else {
        runtimeVersion = next
        generation = { id: (generation?.id || 0) + 1, host: { home: '/tmp' } }
      }
      for (const listener of [...generationListeners]) listener()
    }
  }

  return {
    body,
    componentEffects,
    componentSubscriptions,
    connection,
    context,
    document,
    flushAnimationFrames() {
      for (const callback of animationFrames.splice(0)) callback()
    },
    getStyle: () => currentStyle,
    media,
    mediaListeners,
    observers,
    plugin,
    shell,
    viewport,
    warnings,
    window
  }
}

function applyPlugin(harness) {
  const fiberDisposers = []
  const localeDisposals = []
  const localeDictionaries = new Map()
  let closeRightbarCalls = 0
  const layout = {
    toggleSidebarCalls: 0,
    closeRightbar() { closeRightbarCalls += 1 },
    toggleSidebar() {
      this.toggleSidebarCalls += 1
      if (harness.shell.frame.hasAttribute('data-sidebar-collapsed')) harness.shell.frame.removeAttribute('data-sidebar-collapsed')
      else harness.shell.frame.setAttribute('data-sidebar-collapsed', '')
    }
  }
  const locale = {
    active: 'en',
    register(namespace, id, dictionary) {
      localeDictionaries.set(`${namespace}:${id}`, dictionary)
      return () => { localeDisposals.push(`${namespace}:${id}`) }
    },
    bind(namespace) { return (key) => localeDictionaries.get(`${namespace}:${this.active}`)?.[key] || key },
    getSnapshot() { return { active: this.active, revision: 0 } },
    subscribe() { return () => { localeDisposals.push('subscription') } }
  }
  let slot = null
  let slotComponent = null
  const ctx = {
    connection: harness.connection,
    layout,
    locale,
    effect(start) {
      const dispose = start()
      if (typeof dispose === 'function') fiberDisposers.push(dispose)
    },
    slots: {
      inject(name, register) {
        assert.equal(name, 'shell.overlay')
        const dispose = register()
        return () => { if (typeof dispose === 'function') dispose() }
      },
      register(options, component) {
        slot = options
        slotComponent = component
        return () => {
          slot = null
          slotComponent = null
          localeDisposals.push('slot')
        }
      }
    }
  }

  harness.plugin.apply(ctx)
  return {
    closeRightbarCalls: () => closeRightbarCalls,
    fiberDisposers,
    layout,
    localeDisposals,
    slot: () => slot,
    slotComponent: () => slotComponent
  }
}

async function flushCompatibility() {
  for (let step = 0; step < 6; step += 1) await Promise.resolve()
}

test('supported runtime installs and cleans static compatibility effects', async () => {
  const harness = makeHarness()
  const applied = applyPlugin(harness)
  await flushCompatibility()

  assert.deepEqual(Array.from(harness.plugin.inject), ['slots', 'layout', 'locale', 'connection'])
  assert.equal(harness.body.hasAttribute('data-dsh-mobile-compat'), true)
  assert.equal(harness.shell.frame.hasAttribute('data-dsh-mobile-shell-compatible'), true)
  assert.equal(harness.shell.workspaceSeat.hasAttribute('data-dsh-mobile-workspaces-compatible'), true)
  assert.equal(harness.shell.conversationRoot.hasAttribute('data-dsh-mobile-conversation-compatible'), true)
  assert.equal(harness.shell.sidebar.getAttribute('id'), 'dsh-mobile-sidebar')
  assert.equal(harness.getStyle().id, 'dsh-mobile-compat-style')
  assert.match(harness.getStyle().textContent, /100dvh/)
  assert.match(harness.getStyle().textContent, /\[data-dsh-mobile-shell-compatible\] > :first-child > \[data-slot='sidebar'\] > :first-child/)
  assert.match(harness.getStyle().textContent, /\[data-dsh-mobile-workspaces-compatible\].+max-width: 92px !important;/s)
  assert.match(harness.getStyle().textContent, /\[data-dsh-mobile-conversation-compatible\] > :first-child:not\(:last-child\) > :first-child > :first-child/)
  assert.doesNotMatch(harness.getStyle().textContent, /\[data-dsh-mobile-conversation-compatible\] > :first-child:not\(:last-child\) > :first-child \{/)
  assert.match(harness.getStyle().textContent, /\.dmc-sidebar-toggle::after/)
  assert.doesNotMatch(harness.getStyle().textContent, /:nth-child\(3\)/)
  assert.doesNotMatch(harness.getStyle().textContent, /:has\(> \[data-conversation-scroll\]\)/)
  assert.match(harness.getStyle().textContent, /min-width: 44px;/)
  assert.match(harness.getStyle().textContent, /\[role='textbox'\]\[aria-multiline='true'\]/)
  assert.equal(harness.viewport.getAttribute('data-dsh-mobile-compat-refs'), '1')
  // Untagged sheets are claimed by whichever bundle materializes next, and HMR removes
  // style[data-plugin=<id>]: the sheet must declare this plugin as its owner.
  assert.equal(harness.getStyle().dataset.plugin, 'dsh-mobile-compat')
  assert.equal(applied.slot().name, 'shell.overlay')

  const tree = applied.slotComponent()()
  const toggle = tree.props.children[1]
  assert.equal(toggle.props['aria-controls'], 'dsh-mobile-sidebar')
  assert.equal(toggle.props['aria-expanded'], false)
  assert.equal(toggle.props['aria-label'], 'Open sidebar')

  const componentDisposers = harness.componentEffects.map((callback) => callback()).filter(Boolean)
  assert.equal(applied.closeRightbarCalls(), 0)
  harness.shell.frame.removeAttribute('data-sidebar-collapsed')
  harness.window.innerWidth = 901
  harness.media.matches = false
  for (const listener of [...harness.mediaListeners]) listener({ matches: false })
  assert.equal(applied.layout.toggleSidebarCalls, 1)
  assert.equal(harness.shell.frame.hasAttribute('data-sidebar-collapsed'), true)

  for (const dispose of componentDisposers.reverse()) dispose()
  for (const dispose of harness.componentSubscriptions.reverse()) dispose()
  for (const dispose of applied.fiberDisposers.reverse()) dispose()

  assert.equal(harness.getStyle(), null)
  assert.equal(harness.body.hasAttribute('data-dsh-mobile-compat'), false)
  assert.equal(harness.shell.frame.hasAttribute('data-dsh-mobile-shell-compatible'), false)
  assert.equal(harness.shell.workspaceSeat.hasAttribute('data-dsh-mobile-workspaces-compatible'), false)
  assert.equal(harness.shell.conversationRoot.hasAttribute('data-dsh-mobile-conversation-compatible'), false)
  assert.equal(harness.shell.sidebar.hasAttribute('id'), false)
  assert.equal(harness.viewport.getAttribute('content'), 'width=device-width, initial-scale=1')
  assert.equal(harness.viewport.hasAttribute('data-dsh-mobile-compat-refs'), false)
  assert.deepEqual(applied.localeDisposals.sort(), [
    'dsh-mobile-compat:en',
    'dsh-mobile-compat:zh',
    'slot',
    'subscription'
  ].sort())
})

test('attribute-only shell changes deactivate and recover compatibility effects', async () => {
  const harness = makeHarness()
  const applied = applyPlugin(harness)
  await flushCompatibility()

  const observer = [...harness.observers][0]
  assert.equal(observer.options.attributes, true)
  assert.equal(observer.options.attributeFilter.includes('data-shell-overlay'), true)
  assert.equal(observer.options.attributeFilter.includes('data-slot'), true)
  assert.equal(observer.options.attributeFilter.includes('aria-expanded'), true)

  harness.shell.overlay.removeAttribute('data-shell-overlay')
  observer.callback([])
  await flushCompatibility()
  assert.equal(harness.getStyle(), null)
  assert.equal(harness.shell.frame.hasAttribute('data-dsh-mobile-shell-compatible'), false)

  harness.shell.overlay.setAttribute('data-shell-overlay', '')
  observer.callback([])
  await flushCompatibility()
  assert.notEqual(harness.getStyle(), null)
  assert.equal(harness.shell.frame.hasAttribute('data-dsh-mobile-shell-compatible'), true)

  for (const dispose of applied.fiberDisposers.reverse()) dispose()
})

test('later same-line versions activate only after runtime capability checks', async () => {
  // alpha.2 is source-verified now; alpha.3 stands in for "same line, not individually verified".
  const harness = makeHarness({ version: '0.1.6-alpha.3' })
  const applied = applyPlugin(harness)
  await flushCompatibility()

  assert.notEqual(harness.getStyle(), null)
  assert.notEqual(applied.slot(), null)
  assert.equal(harness.warnings.some((warning) => /has not been individually verified/.test(warning)), true)

  for (const dispose of applied.fiberDisposers.reverse()) dispose()
})

test('the second source-verified version activates without a warning', async () => {
  const harness = makeHarness({ version: '0.1.6-alpha.2' })
  const applied = applyPlugin(harness)
  await flushCompatibility()

  assert.notEqual(harness.getStyle(), null)
  assert.notEqual(applied.slot(), null)
  assert.equal(harness.warnings.some((warning) => /has not been individually verified/.test(warning)), false)

  for (const dispose of applied.fiberDisposers.reverse()) dispose()
})

test('missing connection generation capability stays inert', async () => {
  const harness = makeHarness({ connectionCapability: false })
  const applied = applyPlugin(harness)
  await flushCompatibility()

  assert.equal(harness.getStyle(), null)
  assert.equal(applied.slot(), null)
  assert.match(harness.warnings[0], /connection\.generation is unavailable/)

  for (const dispose of applied.fiberDisposers.reverse()) dispose()
})

test('runtime version and structure gates fail closed and can recover', async () => {
  const harness = makeHarness({ version: '0.1.6-alpha.0' })
  const applied = applyPlugin(harness)
  await flushCompatibility()

  assert.equal(harness.getStyle(), null)
  assert.equal(applied.slot(), null)
  assert.equal(harness.shell.frame.hasAttribute('data-dsh-mobile-shell-compatible'), false)
  assert.match(harness.warnings[0], /outside the compatible release line/)

  harness.connection.publish('0.1.6-alpha.1')
  await flushCompatibility()
  assert.notEqual(harness.getStyle(), null)
  assert.notEqual(applied.slot(), null)

  harness.connection.publish(undefined)
  await flushCompatibility()
  assert.notEqual(harness.getStyle(), null, 'transient reconnect should not flash back to native layout')

  const decoy = harness.shell.frame.insertBefore(new FakeElement(), harness.shell.sidebar)
  harness.connection.publish('0.1.6-alpha.1')
  await flushCompatibility()
  assert.equal(harness.getStyle(), null)
  assert.equal(applied.slot(), null)
  assert.equal(harness.shell.frame.hasAttribute('data-dsh-mobile-shell-compatible'), false)
  assert.equal(harness.warnings.some((warning) => /shell structure does not match/.test(warning)), true)

  harness.shell.frame.removeChild(decoy)
  harness.connection.publish('0.1.6-alpha.1')
  await flushCompatibility()
  assert.notEqual(harness.getStyle(), null)
  assert.notEqual(applied.slot(), null)

  for (const dispose of applied.fiberDisposers.reverse()) dispose()
  assert.equal(harness.getStyle(), null)
  assert.equal(harness.observers.size, 0)
})

test('incomplete shell mounting stays pending without a false incompatibility warning', async () => {
  const harness = makeHarness()
  const sidebarSeat = harness.shell.sidebar.children[0]
  const sidebarRoot = sidebarSeat.firstElementChild
  sidebarSeat.removeChild(sidebarRoot)
  const applied = applyPlugin(harness)
  await flushCompatibility()

  assert.equal(harness.getStyle(), null)
  assert.equal(applied.slot(), null)
  assert.equal(harness.warnings.some((warning) => /shell structure does not match/.test(warning)), false)

  sidebarSeat.appendChild(sidebarRoot)
  for (const observer of harness.observers) observer.callback([])
  await flushCompatibility()
  assert.notEqual(harness.getStyle(), null)
  assert.notEqual(applied.slot(), null)

  for (const dispose of applied.fiberDisposers.reverse()) dispose()
})

test('invalid exact-version shell never receives partial compatibility CSS', async () => {
  const harness = makeHarness({ validStructure: false })
  const applied = applyPlugin(harness)
  await flushCompatibility()

  assert.equal(harness.getStyle(), null)
  assert.equal(applied.slot(), null)
  assert.equal(harness.body.hasAttribute('data-dsh-mobile-compat'), false)
  assert.equal(harness.viewport.getAttribute('content'), 'width=device-width, initial-scale=1')
  assert.match(harness.warnings[0], /native layout was preserved/)

  for (const dispose of applied.fiberDisposers.reverse()) dispose()
})

test('parks an overlay layer left behind by a previous generation', async () => {
  const harness = makeHarness()
  const staleLayer = new FakeElement('div', { class: 'dmc-layer' })
  harness.shell.overlay.appendChild(staleLayer)
  const applied = applyPlugin(harness)
  await flushCompatibility()

  // The fake DOM does not reconcile React: stamp the live layer with the generation the
  // component rendered, which is what a real commit would have written.
  const liveLayer = harness.shell.overlay.children[0]
  const rendered = applied.slotComponent()()
  liveLayer.setAttribute('class', 'dmc-layer')
  liveLayer.setAttribute('data-dsh-mobile-layer-generation', rendered.props['data-dsh-mobile-layer-generation'])

  harness.flushAnimationFrames()

  assert.equal(staleLayer.hasAttribute('data-dsh-mobile-orphan'), true)
  assert.equal(liveLayer.hasAttribute('data-dsh-mobile-orphan'), false)
  assert.match(harness.getStyle().textContent, /\[data-dsh-mobile-orphan\] \{/)
  assert.match(harness.getStyle().textContent, /pointer-events: none !important;/)

  for (const dispose of applied.fiberDisposers.reverse()) dispose()
})

test('rewrites a stylesheet surviving from a previous bundle generation', async () => {
  const harness = makeHarness()
  const applied = applyPlugin(harness)
  await flushCompatibility()

  harness.getStyle().textContent = '/* previous generation */'
  applyPlugin(harness)
  await flushCompatibility()

  assert.match(harness.getStyle().textContent, /--dmc-mobile-control-size: 44px/)

  for (const dispose of applied.fiberDisposers.reverse()) dispose()
})
