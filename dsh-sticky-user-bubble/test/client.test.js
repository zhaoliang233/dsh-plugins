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

class FakeElement {
  constructor(tagName = 'div', rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) {
    this.tagName = tagName.toUpperCase()
    this.rect = { ...rect }
    this.children = []
    this.parentElement = null
    this.style = {}
    this.computed = {}
    this._attributes = new Map()
    this.listeners = new Map()
    this.textContent = ''
    this.scrollTop = 0
    this.scrollHeight = 0
    this.ownerDocument = null
    this.lastScrollTo = null
    this.lastScrollIntoView = null
  }

  get firstElementChild() {
    return this.children[0]
  }

  get firstChild() {
    return this.children[0]
  }

  get childNodes() {
    return this.children
  }

  get attributes() {
    return [...this._attributes].map(([name, value]) => ({ name, value }))
  }

  appendChild(child) {
    if (child.parentElement !== null && child.parentElement !== this) {
      child.parentElement.removeChild(child)
    }
    child.parentElement = this
    if (!this.children.includes(child)) this.children.push(child)
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
      child.parentElement = null
    }
    return child
  }

  setAttribute(name, value) {
    this._attributes.set(String(name).toLowerCase(), String(value))
  }

  getAttribute(name) {
    return this._attributes.get(String(name).toLowerCase()) ?? null
  }

  removeAttribute(name) {
    this._attributes.delete(String(name).toLowerCase())
  }

  matches(selector) {
    if (selector === '*') return true
    if (!selector.startsWith('[')) return this.tagName.toLowerCase() === selector.toLowerCase()
    const name = selector.slice(1, -1).split('=')[0]
    return this._attributes.has(name.toLowerCase())
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector) {
    const result = []
    const visit = (element) => {
      for (const child of element.children) {
        if (selector === '*' || child.matches(selector)) result.push(child)
        visit(child)
      }
    }
    visit(this)
    return result
  }

  contains(candidate) {
    if (candidate === this) return true
    return this.children.some((child) => child.contains(candidate))
  }

  getBoundingClientRect() {
    return { ...this.rect }
  }

  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }

  removeEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? []
    this.listeners.set(name, listeners.filter((value) => value !== listener))
  }

  dispatch(name, init = {}) {
    const event = {
      currentTarget: this,
      target: this,
      defaultPrevented: false,
      propagationStopped: false,
      ...init,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this.propagationStopped = true }
    }
    for (const listener of this.listeners.get(name) ?? []) listener(event)
    return event
  }

  scrollTo(options) {
    this.lastScrollTo = { ...options }
    this.scrollTop = options.top
  }

  scrollIntoView(options) {
    this.lastScrollIntoView = { ...options }
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName, this.rect)
    clone.style = { ...this.style }
    clone.computed = { ...this.computed }
    clone.textContent = this.textContent
    clone.scrollHeight = this.scrollHeight
    clone.ownerDocument = this.ownerDocument
    for (const [name, value] of this._attributes) clone.setAttribute(name, value)
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true))
    return clone
  }
}

function element(rect, attrs = {}) {
  const value = new FakeElement('div', rect)
  for (const [name, attribute] of Object.entries(attrs)) value.setAttribute(name, attribute)
  return value
}

function createReactRuntime() {
  const hooks = []
  let cursor = 0
  const effects = []

  function sameDeps(left, right) {
    return left !== undefined
      && right !== undefined
      && left.length === right.length
      && left.every((value, index) => Object.is(value, right[index]))
  }

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useRef(initial) {
      const index = cursor++
      hooks[index] ??= { current: initial }
      return hooks[index]
    },
    useCallback(callback, deps) {
      const index = cursor++
      const previous = hooks[index]
      if (previous === undefined || !sameDeps(previous.deps, deps)) hooks[index] = { callback, deps }
      return hooks[index].callback
    },
    useEffect(factory, deps) {
      const index = cursor++
      const previous = hooks[index]
      if (previous === undefined || !sameDeps(previous.deps, deps)) {
        hooks[index] = { deps }
        effects.push(factory)
      }
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor++
      if (hooks[index] === undefined) {
        hooks[index] = { unsubscribe: subscribe(() => {}) }
      }
      return getSnapshot()
    }
  }

  return {
    React,
    render(Component, props) {
      cursor = 0
      effects.length = 0
      const tree = Component(props)
      return { tree, effects: [...effects] }
    }
  }
}

function createEventTarget() {
  const listeners = new Map()
  return {
    addEventListener(name, listener) {
      const values = listeners.get(name) ?? []
      values.push(listener)
      listeners.set(name, values)
    },
    removeEventListener(name, listener) {
      const values = listeners.get(name) ?? []
      listeners.set(name, values.filter((value) => value !== listener))
    },
    dispatch(name) {
      for (const listener of listeners.get(name) ?? []) listener({ type: name })
    },
    listenerCount(name) {
      return (listeners.get(name) ?? []).length
    }
  }
}

function createObserverHarness() {
  const instances = []
  class Observer {
    constructor(callback) {
      this.callback = callback
      this.observed = []
      this.disconnected = false
      instances.push(this)
    }
    observe(target, options = {}) {
      this.observed.push({ target, options })
    }
    unobserve(target) {
      this.observed = this.observed.filter((entry) => entry.target !== target)
    }
    disconnect() {
      this.disconnected = true
      this.observed = []
    }
    trigger(records = []) {
      this.callback(records)
    }
  }
  return { Observer, instances }
}

