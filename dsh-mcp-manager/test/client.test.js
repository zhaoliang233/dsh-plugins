import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { createHarness } from './harness.js'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/**
 * bundle 在 vm 沙箱里执行，它产出的对象属于另一个 realm：
 * assert.deepEqual 会因为原型不同而失败，所以比较前先过一遍 JSON。
 */
const plain = (value) => JSON.parse(JSON.stringify(value))

/** 用最小 React 桩 + stub primitives 加载 bundle，返回它的导出。 */
function loadBundle(overrides = {}) {
  const registered = []
  const react = overrides.react ?? createReactStub()
  const primitives = overrides.primitives ?? createPrimitivesStub()
  const modules = {
    react,
    'react-dom/client': overrides.reactDomClient,
    '@deepseek-ai/dsh-client-ui-primitives': primitives
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (spec) => registered.push(spec) } },
    console,
    document: overrides.document,
    setTimeout,
    clearTimeout,
    URL,
    Promise,
    Math,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Set,
    Map,
    Error,
    fetch: overrides.fetch
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  assert.equal(registered.length, 1, 'bundle 必须只注册一次')
  const spec = registered[0]
  assert.equal(spec.id, 'dsh-mcp-manager')
  return { spec, exports: spec.factory((name) => modules[name]) }
}

function createPrimitivesStub() {
  const icon = (name) => {
    const Component = () => null
    Component.displayName = name
    return Component
  }
  // 与 React 无关的元素构造：这个桩既会被 harness（能渲染）用，也会被
  // `createReactStub`（不能渲染）用，两边对元素的形状要求一致。
  const element = (tag, props, children) => ({
    type: tag,
    props: props ?? {},
    children: (children ?? []).filter((child) => child !== null && child !== undefined && child !== false)
  })
  // 图标按 0.1.7 的档位词命名法供货：0.1.6 的数字档位名（`…16`/`…14`）在 0.1.7 里
  // 已不存在，bundle 靠 `iconOf()` 的能力探测取到这里的 `…Medium`（详见同文件
  // 「图标按能力解析」用例——两套命名法都要能画出来）。
  return {
    IconApiOutlineMedium: icon('IconApiOutlineMedium'),
    IconChevronDownOutlineMedium: icon('IconChevronDownOutlineMedium'),
    IconCodeOutlineMedium: icon('IconCodeOutlineMedium'),
    IconLinkOutlineMedium: icon('IconLinkOutlineMedium'),
    IconLoadingOutlineMedium: icon('IconLoadingOutlineMedium'),
    IconPlusOutlineMedium: icon('IconPlusOutlineMedium'),
    IconRefreshOutlineMedium: icon('IconRefreshOutlineMedium'),
    IconTrashOutlineMedium: icon('IconTrashOutlineMedium'),
    IconWarningOutlineMedium: icon('IconWarningOutlineMedium'),
    /**
     * 官方 `Tooltip` 的桩：真组件**只在悬停/聚焦时**渲染气泡，且气泡
     * `pointer-events:none`、鼠标离开锚点即关（悬停行为由 `scripts/gui-flow.mjs` 真机验收）。
     * 桩里恒定把 `label` 渲染成 `role="tooltip"`，这样能断言"什么条件下才给 tag 挂浮层"。
     */
    Tooltip: ({ label, children }) =>
      element('span', { className: 'dmm-tooltip-root' }, [
        element('span', { className: 'dmm-tooltip-anchor' }, [children]),
        label === undefined ? null : element('span', { role: 'tooltip' }, [label])
      ]),
    Modal: undefined
  }
}

/**
 * 本插件用到的 8 个图标：基础名 → 0.1.6 的数字档位（0.1.7 一律换成档位词 `…Medium`）。
 * 名字一旦对不上就是空白图标，所以两条命名法都要有守卫。
 */
const ICON_TIERS = {
  IconChevronDownOutline: 14,
  IconCodeOutline: 16,
  IconEditOutline: 16,
  IconLinkOutline: 16,
  IconLoadingOutline: 16,
  IconPlusOutline: 16,
  IconRefreshOutline: 16,
  IconTrashOutline: 16
}

/**
 * 「会自我申报」的图标桩：每个图标渲染成 `<span data-icon="导出名">`，于是渲染树能证明
 * 组件到底从哪个导出名取到了图标。`naming` 决定这份桩按哪条命名法供货：
 * `'medium'` = 0.1.7 的档位词，`'legacy'` = 0.1.6 的数字档位。
 * @param {'medium' | 'legacy'} naming
 * @returns {object}
 */
function createIconProbePrimitives(naming) {
  const stub = createPrimitivesStub()
  for (const key of Object.keys(stub)) if (key.startsWith('Icon')) delete stub[key]
  for (const [base, tier] of Object.entries(ICON_TIERS)) {
    const name = naming === 'medium' ? `${base}Medium` : `${base}${tier}`
    const Component = () => ({ type: 'span', props: { 'data-icon': name }, children: [] })
    Component.displayName = name
    stub[name] = Component
  }
  return stub
}

/** 渲染树里「由图标桩画出来」的导出名（顺序 = 渲染顺序）。 */
const paintedIcons = (harness) =>
  harness.findAll((node) => typeof node.props?.['data-icon'] === 'string').map((node) => node.props['data-icon'])

/** 极简 React 桩：只够让组件函数跑起来并产出元素树。 */
function createReactStub() {
  const createElement = (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat().filter((child) => child !== null && child !== undefined && child !== false)
  })
  return {
    createElement,
    Fragment: Symbol('Fragment'),
    createContext: (value) => ({ value, Provider: Symbol('Provider') }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useCallback: (fn) => fn,
    useEffect: () => undefined,
    useLayoutEffect: () => undefined,
    useContext: (context) => context?.value,
    Component: class {
      constructor(props) {
        this.props = props ?? {}
        this.state = {}
      }
    }
  }
}

/** 只实现补丁需要的 DOM 子集。 */
function createNavDocument(labels) {
  const buttons = labels.map((label) => {
    const style = new Map()
    return {
      textContent: label,
      dataset: {},
      style: {
        setProperty: (name, value) => style.set(name, value),
        removeProperty: (name) => style.delete(name),
        get: (name) => style.get(name)
      },
      __style: style
    }
  })
  const observers = []
  return {
    buttons,
    observers,
    defaultView: { MutationObserver: class { constructor(cb) { this.cb = cb } observe() {} disconnect() { this.disconnected = true } } },
    body: {},
    querySelectorAll: (selector) => (selector === 'nav button' ? buttons : [])
  }
}


/** 只实现样式表注入需要的 DOM 子集（apply 阶段就会用到）。 */
function createStyleDocument() {
  const created = []
  return {
    created,
    head: {
      appendChild: (element) => {
        created.push(element)
      }
    },
    createElement: (tag) => {
      const element = {
        tag,
        dataset: {},
        attributes: {},
        textContent: '',
        setAttribute(name, value) {
          element.attributes[name] = value
        },
        remove() {
          const index = created.indexOf(element)
          if (index >= 0) created.splice(index, 1)
        }
      }
      return element
    },
    querySelector: (selector) => {
      const owner = /data-owner="([^"]+)"/u.exec(selector)?.[1]
      return created.find((element) => element.attributes['data-owner'] === owner) ?? null
    },
    querySelectorAll: () => []
  }
}

