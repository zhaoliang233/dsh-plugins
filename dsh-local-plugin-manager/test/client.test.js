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
      // 只为需要预置的 hook 传值，其余按组件自己的初值走。
      const preset = index === 0 && options.view !== undefined ? options.view : options.states?.[index]
      return [preset === undefined ? initial : preset, () => {}]
    }
  }
  const types = {
    Button: () => null,
    IconLoadingOutline16: () => null,
    IconRefreshOutline16: () => null,
    IconTrashOutline16: () => null,
    IconWarningOutline16: () => null,
    Modal: () => null,
    Switch: () => null,
    Tag: () => null
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

/** 在假 document 下 apply 插件并渲染，body 拿到 harness 与样式元素表，after 在卸载后跑。 */
function withDocument(run) {
  const fixture = createStyleDocument()
  const previousDocument = globalThis.document
  globalThis.document = fixture.document
  const harness = instantiate(run.options)
  try {
    harness.plugin.apply(harness.ctx)
    return run.body(harness, fixture)
  } finally {
    harness.cleanup()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    run.after?.(harness, fixture)
  }
}

function styleFor(fixture) {
  return fixture.elements.get('dsh-local-plugin-manager-style')
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

function findByType(node, type, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) findByType(child, type, found)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  if (node.type === type) found.push(node)
  for (const child of node.children ?? []) findByType(child, type, found)
  return found
}

function ruleBody(styleText, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`${escaped}\\{([^}]*)\\}`).exec(styleText)
  assert.ok(match, `missing style rule ${selector}`)
  return match[1]
}

test('registers a third Plugins tab with reversible current-theme styles', () => {
  assert.equal(definition.id, 'dsh-local-plugin-manager')
  withDocument({
    body(harness, fixture) {
      assert.deepEqual(harness.plugin.inject, ['slots'])
      assert.equal(harness.registrations.length, 1)
      // 插件 tab 必须排到 DSH 自带 tab（只有 all，order 10）之后。
      assert.deepEqual(harness.registrations[0].options, {
        name: 'settings.plugins.tab',
        id: 'local-plugins',
        order: 100,
        label: '本地插件'
      })
      const style = styleFor(fixture)
      assert.ok(style)
      // Untagged sheets are claimed by whichever bundle materializes next, and HMR removes
      // style[data-plugin=<id>]: the sheet must declare this plugin as its owner.
      assert.equal(style.dataset.plugin, 'dsh-local-plugin-manager')
      assert.equal(style.textContent.includes('--dsw-alias-state-error-primary'), true)
      assert.equal(style.textContent.includes('--dsw-alias-state-business-primary'), false)
      const rendered = harness.render()
      assert.equal(rendered.children[0].props['aria-label'], '本地插件')
      assert.equal(rendered.children[0].children[0].children[0].children[0], '本地插件')
    },
    after(harness, fixture) {
      assert.equal(fixture.elements.has('dsh-local-plugin-manager-style'), false)
    }
  })
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
    uninstallBlockedBy: []
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
    uninstallBlockedBy: []
  }
]

test('renders the official Switch and Button primitives instead of local controls', () => {
  withDocument({
    options: { view: { kind: 'ready', profile: 'web', plugins: DEMO_PLUGINS } },
    body(harness, fixture) {
      const switches = findByType(harness.render(), harness.types.Switch)
      assert.equal(switches.length, DEMO_PLUGINS.length)
      assert.equal(switches[0].props.checked, true)
      assert.equal(switches[0].props.label, '禁用 dsh-demo-local')
      assert.equal(switches[0].props.disabled, false)
      assert.equal(switches[0].props.title, '禁用插件')
      assert.equal(switches[1].props.checked, false)
      assert.equal(switches[1].props.label, '启用 dsh-demo-nodesc')

      // 开关与操作按钮交给官方 primitives，自绘样式必须彻底消失：留着它会与官方组件
      // 外观打架，也会在官方换皮肤后变成不会跟着变的那一套。
      for (const gone of ['dlpm-switch', 'dlpm-button', 'dlpm-refresh-action', 'dlpm-footer', 'dlpm-badge']) {
        assert.equal(source.includes(gone), false, `${gone} 应已由官方组件取代`)
        assert.equal(styleFor(fixture).textContent.includes(gone), false, `${gone} 应已由官方组件取代`)
      }
    }
  })
})