function createBrowserDom({ withFonts = false, withHoverRoot = true } = {}) {
  const overlay = element({ left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900 })
  const host = element({ left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900 })
  const scroll = element({ left: 0, top: 100, right: 1000, bottom: 800, width: 1000, height: 700 })
  const scrollInner = element({ left: 0, top: 100, right: 1000, bottom: 800, width: 1000, height: 700 })
  scrollInner.computed.paddingTop = '16px'
  const flow = element({ left: 100, top: 116, right: 900, bottom: 700, width: 800, height: 584 }, { 'data-chat-flow': '' })
  const row = element({ left: 100, top: 80, right: 900, bottom: 150, width: 800, height: 70 }, {
    'data-chat-anchor-key': 'u1',
    'data-chat-flow-key': 'u1',
    'data-chat-flow-kind': 'user'
  })
  const hoverRoot = element({ left: 100, top: 80, right: 900, bottom: 150, width: 800, height: 70 }, { 'data-time-hover-root': '' })
  const stack = element({ left: 600, top: 80, right: 900, bottom: 150, width: 300, height: 70 })
  const bubble = element({ left: 600, top: 80, right: 900, bottom: 120, width: 300, height: 40 })
  bubble.textContent = 'hello from the user'
  bubble.computed = {
    backgroundColor: 'rgb(240, 241, 244)',
    backgroundImage: 'none',
    borderTopLeftRadius: '22px',
    borderTopRightRadius: '22px',
    borderBottomLeftRadius: '22px',
    borderBottomRightRadius: '22px',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    boxSizing: 'content-box',
    background: 'rgb(240, 241, 244)',
    color: 'rgb(32, 33, 36)',
    border: '0px none rgb(0, 0, 0)',
    borderRadius: '22px',
    padding: '10px 16px',
    fontFamily: 'system-ui',
    fontSize: '16px',
    fontWeight: '400',
    fontStyle: 'normal',
    lineHeight: '24px',
    letterSpacing: 'normal',
    textAlign: 'start',
    wordBreak: 'normal',
    display: 'block',
    writingMode: 'horizontal-tb',
    overflow: 'visible',
    overflowX: 'visible',
    overflowY: 'visible',
    boxShadow: 'none'
  }
  bubble.setAttribute('id', 'original-bubble')
  bubble.setAttribute('aria-describedby', 'original-help')
  bubble.setAttribute('data-chat-flow-key', 'u1')
  const link = new FakeElement('a', { left: 610, top: 90, right: 700, bottom: 110, width: 90, height: 20 })
  link.setAttribute('id', 'reference')
  link.setAttribute('href', '/reference')
  link.setAttribute('tabindex', '0')
  link.textContent = 'reference'
  bubble.appendChild(link)
  stack.appendChild(bubble)
  if (withHoverRoot) {
    hoverRoot.appendChild(stack)
    row.appendChild(hoverRoot)
  } else {
    row.appendChild(stack)
  }
  flow.appendChild(row)
  scrollInner.appendChild(flow)
  scroll.appendChild(scrollInner)

  const html = element({ left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900 })
  const head = element({ left: 0, top: 0, right: 1200, bottom: 0, width: 1200, height: 1 })
  const body = element({ left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900 })
  html.appendChild(head)
  html.appendChild(body)
  body.appendChild(scroll)
  body.appendChild(overlay)
  overlay.appendChild(host)

  const fontEvents = createEventTarget()
  const document = {
    body,
    head,
    documentElement: html,
    contentScrollHeight: 20,
    contentRect: { left: 616, top: 126, right: 884, bottom: 146, width: 268, height: 20 },
    lineRects: [],
    wholeRangeRect: null,
    createElement(tagName) {
      const value = new FakeElement(tagName, document.contentRect)
      value.ownerDocument = document
      value.scrollHeight = document.contentScrollHeight
      return value
    },
    createTreeWalker() {
      let emitted = false
      return {
        nextNode() {
          if (emitted) return null
          emitted = true
          return { nodeValue: 'fixture text' }
        }
      }
    },
    createRange() {
      let selected
      return {
        selectNodeContents(node) { selected = node },
        getClientRects() {
          const aggregate = selected instanceof FakeElement && document.wholeRangeRect !== null
            ? [document.wholeRangeRect]
            : []
          return [...aggregate, ...document.lineRects].map((rect) => ({ ...rect }))
        },
        detach() {}
      }
    },
    querySelectorAll(selector) {
      return selector === '[data-conversation-scroll]' ? [scroll] : []
    }
  }
  if (withFonts) document.fonts = fontEvents
  for (const value of [html, head, body, overlay, host, scroll, scrollInner, flow, row, hoverRoot, stack, bubble, link]) {
    value.ownerDocument = document
  }

  const windowEvents = createEventTarget()
  const visualViewport = createEventTarget()
  const window = {
    ...windowEvents,
    visualViewport,
    getComputedStyle(target) {
      return {
        paddingTop: '0px',
        paddingRight: '0px',
        paddingBottom: '0px',
        paddingLeft: '0px',
        borderTopWidth: '0px',
        borderRightWidth: '0px',
        borderBottomWidth: '0px',
        borderLeftWidth: '0px',
        display: 'block',
        writingMode: 'horizontal-tb',
        overflow: 'visible',
        overflowX: 'visible',
        overflowY: 'visible',
        ...target.computed,
        ...target.style
      }
    },
    requestAnimationFrame(callback) {
      window.frames.push(callback)
      return window.frames.length
    },
    cancelAnimationFrame() {},
    frames: []
  }
  const mutationHarness = createObserverHarness()
  const resizeHarness = createObserverHarness()
  return {
    window,
    document,
    body,
    head,
    flow,
    row,
    link,
    scroll,
    bubble,
    overlay,
    host,
    fontEvents,
    mutationObservers: mutationHarness.instances,
    resizeObservers: resizeHarness.instances,
    MutationObserver: mutationHarness.Observer,
    ResizeObserver: resizeHarness.Observer,
    setContentMeasurement({ height, lineRects = [], width = 268, wholeRangeRect = null }) {
      document.contentScrollHeight = height
      document.contentRect = {
        left: 616,
        top: 126,
        right: 616 + width,
        bottom: 126 + height,
        width,
        height
      }
      document.lineRects = lineRects
      document.wholeRangeRect = wholeRangeRect
    },
    flushFrames() {
      let rounds = 0
      while (window.frames.length > 0 && rounds < 20) {
        const frames = window.frames.splice(0)
        for (const callback of frames) callback()
        rounds += 1
      }
      assert.ok(rounds < 20, 'animation frame scheduler must settle')
    }
  }
}

function installBrowserGlobals(dom) {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    ResizeObserver: globalThis.ResizeObserver
  }
  globalThis.window = dom.window
  globalThis.document = dom.document
  globalThis.MutationObserver = dom.MutationObserver
  globalThis.ResizeObserver = dom.ResizeObserver
  return () => {
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.MutationObserver = previous.MutationObserver
    globalThis.ResizeObserver = previous.ResizeObserver
  }
}