test('bundle 注册的两个 slot 与设置分区契约一致', () => {
  const { exports } = loadBundle({ document: createStyleDocument() })
  // remote.credentials 必须单独声明：客户端的 Cordis 里带点号的命名空间本身就是服务名，
  // 少写它会在读 ctx.remote.credentials 时同步抛错（凭据区"点保存没反应"的真因）
  assert.deepEqual(plain(exports.inject), ['slots', 'configForms', 'remote', 'remote.credentials'])
  const registered = []
  const ctx = {
    configForms: { get: (id) => ({ id, getSnapshot: () => ({ value: {} }), subscribe: () => () => {}, mutate: async () => {} }) },
    slots: {
      inject: (name, callback) => {
        callback()
      },
      register: (options) => registered.push(options)
    },
    effect: (fn) => {
      fn()
      return () => {}
    },
    remote: {}
  }
  exports.apply(ctx)
  assert.deepEqual(
    plain(registered).map((item) => [item.name, item.id, item.order, item.label]),
    [
      // order ≥ 100 = 排到 DSH 自带分区（最大 25）之后。
      ['settings.section', 'mcp-manager', 110, 'MCP 服务器'],
      ['settings.action', 'mcp-manager-nav-icon', 110, undefined]
    ]
  )
})

test('设置条目契约：configForms 用本插件的 profile 条目 id，decodeSettings 仍做防御性规范化', () => {
  const { exports } = loadBundle({ document: createStyleDocument() })
  let requested = null
  exports.apply({
    configForms: { get: (id) => (requested = id, { getSnapshot: () => ({ value: {} }), subscribe: () => () => {}, mutate: async () => {} }) },
    slots: { inject: (name, cb) => cb(), register: () => {} },
    effect: (fn) => {
      fn()
      return () => {}
    },
    remote: {}
  })
  // 0.1.7 起插件的设置就是 profile 里这一条条目的 config：客户端按**条目 id** 取表，
  // 宿主 `settings.describe()` 的 ns 也是它（宿主侧的同源断言在 host.test.js）。
  assert.equal(requested, 'dsh-mcp-manager')
  const { decodeSettings } = exports.__internals
  assert.equal(decodeSettings({ servers: [{ serverName: 'a', command: 'node' }] }).servers[0].transport, 'stdio')
})

test('decodeSettings / normalizeServer 对脏数据防御性读取', () => {
  const { exports } = loadBundle()
  const { decodeSettings, normalizeServer } = exports.__internals
  assert.deepEqual(plain(decodeSettings(undefined)), { enabled: true, servers: [] })
  assert.equal(decodeSettings({ enabled: false }).enabled, false)
  assert.deepEqual(plain(decodeSettings({ servers: 'nope' }).servers), [])
  const server = normalizeServer({ transport: 'streamable-http', env: { A: 1, B: 'x' }, args: ['a', 2], toolCallTimeoutMs: 0 })
  assert.equal(server.transport, 'streamable-http')
  assert.deepEqual(plain(server.env), { B: 'x' })
  assert.deepEqual(plain(server.args), ['a'])
  assert.equal(server.toolCallTimeoutMs, 60000)
})

test('编辑器文本解析：env 用 =、header 用 :，且忽略注释与空行', () => {
  const { parsePairs, formatPairs, parseArgs } = loadBundle().exports.__internals
  assert.deepEqual(plain(parsePairs('A=1\n# 注释\nB=credential:TOK\n=', '=')), { A: '1', B: 'credential:TOK' })
  assert.deepEqual(plain(parsePairs('Authorization: Bearer x\nEmpty:', ':')), { Authorization: 'Bearer x', Empty: '' })
  assert.deepEqual(plain(parseArgs(' a\n\n b \n')), ['a', 'b'])
  assert.equal(formatPairs({ A: '1', B: '2' }, '='), 'A=1\nB=2')
  assert.equal(formatPairs({ Authorization: 'Bearer x' }, ':'), 'Authorization: Bearer x')
})

test('凭据引用只从 env/headers 的值里提取', () => {
  const { credentialRefsOf } = loadBundle().exports.__internals
  assert.deepEqual(
    plain(credentialRefsOf({ env: { A: 'credential:ONE' }, headers: { B: 'Basic credential:ONE', C: 'credential:TWO' } })),
    ['ONE', 'TWO']
  )
  assert.deepEqual(plain(credentialRefsOf({ env: { A: 'plain' } })), [])
  // URL 也算：http 条目的地址里写 credential:KEY 时，凭据区同样要给输入框
  assert.deepEqual(plain(credentialRefsOf({ url: 'https://x.test/mcp?token=credential:URL_TOK' })), ['URL_TOK'])
})

test('行状态口径：宿主未就绪 / 停用 / 被拦 / 挂载失败 / 无工具 / 正常', () => {
  const { rowState } = loadBundle().exports.__internals
  const server = { enabled: true, serverName: 'a' }
  assert.equal(rowState(server, null, '', 'mcp-client-unavailable').tone, 'error')
  assert.equal(rowState({ enabled: false }, null, '', 'ready').tone, 'idle')
  assert.equal(rowState(server, null, '名字被占用', 'ready').text, '名字被占用')
  assert.equal(rowState(server, { state: 'failed', error: 'boom', tools: [] }, '', 'ready').tone, 'error')
  assert.equal(rowState(server, { state: 'mounted', error: '', tools: [] }, '', 'ready').tone, 'warn')
  assert.match(rowState(server, { state: 'mounted', error: '', tools: ['mcp__a__t'] }, '', 'ready').text, /1 个工具/u)
  // 与配置文件同名：即使此刻还是 mounted，也要在行上提示（纯读提示，不依赖对账）
  const conflict = rowState(server, { state: 'mounted', error: '', tools: ['mcp__a__t'] }, '', 'ready', '配置文件里也声明了同名服务器') 
  assert.equal(conflict.tone, 'warn')
  assert.match(conflict.text, /配置文件/u)
  assert.equal(rowState(server, null, '先看被拦原因', 'ready', '冲突提示').text, '先看被拦原因', '被拦原因优先于同名提示')
})

test('端点摘要：未填必填项时给出可读占位', () => {
  const { endpointSummary } = loadBundle().exports.__internals
  assert.equal(endpointSummary({ transport: 'streamable-http', url: '' }), '（未填写 URL）')
  assert.equal(endpointSummary({ transport: 'stdio', command: '', args: [] }), '（未填写命令）')
  assert.equal(endpointSummary({ transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] }), 'npx -y pkg')
})

