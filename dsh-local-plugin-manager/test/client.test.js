import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
let definition
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../client.js')

function createStyleDocument() {
  const elements = new Map()
  const head = {
    appendChild(element) { elements.set(element.id, element) }
  }
  return {
    elements,
    document: {
      head,
      getElementById(id) { return elements.get(id) ?? null },
      createElement() {
        return {
          id: '',
          dataset: {},
          textContent: '',
          remove() { elements.delete(this.id) }
        }
      }
    }
  }
}

function instantiate(options = {}) {
  const effects = []
  const registrations = []
  let hookIndex = 0
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useCallback(value) { return value },
    useEffect() {},
    useRef(initial) { return { current: initial } },
    useState(initial) {
      const index = hookIndex
      hookIndex += 1
      return [index === 0 && options.view !== undefined ? options.view : initial, () => {}]
    }
  }
  const types = {
    IconLoadingOutline16: () => null,
    IconRefreshOutline16: () => null,
    IconTrashOutline16: () => null,
    IconWarningOutline16: () => null,
    Modal: () => null
  }
  const plugin = definition.factory((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return types
    throw new Error(`unexpected require: ${id}`)
  })
  const ctx = {
    effect(factory) {
      const cleanup = factory()
      if (typeof cleanup === 'function') effects.push(cleanup)
    },
    slots: {
      inject(name, factory) {
        assert.equal(name, 'settings.plugins.tab')
        return factory()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      }
    }
  }
  return {
    plugin,
    types,
    ctx,
    registrations,
    render() {
      hookIndex = 0
      return registrations[0].component()
    },
    cleanup() { for (const effect of effects.reverse()) effect() }
  }
}

function findByClassName(node, className, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) findByClassName(child, className, found)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  const classes = typeof node.props?.className === 'string' ? node.props.className.split(/\s+/u) : []
  if (classes.includes(className)) found.push(node)
  for (const child of node.children ?? []) findByClassName(child, className, found)
  return found
}