test('renders the row badges as official Tags with the row state tone', () => {
  // 管理器自身那行同时带身份徽标与状态徽标；身份与三种状态各走一个官方语义档位。
  const selfRow = { ...DEMO_PLUGINS[0], self: true, canEnable: false, canDisable: false, canUninstall: false }
  const partialRow = { ...DEMO_PLUGINS[1], name: 'dsh-demo-partial', status: 'partial' }
  withDocument({
    options: { view: { kind: 'ready', profile: 'web', plugins: [selfRow, DEMO_PLUGINS[1], partialRow] } },
    body(harness, fixture) {
      const tags = findByType(harness.render(), harness.types.Tag)
      assert.deepEqual(tags.map((tag) => [tag.props.tone, tag.children[0]]), [
        ['outline', '当前管理器'],
        ['success', '已启用'],
        ['quiet', '已禁用'],
        ['warning', '部分启用']
      ])
      // 档位名必须来自官方 Tag 的档位表：写错时官方样式不会命中，徽标会静默失去配色。
      const officialTones = ['outline', 'solid', 'neutral', 'quiet', 'success', 'info', 'warning', 'danger']
      for (const tag of tags) {
        assert.equal(officialTones.includes(tag.props.tone), true, `${tag.props.tone} 不是官方 Tag 档位`)
      }
      // 插件只保留布局类，配色全部由官方 tone 决定。
      assert.deepEqual([...new Set(tags.map((tag) => tag.props.className))], ['dlpm-tag'])
      assert.equal(source.includes('dlpm-badge'), false)
      assert.equal(styleFor(fixture).textContent.includes('dlpm-badge'), false)
    }
  })
})

test('renders the uninstall confirmation footer with official Button variants', () => {
  withDocument({
    options: {
      view: { kind: 'ready', profile: 'web', plugins: DEMO_PLUGINS },
      states: [undefined, undefined, undefined, { name: 'dsh-demo-local', path: '/tmp/dsh-demo-local' }]
    },
    body(harness) {
      const modal = findByType(harness.render(), harness.types.Modal)[0]
      assert.equal(modal.props.open, true)
      const buttons = findByType(modal.props.footer, harness.types.Button)
      assert.deepEqual(buttons.map((button) => button.props.variant), ['outline', 'primary'])
      assert.deepEqual(buttons.map((button) => button.children[0]), ['取消', '卸载'])
      // 危险动作只覆盖官方 primary 的填充色 token，不再自带一整套按钮外观。
      assert.equal(buttons[1].props.className, 'dlpm-danger-button')
    }
  })
})

test('renders the retry action as an official small outline Button', () => {
  withDocument({
    options: { view: { kind: 'failed', error: '读取失败' } },
    body(harness) {
      const button = findByType(harness.render(), harness.types.Button)[0]
      assert.equal(button.props.variant, 'outline')
      assert.equal(button.props.size, 'sm')
      assert.equal(button.children[0], '重试')
      assert.equal(findByType(button.props.icon, harness.types.IconRefreshOutline16).length, 1)
    }
  })
})

test('renders the Host description on every row and a placeholder when it is absent', () => {
  withDocument({
    options: { view: { kind: 'ready', profile: 'web', plugins: DEMO_PLUGINS } },
    body(harness, fixture) {
      const descriptions = findByClassName(harness.render(), 'dlpm-description')
      assert.equal(descriptions.length, DEMO_PLUGINS.length)
      assert.equal(descriptions[0].props.className, 'dlpm-description')
      assert.equal(descriptions[0].props.title, '演示插件说明')
      assert.equal(descriptions[0].children[0], '演示插件说明')
      assert.equal(descriptions[1].props.className, 'dlpm-description missing')
      assert.equal(descriptions[1].props.title, undefined)
      assert.equal(descriptions[1].children[0], '未提供说明')

      const styleText = styleFor(fixture).textContent
      assert.equal(styleText.includes('.dlpm-description{'), true)
      assert.equal(styleText.includes('-webkit-line-clamp:2'), true)
      assert.equal(styleText.includes('var(--dsw-alias-label-tertiary)'), true)
      assert.match(source, /plugin\.description \|\| '未提供说明'/)
    }
  })
})

test('keeps the description above version and path in the type hierarchy', () => {
  withDocument({
    body(harness, fixture) {
      const styleText = styleFor(fixture).textContent

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
    }
  })
})

test('rewrites a surviving style element left behind by a client HMR reload', () => {
  withDocument({
    body(harness, fixture) {
      styleFor(fixture).textContent = 'previous bundle rules'
      harness.plugin.apply(harness.ctx)
      assert.equal(styleFor(fixture).textContent.includes('.dlpm-description{'), true)
      assert.equal(styleFor(fixture).dataset.references, '2')
    },
    after(harness, fixture) {
      assert.equal(fixture.elements.has('dsh-local-plugin-manager-style'), false)
    }
  })
})