test('导航图标补丁：只改名字精确匹配的行，并能完整还原', () => {
  const { patchSettingsNavIcon } = loadBundle().exports.__internals
  const doc = createNavDocument(['模型', 'MCP 服务器', 'MCP 服务器（旧）'])
  const cleanup = patchSettingsNavIcon(doc, '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>', 'MCP 服务器')
  const [models, target, decoy] = doc.buttons
  assert.equal(target.dataset.dmmNavIcon, '')
  assert.match(target.__style.get('--dmm-nav-icon-mask'), /^url\("data:image\/svg\+xml,/u)
  assert.equal(models.dataset.dmmNavIcon, undefined, '别行不能被误伤')
  assert.equal(decoy.dataset.dmmNavIcon, undefined, '前缀相同的行不能误伤')

  // 二次安装（HMR 重叠窗口）走引用计数，先卸一份不能把补丁摘掉
  const cleanupAgain = patchSettingsNavIcon(doc, '<svg xmlns="http://www.w3.org/2000/svg"/>', 'MCP 服务器')
  cleanup()
  assert.equal(target.dataset.dmmNavIcon, '', '还有一份引用时补丁必须保留')
  cleanupAgain()
  assert.equal(target.dataset.dmmNavIcon, undefined)
  assert.equal(target.__style.get('--dmm-nav-icon-mask'), undefined)
})

test('导航图标补丁对坏输入静默退化，绝不抛错到设置页', () => {
  const { patchSettingsNavIcon } = loadBundle().exports.__internals
  assert.equal(typeof patchSettingsNavIcon(null, '<svg/>', 'x'), 'function')
  assert.equal(typeof patchSettingsNavIcon(createNavDocument([]), '', 'x'), 'function')
  assert.equal(typeof patchSettingsNavIcon(createNavDocument([]), '<svg/>', ''), 'function')
})

test('图标源码必须补 xmlns，否则 data: URI 里的 mask 会静默失效', () => {
  const { __internals } = loadBundle().exports
  assert.equal(__internals.navIconMaskSource, undefined, '取样函数不外露也没关系')
  // 通过补丁行为断言：补进 dataset 的 mask 里应带上 xmlns
  const doc = createNavDocument(['MCP 服务器'])
  const cleanup = (function () {
    const source = '<svg><path d="M0 0"/></svg>'.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    return __internals.patchSettingsNavIcon(doc, source, 'MCP 服务器')
  })()
  assert.match(decodeURIComponent(doc.buttons[0].__style.get('--dmm-nav-icon-mask')), /xmlns=/u)
  cleanup()
})

test('样式表打 data-plugin 标签并按引用计数清理（否则会被别的插件认领或误删）', () => {
  const doc = createStyleDocument()
  const { exports } = loadBundle({ document: doc })
  const disposers = []
  const ctx = {
    configForms: undefined,
    slots: { inject: (name, cb) => cb(), register: () => {} },
    effect: (fn) => {
      disposers.push(fn())
      return () => {}
    },
    remote: {}
  }
  exports.apply(ctx)
  assert.equal(doc.created.length, 1, 'apply 阶段就要注入样式（组件渲染比它晚，见导航图标踩坑）')
  assert.equal(doc.created[0].dataset.plugin, 'dsh-mcp-manager')
  assert.equal(doc.created[0].attributes['data-owner'], 'dsh-mcp-manager-v1')
  assert.match(doc.created[0].textContent, /\[data-dmm-nav-icon\]::before/u, 'CSS 必须与补丁的 dataset 键同源')
  assert.match(doc.created[0].textContent, /--dmm-nav-icon-mask/u)
  assert.match(doc.created[0].textContent, /dmm-section/u, '分区样式必须在同一张表里')

  // HMR 会先卸旧 fiber 再挂新的：两份引用时先卸一份，样式必须留着
  const second = []
  exports.apply({ ...ctx, effect: (fn) => (second.push(fn()), () => {}) })
  disposers[0]()
  assert.equal(doc.created.length, 1, '还有一份引用时样式不能被移除')
  second[0]()
  assert.equal(doc.created.length, 0)
})

test('mcp-manager 的 profile 行与状态路由常量与宿主半体同源', () => {
  const { __internals } = loadBundle().exports
  assert.equal(__internals.SETTINGS_ENTRY, 'dsh-mcp-manager')
  assert.equal(__internals.STATUS_PATH, '/dsh-mcp-manager/status')
  assert.equal(__internals.ACTION_PATH, '/dsh-mcp-manager/action')
  assert.equal(__internals.CLIENT_HEADER, 'x-dsh-mcp-manager-client')
  assert.equal(__internals.CSRF_HEADER, 'x-dsh-mcp-manager-csrf')
})

// ── 真渲染 / 真点击：守住"组件接线"这一类缺陷 ──────────────────────────────

/**
 * 把真实 bundle 装进 harness 的 React 上，并按 apply() 注册的
 * settings.section 组件渲染一次设置分区。
 * @param {object} [options]
 * @param {object} [options.primitives] - 替换 primitives 桩（图标命名法的能力探测用例要用）
 * @returns {Promise<any>}
 */
/** 与 client.js 的 emptyDraft 同形，供导入用例构造宿主返回值。 */
/** 宿主 import 返回的是**清单形状**（与 settings 里的条目一致）。 */
const importedEntryStub = {
  id: 'srv-imported',
  enabled: false,
  label: 'jira（导入自配置文件）',
  serverName: 'jira',
  transport: 'streamable-http',
  command: '',
  args: [],
  cwd: '',
  env: {},
  url: 'https://mcp.atlassian.com/v2/mcp',
  headers: { Authorization: 'credential:MCP_JIRA_HEADERS_AUTHORIZATION' },
  toolCallTimeoutMs: 60000,
  failOnStartupError: false
}

async function mountSection(options = {}) {
  const harness = createHarness()
  const status = options.status ?? {
    ok: true,
    csrf: 'csrf-token',
    // 默认模拟"新版宿主"（声明支持 verify）；要测旧宿主就显式传 actions: null 表示字段缺失
    ...(options.actions === null ? {} : { actions: options.actions ?? ['reconcile', 'verify'] }),
    runtime: 'ready',
    dshVersion: '0.1.6-alpha.1',
    versionSupported: true,
    settingsAvailable: true,
    mcpModule: { ok: true, strategy: 'loader-import', errors: [] },
    lastError: '',
    lastReconcile: null,
    servers: options.servers ?? [],
    totalEnabled: true,
    profileTargets: options.profileTargets ?? []
  }
  const fetched = []
  const sequence = Array.isArray(options.statusSequence) ? [...options.statusSequence] : null
  const fetchStub = async (path, init) => {
    fetched.push({ path, init })
    if (typeof path === 'string' && path.endsWith('/action')) {
      const body = init?.body === undefined ? {} : JSON.parse(String(init.body))
      const payload =
        body.action === 'import'
          ? options.importResponse ?? { ok: true, value: { ok: true, draft: importedEntryStub, notes: ['敏感字段已转入凭据库（MCP_JIRA_HEADERS_AUTHORIZATION）'] } }
          : options.verifyResponse ?? { ok: true, value: { ok: true, tools: ['alpha_tool'] } }
      const status = options.verifyHttpStatus ?? 200
      return { ok: status < 400, status, json: async () => payload }
    }
    const payload = sequence === null ? status : sequence.length > 1 ? sequence.shift() : sequence[0]
    return { ok: true, status: 200, json: async () => payload }
  }
  const registered = []
  const writes = []
  const calls = []
  const scope = {
    getSnapshot: () => ({ value: options.value ?? { enabled: true, servers: [] } }),
    subscribe: () => () => {},
    set: async (field, value) => {
      writes.push({ field, value })
    },
    mutate: async (ops) => {
      calls.push(ops)
      for (const op of ops ?? []) {
        if (op?.op === 'set') writes.push({ field: op.path?.[0] ?? '', value: op.value })
      }
    }
  }
  const ctx = {
    configForms: { get: () => scope },
    slots: {
      inject: (name, callback) => callback(),
      register: (slotOptions, Component) => {
        registered.push({ slotOptions, Component })
      }
    },
    effect: (fn) => {
      const disposer = fn()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    remote: { credentials: { describe: async () => ({ ok: true, value: {} }), set: async () => ({ ok: true }), unset: async () => ({ ok: true }) } }
  }
  const { exports } = loadBundle({ document: createStyleDocument(), react: harness.React, fetch: fetchStub, primitives: options.primitives })
  exports.apply(ctx)
  const section = registered.find((entry) => entry.slotOptions.name === 'settings.section')
  assert.ok(section !== undefined, 'apply 必须注册 settings.section')
  const element = harness.React.createElement(section.Component, {})
  harness.render(element)
  // 状态是异步读回来的：让 refresh() 的 promise 落地后再渲染一次
  await new Promise((resolve) => setTimeout(resolve, 0))
  harness.render(element)
  return { harness, element, registered, writes, calls, fetched, status, scope }
}

test('分区真渲染：标题、总开关、空状态与配置文件条目都在', async () => {
  const mounted = await mountSection({
    profileTargets: [{ source: 'profile', entryId: 'include:mcp-figma', serverName: 'figma', transport: 'streamable-http', enabled: true, phase: 'active', endpoint: 'http://127.0.0.1:3845/mcp', envKeys: [], headerKeys: ['Authorization'], hasSensitiveValues: true }]
  })
  const text = mounted.harness.text()
  assert.match(text, /MCP 服务器/u)
  assert.match(text, /还没有托管任何 MCP 服务器/u)
  assert.match(text, /配置文件中的服务器/u, '只读块要有自己的标题')
  assert.match(text, /只读 · 值不显示/u, '只读说明要短，且不得出现 profile / cordis.patch.yml / !!js 这类实现细节')
  for (const word of ['profile', 'cordis.patch.yml', '!!js', '本插件不修改']) {
    assert.equal(text.includes(word), false, `只读块文案里不该出现实现细节「${word}」`)
  }
  assert.match(text, /figma/u)
  assert.match(text, /http:\/\/127\.0\.0\.1:3845\/mcp/u)
  assert.equal(mounted.harness.warnings.length, 0)
})

// 图标名在发布线之间改过（0.1.6 数字档位 → 0.1.7 档位词），而 `require` 到 undefined
// 的图标是**静默**空白——所以两条命名法各渲染一遍，用渲染出来的 `data-icon` 证明取到了谁。
test('图标按能力解析：0.1.7 的档位词命名取得到图标', async () => {
  const mounted = await mountSection({ primitives: createIconProbePrimitives('medium') })
  const painted = paintedIcons(mounted.harness)
  for (const name of ['IconRefreshOutlineMedium', 'IconPlusOutlineMedium']) {
    assert.ok(painted.includes(name), `应当从 0.1.7 的档位词导出取到 ${name}，实际画出的图标：${JSON.stringify(painted)}`)
  }
})

test('图标按能力解析：0.1.6 的数字档位命名同样取得到图标', async () => {
  const mounted = await mountSection({ primitives: createIconProbePrimitives('legacy') })
  const painted = paintedIcons(mounted.harness)
  for (const name of ['IconRefreshOutline16', 'IconPlusOutline16']) {
    assert.ok(painted.includes(name), `应当回退到 0.1.6 的数字档位导出 ${name}，实际画出的图标：${JSON.stringify(painted)}`)
  }
})

test('图标全部缺失时退化成空组件：不抛错，分区照常渲染', async () => {
  const bare = createPrimitivesStub()
  for (const key of Object.keys(bare)) if (key.startsWith('Icon')) delete bare[key]
  const mounted = await mountSection({ primitives: bare })
  assert.deepEqual(paintedIcons(mounted.harness), [], '没有图标导出时不该画出任何图标')
  assert.match(mounted.harness.text(), /MCP 服务器/u, '图标缺失不能让整个分区挂掉')
})

/** 按 aria-label 取控件（行式编辑器里一行有多个输入，按字段容器找已经不够用了）。 */
function byAria(harness, label) {
  return harness.find((node) => node.props['aria-label'] === label)
}

/** 在（已渲染的）节点子树里找：用来断言"某块挂在某块里面"，不关心中间隔了几层。 */
function withinNode(node, predicate) {
  if (node === null || node === undefined) return false
  if (Array.isArray(node)) return node.some((child) => withinNode(child, predicate))
  if (typeof node !== 'object' || node.tag === undefined) return false
  if (predicate(node)) return true
  return (node.children ?? []).some((child) => withinNode(child, predicate))
}

/** 节点子树里的文本，可跳过某些子树（列表行断言要排除浮层内容）。 */
function textWithout(node, skip) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => textWithout(child, skip)).join('')
  if (typeof node !== 'object' || node.tag === undefined) return ''
  if (skip(node)) return ''
  return (node.children ?? []).map((child) => textWithout(child, skip)).join('')
}

test('列表行：只有一行——开关在左、标题居中、编辑/删除在右，工具说明不再铺在行里', async () => {
  const value = {
    enabled: true,
    servers: [{ id: 'srv-a', label: '本地 alpha', enabled: true, transport: 'stdio', serverName: 'alpha', command: 'node', args: [], cwd: '', env: {}, url: '', headers: {}, toolCallTimeoutMs: 60000, failOnStartupError: false }]
  }
  const mounted = await mountSection({
    value,
    servers: [{ id: 'srv-a', serverName: 'alpha', enabled: true, transport: 'stdio', command: 'node', args: [], cwd: '', url: '', toolCallTimeoutMs: 60000, failOnStartupError: false, envKeys: [], headerKeys: [], credentialRefs: [], issues: [], live: { id: 'srv-a', serverName: 'alpha', state: 'mounted', error: '', mountedAt: 0, tools: ['mcp__alpha__search', 'mcp__alpha__list'], logs: [] }, blockedReason: '', conflictNote: '' }]
  })
  const row = mounted.harness.find((node) => String(node.props.className ?? '').split(/\s+/u).includes('dmm-row'))
  const line = row.children.find((child) => String(child.props.className ?? '').split(/\s+/u).includes('dmm-row-line'))
  assert.ok(line !== undefined, '行上只有一条 dmm-row-line')
  const tokens = (node) => String(node?.props.className ?? '').split(/\s+/u)
  // 左 = 开关，中 = 标题块，右 = 操作（挂了 tooltip 时中间多一层官方 Tooltip 的锚点）
  assert.equal(line.children.length, 3, '一行里只有三块：开关 / 标题 / 操作')
  assert.ok(tokens(line.children[0]).includes('dmm-switch'), '最左边是启停开关')
  assert.ok(withinNode(line.children[1], (node) => tokens(node).includes('dmm-title-block')), '中间是标题区')
  assert.equal(
    mounted.harness.find((node) => tokens(node).includes('dmm-name')).children[0],
    '本地 alpha',
    '标题区先给名字'
  )
  assert.ok(tokens(line.children[2]).includes('dmm-actions'), '最右边是操作区')
  assert.deepEqual(line.children[2].children.map((node) => node.props['aria-label']), ['编辑 alpha', '删除 alpha'])
  // 工具清单不再铺在行里：行文本（排除浮层内容）只有名字、命名空间与状态 tag
  assert.equal(mounted.harness.findAll((node) => tokens(node).some((token) => token.startsWith('dmm-tools'))).length, 0)
  const lineText = textWithout(line, (node) => node.props.role === 'tooltip')
  assert.match(lineText, /本地 alpha/u)
  assert.match(lineText, /mcp__alpha__/u, '命名空间 chip 还在行上')
  assert.match(lineText, /已连接 · 2 个工具/u)
  assert.equal(lineText.includes('mcp__alpha__search'), false, '工具名只出现在浮层里')
})

test('工具浮层：连上且有工具时挂在「已连接 · N 个工具」tag 上，内容是可滚动的完整清单', async () => {
  const base = { id: 'srv-a', label: '', enabled: true, transport: 'stdio', serverName: 'alpha', command: 'node', args: [], cwd: '', env: {}, url: '', headers: {}, toolCallTimeoutMs: 60000, failOnStartupError: false }
  const live = { id: 'srv-a', serverName: 'alpha', state: 'mounted', error: '', mountedAt: 0, tools: ['mcp__alpha__search', 'mcp__alpha__list'], logs: [] }
  const rowFor = (patch) => ({ ...base, envKeys: [], headerKeys: [], credentialRefs: [], issues: [], live: null, blockedReason: '', conflictNote: '', ...patch })

  const mounted = await mountSection({ value: { enabled: true, servers: [base] }, servers: [rowFor({ live })] })
  const tag = mounted.harness.find((node) => String(node.props.className ?? '').includes('dmm-status'))
  assert.match(String(tag.children[0] ?? ''), /已连接 · 2 个工具/u, 'tag 上给短句')
  assert.equal(tag.props.title, undefined, '挂了浮层就不再挂原生 title（避免两层提示）')
  const tip = mounted.harness.find((node) => node.props.role === 'tooltip')
  assert.ok(tip !== undefined, 'tag 上必须挂浮层')
  const content = mounted.harness.find((node) => String(node.props.className ?? '').includes('dmm-tip-content'))
  assert.match(String(content.props.style?.maxHeight ?? ''), /^\d+px$/u, '内容高度受面板尺寸约束（这里给的是默认上限）')
  assert.deepEqual(
    mounted.harness.findAll((node) => String(node.props.className ?? '').includes('dmm-tip-name')).map((node) => node.children[0]),
    ['mcp__alpha__search', 'mcp__alpha__list'],
    '清单给的是模型看到的工具全名'
  )
  // 只在 tag 上悬停：标题区整块不吃指针事件（否则气泡会从窄 tag 右侧探出设置面板）
  const block = mounted.harness.find((node) => String(node.props.className ?? '').includes('dmm-title-block'))
  assert.ok(String(block.props.className).includes('tip'), '标题区要标记成浮层锚点')
  assert.ok(String(tag.props.className).includes('dmm-tip-trigger'), '只有 tag 自己是触发区')

  // 没连上 / 连上但没工具：都不要浮层（否则只是把 tag 上的话再说一遍）
  const idle = await mountSection({ value: { enabled: true, servers: [base] }, servers: [rowFor({ live: null })] })
  assert.equal(idle.harness.find((node) => node.props.role === 'tooltip'), undefined, '未挂载时不给浮层')
  assert.equal(String(idle.harness.find((node) => String(node.props.className ?? '').includes('dmm-status')).props.title).length > 0, true, '没浮层时用原生 title 兜底')

  const empty = await mountSection({
    value: { enabled: true, servers: [base] },
    servers: [rowFor({ live: { ...live, tools: [] } })]
  })
  assert.equal(empty.harness.find((node) => node.props.role === 'tooltip'), undefined, '没有工具时不给浮层')
})

test('凭据交互：点「凭据」就能加键，不需要用户手写 credential: 写法', async () => {
  const mounted = await mountSection()
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  // 一开始是直接填写：值输入框就是普通输入
  assert.equal(byAria(mounted.harness, '环境变量第 1 行名字'), undefined, '没有行时不渲染输入框')
  mounted.harness.click(mounted.harness.buttonByLabel('添加环境变量'))
  mounted.harness.change(byAria(mounted.harness, '环境变量第 1 行名字'), 'API_TOKEN')
  assert.equal(mounted.harness.text().includes('引用的凭据'), false, '还没点「凭据」，不该出现凭据区')

  // 点「凭据」：值输入换成「键名」输入框，凭据区随之出现
  mounted.harness.click(mounted.harness.buttonByLabel('环境变量第 1 行引用凭据'))
  const keyInput = byAria(mounted.harness, '环境变量第 1 行凭据键名')
  assert.ok(keyInput !== undefined, '凭据模式给的是"键名"输入框')
  assert.equal(mounted.harness.text().includes('引用的凭据'), false, '键名还没填时不显示空凭据行')
  mounted.harness.change(keyInput, 'MY_TOKEN')
  assert.match(mounted.harness.text(), /引用的凭据/u, '填了键名就该出现凭据区（值填在这里）')
  assert.equal(mounted.harness.buttonByLabel('保存凭据 MY_TOKEN') !== undefined, true, '凭据区里是这个键的保存按钮')

  // 再点一次回到直接填写：值回到前缀（key 非空时前缀为空）
  mounted.harness.click(mounted.harness.buttonByLabel('环境变量第 1 行引用凭据'))
  assert.equal(byAria(mounted.harness, '环境变量第 1 行凭据键名'), undefined, '切回来就不再是凭据模式')
})

test('凭据交互：请求头能填前缀（Bearer ）并选中用过的键名', async () => {
  const value = {
    enabled: true,
    servers: [
      {
        id: 'srv-a',
        label: '',
        enabled: true,
        transport: 'streamable-http',
        serverName: 'jira',
        command: '',
        args: [],
        cwd: '',
        env: {},
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer credential:JIRA_MCP_BASIC' },
        toolCallTimeoutMs: 60000,
        failOnStartupError: false
      },
      // 另一条服务器用过的键：应当出现在候选芯片里，方便复用（不必记名字）
      {
        id: 'srv-b',
        label: '',
        enabled: true,
        transport: 'streamable-http',
        serverName: 'jira2',
        command: '',
        args: [],
        cwd: '',
        env: {},
        url: 'https://example.test/mcp',
        headers: { Authorization: 'credential:MCP_JIRA_HEADERS_AUTHORIZATION' },
        toolCallTimeoutMs: 60000,
        failOnStartupError: false
      }
    ]
  }
  const mounted = await mountSection({ value })
  mounted.harness.click(mounted.harness.buttonByLabel('编辑 jira'))
  // 打开时就能认出既有条目里的凭据：拆成前缀 + 键名，而不是把 credential: 甩给用户
  assert.equal(byAria(mounted.harness, '请求头第 1 行前缀').props.value, 'Bearer ')
  assert.equal(byAria(mounted.harness, '请求头第 1 行凭据键名').props.value, 'JIRA_MCP_BASIC')
  // 候选键名：用过的键做成可点的小芯片（不用原生 datalist：箭头又小又不居中，用户截图反馈过）
  const chips = mounted.harness.findAll((node) => String(node.props['aria-label'] ?? '').startsWith('使用键名 '))
  assert.deepEqual(chips.map((node) => node.props['aria-label']), ['使用键名 MCP_JIRA_HEADERS_AUTHORIZATION'], '其它条目用过的键也要能一键选用')
  const keyInput = byAria(mounted.harness, '请求头第 1 行凭据键名')
  assert.equal(keyInput.props.list, undefined, '不再依赖原生 datalist 下拉')
  mounted.harness.click(mounted.harness.buttonByLabel('使用键名 MCP_JIRA_HEADERS_AUTHORIZATION'))
  assert.equal(
    byAria(mounted.harness, '请求头第 1 行凭据键名').props.value,
    'MCP_JIRA_HEADERS_AUTHORIZATION',
    '点一下候选键名就填进输入框'
  )
})

test('凭据交互：前缀是「不加前缀 / Bearer / Basic / 其它」四档，选其它才出现自由输入', async () => {
  const mounted = await mountSection()
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  const radios = mounted.harness.findAll((node) => node.tag === 'input' && node.props.type === 'radio')
  mounted.harness.change(radios[1], true)
  mounted.harness.click(mounted.harness.buttonByLabel('添加请求头'))
  mounted.harness.click(mounted.harness.buttonByLabel('请求头第 1 行引用凭据'))

  const select = byAria(mounted.harness, '请求头第 1 行前缀')
  assert.equal(select.tag, 'select', '前缀是档位下拉，不是让人猜的空文本框')
  assert.deepEqual(
    select.children.map((node) => node.children[0]),
    ['不加前缀', 'Bearer', 'Basic', '其它…']
  )
  assert.equal(byAria(mounted.harness, '请求头第 1 行前缀（自定义）'), undefined, '选档位时不显示自由输入')

  mounted.harness.change(select, 'Bearer ')
  assert.equal(byAria(mounted.harness, '请求头第 1 行前缀').props.value, 'Bearer ')
  mounted.harness.change(byAria(mounted.harness, '请求头第 1 行前缀'), '__custom__')
  const custom = byAria(mounted.harness, '请求头第 1 行前缀（自定义）')
  assert.ok(custom !== undefined, '选「其它」后要有自由输入框')
  mounted.harness.change(custom, 'Token ')
  assert.equal(byAria(mounted.harness, '请求头第 1 行前缀（自定义）').props.value, 'Token ')
  assert.equal(String(custom.props.className).includes('dmm-input'), true, '自定义前缀是普通输入框（不窄、和别的输入框同高）')
})

test('凭据区：拿不到凭据服务时给出可读原因，而不是静默失效', async () => {
  // remote.credentials 的读取是同步抛错的（没注入时），所以要能看到原因、按钮也不该装成可用
  const mountWithoutCredentials = async () => {
    const harness = createHarness()
    const registered = []
    const ctx = {
      configForms: { get: () => ({ getSnapshot: () => ({ value: { enabled: true, servers: [] } }), subscribe: () => () => {}, mutate: async () => {} }) },
      slots: { inject: (name, callback) => callback(), register: (slotOptions, Component) => registered.push({ slotOptions, Component }) },
      effect: (fn) => { fn() },
      get remote() {
        throw new Error('cannot get property "remote.credentials" without inject')
      }
    }
    const { exports } = loadBundle({ document: createStyleDocument(), react: harness.React, fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, csrf: 't', runtime: 'ready', servers: [], profileTargets: [] }) }) })
    exports.apply(ctx)
    const section = registered.find((entry) => entry.slotOptions.name === 'settings.section')
    const element = harness.React.createElement(section.Component, {})
    harness.render(element)
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.render(element)
    return { harness, element }
  }
  const { harness, element } = await mountWithoutCredentials()
  harness.click(harness.buttonByLabel('新增服务器'))
  harness.click(harness.buttonByLabel('添加环境变量'))
  harness.click(harness.buttonByLabel('环境变量第 1 行引用凭据'))
  harness.change(byAria(harness, '环境变量第 1 行凭据键名'), 'TOK')
  // 凭据状态是异步读的：让 load() 落地后再看
  await new Promise((resolve) => setTimeout(resolve, 0))
  harness.render(element)
  assert.match(harness.text(), /凭据服务不可用/u, '要把原因写在凭据区里')
  assert.match(harness.text(), /without inject/u, '原因要带上服务端的原话，便于排查')
  assert.equal(harness.buttonByLabel('保存凭据 TOK').props.disabled, true, '服务拿不到时按钮是灰的，点不动也说得清')
  assert.equal(
    harness.warnings.filter((warning) => /渲染未收敛/u.test(warning)).length,
    0,
    '渲染不能因为异常而反复重来'
  )
})