test('registers a third Plugins tab with reversible current-theme styles', () => {
  assert.equal(definition.id, 'dsh-local-plugin-manager')
  const fixture = createStyleDocument()
  const previousDocument = globalThis.document
  globalThis.document = fixture.document
  const harness = instantiate()
  try {
    assert.deepEqual(harness.plugin.inject, ['slots'])
    harness.plugin.apply(harness.ctx)
    assert.equal(harness.registrations.length, 1)
    assert.deepEqual(harness.registrations[0].options, {
      name: 'settings.plugins.tab',
      id: 'local-plugins',
      order: 20,
      label: '本地插件'
    })
    const style = fixture.elements.get('dsh-local-plugin-manager-style')
    assert.ok(style)
    // Untagged sheets are claimed by whichever bundle materializes next, and HMR removes
    // style[data-plugin=<id>]: the sheet must declare this plugin as its owner.
    assert.equal(style.dataset.plugin, 'dsh-local-plugin-manager')
    assert.equal(style.textContent.includes('--dsw-alias-brand-primary'), true)
    assert.equal(style.textContent.includes('--dsw-alias-state-business-primary'), false)
    const rendered = harness.registrations[0].component()
    assert.equal(rendered.children[0].props['aria-label'], '本地插件')
    assert.equal(rendered.children[0].children[0].children[0].children[0], '本地插件')
  } finally {
    harness.cleanup()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
  assert.equal(fixture.elements.has('dsh-local-plugin-manager-style'), false)
})

test('single-flights mutations and aborts requests when the tab unmounts', () => {
  assert.match(source, /const actionRef = React\.useRef\(null\)/)
  assert.match(source, /const requestEpochRef = React\.useRef\(0\)/)
  assert.match(source, /busyName !== null \|\| csrfToken === '' \|\| actionRef\.current !== null/)
  assert.match(source, /requestEpochRef\.current \+= 1/)
  assert.match(source, /requestRef\.current\.abort\(\)\n\s+requestRef\.current = null/)
  assert.match(source, /if \(actionRef\.current !== null\) actionRef\.current\.abort\(\)/)
  assert.match(source, /body: JSON\.stringify\(\{ action, name: plugin\.name \}\),\n\s+signal: controller\.signal/)
  assert.match(source, /if \(!controller\.signal\.aborted && reason\?\.name !== 'AbortError'\)/)
})

const DEMO_PLUGINS = [
  {
    name: 'dsh-demo-local',
    version: '1.2.3',
    description: '演示插件说明',
    path: '/tmp/dsh-demo-local',
    enabled: true,
    status: 'enabled',
    manageable: true,
    self: false,
    canEnable: true,
    canDisable: true,
    canUninstall: true,
    uninstallBlockedBy: [],
    rowIds: ['dsh-demo-local']
  },
  {
    name: 'dsh-demo-nodesc',
    version: '0.1.0',
    path: '/tmp/dsh-demo-nodesc',
    enabled: false,
    status: 'disabled',
    manageable: true,
    self: false,
    canEnable: true,
    canDisable: true,
    canUninstall: true,
    uninstallBlockedBy: [],
    rowIds: ['dsh-demo-nodesc']
  }
]

test('renders the Host description on every row and a placeholder when it is absent', () => {
  const fixture = createStyleDocument()
  const previousDocument = globalThis.document
  globalThis.document = fixture.document
  const harness = instantiate({
    view: { kind: 'ready', profile: 'web', dshVersion: '0.1.6-alpha.1', plugins: DEMO_PLUGINS }
  })
  try {
    harness.plugin.apply(harness.ctx)
    const descriptions = findByClassName(harness.render(), 'dlpm-description')
    assert.equal(descriptions.length, DEMO_PLUGINS.length)
    assert.equal(descriptions[0].props.className, 'dlpm-description')
    assert.equal(descriptions[0].props.title, '演示插件说明')
    assert.equal(descriptions[0].children[0], '演示插件说明')
    assert.equal(descriptions[1].props.className, 'dlpm-description missing')
    assert.equal(descriptions[1].props.title, undefined)
    assert.equal(descriptions[1].children[0], '未提供说明')

    const style = fixture.elements.get('dsh-local-plugin-manager-style')
    assert.equal(style.textContent.includes('.dlpm-description{'), true)
    assert.equal(style.textContent.includes('-webkit-line-clamp:2'), true)
    assert.equal(style.textContent.includes('var(--dsw-alias-label-tertiary)'), true)
    assert.match(source, /plugin\.description \|\| '未提供说明'/)
  } finally {
    harness.cleanup()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

function ruleBody(styleText, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`${escaped}\\{([^}]*)\\}`).exec(styleText)
  assert.ok(match, `missing style rule ${selector}`)
  return match[1]
}

test('keeps the description above version and path in the type hierarchy', () => {
  const fixture = createStyleDocument()
  const previousDocument = globalThis.document
  globalThis.document = fixture.document
  const harness = instantiate()
  try {
    harness.plugin.apply(harness.ctx)
    const styleText = fixture.elements.get('dsh-local-plugin-manager-style').textContent

    // The description is the row's second focal point: larger than the meta line, its own
    // color step above the path, and a faint self-mixed surface that works in both themes.
    const description = ruleBody(styleText, '.dlpm-description')
    assert.equal(description.includes('font-size:13px'), true)
    assert.equal(description.includes('line-height:20px'), true)
    assert.equal(description.includes('color:var(--dsw-alias-label-secondary)'), true)
    assert.equal(description.includes('background:color-mix(in srgb,var(--dsw-alias-label-secondary) 7%,transparent)'), true)

    // Missing copy must stay quiet: no surface, a dimmer step, and one size below.
    const missing = ruleBody(styleText, '.dlpm-description.missing')
    assert.equal(missing.includes('background:transparent'), true)
    assert.equal(missing.includes('color:var(--dsw-alias-label-tertiary)'), true)
    assert.equal(missing.includes('font-size:12px'), true)

    // Version and path are metadata: tertiary, smaller, and never the focal point.
    const meta = ruleBody(styleText, '.dlpm-meta')
    assert.equal(meta.includes('color:var(--dsw-alias-label-tertiary)'), true)
    assert.equal(meta.includes('font-size:12px'), true)

    assert.equal(ruleBody(styleText, '.dlpm-copy').includes('gap:6px'), true)
    assert.equal(ruleBody(styleText, '.dlpm-row').includes('padding:12px 0'), true)
  } finally {
    harness.cleanup()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('rewrites a surviving style element left behind by a client HMR reload', () => {
  const fixture = createStyleDocument()
  const previousDocument = globalThis.document
  globalThis.document = fixture.document
  const harness = instantiate()
  try {
    harness.plugin.apply(harness.ctx)
    const style = fixture.elements.get('dsh-local-plugin-manager-style')
    style.textContent = 'previous bundle rules'
    harness.plugin.apply(harness.ctx)
    const current = fixture.elements.get('dsh-local-plugin-manager-style')
    assert.equal(current.textContent.includes('.dlpm-description{'), true)
    assert.equal(current.dataset.references, '2')
  } finally {
    harness.cleanup()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
  assert.equal(fixture.elements.has('dsh-local-plugin-manager-style'), false)
})