function createSnapshotSource(snapshot) {
  const listeners = new Set()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return snapshot
    },
    listenerCount() {
      return listeners.size
    }
  }
}

function mountSticky(dom, text = 'hello from the user', options = {}) {
  const runtime = createReactRuntime()
  const component = { React: runtime.React, value: undefined }
  const currentChat = options.chatSnapshot ?? (options.currentChat ? {
    order: ['u1'],
    nodes: {
      get(key) {
        return key === 'u1'
          ? { key: 'u1', kind: 'user', data: { content: [{ type: 'text', text }] } }
          : undefined
      }
    }
  } : undefined)
  const chatSource = options.chatSource
    ?? (currentChat === undefined ? undefined : createSnapshotSource(currentChat))
  const binding = {
    session: {
      subscribe() { return () => {} },
      getSnapshot() {
        const snapshot = {
          sessionId: 'session-a',
          openState: options.sessionState?.openState ?? 'open',
          removed: options.sessionState?.removed ?? false
        }
        if (currentChat === undefined) {
          snapshot.chat = {
            order: ['u1'],
            nodes: {
              get(key) {
                return key === 'u1'
                  ? { key: 'u1', kind: 'user', data: { content: [{ type: 'text', text }] } }
                  : undefined
              }
            }
          }
        }
        return snapshot
      }
    }
  }
  const sessions = {
    binding(id) {
      assert.equal(id, 'session-a')
      return binding
    }
  }
  const uiConversation = chatSource === undefined ? undefined : {
    binding(value) {
      assert.equal(value, 'session-a')
      return {
        target(name) {
          assert.equal(name, 'chat')
          return chatSource
        }
      }
    }
  }
  const slots = {
    inject(_name, callback) { callback() },
    register(_options, entry) {
      component.value = entry
      return () => {}
    }
  }
  const plugin = definition.factory(() => runtime.React)
  const context = { slots, sessions }
  if (uiConversation !== undefined) context.uiConversation = uiConversation
  plugin.apply(context)
  const rendered = runtime.render(component.value, {
    useSessions(selector) { return selector(options.sessionList ?? { current: 'session-a' }) }
  })
  rendered.tree.props.ref.current = dom.overlay
  rendered.tree.children[0].props.ref.current = dom.host
  const cleanups = rendered.effects.map((factory) => factory()).filter((value) => typeof value === 'function')
  dom.flushFrames()
  return {
    cleanup() {
      for (const cleanup of cleanups.reverse()) cleanup()
    },
    rendered,
    chatSource
  }
}

test('registers one additive shell overlay with the required services', () => {
  const React = { createElement() {} }
  const component = { React }
  const registrations = []
  const slots = {
    inject(name, callback) {
      assert.equal(name, 'shell.overlay')
      registrations.push(callback())
    },
    register(options, entry) {
      registrations.push({ options, entry })
      return () => {}
    }
  }
  const sessions = { binding() { return undefined } }
  const plugin = definition.factory((specifier) => {
    assert.equal(specifier, 'react')
    return React
  })

  plugin.apply({ slots, sessions })

  assert.deepEqual(plugin.inject, ['slots', 'sessions', 'uiConversation'])
  assert.deepEqual(registrations[0].options, {
    name: 'shell.overlay',
    id: 'dsh-sticky-user-bubble',
    order: 0
  })
  assert.equal(typeof registrations[0].entry, 'function')
})