test('凭据区：状态是标签不是说明句，按钮与输入框同一行', async () => {
  const mounted = await mountSection()
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  mounted.harness.click(mounted.harness.buttonByLabel('添加环境变量'))
  mounted.harness.change(byAria(mounted.harness, '环境变量第 1 行名字'), 'API_TOKEN')
  mounted.harness.click(mounted.harness.buttonByLabel('环境变量第 1 行引用凭据'))
  mounted.harness.change(byAria(mounted.harness, '环境变量第 1 行凭据键名'), 'MY_TOKEN')

  const chip = mounted.harness.find(
    (node) => String(node.props.className ?? '').includes('dmm-status') && node.children[0] === '未配置'
  )
  assert.ok(chip !== undefined, '未配置要做成状态标签')
  const row = mounted.harness.find((node) => String(node.props.className ?? '').includes('dmm-cred-input-row'))
  assert.ok(row !== undefined, '输入框与按钮要在同一行容器里')
  assert.deepEqual(
    row.children.map((node) => node.tag),
    ['input', 'button', 'button'],
    '一行里依次是输入框、保存、清除'
  )
  assert.equal(mounted.harness.buttonByLabel('保存凭据 MY_TOKEN').props.className, 'dmm-btn-sm')
  assert.equal(mounted.harness.buttonByLabel('清除凭据 MY_TOKEN').props.className, 'dmm-btn-sm')
})

test('导入提示："已转入凭据库"这类文案不再出现在弹窗里（与字段旁的提示重复、删掉键后还会撒谎）', async () => {
  const { visibleNotes } = loadBundle().exports.__internals
  assert.deepEqual(plain(visibleNotes(['敏感字段已转入凭据库（A、B）：界面里这些字段是「凭据」形态，只显示键名、不回显值。'])), [])
  assert.deepEqual(plain(visibleNotes(['宿主没有可用的凭据服务，请在弹窗的凭据区手动填写值。'])), [
    '宿主没有可用的凭据服务，请在弹窗的凭据区手动填写值。'
  ])
  assert.deepEqual(plain(visibleNotes(undefined)), [])

  const mounted = await mountSection({
    profileTargets: [{ source: 'profile', entryId: 'include:mcp-jira-cloud', serverName: 'jira', transport: 'streamable-http', enabled: true, phase: 'active', endpoint: 'https://mcp.atlassian.com/v2/mcp', envKeys: [], headerKeys: ['Authorization'], hasSensitiveValues: true }],
    importResponse: {
      ok: true,
      value: { ok: true, draft: importedEntryStub, notes: ['敏感字段已转入凭据库（MCP_JIRA_HEADERS_AUTHORIZATION）：清单里只留 credential:键名，界面上不回显值。'] }
    }
  })
  mounted.harness.click(mounted.harness.buttonByLabel('导入'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  mounted.harness.render(mounted.element)
  assert.equal(mounted.harness.text().includes('已转入凭据库'), false, '弹窗里不该再出现这句')
})

test('凭据交互：键名候选只推"当前草稿还没用到的键"（否则一堆重复候选，看着乱）', async () => {
  const value = {
    enabled: true,
    servers: [
      {
        id: 'srv-a',
        label: '',
        enabled: true,
        transport: 'streamable-http',
        serverName: 'jira',
        command: '',
        args: [],
        cwd: '',
        env: {},
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer credential:JIRA_MCP_BASIC' },
        toolCallTimeoutMs: 60000,
        failOnStartupError: false
      },
      {
        id: 'srv-b',
        label: '',
        enabled: true,
        transport: 'streamable-http',
        serverName: 'jira2',
        command: '',
        args: [],
        cwd: '',
        env: {},
        url: 'https://example.test/mcp',
        headers: { Authorization: 'credential:OTHER_KEY' },
        toolCallTimeoutMs: 60000,
        failOnStartupError: false
      }
    ]
  }
  const mounted = await mountSection({ value })
  mounted.harness.click(mounted.harness.buttonByLabel('编辑 jira'))
  const labels = mounted.harness
    .findAll((node) => String(node.props['aria-label'] ?? '').startsWith('使用键名 '))
    .map((node) => node.props['aria-label'])
  assert.deepEqual(labels, ['使用键名 OTHER_KEY'], '别的条目用过的键要推荐，当前草稿已在用的键不要再列一遍')
})

test('凭据交互：改了键名/前缀后，保存时写进设置的是正确的 credential 占位符', async () => {
  const mounted = await mountSection()
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  mounted.harness.change(mounted.harness.inputByLabel('服务器名'), 'gamma')
  const radios = mounted.harness.findAll((node) => node.tag === 'input' && node.props.type === 'radio')
  mounted.harness.change(radios[1], true)
  mounted.harness.change(byAria(mounted.harness, 'URL'), 'http://127.0.0.1:1/mcp')
  mounted.harness.click(mounted.harness.buttonByLabel('添加请求头'))
  mounted.harness.change(byAria(mounted.harness, '请求头第 1 行名字'), 'Authorization')
  mounted.harness.click(mounted.harness.buttonByLabel('请求头第 1 行引用凭据'))
  mounted.harness.change(byAria(mounted.harness, '请求头第 1 行前缀'), 'Bearer ')
  mounted.harness.change(byAria(mounted.harness, '请求头第 1 行凭据键名'), 'gamma_token')

  mounted.harness.click(mounted.harness.buttonByLabel('保存'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const written = mounted.writes.filter((entry) => entry.field === 'servers').at(-1).value
  assert.deepEqual(plain(written[0].headers), { Authorization: 'Bearer credential:gamma_token' })
  assert.deepEqual(plain(written[0].env), {})
  assert.deepEqual(Object.keys(plain(written[0].headers)), ['Authorization'], '没填名字的行不该进设置')
})

test('纯函数：值里 credential: 的拆分与拼回（含非法键名、前后缀）', () => {
  const { splitCredential, joinCredential } = loadBundle().exports.__internals
  assert.equal(splitCredential('plain-value'), null)
  assert.deepEqual(plain(splitCredential('credential:TOK')), { prefix: '', key: 'TOK', suffix: '' })
  assert.deepEqual(plain(splitCredential('Bearer credential:TOK')), { prefix: 'Bearer ', key: 'TOK', suffix: '' })
  assert.deepEqual(plain(splitCredential('credential:TOK/suffix')), { prefix: '', key: 'TOK', suffix: '/suffix' })
  // 空键名 = 用户刚点开「凭据」还没填：仍是凭据模式，不能因为"键名不合法"就丢掉输入
  assert.deepEqual(plain(splitCredential('credential:')), { prefix: '', key: '', suffix: '' })
  assert.deepEqual(plain(splitCredential('credential:1bad')), { prefix: '', key: '', suffix: '1bad' })
  assert.equal(joinCredential({ prefix: 'Bearer ', key: 'TOK', suffix: '' }), 'Bearer credential:TOK')
  assert.equal(joinCredential(plain(splitCredential('credential:1bad'))), 'credential:1bad', '非法键名原样保留，不吞输入')
})

test('弹窗表单：服务器名与「(工具前缀为 mcp__<名字>__)」在同一行 label 上', async () => {
  const mounted = await mountSection()
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  const field = mounted.harness.fieldByLabel('服务器名')
  const label = field.children[0]
  assert.equal(label.tag, 'span')
  assert.deepEqual(label.children.map((node) => (typeof node === 'string' ? node : node.children[0])), ['服务器名', ' *', '(工具前缀为 mcp__<名字>__)'])
  assert.equal(
    (mounted.harness.text().match(/工具前缀为/gu) ?? []).length,
    1,
    '提示只在 label 里出现一次，不再单独占一行'
  )
})

test('接线守卫：点「+」打开弹窗表单（不落盘），且只有「保存」一个动作', async () => {
  const mounted = await mountSection()
  const writesBefore = mounted.writes.length
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  assert.equal(mounted.writes.length, writesBefore, '打开弹窗不得写设置（早先的版本会直接落一条连不上的空条目）')
  assert.ok(mounted.harness.inputByLabel('服务器名') !== undefined, '弹窗里要有表单字段')
  assert.equal(mounted.harness.buttonByLabel('验证'), undefined, '「验证」按钮已按用户要求去掉（保存时自动验证）')
  assert.notEqual(mounted.harness.buttonByLabel('保存').props.disabled, true, '保存应当可点')
  assert.equal(mounted.harness.text().includes('还没有验证'), false, '不再有那句提示')
})

test('接线守卫：URL 里写 credential:KEY 时，弹窗的凭据区给出这个键的输入框', async () => {
  const mounted = await mountSection()
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  const radios = mounted.harness.findAll((node) => node.tag === 'input' && node.props.type === 'radio')
  mounted.harness.change(radios[1], true)
  assert.equal(mounted.harness.text().includes('引用的凭据'), false, '没有占位符时不显示凭据区')
  mounted.harness.change(mounted.harness.inputByLabel('URL'), 'https://x.test/mcp?token=credential:URL_TOK')
  const text = mounted.harness.text()
  assert.match(text, /引用的凭据/u, 'URL 里出现占位符后要显示凭据区')
  assert.match(text, /URL_TOK/u, '凭据区要列出这个键')
  assert.match(text, /未配置/u)
})

test('接线守卫：点「保存」先自动验证，通过才写盘', async () => {
  const mounted = await mountSection()
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  mounted.harness.change(mounted.harness.inputByLabel('服务器名'), 'beta')
  // 切到 http 后 URL 字段才存在（radio 顺序 = stdio, streamable-http）
  const radios = mounted.harness.findAll((node) => node.tag === 'input' && node.props.type === 'radio')
  mounted.harness.change(radios[1], true)
  mounted.harness.change(mounted.harness.inputByLabel('URL'), 'http://127.0.0.1:1/mcp')

  mounted.harness.click(mounted.harness.buttonByLabel('保存'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  mounted.harness.render(mounted.element)
  const actionCalls = mounted.fetched.filter((entry) => String(entry.init?.body ?? '').includes('"verify"'))
  assert.equal(actionCalls.length, 1, '保存必须先调一次验证')
  assert.equal(mounted.harness.text().includes('验证通过'), false, '通过就存下并关窗，不再往界面写"验证通过"')

  const written = mounted.writes.filter((entry) => entry.field === 'servers').at(-1)
  assert.equal(written.value.length, 1)
  assert.equal(written.value[0].serverName, 'beta')
  assert.equal(written.value[0].transport, 'streamable-http')
  assert.equal(written.value[0].url, 'http://127.0.0.1:1/mcp')
})

test('接线守卫：验证失败时不落盘，弹窗留在原地显示宿主给的原因', async () => {
  const mounted = await mountSection({ verifyResponse: { ok: true, value: { ok: false, error: '连接超时，服务器没有在预期时间内响应' } } })
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  mounted.harness.click(mounted.harness.buttonByLabel('保存'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  mounted.harness.render(mounted.element)
  assert.match(mounted.harness.text(), /验证失败：连接超时/u, '原因要就地显示')
  assert.ok(mounted.harness.buttonByLabel('保存') !== undefined, '弹窗留着让人改')
  assert.equal(mounted.writes.filter((entry) => entry.field === 'servers').length, 0, '验证不通过绝不落盘')
})

test('接线守卫：每次保存都重新验证（不缓存上一次的结果）', async () => {
  const mounted = await mountSection()
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  mounted.harness.change(mounted.harness.inputByLabel('服务器名'), 'gamma')
  mounted.harness.click(mounted.harness.buttonByLabel('保存'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  mounted.harness.render(mounted.element)
  assert.equal(mounted.writes.filter((entry) => entry.field === 'servers').length, 1, '第一次保存会验证并落盘')

  // 第二次：编辑同一份（新开弹窗）再保存，累计两次 verify
  mounted.harness.click(mounted.harness.buttonByLabel('编辑 gamma'))
  mounted.harness.change(mounted.harness.inputByLabel('服务器名'), 'gamma2')
  mounted.harness.click(mounted.harness.buttonByLabel('保存'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const verifies = mounted.fetched.filter((entry) => String(entry.init?.body ?? '').includes('"verify"'))
  assert.equal(verifies.length, 2, '每次保存都要重新验证，不能复用上一次结果')
  assert.match(String(verifies[1].init.body), /gamma2/u, '第二次验的是改后的值')
})

test('接线守卫：编辑走同一个弹窗，预填现有值且保存写回新值', async () => {
  const value = {
    enabled: true,
    servers: [{ id: 'srv-a', label: '', enabled: true, transport: 'stdio', serverName: 'alpha', command: 'node', args: [], cwd: '', env: {}, url: '', headers: {}, toolCallTimeoutMs: 60000, failOnStartupError: false }]
  }
  const mounted = await mountSection({ value })
  mounted.harness.click(mounted.harness.buttonByLabel('编辑 alpha'))
  assert.equal(mounted.harness.inputByLabel('服务器名').props.value, 'alpha', '编辑要预填现有值')
  mounted.harness.change(mounted.harness.inputByLabel('服务器名'), 'omega')
  mounted.harness.click(mounted.harness.buttonByLabel('保存'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const updated = mounted.writes.filter((entry) => entry.field === 'servers').at(-1).value
  assert.equal(updated.length, 1, '编辑不应新增条目')
  assert.equal(updated[0].serverName, 'omega')
  assert.equal(updated[0].id, 'srv-a', 'id 必须保持不变')
})

test('接线守卫：启停开关写回 enabled，删除要经确认后写回', async () => {
  const value = {
    enabled: true,
    servers: [{ id: 'srv-a', label: '', enabled: true, transport: 'stdio', serverName: 'alpha', command: 'node', args: [], cwd: '', env: {}, url: '', headers: {}, toolCallTimeoutMs: 60000, failOnStartupError: false }]
  }
  const mounted = await mountSection({
    value,
    servers: [{ id: 'srv-a', serverName: 'alpha', enabled: true, transport: 'stdio', command: 'node', args: [], cwd: '', url: '', toolCallTimeoutMs: 60000, failOnStartupError: false, envKeys: [], headerKeys: [], credentialRefs: [], issues: [], live: { id: 'srv-a', serverName: 'alpha', state: 'mounted', error: '', mountedAt: 0, tools: ['mcp__alpha__t'], logs: [] }, blockedReason: '', conflictNote: '' }]
  })
  mounted.harness.click(mounted.harness.buttonByLabel('停用 alpha'))
  const toggled = mounted.writes.filter((entry) => entry.field === 'servers').at(-1)
  assert.equal(toggled.value[0].enabled, false, '开关必须写回停用状态')

  mounted.harness.click(mounted.harness.buttonByLabel('删除 alpha'))
  const confirm = mounted.harness.buttonByLabel('删除')
  assert.ok(confirm !== undefined, '删除必须先弹确认（不能直接删）')
  mounted.harness.click(confirm)
  assert.deepEqual(mounted.writes.filter((entry) => entry.field === 'servers').at(-1).value, [], '确认后写回空清单')
})

test('写后刷新：宿主对账晚一拍时，行上不得停留在旧的对账结论', async () => {
  const base = { id: 'srv-a', label: '', enabled: true, transport: 'stdio', serverName: 'alpha', command: 'node', args: [], cwd: '', env: {}, url: '', headers: {}, toolCallTimeoutMs: 60000, failOnStartupError: false }
  const stale = {
    ok: true,
    csrf: 'token',
    runtime: 'ready',
    settingsAvailable: true,
    mcpModule: { ok: true, strategy: 'loader-import', errors: [] },
    lastError: '',
    lastReconcile: { reason: 'startup', at: 1000, blocked: [{ id: 'srv-a', serverName: 'alpha', reason: 'stdio 传输必须填写可执行命令' }] },
    servers: [{ ...base, envKeys: [], headerKeys: [], credentialRefs: [], issues: [], live: null, blockedReason: 'stdio 传输必须填写可执行命令', conflictNote: '' }],
    totalEnabled: true,
    profileTargets: []
  }
  const fresh = {
    ...stale,
    lastReconcile: { reason: 'settings', at: 9999, blocked: [], mounted: ['alpha'] },
    servers: [{ ...stale.servers[0], blockedReason: '', live: { id: 'srv-a', serverName: 'alpha', state: 'mounted', error: '', mountedAt: 9999, tools: ['mcp__alpha__a', 'mcp__alpha__b'], logs: [] } }]
  }
  const mounted = await mountSection({
    value: { enabled: true, servers: [base] },
    statusSequence: [stale, stale, fresh]
  })
  // 列表行只有一行（用户要求"列表页改为一行，去掉工具说明"）：
  // 行上只给短标签，完整原因挪到 chip 的 title 上，细节点编辑看。
  const chip = mounted.harness.find((node) => String(node.props.className ?? '').includes('dmm-status'))
  assert.match(mounted.harness.text(), /配置不完整/u, '列表行给短标签')
  assert.equal(mounted.harness.text().includes('必须填写可执行命令'), false, '一行的行里不该再铺一整行原因')
  assert.match(String(chip?.props.title ?? ''), /必须填写可执行命令/u, '完整原因挂在 chip 的 title 上')

  // 走"编辑 → 验证 → 保存"这条路：写入会发生，但条目仍启用，
  // 于是行上的文字完全由宿主状态决定（停用会让它变成「已停用」，掩盖这件事）。
  mounted.harness.click(mounted.harness.buttonByLabel('编辑 alpha'))
  mounted.harness.click(mounted.harness.buttonByLabel('保存'))
  await new Promise((resolve) => setTimeout(resolve, 1600))
  mounted.harness.render(mounted.element)

  assert.ok(mounted.fetched.length >= 3, `必须重读到对账追上为止（实际读了 ${mounted.fetched.length} 次）`)
  const text = mounted.harness.text()
  assert.equal(text.includes('配置不完整'), false, '旧的对账结论必须被新结论替换')
  assert.match(text, /已连接 · 2 个工具/u, '列表行显示短句状态')
  assert.match(text, /mcp__alpha__a/u, '工具全名要出现在 tag 的浮层里')
  assert.match(text, /mcp__alpha__b/u)
})

test('宿主状态里没有 actions（客户端比宿主新）时，弹窗一打开就提示重启并禁用保存', async () => {
  const mounted = await mountSection({ actions: null })
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  const text = mounted.harness.text()
  assert.match(text, /还是旧版本/u)
  assert.match(text, /重启|dsh web/u)
  assert.equal(mounted.harness.buttonByLabel('保存').props.disabled, true, '宿主不支持验证，保存也无从校验')
})

test('宿主声明支持 verify 时，保存可用、不显示重启提示', async () => {
  const mounted = await mountSection({ actions: ['reconcile', 'verify'] })
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  assert.equal(mounted.harness.text().includes('还是旧版本'), false)
  assert.notEqual(mounted.harness.buttonByLabel('保存').props.disabled, true)
})

test('宿主是旧版本（没有 verify 接口）时，要明确提示去重启，而不是说成"验证失败"', async () => {
  const mounted = await mountSection({
    statusSequence: undefined,
    actions: ['reconcile', 'verify'],
    verifyResponse: { ok: false, error: 'unknown action "verify"' },
    verifyHttpStatus: 400
  })
  mounted.harness.click(mounted.harness.buttonByLabel('新增服务器'))
  mounted.harness.click(mounted.harness.buttonByLabel('保存'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  mounted.harness.render(mounted.element)
  const text = mounted.harness.text()
  assert.match(text, /还是旧版本/u, '要说清是宿主进程旧')
  assert.match(text, /重启|dsh web/u, '要给出下一步：重启 dsh web')
  assert.equal(text.includes('验证失败'), false, '这不是配置验证失败，别误导用户去改表单')
  assert.equal(mounted.writes.filter((entry) => entry.field === 'servers').length, 0, '宿主不支持验证时不会落盘')
})

test('导入：向宿主取完整配置（URL、请求头占位符都在），并显示敏感字段去向', async () => {
  const mounted = await mountSection({
    profileTargets: [{ source: 'profile', entryId: 'include:mcp-jira-cloud', serverName: 'jira', transport: 'streamable-http', enabled: true, phase: 'active', endpoint: 'https://mcp.atlassian.com/v2/mcp', envKeys: [], headerKeys: ['Authorization'], hasSensitiveValues: true }]
  })
  mounted.harness.click(mounted.harness.buttonByLabel('导入'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  mounted.harness.render(mounted.element)

  assert.equal(byAria(mounted.harness, 'URL').props.value, 'https://mcp.atlassian.com/v2/mcp', 'URL 必须带过来')
  // 敏感请求头导入后是「引用凭据」形态：界面给的是键名输入框 + 凭据区，不再是一行要用户维护的文本
  assert.equal(byAria(mounted.harness, '请求头第 1 行名字').props.value, 'Authorization')
  assert.equal(byAria(mounted.harness, '请求头第 1 行凭据键名').props.value, 'MCP_JIRA_HEADERS_AUTHORIZATION')
  assert.match(mounted.harness.text(), /凭据库/u, '要说明敏感字段去哪了')
  assert.equal(mounted.writes.filter((entry) => entry.field === 'servers').length, 0, '导入本身不写设置，仍要先验证')
  assert.notEqual(mounted.harness.buttonByLabel('保存').props.disabled, true, '导入后可以直接点保存（保存时会先验证）')
  assert.equal(
    mounted.harness.buttonByLabel('保存凭据 MCP_JIRA_HEADERS_AUTHORIZATION').props.disabled,
    true,
    '值还没填，凭据行自己的保存按钮是灰的'
  )

  // 送进宿主的 import 请求要带上 entryId
  const actionCalls = mounted.fetched.filter((entry) => String(entry.init?.body ?? '').includes('"import"'))
  assert.equal(actionCalls.length, 1)
  assert.match(String(actionCalls[0].init.body), /include:mcp-jira-cloud/u)
})