test('uses the 0.1.6-alpha.1 Chat target and finds a bubble without the legacy hover root', () => {
  const dom = createBrowserDom({ withHoverRoot: false })
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    dom.bubble.removeAttribute('data-chat-flow-key')
    mounted = mountSticky(dom, 'hello from the user', { currentChat: true })

    assert.ok(mounted.chatSource)
    assert.equal(mounted.chatSource.listenerCount(), 1)
    assert.ok(dom.host.firstChild)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
    assert.equal(dom.host.firstChild.style.background, 'rgb(240, 241, 244)')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('keeps an independent Chat target inactive when the session snapshot is closed', () => {
  const dom = createBrowserDom({ withHoverRoot: false })
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    mounted = mountSticky(dom, 'hello from the user', {
      currentChat: true,
      sessionState: { openState: 'closed' }
    })
    assert.equal(dom.host.firstChild, undefined)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'inactive-snapshot')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('resolves the current session from mainView retention when the list drops its current cell', () => {
  // DSH 0.1.6-alpha.2 removed SessionListState.current; the shell now derives the
  // main-view Session from the retention counts instead.
  const dom = createBrowserDom({ withHoverRoot: false })
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    mounted = mountSticky(dom, 'hello from the user', {
      currentChat: true,
      sessionList: {
        ids: ['session-b', 'session-a'],
        byId: {
          'session-b': { id: 'session-b', retainedBy: { mainView: 0, sidebar: 1 } },
          'session-a': { id: 'session-a', retainedBy: { mainView: 1 } }
        },
        phase: 'ready'
      }
    })

    assert.ok(mounted.chatSource)
    assert.ok(dom.host.firstChild)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('stays inactive when no session is retained by the main view', () => {
  const dom = createBrowserDom({ withHoverRoot: false })
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    mounted = mountSticky(dom, 'hello from the user', {
      currentChat: true,
      sessionList: {
        ids: ['session-b'],
        byId: { 'session-b': { id: 'session-b', retainedBy: { sidebar: 1 } } },
        phase: 'ready'
      }
    })

    assert.equal(dom.host.firstChild, undefined)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'inactive-snapshot')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('pins, expands, and navigates a native content-box bubble', () => {
  const dom = createBrowserDom()
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousMutationObserver = globalThis.MutationObserver
  const previousResizeObserver = globalThis.ResizeObserver
  globalThis.window = dom.window
  globalThis.document = dom.document
  globalThis.MutationObserver = dom.MutationObserver
  globalThis.ResizeObserver = dom.ResizeObserver

  try {
    const runtime = createReactRuntime()
    const component = { React: runtime.React, value: undefined, disposed: false }
    const sessions = {
      binding(id) {
        assert.equal(id, 'session-a')
        return {
          session: {
            subscribe() { return () => {} },
            getSnapshot() {
              return {
                sessionId: 'session-a',
                openState: 'open',
                removed: false,
                chat: {
                  order: ['u1'],
                  nodes: {
                    get(key) {
                      return key === 'u1'
                        ? { key: 'u1', kind: 'user', data: { content: [{ type: 'text', text: 'hello from the user' }] } }
                        : undefined
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    const registrations = []
    const slots = {
      inject(name, callback) {
        assert.equal(name, 'shell.overlay')
        registrations.push(callback())
      },
      register(options, entry) {
        component.value = entry
        return () => { component.disposed = true }
      }
    }
    const plugin = definition.factory((specifier) => {
      assert.equal(specifier, 'react')
      return runtime.React
    })
    plugin.apply({ slots, sessions })

    const rendered = runtime.render(component.value, {
      useSessions(selector) {
        return selector({ current: 'session-a' })
      }
    })
    rendered.tree.props.ref.current = dom.overlay
    rendered.tree.children[0].props.ref.current = dom.host
    const cleanups = rendered.effects.map((factory) => factory()).filter((value) => typeof value === 'function')
    dom.flushFrames()
    assert.equal(dom.host.firstChild, undefined)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'inactive-source-visible')

    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    dom.scroll.dispatch('scroll')
    dom.flushFrames()
    const clone = dom.host.firstChild
    assert.ok(clone)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
    assert.equal(rendered.tree.props['aria-hidden'], undefined)
    assert.equal(rendered.tree.props.inert, undefined)
    assert.equal(rendered.tree.children[0].props['aria-hidden'], undefined)
    assert.equal(rendered.tree.children[0].props.inert, undefined)
    assert.equal(clone.getAttribute('aria-hidden'), null)
    assert.equal(clone.getAttribute('inert'), null)
    assert.equal(clone.getAttribute('role'), 'button')
    assert.equal(clone.getAttribute('tabindex'), '0')
    assert.equal(clone.getAttribute('data-dsh-sticky-user-bubble-clone'), '')
    assert.equal(clone.getAttribute('id'), null)
    assert.equal(clone.getAttribute('data-chat-flow-key'), null)
    assert.equal(clone.style.left, '600px')
    assert.equal(clone.style.top, '116px')
    assert.equal(clone.style.width, '300px')
    assert.equal(clone.style.height, '40px')
    assert.equal(clone.style.boxSizing, 'border-box')
    assert.equal(clone.style.pointerEvents, 'auto')
    assert.equal(clone.querySelector('a').getAttribute('href'), null)
    assert.equal(clone.querySelector('a').getAttribute('tabindex'), null)
    assert.equal(clone.querySelector('a').style.pointerEvents, 'none')

    dom.scroll.scrollTop = 500
    const click = clone.dispatch('click')
    assert.deepEqual(dom.scroll.lastScrollTo, { top: 414, behavior: 'smooth' })
    assert.equal(click.defaultPrevented, true)
    assert.equal(click.propagationStopped, true)

    dom.scroll.scrollTop = 500
    dom.bubble.rect = { left: 600, top: -40, right: 900, bottom: 100, width: 300, height: 140 }
    dom.setContentMeasurement({ height: 120 })
    dom.scroll.dispatch('scroll')
    dom.flushFrames()
    const longClone = dom.host.firstChild
    assert.notEqual(longClone, clone)
    const longContent = longClone.querySelector('[data-dsh-sticky-user-bubble-content]')
    assert.ok(longContent)
    assert.equal(longClone.children.length, 1)
    assert.equal(longClone.style.height, '92px')
    assert.equal(longClone.style.display, 'block')
    assert.equal(longClone.style.overflow, 'hidden')
    assert.equal(longClone.style.textOverflow, 'clip')
    assert.equal(longClone.style.WebkitLineClamp, 'unset')
    assert.equal(longContent.style.height, '72px')
    assert.equal(longContent.style.maxHeight, '72px')
    assert.equal(longContent.style.display, '-webkit-box')
    assert.equal(longContent.style.overflow, 'hidden')
    assert.equal(longContent.style.textOverflow, 'ellipsis')
    assert.equal(longContent.style.WebkitBoxOrient, 'vertical')
    assert.equal(longContent.style.WebkitLineClamp, '3')

    longClone.dispatch('mouseenter')
    assert.equal(longClone.style.height, '140px')
    assert.equal(longClone.style.display, 'block')
    assert.equal(longClone.style.overflow, 'visible')
    assert.equal(longContent.style.height, 'auto')
    assert.equal(longContent.style.maxHeight, 'none')
    assert.equal(longContent.style.display, 'block')
    assert.equal(longContent.style.overflow, 'visible')
    assert.equal(longContent.style.WebkitLineClamp, 'unset')
    longClone.dispatch('mouseleave')
    assert.equal(longClone.style.height, '92px')
    assert.equal(longContent.style.height, '72px')
    assert.equal(longContent.style.WebkitLineClamp, '3')

    longClone.dispatch('focus')
    assert.equal(longClone.style.height, '140px')
    longClone.dispatch('blur')
    assert.equal(longClone.style.height, '92px')

    const keydown = longClone.dispatch('keydown', { key: 'Enter' })
    assert.deepEqual(dom.scroll.lastScrollTo, { top: 344, behavior: 'smooth' })
    assert.equal(keydown.defaultPrevented, true)
    assert.equal(keydown.propagationStopped, true)

    for (const cleanup of cleanups.reverse()) cleanup()
    assert.equal(dom.host.firstChild, undefined)
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
    globalThis.MutationObserver = previousMutationObserver
    globalThis.ResizeObserver = previousResizeObserver
  }
})

test('pins only after the original bubble has left the painted conversation band', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    // The reading line is scrollTop 100 + paddingTop 16 = 116, but the scrollport still
    // paints the bubble down to its clip edge at 100. A bubble bottom of 110 is therefore
    // visible and must not be duplicated, even though it sits above the reading line.
    dom.bubble.rect = { left: 600, top: 70, right: 900, bottom: 110, width: 300, height: 40 }
    mounted = mountSticky(dom, 'hello from the user', { currentChat: true })

    assert.equal(dom.host.firstChild, undefined)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'inactive-source-visible')

    dom.bubble.rect = { left: 600, top: 56, right: 900, bottom: 96, width: 300, height: 40 }
    dom.scroll.dispatch('scroll')
    dom.flushFrames()

    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
    assert.equal(dom.host.firstChild.style.top, '116px')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('narrows the painted band to a clipping ancestor between bubble and scrollport', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    // A wrapper that clips (or scrolls on its own) above the scrollport edge hides the
    // bubble before the scrollport does, so the clone has to appear at that boundary.
    const clip = element({ left: 100, top: 200, right: 900, bottom: 700, width: 800, height: 500 })
    clip.computed = { overflow: 'hidden', overflowY: 'hidden' }
    clip.ownerDocument = dom.document
    dom.flow.appendChild(clip)
    clip.appendChild(dom.row)
    dom.row.rect = { left: 100, top: 60, right: 900, bottom: 130, width: 800, height: 70 }
    // Bottom 150 still overlaps the scrollport band (clip edge 100) yet sits above the
    // clipping wrapper's top at 200, so no part of the bubble is painted any more.
    dom.bubble.rect = { left: 600, top: 110, right: 900, bottom: 150, width: 300, height: 40 }

    mounted = mountSticky(dom, 'hello from the user', { currentChat: true })

    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
    assert.equal(dom.host.firstChild.style.top, '116px')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('yields the top slot to the next user card instead of covering it', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    const chatSnapshot = {
      order: ['u1', 'u2'],
      nodes: {
        get(key) {
          if (key === 'u1') {
            return { key: 'u1', kind: 'user', data: { content: [{ type: 'text', text: 'hello from the user' }] } }
          }
          if (key === 'u2') {
            return { key: 'u2', kind: 'user', data: { content: [{ type: 'text', text: 'second question' }] } }
          }
          return undefined
        }
      }
    }
    const row2 = element({ left: 100, top: 400, right: 900, bottom: 470, width: 800, height: 70 }, {
      'data-chat-anchor-key': 'u2',
      'data-chat-flow-key': 'u2',
      'data-chat-flow-kind': 'user'
    })
    const bubble2 = element({ left: 600, top: 400, right: 900, bottom: 440, width: 300, height: 40 })
    bubble2.textContent = 'second question'
    bubble2.computed = { ...dom.bubble.computed }
    row2.appendChild(bubble2)
    dom.flow.appendChild(row2)
    row2.ownerDocument = dom.document
    bubble2.ownerDocument = dom.document
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }

    mounted = mountSticky(dom, 'hello from the user', { chatSnapshot })

    const clone = dom.host.firstChild
    const clearanceAbove = (cardTop) => cardTop - (Number.parseFloat(clone.style.top) + Number.parseFloat(clone.style.height))
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
    assert.equal(clone.style.top, '116px')
    assert.equal(clone.style.clipPath, 'none')

    // The card is 166px away: still within the 16px flow gap above the clone's 156px bottom
    // edge, so the clone already starts moving and keeps exactly that gap.
    row2.rect = { left: 100, top: 166, right: 900, bottom: 236, width: 800, height: 70 }
    bubble2.rect = { left: 600, top: 166, right: 900, bottom: 206, width: 300, height: 40 }
    dom.scroll.dispatch('scroll')
    dom.flushFrames()

    assert.equal(dom.host.firstChild, clone)
    assert.equal(clone.style.top, '110px')
    assert.equal(clone.style.clipPath, 'none')
    assert.equal(clearanceAbove(166), 16)

    // Closer in, the clone keeps the same 16px clearance and is clipped at the scrollport
    // edge instead of sliding flush against the incoming card.
    row2.rect = { left: 100, top: 130, right: 900, bottom: 200, width: 800, height: 70 }
    bubble2.rect = { left: 600, top: 130, right: 900, bottom: 170, width: 300, height: 40 }
    dom.scroll.dispatch('scroll')
    dom.flushFrames()

    assert.equal(dom.host.firstChild, clone)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
    assert.equal(clone.style.top, '74px')
    assert.equal(clone.style.clipPath, 'inset(26px 0 0 0)')
    assert.equal(clearanceAbove(130), 16)

    // Once that card reaches the reading line it becomes the active row, and because it is
    // still visible the plugin shows no clone at all.
    row2.rect = { left: 100, top: 100, right: 900, bottom: 170, width: 800, height: 70 }
    bubble2.rect = { left: 600, top: 100, right: 900, bottom: 140, width: 300, height: 40 }
    dom.scroll.dispatch('scroll')
    dom.flushFrames()

    assert.equal(dom.host.firstChild, undefined)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'inactive-source-visible')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

// Fixture for the long pinned message: a durable pinned row plus a second user card the
// clone has to yield to, with 1000px of natural content (three collapsed lines = 92px).
function mountLongPinnedCard(dom, secondTop) {
  const chatSnapshot = {
    order: ['u1', 'u2'],
    nodes: {
      get(key) {
        if (key === 'u1') {
          return { key: 'u1', kind: 'user', data: { content: [{ type: 'text', text: 'hello from the user' }] } }
        }
        if (key === 'u2') {
          return { key: 'u2', kind: 'user', data: { content: [{ type: 'text', text: 'second question' }] } }
        }
        return undefined
      }
    }
  }
  const row2 = element({ left: 100, top: secondTop, right: 900, bottom: secondTop + 70, width: 800, height: 70 }, {
    'data-chat-anchor-key': 'u2',
    'data-chat-flow-key': 'u2',
    'data-chat-flow-kind': 'user'
  })
  const bubble2 = element({ left: 600, top: secondTop, right: 900, bottom: secondTop + 40, width: 300, height: 40 })
  bubble2.textContent = 'second question'
  bubble2.computed = { ...dom.bubble.computed }
  row2.appendChild(bubble2)
  dom.flow.appendChild(row2)
  row2.ownerDocument = dom.document
  bubble2.ownerDocument = dom.document
  // The pinned original is genuinely long: only its last 60px are still painted.
  dom.bubble.rect = { left: 600, top: -960, right: 900, bottom: 60, width: 300, height: 1020 }
  dom.setContentMeasurement({ height: 1000 })
  return { mounted: mountSticky(dom, 'hello from the user', { chatSnapshot }), row2, bubble2 }
}

function moveSecondCard(dom, row2, bubble2, top) {
  row2.rect = { left: 100, top, right: 900, bottom: top + 70, width: 800, height: 70 }
  bubble2.rect = { left: 600, top, right: 900, bottom: top + 40, width: 300, height: 40 }
  dom.scroll.dispatch('scroll')
  dom.flushFrames()
}

test('never expands the pinned bubble over the next user card', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    // Card top 400 sits below the clone's 208px bottom edge but well inside the 1020px
    // expanded bubble, so the expansion stops at the free room and scrolls inside instead.
    const fixture = mountLongPinnedCard(dom, 400)
    mounted = fixture.mounted
    const clone = dom.host.firstChild
    const content = clone.querySelector('[data-dsh-sticky-user-bubble-content]')
    const clearance = (cardTop) => cardTop - (Number.parseFloat(clone.style.top) + Number.parseFloat(clone.style.height))

    assert.equal(clone.style.height, '92px')
    clone.dispatch('mouseenter')
    assert.equal(clone.style.height, '268px')
    // The bubble stays a single surface: the content inside its padding is the scroller, so
    // the scrollbar never lands on the bubble's rounded border.
    assert.equal(clone.style.overflowY, 'hidden')
    assert.equal(content.style.overflowY, 'auto')
    assert.equal(content.style.pointerEvents, 'auto')
    assert.equal(content.style.height, '248px')
    assert.equal(content.style['--dsh-scrollbar-thumb'], 'var(--dsw-alias-scrollbar-bg-l2)')
    assert.equal(clearance(400), 16)
    clone.dispatch('mouseleave')

    // Card inside the clone's footprint: no room is left, so the hover keeps the three-line
    // box (which the yield already clipped) rather than growing over the card.
    moveSecondCard(dom, fixture.row2, fixture.bubble2, 130)
    assert.equal(clone.style.top, '22px')
    assert.equal(clone.style.clipPath, 'inset(78px 0 0 0)')

    clone.dispatch('mouseenter')
    assert.equal(clone.style.height, '92px')
    assert.equal(clone.style.overflowY, 'hidden')
    assert.equal(content.style.overflowY, 'hidden')
    assert.equal(clearance(130), 16)
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('keeps an expanded bubble inside the free room while the next card approaches', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    const fixture = mountLongPinnedCard(dom, 1200)
    mounted = fixture.mounted
    const clone = dom.host.firstChild
    const clearance = (cardTop) => cardTop - (Number.parseFloat(clone.style.top) + Number.parseFloat(clone.style.height))

    clone.dispatch('mouseenter')
    assert.equal(clone.style.height, '668px')

    // Same clone and still hovered: only the cap follows the incoming card.
    moveSecondCard(dom, fixture.row2, fixture.bubble2, 500)
    assert.equal(dom.host.firstChild, clone)
    assert.equal(clone.style.height, '368px')
    assert.equal(clearance(500), 16)

    moveSecondCard(dom, fixture.row2, fixture.bubble2, 180)
    assert.equal(clone.style.height, '92px')
    assert.equal(clone.style.top, '72px')
    assert.equal(clone.style.clipPath, 'inset(28px 0 0 0)')
    assert.equal(clearance(180), 16)
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('measures natural content independently of fixed source height and copies descendant styles', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    dom.bubble.computed.backgroundColor = 'transparent'
    dom.bubble.computed.backgroundImage = 'linear-gradient(rgb(240, 241, 244), rgb(230, 232, 236))'
    dom.bubble.computed.background = dom.bubble.computed.backgroundImage
    dom.bubble.computed.borderTopLeftRadius = '4px'
    dom.bubble.computed.borderTopRightRadius = '4px'
    dom.bubble.computed.borderBottomLeftRadius = '4px'
    dom.bubble.computed.borderBottomRightRadius = '4px'
    dom.bubble.computed.borderRadius = '4px'
    dom.bubble.computed.fontSize = '20px'
    dom.bubble.computed.lineHeight = 'normal'
    dom.bubble.computed.padding = '12px 18px'
    dom.bubble.computed.minHeight = '200px'
    dom.link.computed.color = 'rgb(180, 20, 30)'
    dom.link.computed.fontSize = '14px'
    dom.setContentMeasurement({ height: 120, width: 264 })

    mounted = mountSticky(dom)
    const clone = dom.host.firstChild
    const content = clone.querySelector('[data-dsh-sticky-user-bubble-content]')
    const clonedLink = clone.querySelector('a')
    assert.ok(clone)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
    assert.equal(clone.style.height, '114px')
    assert.equal(content.style.height, '90px')
    assert.equal(clonedLink.style.color, 'rgb(180, 20, 30)')
    assert.equal(clonedLink.style.fontSize, '14px')

    clone.dispatch('mouseenter')
    assert.equal(clone.style.height, '144px')
    assert.equal(content.style.height, 'auto')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('prefers an explicit bubble marker even for a transparent square bubble', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    dom.bubble.setAttribute('data-user-bubble', '')
    dom.bubble.textContent = '**hello from the user**'
    dom.bubble.computed.backgroundColor = 'transparent'
    dom.bubble.computed.backgroundImage = 'none'
    dom.bubble.computed.background = 'transparent'
    dom.bubble.computed.padding = '0px'
    dom.bubble.computed.borderRadius = '0px'
    dom.bubble.computed.borderTopLeftRadius = '0px'
    dom.bubble.computed.borderTopRightRadius = '0px'
    dom.bubble.computed.borderBottomLeftRadius = '0px'
    dom.bubble.computed.borderBottomRightRadius = '0px'
    dom.setContentMeasurement({ height: 20, width: 300 })

    mounted = mountSticky(dom)
    assert.ok(dom.host.firstChild)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('uses actual line boxes for mixed line heights', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    dom.setContentMeasurement({
      height: 140,
      wholeRangeRect: { left: 616, top: 126, right: 884, bottom: 204, width: 268, height: 78 },
      lineRects: [
        { left: 616, top: 126, right: 884, bottom: 146, width: 268, height: 20 },
        { left: 616, top: 150, right: 884, bottom: 174, width: 268, height: 24 },
        { left: 616, top: 178, right: 884, bottom: 204, width: 268, height: 26 },
        { left: 616, top: 208, right: 884, bottom: 232, width: 268, height: 24 }
      ]
    })

    mounted = mountSticky(dom)
    const clone = dom.host.firstChild
    const content = clone.querySelector('[data-dsh-sticky-user-bubble-content]')
    assert.equal(content.style.height, '82px')
    assert.equal(clone.style.height, '102px')
    clone.dispatch('mouseenter')
    assert.equal(clone.style.height, '160px')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('caps exceptionally long expanded content to the available viewport', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    dom.setContentMeasurement({ height: 1000 })

    mounted = mountSticky(dom)
    const clone = dom.host.firstChild
    const content = clone.querySelector('[data-dsh-sticky-user-bubble-content]')
    assert.equal(clone.style.height, '92px')
    clone.dispatch('mouseenter')
    assert.equal(clone.style.height, '668px')
    assert.equal(clone.style.overflowY, 'hidden')
    assert.equal(content.style.height, '648px')
    assert.equal(content.style.maxHeight, '648px')
    assert.equal(content.style.overflowY, 'auto')
    assert.equal(content.style.pointerEvents, 'auto')
    clone.dispatch('mouseleave')
    assert.equal(clone.style.height, '92px')
    assert.equal(clone.style.overflowY, 'hidden')
    assert.equal(content.style.overflowY, 'hidden')
    assert.equal(content.style.pointerEvents, 'none')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('stops the expanded bubble above the composer seat', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    // The composer is sticky at the bottom inside the conversation scrollport, so the
    // scrollport's own 800px edge is below it: the expansion must end at the composer's top.
    const seat = element({ left: 0, top: 600, right: 1000, bottom: 770, width: 1000, height: 170 }, {
      'data-composer-seat': ''
    })
    seat.ownerDocument = dom.document
    dom.scroll.appendChild(seat)
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    dom.setContentMeasurement({ height: 1000 })

    mounted = mountSticky(dom)
    const clone = dom.host.firstChild
    const content = clone.querySelector('[data-dsh-sticky-user-bubble-content]')
    clone.dispatch('mouseenter')

    // 600px composer top - 116px reading line - 20px bubble padding - 16px gap.
    assert.equal(clone.style.height, '468px')
    assert.equal(content.style.height, '448px')
    assert.equal(content.style.overflowY, 'auto')
    assert.equal(600 - (Number.parseFloat(clone.style.top) + 468), 16)
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('keeps a hovered expansion while the conversation keeps updating', () => {
  const dom = createBrowserDom()
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    dom.setContentMeasurement({ height: 1000 })

    mounted = mountSticky(dom, 'hello from the user', { currentChat: true })
    const clone = dom.host.firstChild
    clone.dispatch('mouseenter')
    assert.equal(clone.style.height, '668px')

    // A streaming answer keeps resizing the flow. That is a re-measure, but nothing about the
    // pinned bubble changed, so the rendered clone must survive instead of collapsing.
    dom.resizeObservers[0].trigger()
    dom.flushFrames()
    assert.equal(dom.host.firstChild, clone)
    assert.equal(clone.style.height, '668px')

    // A genuinely forced remeasure (source style, theme or font change) does rebuild the
    // clone, and the rebuild has to carry the hovered expansion over.
    dom.mutationObservers[2].trigger()
    dom.flushFrames()
    const rebuilt = dom.host.firstChild
    assert.notEqual(rebuilt, clone)
    assert.equal(rebuilt.style.height, '668px')

    // Leaving the bubble still collapses it.
    rebuilt.dispatch('mouseleave')
    assert.equal(rebuilt.style.height, '92px')
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('fails closed for root layouts that the wrapper cannot preserve', () => {
  const cases = [
    { property: 'display', value: 'flex', expected: 'unsupported-root-display' },
    { property: 'writingMode', value: 'vertical-rl', expected: 'unsupported-writing-mode' },
    { property: 'transform', value: 'matrix(1, 0, 0, 1, 20, 0)', expected: 'unsupported-transform' },
    { property: 'zoom', value: '1.25', expected: 'unsupported-zoom' }
  ]
  for (const current of cases) {
    const dom = createBrowserDom()
    const restore = installBrowserGlobals(dom)
    let mounted
    try {
      dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
      dom.bubble.computed[current.property] = current.value
      mounted = mountSticky(dom)
      assert.equal(dom.host.firstChild, undefined)
      assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), current.expected)
    } finally {
      mounted?.cleanup()
      restore()
    }
  }
})

test('remeasures targeted style changes without observing its own clone mutations', () => {
  const dom = createBrowserDom({ withFonts: true })
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    mounted = mountSticky(dom)
    const initialClone = dom.host.firstChild
    const structureObserver = dom.mutationObservers.find((observer) => observer.observed.some((entry) => (
      entry.target === dom.body && entry.options.childList === true && entry.options.attributes !== true
    )))
    const sourceObserver = dom.mutationObservers.find((observer) => observer.observed.some((entry) => entry.target === dom.bubble))
    const styleObserver = dom.mutationObservers.find((observer) => observer.observed.some((entry) => entry.target === dom.head))
    const resizeObserver = dom.resizeObservers[0]
    assert.ok(structureObserver)
    assert.ok(sourceObserver)
    assert.ok(sourceObserver.observed.some((entry) => entry.target === dom.row && entry.options.attributes === true))
    assert.ok(sourceObserver.observed.some((entry) => entry.target === dom.scroll && entry.options.attributes === true))
    assert.ok(styleObserver)
    assert.ok(resizeObserver.observed.some((entry) => entry.target === dom.bubble))
    assert.equal(dom.fontEvents.listenerCount('loadingdone'), 1)
    assert.equal(dom.window.visualViewport.listenerCount('resize'), 1)

    structureObserver.trigger([{ target: dom.host, type: 'childList' }])
    assert.equal(dom.window.frames.length, 0)
    assert.equal(dom.host.firstChild, initialClone)

    structureObserver.trigger([{ target: dom.body, type: 'childList' }])
    dom.flushFrames()
    assert.equal(dom.host.firstChild, initialClone)

    dom.row.setAttribute('class', 'third-party-theme-context')
    sourceObserver.trigger([{ target: dom.row, type: 'attributes' }])
    dom.flushFrames()
    const ancestorRefreshClone = dom.host.firstChild
    assert.notEqual(ancestorRefreshClone, initialClone)

    dom.bubble.computed.color = 'rgb(10, 120, 200)'
    sourceObserver.trigger([{ target: dom.bubble, type: 'attributes' }])
    dom.flushFrames()
    const sourceRefreshClone = dom.host.firstChild
    assert.notEqual(sourceRefreshClone, ancestorRefreshClone)
    assert.equal(sourceRefreshClone.style.color, 'rgb(10, 120, 200)')

    styleObserver.trigger([{ target: dom.head, type: 'childList' }])
    dom.flushFrames()
    const stylesheetRefreshClone = dom.host.firstChild
    assert.notEqual(stylesheetRefreshClone, sourceRefreshClone)

    dom.fontEvents.dispatch('loadingdone')
    dom.flushFrames()
    const fontRefreshClone = dom.host.firstChild
    assert.notEqual(fontRefreshClone, stylesheetRefreshClone)

    dom.window.visualViewport.dispatch('resize')
    dom.flushFrames()
    assert.notEqual(dom.host.firstChild, fontRefreshClone)
  } finally {
    mounted?.cleanup()
    assert.ok(dom.mutationObservers.every((observer) => observer.disconnected))
    assert.ok(dom.resizeObservers.every((observer) => observer.disconnected))
    assert.equal(dom.fontEvents.listenerCount('loadingdone'), 0)
    assert.equal(dom.window.visualViewport.listenerCount('resize'), 0)
    assert.equal(dom.host.firstChild, undefined)
    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), null)
    restore()
  }
})

test('fails closed for a stale snapshot and never binds a missing session', () => {
  const runtime = createReactRuntime()
  const component = { React: runtime.React, value: undefined, disposed: false }
  const sessions = { binding() { throw new Error('must not be called') } }
  const registrations = []
  const slots = {
    inject(_name, callback) { registrations.push(callback()) },
    register(_options, entry) {
      component.value = entry
      return () => {}
    }
  }
  const plugin = definition.factory(() => runtime.React)
  plugin.apply({ slots, sessions })
  const rendered = runtime.render(component.value, {
    useSessions(selector) { return selector({ current: undefined }) }
  })
  assert.equal(rendered.tree.children[0].props['data-dsh-sticky-user-bubble-host'], '')
})

// DSH renders user text through its reference projector: a whitespace-preceded `@` or
// `/` token becomes a chip that shows an icon plus the token's last path segment, and
// the raw token survives only in the chip's `title` attribute. A message that contains
// such a token therefore renders different text than the Chat snapshot carries, while
// the snapshot still holds the raw text the user typed. The real message that exposed
// this was "…请尝试运行 `npm i --save-dev @types/node`，然后将 \"node\" 添加到 tsconfig 的
// types 字段…": only the raw token text is missing from the rendered bubble, so the
// whole-bubble text comparison failed and the row ended up as `bubble-not-found`.
const REFERENCE_MESSAGE = '另外我发现项目中的process 这个变量 ts会报错, 找不到名称“process”。是否需要安装 Node.js 的类型定义? 请尝试运行 `npm i --save-dev @types/node`，然后将 "node" 添加到 tsconfig 的 types 字段。这个是不是 vite 的环境变量, 要怎么解决'
// The projector's `@[^\s]+` branch consumes the backtick and everything up to the next
// space, so the chip swallows more than the bare path.
const REFERENCE_TOKEN = '@types/node`，然后将'
const REFERENCE_TOKEN_DISPLAY = 'node`，然后将'

function appendProjectedPlainRun(bubble, text) {
  const run = element({ left: 616, top: 126, right: 700, bottom: 146, width: 84, height: 20 })
  run.textContent = text
  bubble.appendChild(run)
  return run
}

function appendReferenceChip(bubble, title, display) {
  const chip = element({ left: 616, top: 126, right: 700, bottom: 146, width: 84, height: 20 }, {
    'data-ref-chip': 'file',
    title
  })
  chip.textContent = display
  bubble.appendChild(chip)
  return chip
}

// Rebuild the bubble the way the projector does: plain runs around one chip, with the
// element's derived `textContent` holding only the rendered text.
function projectReferenceBubble(bubble, rawText, token, display) {
  const tokenStart = rawText.indexOf(token)
  assert.ok(tokenStart > 0)
  appendProjectedPlainRun(bubble, rawText.slice(0, tokenStart))
  appendReferenceChip(bubble, token, display)
  appendProjectedPlainRun(bubble, rawText.slice(tokenStart + token.length))
  bubble.textContent = rawText.slice(0, tokenStart) + display + rawText.slice(tokenStart + token.length)
  return bubble.textContent
}

test('pins a message whose reference token renders as a chip instead of its raw text', () => {
  const dom = createBrowserDom({ withHoverRoot: false })
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    dom.bubble.removeAttribute('data-chat-flow-key')
    dom.bubble.removeChild(dom.link)
    projectReferenceBubble(dom.bubble, REFERENCE_MESSAGE, REFERENCE_TOKEN, REFERENCE_TOKEN_DISPLAY)
    assert.notEqual(dom.bubble.textContent, REFERENCE_MESSAGE)

    mounted = mountSticky(dom, REFERENCE_MESSAGE, { currentChat: true })

    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
    assert.ok(dom.host.firstChild)
    assert.equal(dom.host.firstChild.getAttribute('data-dsh-sticky-user-bubble-clone'), '')
    const clonedChip = dom.host.firstChild.querySelector('[data-ref-chip]')
    assert.ok(clonedChip)
    assert.equal(clonedChip.getAttribute('title'), REFERENCE_TOKEN)
  } finally {
    mounted?.cleanup()
    restore()
  }
})

test('pins a message that consists only of a reference token', () => {
  const dom = createBrowserDom({ withHoverRoot: false })
  const restore = installBrowserGlobals(dom)
  let mounted
  try {
    dom.bubble.rect = { left: 600, top: 30, right: 900, bottom: 70, width: 300, height: 40 }
    dom.bubble.removeAttribute('data-chat-flow-key')
    dom.bubble.removeChild(dom.link)
    dom.bubble.textContent = 'flag.ts'
    appendReferenceChip(dom.bubble, '@src/utils/flag.ts', 'flag.ts')

    mounted = mountSticky(dom, '@src/utils/flag.ts', { currentChat: true })

    assert.equal(dom.host.getAttribute('data-dsh-sticky-user-bubble-state'), 'ready')
    assert.ok(dom.host.firstChild)
  } finally {
    mounted?.cleanup()
    restore()
  }
})
