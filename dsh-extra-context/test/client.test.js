import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

let definition
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
await import('../client.js')

/**
 * React 桩：足够真实以驱动组件跨渲染周期运行。
 *
 * 设计要点（都踩过坑，勿简化）：
 * - **按组件实例分池**：每个被求值的函数组件有自己的 hook 槽位池。
 *   曾用「三个全局游标 + 全局数组」的写法（`useState`/`useRef` 共用 cursor，
 *   `useCallback` 另用一个），父组件与子组件的槽位会互相推挤，
 *   于是同一个 `useRef` 位置在不同渲染轮次落到不同索引、返回**不同对象**：
 *   回调闭包捕获的 ref 与后续渲染用的 ref 不是同一个，
 *   表现为"失焦提交读不到待写内容"，越改越像产品缺陷。
 * - `useState` / `useRef` / `useCallback` / `useEffect` 各自独立游标，语义与 React 一致。
 * - `useCallback` 按依赖数组记忆化（不记忆化同样会制造假通过，见下方注释）。
 * - `createElement` 就地求值函数组件与类组件，于是遍历到的就是真实元素树。
 */
const harness = {
  /** 组件实例身份 → 该实例的 hook 槽位池 */
  instances: new Map(),
  /** 当前正在求值的组件实例槽位池 */
  current: null,
  /** 当前渲染轮次收集到的 effect，由 render() 在每轮结束后执行 */
  effects: [],
  effectCursor: 0
}

/** React 的依赖比较语义：长度相同且逐项 `Object.is`。 */
function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

/**
 * 取得某个组件实例的槽位池。
 *
 * 以函数对象身份为键：真实 React 里组件类型身份就是它的 `type`，
 * 渲染期间类型不变即实例不重挂载，hook 状态因此得以保留。
 */
function instanceFor(type) {
  let pool = harness.instances.get(type)
  if (pool === undefined) {
    pool = { states: [], refs: [], callbacks: [], effectSlots: [], cursor: 0, callbackCursor: 0, effectCursor: 0 }
    harness.instances.set(type, pool)
  }
  return pool
}

/** 以某个组件实例的身份求值一次函数组件。 */
function evaluate(type, props) {
  const previous = harness.current
  const pool = instanceFor(type)
  pool.cursor = 0
  pool.callbackCursor = 0
  pool.effectCursor = 0
  harness.current = pool
  try {
    return type(props)
  } finally {
    harness.current = previous
  }
}

function pool() {
  assert.notEqual(harness.current, null, 'hook 只能在函数组件求值期间调用')
  return harness.current
}

const React = {
  Component: class Component {
    constructor(props) { this.props = props || {} }
    setState() {}
    componentDidCatch() {}
    static getDerivedStateFromError() { return null }
  },
  createElement(type, props, ...children) {
    if (typeof type === 'function') {
      const merged = { ...(props || {}), children }
      if (type.prototype !== undefined && typeof type.prototype.render === 'function') {
        // 类组件：按实例身份保存，使错误边界的 state 跨渲染保留
        let instance = harness.classInstances?.get(type)
        if (instance === undefined) {
          instance = new type(merged)
          if (harness.classInstances === undefined) harness.classInstances = new Map()
          harness.classInstances.set(type, instance)
        } else {
          instance.props = merged
        }
        instance.props = merged
        // 模拟 React 的错误边界语义：render 抛错时先交给 getDerivedStateFromError，
        // 用它返回的 state 再渲染一次；没有这个方法就照原样抛出（与 React 一致）。
        // 少了这段，桩里的异常会一路冒泡出去，于是"错误边界有没有接在树上"根本无法验证。
        // 保留类实例的身份（与 React 一致：类组件对应一个元素，不是被展开的子节点），
        // 这样测试才能在渲染树里断言"错误边界确实接在树上"。子节点取它的 render 结果。
        let rendered
        try {
          rendered = instance.render()
        } catch (error) {
          const derive = typeof type.getDerivedStateFromError === 'function' ? type.getDerivedStateFromError.bind(type) : null
          if (derive === null) throw error
          const next = derive(error)
          if (next === null || typeof next !== 'object') throw error
          instance.state = { ...(instance.state ?? {}), ...next }
          if (typeof instance.componentDidCatch === 'function') instance.componentDidCatch(error)
          rendered = instance.render()
        }
        return { type, props: merged, children: [rendered], instance }
      }
      return evaluate(type, merged)
    }
    return { type, props: props || {}, children }
  },
  useEffect(fn, deps) {
    const slot = pool()
    const index = slot.effectCursor++
    const previous = slot.effectSlots[index]
    const changed = previous === undefined
      || deps === undefined
      || previous.deps === undefined
      || !sameDeps(previous.deps, deps)
    if (changed) harness.effects.push({ slot, index, fn, deps })
  },
  /**
   * `useCallback` 必须**真**按依赖数组记忆化。
   *
   * 曾写成 `useCallback(fn) { return fn }`（每次渲染返回新函数），后果是：
   * 即使真实 React 下回调标识稳定，桩里也会每轮变化，于是
   * `useEffect([flush])` 的清理函数每轮重跑——"卸载兜底写入"会在每次
   * 重渲染时被误触发，让"打字过程中不得写设置"的守卫在桩里恒为真。
   */
  useCallback(fn, deps) {
    const slot = pool()
    const index = slot.callbackCursor++
    const previous = slot.callbacks[index]
    if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.fn
    slot.callbacks[index] = { fn, deps }
    return fn
  },
  useRef(initial) {
    const slot = pool()
    const index = slot.cursor++
    if (slot.refs[index] === undefined) slot.refs[index] = { current: initial }
    return slot.refs[index]
  },
  useState(initial) {
    const slot = pool()
    const index = slot.cursor++
    if (slot.states.length <= index) {
      slot.states[index] = typeof initial === 'function' ? initial() : initial
    }
    return [slot.states[index], (next) => {
      slot.states[index] = typeof next === 'function' ? next(slot.states[index]) : next
    }]
  },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() }
}

/**
 * 布局阶段副作用：真实 React 里有，桩里与 `useEffect` 同义。
 * 导航图标补丁必须用 `useLayoutEffect` 安装（用 `useEffect` 会先画一帧齿轮），
 * 桩缺这个方法会让补丁组件在测试里直接抛错。
 */
React.useLayoutEffect = function useLayoutEffect(fn, deps) {
  React.useEffect(fn, deps)
}

/**
 * primitives 桩：只放 bundle 真正 import 的图标。
 * 多放会掩盖"引用了不存在的图标"这类错误——bundle 一旦 import 新图标就会立刻暴露。
 */
// 图标桩返回真实的 <svg> 元素，而不是 null：
// 浏览器里这些图标就是 svg，桩返回 null 会让"按钮里装的是什么"无法断言
// （曾经正是文本字符与 svg 混用导致两个按钮差 1.5px 对不齐）。
const primitives = {
  IconTriangleRightFill14: (props) => ({ type: 'svg', props: { ...(props || {}), viewBox: '0 0 14 14' }, children: [] }),
  // 与三角箭头同属 14 尺寸集；用 16 集（IconCloseOutline16）会大一圈
  IconCloseFill14: (props) => ({ type: 'svg', props: { ...(props || {}), viewBox: '0 0 14 14' }, children: [] }),
  // 设置页导航专用的 16 档图标：壳层那一列的图标都是 16 档
  IconContextInjectionOutline16: (props) => ({ type: 'svg', props: { ...(props || {}), viewBox: '0 0 16 16' }, children: [] })
}

function byteLengthOf(text) {
  return new TextEncoder().encode(text).length
}

function loadPlugin() {
  return definition.factory((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require: ${id}`)
  })
}

/** 深度遍历渲染结果：元素与纯文本子节点都会回调。 */
function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object') {
    visit(node)
    return
  }
  visit(node)
  walk(node.children, visit)
}

/** 收集所有元素节点。 */
function collect(node) {
  const nodes = []
  walk(node, (child) => {
    if (child !== null && typeof child === 'object') nodes.push(child)
  })
  return nodes
}

/** 收集渲染结果中所有可见文本。 */
function gatherStrings(node) {
  const strings = []
  walk(node, (child) => {
    if (typeof child === 'string') strings.push(child)
  })
  return strings
}

const COMPONENT_REFERENCE = /React\.createElement\(\s*([A-Z][\w$]*)/gu

/** bundle 里声明过的全部模块级标识符（函数、类、const/let/var，含解构）。 */
function declaredSymbols(source) {
  const declared = new Set()
  for (const match of source.matchAll(/(?:function|class)\s+([A-Za-z_$][\w$]*)/gu)) declared.add(match[1])
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gu)) declared.add(match[1])
  for (const match of source.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/gu)) {
    for (const piece of match[1].split(',')) {
      const name = piece.split(':').pop().trim().replace(/=.*$/u, '').trim()
      if (name !== '') declared.add(name)
    }
  }
  return declared
}

/** 默认宿主报告：一条规则。 */
function oneSegmentReport(overrides = {}) {
  return {
    ok: true,
    writable: true,
    enabled: true,
    notes: '',
    bytes: 7,
    estimatedTokens: 6,
    maxBytes: 8192,
    overBudget: false,
    rendered: '--- 额外上下文开始 ---\n\n用中文回答\n\n--- 额外上下文结束 ---',
    segments: [{ id: 'seg-1', label: '规则 1', enabled: true, order: 10, text: '用中文回答', bytes: 7, effective: true }],
    ...overrides
  }
}

/**
 * 挂载设置面板：真实走 apply() + 组件渲染，并驱动多个渲染周期。
 *
 * 针对两类真实回归的护栏：误删错误边界导致整页空白；动作没接进 actions
 * 导致点击箭头毫无反应。纯函数断言抓不到这两类问题。
 * @param {() => object} handler 状态接口返回的报告
 */
function mountPanel(handler, hooks = {}) {
  const plugin = loadPlugin()
  const timers = []
  /** 记录每次提交的 operations，用来断言"确实写入了"。 */
  const mutations = []
  /** 每次落地的 segments 快照（按提交顺序），供 afterWrite 钩子表达"读回值落后一拍"。 */
  const writeLog = []
  /**
   * 写入闸门：默认放行；测试可先挂起，用来观察"写入进行中"这一刻的真实 DOM。
   * 曾经做不到这一点，于是"输入控件不得被禁用"只能等写入结束后再断言——
   * 那时 busy 已经回落，断言恒真，缺陷（disabled: busy）照样通过。
   */
  let writeGate = null
  const gateWrite = () => new Promise((resolve) => { writeGate = resolve })
  const releaseWrites = () => { const resolve = writeGate; writeGate = null; if (resolve !== null) resolve() }
  // 模拟宿主：写入后报告随之变化（真实宿主在写入后会返回新的持久化内容）
  // 宿主侧状态：模拟真实宿主"写入后回读即最新"的行为。
  // enabled 也必须在这里跟住——曾漏掉它，于是 report.enabled 长期停留在默认 true，
  // 表现成"切了总开关、预览却不跟着变"（看起来像产品缺陷，其实是桩失真）。
  let hostState = { enabled: undefined, segments: undefined, notes: undefined }
  const report = () => {
    const base = handler()
    if (hostState.enabled !== undefined) base.enabled = hostState.enabled
    if (hostState.segments !== undefined) base.segments = hostState.segments
    if (hostState.notes !== undefined) base.notes = hostState.notes
    // 真实宿主会按当前设置重新渲染，桩也必须这样，否则"提交后读回旧值"会被误判为 UI 缺陷
    if (hostState.segments !== undefined) {
      const body = previewFor({
        enabled: base.enabled !== false,
        segments: (base.segments ?? []).map((segment) => ({
          enabled: segment.enabled !== false,
          text: typeof segment.text === 'string' ? segment.text : ''
        })),
        notes: typeof base.notes === 'string' ? base.notes : ''
      })
      base.rendered = body === '' ? '' : `以下内容由用户在 dsh-extra-context 中配置\n\n--- 额外上下文开始 ---\n\n${body}\n\n--- 额外上下文结束 ---`
      base.bytes = Buffer.byteLength(base.rendered, 'utf8')
      const value = base.rendered
      const cjk = (value.match(/[\u3000-\u9fff\uff00-\uffef]/gu) ?? []).length
      base.estimatedTokens = cjk + Math.ceil((value.length - cjk) / 4)
    }
    return base
  }

  /** 与宿主 renderExtraContext 的正文口径一致：只拼启用且非空的规则与备注。 */
  function previewFor(settings) {
    if (!settings.enabled) return ''
    const parts = settings.segments
      .filter((segment) => segment.enabled && segment.text.trim() !== '')
      .map((segment) => segment.text.trim())
    if (settings.notes.trim() !== '') parts.push(`【模型笔记】\n${settings.notes.trim()}`)
    return parts.join('\n\n')
  }
  const context = {
    /** 两个插槽的注册（设置页分区 + 导航图标挂载点），按插槽名取用 */
    registrations: [],
    settingsScope: {
      bind: () => ({
        getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: { enabled: true, segments: [], notes: '', maxBytes: 8192 } }),
        subscribe: () => () => {},
        mutate: async (operations) => {
          const gate = writeGate
          if (gate !== null) await gateWrite()
          // 钩子先跑：可以让指定的一次写入抛错，用来验证失败与重试语义
          if (typeof hooks.onMutate === 'function') hooks.onMutate(operations)
          mutations.push(operations)
          for (const operation of operations ?? []) {
            // 按 id 合并到既有完整记录：真实宿主存的就是完整 segment，
            // 界面提交时可能只改了某个字段，桩不能因此丢字段。
            if (operation?.path?.[0] === 'segments') {
              // 界面提交的是完整快照，但字段可能是空值（例如只改勾选时 text 仍是空串）；
              // 真实宿主存的是完整记录，所以空值不覆盖已有内容。
              const previous = new Map((hostState.segments ?? handler().segments ?? []).map((segment) => [segment.id, segment]))
              hostState.segments = operation.value.map((segment) => {
                const before = previous.get(segment.id) ?? {}
                return {
                  ...before,
                  ...segment,
                  label: segment.label !== '' ? segment.label : (before.label ?? segment.label),
                  text: segment.text.trim() !== '' ? segment.text : (before.text ?? segment.text)
                }
              })
            }
            if (operation?.path?.[0] === 'notes') hostState.notes = operation.value
            if (operation?.path?.[0] === 'enabled') hostState.enabled = operation.value
          }
          if (hostState.segments !== undefined) writeLog.push(hostState.segments)
          // 写入后宿主返回什么：默认就是上面同步出来的真实内容。
          // 钩子可改成任意内容，用来表达两种真实情形：
          // ① "被栅栏挡下、宿主仍是旧值"（验证写入校验）；
          // ② "读回值落后一拍"（验证写入完成时不得用旧值回滚在途输入）。
          // 钩子返回值会**绕过**上面的同步，语义就是"宿主最终呈现的样子"。
          if (typeof hooks.afterWrite === 'function') {
            const next = hooks.afterWrite(writeLog)
            if (next !== undefined) {
              hostState = { enabled: next.enabled, segments: next.segments, notes: next.notes }
              return
            }
          }
        },
        describe: () => ({ namespaces: [], writable: true })
      })
    },
    remote: {
      settings: {
        describe: async () => ({ ok: true, value: { writable: true, namespaces: [] } }),
        replace: async () => ({ ok: true })
      }
    },
    timer: {
      timeout: (callback, delay) => {
        // 只记录：自动写入（debounce）已移除，测试用它断言"没有任何延时写入"。
        timers.push({ callback, delay })
        return () => {}
      }
    },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, Component) => {
        // 按插槽名收：apply 现在注册两个插槽（设置页分区 + 导航图标挂载点），
        // "最后一次注册就是设置页组件"的老写法会让整套面板测试改成去渲染挂载点。
        context.registrations.push({ options, Component })
        return () => {}
      }
    }
  }
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => {
    // 钩子可让读回"还没返回"：用来精确构造"写入已落地、读回在路上"的那一刻
    if (typeof hooks.beforeReadback === 'function') await hooks.beforeReadback()
    return { ok: true, json: async () => report() }
  }
  plugin.apply(context, hooks.config ?? {})
  const sectionEntry = context.registrations.find((entry) => entry.options.name === 'settings.section')
  // 只在这里兜底断言分区存在；导航挂载点的接线由专门用例负责，
  // 放在这里会让"挂载点丢了"表现成整套面板用例一起红，掩盖真正的失败点。
  assert.equal(typeof sectionEntry?.Component, 'function', 'apply 必须注册设置页组件')

  // 等价于真实 React 的首次挂载：丢掉上一轮测试残留的实例池
  harness.instances.clear()
  harness.classInstances = new Map()
  harness.current = null

  const render = makeRender(() => sectionEntry.Component({}))

  /**
   * 让挂起的状态读取落地。
   *
   * 反复「渲染 → 等微任务」直到组件状态里出现宿主报告（`loadStatus` 的返回值带 ok 字段），
   * 而不是赌固定轮数——不同 Node 版本下微任务的落地时机不完全一致。
   */
  const settledReport = () => collectStates().find((state) => state !== null && typeof state === 'object' && state.ok === true)

  /** 反复渲染并等待微任务，直到条件满足（或轮数耗尽）。 */
  const pump = async (predicate, rounds = 16) => {
    let tree = render()
    for (let attempt = 0; attempt < rounds; attempt += 1) {
      if (predicate(tree)) return tree
      await new Promise((resolve) => setImmediate(resolve))
      tree = render()
    }
    return tree
  }

  const settle = async () => {
    let tree = render()
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (settledReport() !== undefined) break
      for (let tick = 0; tick < 3; tick += 1) await new Promise((resolve) => setImmediate(resolve))
      tree = render()
    }
    assert.notEqual(settledReport(), undefined, '状态接口读取必须在若干轮内落地')
    // 报告落地后组件还会收敛一次展开态（自动展开单条规则），再跑几轮让它稳定。
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve))
      tree = render()
    }
    return tree
  }

  return {
    render,
    settle,
    pump,
    timers,
    holdWrites() { writeGate = gateWrite() },
    releaseWrites,
    mutations,
    unmount() { globalThis.fetch = previousFetch }
  }
}

/**
 * 造一个渲染函数：像 React 一样只在依赖变化时重跑 effect。
 *
 * 不这样做的话，effect 会带着上一轮的闭包反复执行
 * （例如每次都发一次状态读取、把旧值写回状态），测试会看到与真实页面不同的行为。
 */
function makeRender(build) {
  return () => {
    harness.effects = []
    const tree = build()
    for (const effect of harness.effects) {
      const previous = effect.slot.effectSlots[effect.index]
      if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup()
      const cleanup = effect.fn()
      assert.equal(cleanup === undefined || typeof cleanup === 'function', true, 'effect 只能返回清理函数或 undefined')
      effect.slot.effectSlots[effect.index] = { deps: effect.deps, cleanup }
    }
    return tree
  }
}

/** 所有组件实例的 state 槽位（按实例、再按 hook 次序）。 */
function collectStates() {
  const all = []
  for (const pool of harness.instances.values()) all.push(...pool.states)
  return all
}

function findCaret(nodes) {
  return nodes.find((node) => node.type === 'button' && node.props['aria-expanded'] !== undefined)
}

function textareaCount(tree) {
  return collect(tree).filter((node) => node.type === 'textarea').length
}

test('bundle 以 CJS 惰性模型导出插件对象', () => {
  const plugin = loadPlugin()
  assert.equal(definition.id, 'dsh-extra-context')
  assert.deepEqual(plugin.inject, ['slots', 'settingsScope', 'timer'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(typeof plugin.__internals, 'object')
})

test('apply 绑定 settings 命名空间并注册设置页分区', () => {
  const plugin = loadPlugin()
  const state = { bound: null, slots: [], registrations: [] }
  const ctx = {
    settingsScope: {
      bind(spec) {
        state.bound = spec
        return { getSnapshot: () => ({ status: 'ready', value: {}, writable: true }), subscribe: () => () => {}, mutate: async () => {} }
      }
    },
    timer: {
      timeout: (callback, delay) => {
        // 只记录：自动写入（debounce）已移除，测试用它断言"没有任何延时写入"。
        timers.push({ callback, delay })
        return () => {}
      }
    },
    slots: {
      inject(name, callback) {
        state.slots.push(name)
        callback()
      },
      register(options, Component) {
        state.registrations.push({ options, Component })
        return () => {}
      }
    }
  }
  plugin.apply(ctx, {})

  assert.equal(state.bound.namespace, 'extra-context')
  assert.equal(typeof state.bound.decode, 'function')
  assert.deepEqual(state.slots, ['settings.section', 'settings.action'])
  const section = state.registrations.find((entry) => entry.options.name === 'settings.section')
  assert.equal(section.options.id, 'extra-context')
  assert.equal(section.options.order, 25)
  assert.equal(section.options.label, '额外上下文')
  // 导航图标补丁的挂载点：没有它，「额外上下文」在设置页导航里永远是壳层兜底的齿轮
  // （壳层 navIcon 只认 4 个官方 id），这条断言守的就是"补丁必须真的接在树上"。
  const navIcon = state.registrations.find((entry) => entry.options.name === 'settings.action')
  assert.notEqual(navIcon, undefined, '必须注册 settings.action 作为导航图标补丁的挂载点')
  assert.equal(navIcon.options.id, 'extra-context-nav-icon')
  assert.equal(typeof navIcon.Component, 'function')
  assert.equal(navIcon.options.label, undefined, '动作区插槽不需要 label（导航名归 section 那一行）')

  // 官方契约：spec.decode 收到的是 **section 值本身**（不是 {value} 包装）。
  // 曾经的实现写成 view.value，恒为 undefined → 面板读到的永远是默认值。
  const decoded = state.bound.decode({ enabled: false, segments: [{ text: 'x' }] })
  assert.equal(decoded.enabled, false, 'decode 必须按 section 值解析')
  assert.equal(decoded.segments.length, 1)
  assert.equal(typeof decoded.segments[0].id, 'string')
  assert.equal(state.bound.decode(undefined).segments.length, 0, '未配置时退回默认（空规则）')
})

test('回归护栏：设置面板能真正渲染，且 render 异常不会吞掉整页', async () => {
  const panel = mountPanel(oneSegmentReport)
  try {
    const tree = await panel.settle()
    const nodes = collect(tree)
    const texts = gatherStrings(tree)

    assert.equal(texts.includes('额外上下文'), true, '面板必须渲染出标题')
    assert.equal(texts.length > 3, true, '面板必须有可见内容，而不是空白')
    for (const node of nodes) {
      assert.notEqual(node.type, undefined, `元素类型不得为 undefined: ${JSON.stringify(node.props?.className)}`)
    }

    const Boundary = loadPlugin().__internals.SectionErrorBoundary
    assert.equal(typeof Boundary, 'function', '必须导出错误边界（曾被误删导致设置页空白）')
    // 结构性恒真断言换成有价值的契约断言：React 靠这个静态方法把异常转成 state。
    // 缺了它，类还在也不会捕获任何异常，设置页照样整页空白。
    const derived = Boundary.getDerivedStateFromError(new Error('boom'))
    assert.equal(derived !== null && typeof derived === 'object' && derived.error instanceof Error, true,
      'getDerivedStateFromError 必须把异常包装成 { error }')
    const failing = new Boundary({})
    failing.state = { error: new Error('boom') }
    assert.equal(JSON.stringify(failing.render()).includes('设置页渲染失败'), true, '错误边界必须就地显示失败信息')
  } finally {
    panel.unmount()
  }
})

test('回归护栏：错误边界必须真的接在渲染树上，而不是"类还在"', async () => {
  // 最可能的重构形态是"类还在、但没包住面板"——那时设置页会重新变成整页空白，
  // 而"类存在"的断言仍然通过。这里直接断言接线关系。
  //
  // 为什么不用"让子组件抛错"来验证：面板内部的状态读取自带 try/catch（那是刻意的
  // 防御），所以异常在到达边界之前就被消化了，根本走不到边界那条路。
  const internals = loadPlugin().__internals
  const Boundary = internals.SectionErrorBoundary
  const SectionComponent = internals.ExtraContextSection
  assert.equal(typeof Boundary, 'function', '必须导出错误边界类')
  assert.equal(typeof SectionComponent, 'function', '必须导出面板组件（用于接线断言）')

  const panel = mountPanel(oneSegmentReport)
  try {
    const tree = await panel.settle()
    // 渲染树里必须真的出现错误边界节点（而不是只有类定义）：
    // 每次 loadPlugin() 都是独立的 factory 实例，类引用不相等，故按结构特征定位。
    const boundaryNode = collect(tree).find((node) => typeof node.type === 'function'
      && node.type.name === 'SectionErrorBoundary'
      && typeof node.type.getDerivedStateFromError === 'function')
    assert.notEqual(boundaryNode, undefined, '渲染树里必须出现错误边界（否则抛错就是整页空白）')
    // 边界必须包住**面板组件本身**（而不是别的什么）。类实例上留存了接线证据：
    // client.js 注册时把面板组件作为 sectionComponent 传给边界。
    // 只看"树里有边界节点"是不够的——边界包错东西同样会漏掉面板的异常。
    // 跨实例引用比较不可用（每次 loadPlugin() 都是独立实例），按结构比较。
    const wrapped = boundaryNode.instance?.props?.sectionComponent
    assert.equal(typeof wrapped === 'function' && wrapped.name === SectionComponent.name, true,
      '边界必须通过 sectionComponent 接住面板组件本身')
  } finally {
    panel.unmount()
  }
})

test('规则默认收起：点击箭头展开，再点收起（真实渲染周期）', async () => {
  const panel = mountPanel(oneSegmentReport)
  try {
    let tree = await panel.settle()
    // 默认收起：不应有编辑区
    assert.equal(textareaCount(tree), 0, '规则默认收起')

    const caret = findCaret(collect(tree))
    assert.notEqual(caret, undefined, '必须有展开/收起箭头')
    assert.equal(caret.props['aria-expanded'], false, '默认收起时 aria-expanded 应为 false')

    // 点开 → 出现编辑区
    caret.props.onClick()
    tree = panel.render()
    assert.equal(textareaCount(tree), 1, '点击箭头必须展开')
    assert.equal(findCaret(collect(tree)).props['aria-expanded'], true)

    // 再点 → 收起
    findCaret(collect(tree)).props.onClick()
    tree = panel.render()
    assert.equal(textareaCount(tree), 0, '再点箭头必须收起')
  } finally {
    panel.unmount()
  }
})

test('界面只保留功能文案，不出现实现细节', async () => {
  const panel = mountPanel(oneSegmentReport)
  try {
    const texts = gatherStrings(await panel.settle())
    assert.equal(texts.includes('额外上下文'), true)
    // 顶部一行说明：作用范围 + 生效时机 + 看不到规则时的排查线索。
    // 时机文案必须与**实机结果**一致：改动只对新开的对话生效
    // （曾按 dsh-agent-loop 的源码推断改成"下一次请求就生效"，被实测推翻）。
    assert.equal(texts.some((text) => text.includes('附加到之后新开的对话里持续生效')), true, '顶部必须说明作用范围')
    assert.equal(texts.some((text) => text.includes('改动只影响新开的对话')), true, '顶部必须说明生效时机')
    assert.equal(texts.some((text) => text.includes('通常是该对话的 Agent 预设也定义了同名设置')), true, '顶部必须给出看不到规则时的排查线索')
    assert.equal(texts.some((text) => text.includes('下一次请求就生效')), false, '不得说"下一次请求就生效"（与实机结果不符）')
    const headerIndex = texts.findIndex((text) => text.includes('额外上下文'))
    const timingIndex = texts.findIndex((text) => text.includes('改动只影响新开的对话'))
    assert.equal(headerIndex !== -1 && timingIndex !== -1 && timingIndex <= headerIndex + 2, true, '生效时机应紧跟在顶部标题说明之后')
    // 刷新命令已移除：界面上不得再出现任何命令名
    assert.equal(texts.some((text) => text.includes('/context-refresh')), false, '不应再出现已移除的刷新命令')
    assert.equal(texts.some((text) => text.includes('添加规则')), true)

    // 说明：`tokens` 是用户明确要求的"消耗预览"用语（不是实现术语），故不在禁止之列；
    // `字节` 这类单位仍禁止，界面用"字符"表达体积。
    // 允许的描述性用语（面向使用者的功能说明）：系统指令 / 预设 / 规则 / 命令名。
    const banned = ['system prompt', 'section', 'order 204', 'deployment:extra-context', '宿主', '字节', '镜像', 'settings.yaml', 'AGENTS.md', 'schema', '预算']
    for (const term of banned) {
      assert.equal(texts.some((text) => text.includes(term)), false, `界面不应出现技术文案: ${term}`)
    }
  } finally {
    panel.unmount()
  }
})

test('顶部排版：标题与说明区分开，开关与添加规则同一行', async () => {
  const panel = mountPanel(oneSegmentReport)
  try {
    const tree = await panel.settle()
    const nodes = collect(tree)

    // 标题与说明是外面一层的两个子元素（由 gap 撑开间距），而不是同一个段落
    const heading = nodes.find((node) => node.props.className === 'dec-heading')
    assert.notEqual(heading, undefined, '标题区必须有独立的排版容器')
    const headingNodes = collect(heading)
    assert.equal(headingNodes.some((node) => node.props?.className === 'dec-title'), true, '标题必须在标题区内')
    const introLines = headingNodes.filter((node) => node.props?.className === 'dec-intro-line')
    assert.equal(introLines.length, 1, '说明必须是一句话，不拆成多行')

    // 开关与添加规则在同一行，且按钮之间有间距
    const actionRow = nodes.find((node) => typeof node.props.className === 'string' && node.props.className.split(' ').includes('dec-actions') && JSON.stringify(node.children).includes('添加规则'))
    assert.notEqual(actionRow, undefined, '添加规则必须与开关同一行')
    const gapRule = /\.dec-actions\{([^}]*)\}/u.exec(await readFile(new URL('../client.js', import.meta.url), 'utf8'))
    assert.notEqual(gapRule, null, '必须定义动作行样式')
    assert.equal(/gap:\s*[1-9][0-9]*px/u.test(gapRule[1]), true, '动作行必须用非零 gap 拉开按钮')
    const labels = gatherStrings(actionRow)
    assert.equal(labels.some((text) => text.includes('添加规则')), true)
    assert.equal(labels.some((text) => text === '已开启' || text === '已关闭'), true, '开关按钮必须与添加规则同一行')
    // 开关与添加规则使用同一套按钮外观（不再是自己那套胶囊样式）
    const rowButtons = collect(actionRow).filter((node) => node.type === 'button')
    const addButton = rowButtons.find((node) => JSON.stringify(node.children).includes('添加规则'))
    const switchButton = rowButtons.find((node) => JSON.stringify(node.children).includes('已开') || JSON.stringify(node.children).includes('已关'))
    assert.equal(typeof addButton.props.className, 'string')
    assert.equal(typeof switchButton.props.className, 'string')
    assert.equal(switchButton.props.className.split(' ').includes('dec-btn'), true, '开关必须使用与添加规则相同的按钮基类')
    assert.equal(addButton.props.className.includes('dec-switch'), false)
    assert.equal(switchButton.props.className.includes('dec-switch'), false, '不应再使用独立的胶囊开关样式')
    // 状态差异只能来自中性填充，不能再出现品牌描边（深色主题下 brand 是近白色，和相邻按钮不像一套）
    assert.equal(switchButton.props.className.includes('dec-btn-primary'), false, '开关不得使用品牌色按钮变体')
    assert.equal(switchButton.props.className.includes('dec-btn-on'), true, '开启态用中性填充变体')
    const neutral = /(^|\s)dec-btn-on(\s|$)/u.test(switchButton.props.className)
    assert.equal(neutral, true)
  } finally {
    panel.unmount()
  }
})

test('规则行只显示正文，不显示名称；添加按钮在列表之前', async () => {
  const panel = mountPanel(() => oneSegmentReport({
    // order 故意与数组顺序相反：用来证明列表按数组顺序展示，而不是按 order 排序
    segments: [
      { id: 'a', label: '长期偏好', enabled: true, order: 90, text: '第一条内容', bytes: 15, effective: true },
      { id: 'b', label: '规则 2', enabled: true, order: 10, text: '', bytes: 0, effective: false }
    ]
  }))
  try {
    const tree = await panel.settle()
    const texts = gatherStrings(tree)
    const nodes = collect(tree)

    assert.equal(texts.includes('第一条内容'), true, '显示正文摘要')
    assert.equal(texts.includes('未填写内容'), true, '空正文给出占位')
    assert.equal(texts.includes('长期偏好'), false, '规则行不得显示名称')
    assert.equal(texts.includes('规则 2'), false, '规则行不得显示名称')
    assert.equal(nodes.filter((node) => node.props.className === 'dec-input').length, 0, '不应有名称输入框')

    const addIndex = nodes.findIndex((node) => node.type === 'button' && JSON.stringify(node.children).includes('添加规则'))
    const rowIndexes = nodes.map((node, i) => (node.props.className === 'dec-item-row' ? i : -1)).filter((i) => i !== -1)
    assert.equal(addIndex !== -1 && rowIndexes.length === 2 && addIndex < rowIndexes[0], true, '添加按钮应在列表上方')

    // 列表数据层已不再依赖 order：这里只锁定"每条规则一行、内容来自该条规则自身"
    const previewTexts = nodes
      .filter((node) => typeof node.props.className === 'string' && node.props.className.split(' ').includes('dec-item-preview'))
      .map((node) => (Array.isArray(node.children) ? node.children.join('') : String(node.children)))
    assert.equal(previewTexts.length, 2, '两条规则各有一行摘要')
    assert.equal(previewTexts.includes('第一条内容'), true, '有内容的规则显示其正文摘要')
    assert.equal(previewTexts.includes('未填写内容'), true, '空内容规则显示占位摘要')
    // 位置编号必须是真实序号（曾因 index 未传入卡片而渲染成"第 NaN 条"）
    const orderLabels = nodes
      .filter((node) => typeof node.props.className === 'string' && node.props.className.split(' ').includes('dec-item-order'))
      .map((node) => (Array.isArray(node.children) ? node.children.join('') : String(node.children)))
    assert.equal(orderLabels.length, 2, '每行显示位置编号')
    assert.equal(orderLabels[0], '第 1 条')
    assert.equal(orderLabels[1], '第 2 条')
    assert.equal(orderLabels.some((label) => label.includes('NaN')), false, '位置编号不得出现 NaN')
  } finally {
    panel.unmount()
  }
})

test('预览常显：无需点击、不可关闭，且带消耗提示', async () => {
  const panel = mountPanel(oneSegmentReport)
  try {
    const tree = await panel.settle()
    const texts = gatherStrings(tree)

    // 直接可见，没有"预览/收起预览"按钮
    assert.equal(texts.some((text) => text.includes('用中文回答')), true, '预览内容应直接可见')
    assert.equal(collect(tree).some((node) => node.type === 'button' && JSON.stringify(node.children).includes('预览')), false, '不应再有预览开关按钮')

    // 消耗提示与正文同容器
    const cost = texts.find((text) => text.includes('tokens'))
    assert.notEqual(cost, undefined, '必须显示 token 消耗预览')
    // 预览标题已说明"会附加到每个对话"，消耗行不再重复这句话
    assert.equal(cost.includes('每次对话都会带上'), false, '消耗行不得重复标题里的说明')
    // 消耗数来自本地即时估算（预览与消耗必须跟着编辑立刻变），所以不能拿宿主的数字来断言
    const numbers = cost.match(/(\d+)/gu) ?? []
    assert.equal(numbers.length >= 2, true, '消耗行必须同时给出体积与 token 两个数字')
    assert.equal(numbers.every((value) => Number(value) > 0), true, '消耗数字必须为正')
    const container = collect(tree).find((node) => node.props.className === 'dec-preview')
    assert.notEqual(container, undefined, '预览必须有统一的带背景容器')
    const containerTexts = gatherStrings(container)
    assert.equal(containerTexts.some((text) => text.includes('tokens')), true, '消耗提示必须在预览容器内部')
    assert.equal(containerTexts.some((text) => text.includes('用中文回答')), true, '正文也在同一容器内')
    // ① 标题：在卡片之外（区块级标题），文字只有"预览"
    const heading = collect(tree).find((node) => node.props.className === 'dec-preview-heading')
    assert.notEqual(heading, undefined, '必须有区块级"预览"标题')
    assert.equal(gatherStrings(heading).join(''), '预览', '标题文字必须是"预览"')
    assert.equal(collect(container).some((node) => node.props.className === 'dec-preview-heading'), false, '标题不得放在卡片内部')
    assert.equal(/附加|生效|预设|refresh/u.test(gatherStrings(heading).join('')), false, '说明不得并入标题')

    // ② 说明：卡片内的首段分区，交代位置与生效方式
    const note = collect(container).find((node) => node.props.className === 'dec-preview-note')
    assert.notEqual(note, undefined, '说明必须是卡片内的首段')
    const noteText = gatherStrings(note).join('')
    assert.equal(noteText.includes('最前面'), true, '说明必须交代位置')
    assert.equal(noteText.includes('优先'), true, '说明必须交代优先级')
    // 不重复顶部已经讲过的"作用范围/被预设覆盖"，避免两处文案重复
    assert.equal(/新开|不受影响|同名设置/u.test(noteText), false, '预览说明不得重复顶部的范围说明')

    const scrollArea = collect(container).find((node) => node.props.className === 'dec-preview-text')
    assert.notEqual(scrollArea, undefined, '正文应有自己的滚动区')
    assert.equal(collect(container).some((node) => node.props.className === 'dec-preview-cost'), true, '消耗提示应是容器内的独立一行')
  } finally {
    panel.unmount()
  }

  const empty = mountPanel(() => oneSegmentReport({ rendered: '', segments: [], bytes: 0, estimatedTokens: 0 }))
  try {
    const texts = gatherStrings(await empty.settle())
    assert.equal(texts.some((text) => text.includes('不会向对话附加任何内容')), true)
    assert.equal(texts.some((text) => text.includes('还没有规则')), true, '空状态给出指引')
  } finally {
    empty.unmount()
  }
})

test('导入面板不依赖任何未定义的模块级符号', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const declared = declaredSymbols(source)
  const referenced = [...source.matchAll(COMPONENT_REFERENCE)].map((match) => match[1])
  const missing = [...new Set(referenced)].filter((name) => !declared.has(name))
  assert.deepEqual(missing, [], `组件引用了未定义的符号：${missing.join(', ')}`)
})

test('静态检查本身有效：缺少定义时必须报出该符号', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const broken = source.replace('class SectionErrorBoundary', 'class RenamedBoundaryForTest')
  const declared = declaredSymbols(broken)
  const referenced = [...broken.matchAll(COMPONENT_REFERENCE)].map((match) => match[1])
  const missing = [...new Set(referenced)].filter((name) => !declared.has(name))
  assert.equal(missing.includes('SectionErrorBoundary'), true, '静态检查必须能发现缺失的组件定义')
})

test('apply 必须按官方契约绑定设置命名空间：namespace + decode', () => {
  // 这条守的是两个真实缺陷：
  // ① decode 收到的是 **section 值本身**（不是 view）。曾写成收到 view 并取 view.value
  //    （恒为 undefined）→ 快照永远是默认值、面板读不到已保存的规则；
  // ② 命名空间写错会绑到别的插件的数据上（静默串数据）。
  const plugin = loadPlugin()
  const bound = []
  const registered = []
  const ctx = {
    settingsScope: {
      bind: (spec) => {
        bound.push(spec)
        return { mutate: async () => {}, getSnapshot: () => ({ value: null }) }
      }
    },
    slots: { inject: (_name, callback) => callback(), register: (options) => { registered.push(options); return () => {} } },
    timer: { timeout: () => () => {} }
  }
  plugin.apply(ctx, {})
  assert.equal(bound.length, 1, 'apply 必须恰好绑定一次设置命名空间')
  assert.equal(bound[0].namespace, 'extra-context', '命名空间必须与宿主一致')
  assert.equal(typeof bound[0].decode, 'function', '必须提供 decode')
  // decode 按官方契约收到 section 值本身
  const decoded = bound[0].decode({ enabled: false, segments: [{ id: 'a', text: 'x', enabled: true }], notes: 'n' })
  assert.equal(decoded.enabled, false, 'decode 必须读到真正的 section 值')
  assert.equal(decoded.segments.length, 1, 'decode 必须保留规则')
  assert.equal(decoded.notes, 'n', 'decode 必须保留备注')
  // 脏数据不得让 decode 抛错（面板会整页空白）
  for (const dirty of [undefined, null, 'x', 42, [], { segments: 'oops' }]) {
    const safe = bound[0].decode(dirty)
    assert.equal(typeof safe.segments.length, 'number', `脏数据 ${JSON.stringify(dirty)} 必须退化为可用的默认值`)
  }
  assert.equal(registered.length, 2, 'apply 必须注册设置页分区与导航图标挂载点')
  assert.equal(registered[0].id, 'extra-context', '分区 id 必须稳定（它决定设置项落点）')
  assert.equal(registered[1].id, 'extra-context-nav-icon', '导航图标挂载点的 id 必须稳定')
})

test('回归护栏：宿主返回的段数与提交不符时必须报错，不能当成功', async () => {
  // 真实场景：设置写入被 revision 栅栏或校验挡下，宿主仍是旧值。
  // 曾经这里静默通过，用户看到"改了但没生效"且毫无提示。
  let submitted = false
  const panel = mountPanel(oneSegmentReport, {
    onMutate: () => { submitted = true },
    // 提交后宿主仍返回**两条**（模拟没写进去）
    afterWrite: () => oneSegmentReport({
      segments: [
        { id: 'seg-1', label: '规则 1', enabled: true, order: 10, text: '用中文回答', bytes: 7, effective: true },
        { id: 'seg-2', label: '规则 2', enabled: true, order: 11, text: '额外的', bytes: 4, effective: true }
      ]
    })
  })
  try {
    let nodes = collect(await panel.settle())
    findCaret(nodes).props.onClick()
    nodes = collect(panel.render())
    const remove = nodes.find((node) => node.type === 'button' && node.props.title === '删除')
    remove.props.onClick()
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r))
    const tree = panel.render()
    assert.equal(submitted, true, '删除必须发起写入')
    assert.equal(gatherStrings(tree).some((text) => text.includes('写入未生效')), true, '提交与宿主不一致必须报错')
  } finally {
    panel.unmount()
  }
})

test('回归护栏：读取宿主状态失败必须给出错误，而不是把空面板当"没有规则"', async () => {
  const panel = mountPanel(() => { throw new Error('status route down') })
  try {
    for (let i = 0; i < 10; i += 1) { panel.render(); await new Promise((r) => setImmediate(r)) }
    const tree = panel.render()
    assert.equal(gatherStrings(tree).some((text) => text.includes('status route down')), true, '读取失败必须显示原因')
  } finally {
    panel.unmount()
  }
})

/**
 * 应用期副作用的收集器：真实 Cordis ctx 有 `effect(fn, label)`，插件用它登记样式表自清理。
 * 桩不提供的话，`installStyles` 的清理会静默不登记——与真实宿主行为不一致，测试也就失去意义。
 */
function trackEffects(context) {
  const cleanups = []
  context.effect = (setup, label) => {
    // Cordis 语义：`effect(setup)` 立刻执行 setup，并把它**返回的**函数当作清理器。
    // 桩如果只收集 setup（不同义），"引用计数递减/移除样式表"就永远测不到（踩过）。
    const dispose = typeof setup === 'function' ? setup() : undefined
    if (typeof dispose === 'function') cleanups.push({ fn: dispose, label })
    return dispose ?? (() => {})
  }
  return cleanups
}

/**
 * 假样式宿主：`<style>` 元素 + dataset↔attribute 映射 + head.appendChild 记录。
 *
 * dataset 用 Proxy 写穿到 attributes，与浏览器行为一致——插件是按 dataset 写、
 * 按 attribute 被 dsh-client-modules/HMR 认领的，桩不映射就会把这两者测成同一件事。
 */
function fakeStyleHost() {
  const created = []
  const byId = new Map()
  // dataset 的键 ↔ 属性名：`plugin` → `data-plugin`，`decOwner` → `data-dec-owner`
  const attributeName = (key) => `data-${key.replace(/[A-Z]/gu, (char) => `-${char.toLowerCase()}`)}`
  const documentStub = {
    getElementById: (id) => byId.get(id) ?? null,
    querySelector: (selector) => {
      const match = /^style\[data-dec-owner="([^"]+)"\]$/u.exec(selector)
      if (match === null) return null
      return created.find((element) => element.attributes['data-dec-owner'] === match[1]) ?? null
    },
    createElement: (tag) => {
      const element = {
        tagName: tag,
        attributes: {},
        textContent: '',
        parentNode: null,
        setAttribute(name, value) { this.attributes[name] = value }
      }
      element.dataset = new Proxy({}, {
        get: (_target, key) => element.attributes[attributeName(key)],
        set: (_target, key, value) => { element.attributes[attributeName(key)] = value; return true },
        deleteProperty: (_target, key) => { delete element.attributes[attributeName(key)]; return true }
      })
      return element
    },
    head: {
      appendChild(element) {
        created.push(element)
        element.parentNode = this
        if (element.id) byId.set(element.id, element)
      },
      removeChild(element) {
        const index = created.indexOf(element)
        if (index !== -1) created.splice(index, 1)
        element.parentNode = null
      }
    }
  }
  return { document: documentStub, created }
}

test('样式表由 apply() 插件级注入：打标签、引用计数、HMR 复用同一元素', () => {
  // 真实机制：dsh-client-modules 在 materialize 时会把当前所有**未打标签**的 <style>
  // 认领给"下一个"插件，而 client HMR 只删除 style[data-plugin=<自己的包名>]。
  // 不打标签 → 别人更新时你的样式被删、你更新时旧样式残留，且刷新才恢复。
  //
  // 注入者必须是**插件**（apply 时），不能是某个组件：样式要服务的不只是分区面板，
  // 还有设置页导航里的图标补丁，而后者的生命周期更长（面板一打开就存在，分区要等点开）。
  // 这条同时守着"插件级"和"引用计数"两件事。
  const plugin = loadPlugin()
  const host = fakeStyleHost()
  globalThis.document = host.document
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => oneSegmentReport() })
  const makeContext = () => ({
    settingsScope: { bind: () => ({ mutate: async () => {}, getSnapshot: () => ({ value: null }) }) },
    slots: { inject: (_n, cb) => cb(), register: () => () => {} },
    timer: { timeout: () => () => {} }
  })
  try {
    // 只 apply、不渲染任何组件：样式就必须已经在文档里（这正是修复前缺失的那一步）
    const first = makeContext()
    const firstCleanups = trackEffects(first)
    plugin.apply(first, {})
    assert.equal(host.created.length, 1, 'apply 时必须注入一份样式表，不依赖任何组件渲染')
    const element = host.created[0]
    assert.equal(element.id, 'dsh-extra-context-style', '样式表 id 必须稳定（给人/测试看的便利标识）')
    assert.equal(element.attributes['data-plugin'], 'dsh-extra-context', '样式表必须打 data-plugin 标签（HMR 靠它认领）')
    assert.equal(element.attributes['data-dec-owner'], 'dsh-extra-context-v1', '必须有宿主标识，用于认领自己那份样式')
    assert.equal(element.dataset.references, '1', '一个实例 = 计数 1')
    assert.equal(element.textContent.includes('dec-preview-text'), true, '样式必须包含预览区规则（预览要能看出内容与背景的区别）')
    assert.equal(element.textContent.includes('dec-nav-icon-template'), true, '样式必须包含导航图标补丁的规则')
    assert.equal(firstCleanups.length, 1, '必须登记样式表自清理（副作用可逆）')

    // 再次 materialize（HMR：旧 fiber 还在，新的已经 apply）：复用同一元素、计数 +1
    const second = makeContext()
    const secondCleanups = trackEffects(second)
    plugin.apply(second, {})
    assert.equal(host.created.length, 1, '不得重复注入：必须按宿主标识认领已有元素')
    assert.equal(element.dataset.references, '2', '每次 apply 都要记账')
    element.textContent = '过期文本'
    plugin.apply(second, {})
    assert.equal(element.textContent.includes('dec-preview-text'), true, '元素存活但文本过期时必须重写文本（否则 HMR 后仍是旧样式）')
    assert.equal(element.dataset.references, '3', '每次 apply 都要记账')

    // 旧 fiber 释放：只递减计数，元素保留（新实例还在用）
    firstCleanups[0].fn()
    assert.equal(element.dataset.references, '2', '释放只递减计数')
    assert.equal(element.parentNode === null, false, '还有实例在用，不得移除元素')
    secondCleanups[0].fn()
    secondCleanups[1].fn()
    assert.equal(element.dataset.references, '0', '全部释放后计数归零')
    assert.equal(element.parentNode, null, '计数归零必须把样式表移除（副作用可逆）')
  } finally {
    globalThis.fetch = previousFetch
    delete globalThis.document
  }
})

/**
 * 最小真假 document / 按钮：只实现导航图标补丁真正用到的接口。
 * 补丁的逻辑全是"找元素 → 打标记 → 回滚"，用假 DOM 就能把分支逐条打到位；
 * 真实几何（图标摆在哪、有多大）由浏览器里的固定场景验证，不在单测里假装测得到。
 */
function fakeNavButton(text) {
  const properties = new Map()
  return {
    textContent: text,
    dataset: {},
    style: {
      setProperty: (name, value) => { properties.set(name, value) },
      removeProperty: (name) => { properties.delete(name) },
      getProperty: (name) => properties.get(name)
    }
  }
}

function fakeNavDocument(buttons) {
  const observers = []
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      observers.push(this)
    }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  return {
    buttons,
    observers,
    body: {},
    defaultView: { MutationObserver: FakeMutationObserver },
    querySelectorAll: (selector) => (selector === 'nav button' ? buttons : [])
  }
}

test('导航图标补丁：只改本插件那一行，退出时干净还原（含引用计数与重建补回）', () => {
  // 壳层只给 4 个官方 id 配图标，"额外上下文"会回落成齿轮（用户实测反馈的正是这个）。
  // 补丁必须满足三件事：只动自己那一行、退出后还原成齿轮、壳层重建导航后能补回来。
  const { patchSettingsNavIcon } = loadPlugin().__internals
  const other = fakeNavButton('通用')
  const mine = fakeNavButton('额外上下文')
  // 前缀相同但不相等的行不得被匹配（用 includes 匹配就会误伤）
  const similar = fakeNavButton('额外上下文 备份')
  const doc = fakeNavDocument([other, mine, similar])

  const cleanup = patchSettingsNavIcon(doc, '<svg viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>', '额外上下文')

  assert.equal(mine.dataset.decNavIcon, '', '命中的那一行必须被打上标记（CSS 靠它生效）')
  const mask = String(mine.style.getProperty('--dec-nav-icon-mask'))
  assert.equal(mask.startsWith('url("data:image/svg+xml,'), true, 'mask 必须用 data: URI 的 SVG')
  assert.equal(mask.includes(encodeURIComponent('<svg viewBox="0 0 16 16">')), true, 'mask 必须是图标本身的源码')
  for (const untouched of [other, similar]) {
    assert.equal(untouched.dataset.decNavIcon, undefined, '别的行（含前缀相同的行）不得被改')
    assert.equal(untouched.style.getProperty('--dec-nav-icon-mask'), undefined, '别的行不得被塞 mask')
  }

  // 壳层重排导航（例如运行期插件增删分区）会重建按钮 → 观察者回调必须把它补回来
  const rebuilt = fakeNavButton('额外上下文')
  doc.buttons.push(rebuilt)
  doc.observers[0].callback()
  assert.equal(rebuilt.dataset.decNavIcon, '', '导航重建后补丁必须跟着补回来')

  // 二次挂载（热更新/重挂载）：引用计数，清一次不得提前还原
  const cleanupAgain = patchSettingsNavIcon(doc, '<svg viewBox="0 0 16 16"/>', '额外上下文')
  assert.equal(mine.dataset.decNavIconReferences, '2', '重复挂载必须记账')
  cleanup()
  assert.equal(mine.dataset.decNavIcon, '', '还有一个实例在用，不得还原')
  cleanupAgain()
  assert.equal(mine.dataset.decNavIcon, undefined, '最后一个实例退出必须还原成壳层齿轮')
  assert.equal(mine.dataset.decNavIconReferences, undefined, '标记要清干净，不留脏 dataset')
  assert.equal(mine.style.getProperty('--dec-nav-icon-mask'), undefined, '内联 mask 变量必须移除')
  assert.equal(doc.observers.every((observer) => observer.disconnected === true), true, '观察者必须断开，不能常驻')
})

test('导航图标补丁：前置条件不满足时安静退化，绝不抛错', () => {
  // 这条是"最差也只剩齿轮"的兜底：壳层结构变了、文档拿不到、图标为空，
  // 都不允许把异常抛到设置页（那会整页空白）。
  const { patchSettingsNavIcon, installNavIconPatch, navIconMaskSource } = loadPlugin().__internals
  const noopCases = [
    [null, '<svg/>'],
    [fakeNavDocument([]), ''],
    [fakeNavDocument([]), null]
  ]
  for (const [doc, source] of noopCases) {
    const cleanup = patchSettingsNavIcon(doc, source, '额外上下文')
    assert.equal(typeof cleanup, 'function', '退化路径必须仍返回可调用的清理函数')
    assert.doesNotThrow(() => cleanup())
  }
  assert.equal(typeof patchSettingsNavIcon({}, '<svg/>', '额外上下文'), 'function', '没有 querySelectorAll 的文档不得抛错')

  // 模板里没有 svg（壳层换了图标组件）→ 不装补丁
  const doc = fakeNavDocument([fakeNavButton('额外上下文')])
  const cleanup = installNavIconPatch({ querySelector: () => null }, doc)
  assert.doesNotThrow(() => cleanup())
  assert.equal(doc.buttons[0].dataset.decNavIcon, undefined, '取不到图标源码时不得装补丁')

  // 模板路径通：从 svg 的 outerHTML 取源码并补 xmlns
  const wired = installNavIconPatch({ querySelector: () => ({ outerHTML: '<svg width="16"></svg>' }) }, doc)
  const mask = String(doc.buttons[0].style.getProperty('--dec-nav-icon-mask'))
  assert.equal(mask.includes(encodeURIComponent('xmlns="http://www.w3.org/2000/svg"')), true, 'mask 源码必须补上 xmlns')
  assert.doesNotThrow(() => wired())
  assert.equal(doc.buttons[0].dataset.decNavIcon, undefined, '清理后必须还原')

  // 已有 xmlns 时不得重复插入
  const once = navIconMaskSource('<svg xmlns="http://www.w3.org/2000/svg" width="16"></svg>')
  assert.equal(once.match(/xmlns=/gu).length, 1, 'xmlns 不得重复插入')
  assert.equal(navIconMaskSource(''), '', '空源码返回空串（调用方据此跳过补丁）')
})

test('导航补丁的挂载点与样式必须三处同源（选择器 / 变量名 / dataset 键）', async () => {
  // 三处各写一遍字面量就会出现"改了代码不改 CSS"这类静默失效：
  // 补丁照打标记，但 CSS 匹配不到 → 用户看到的还是齿轮，而且没有任何报错。
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const flag = /const NAV_PATCH_FLAG = '([^']+)'/u.exec(source)
  const maskVariable = /const NAV_PATCH_MASK = '([^']+)'/u.exec(source)
  assert.notEqual(flag, null, '必须有 NAV_PATCH_FLAG 常量（dataset 键的唯一来源）')
  assert.notEqual(maskVariable, null, '必须有 NAV_PATCH_MASK 常量（CSS 变量的唯一来源）')
  const attribute = flag[1].replace(/[A-Z]/gu, (char) => `-${char.toLowerCase()}`)

  const rule = new RegExp(`\\[data-${attribute}\\]::before\\{[^}]*\\}`, 'u').exec(source)
  assert.notEqual(rule, null, '样式里必须有 ::before 规则（图标由它画出来）')
  assert.equal(rule[0].includes(`mask:var(${maskVariable[1]})`), true, 'CSS 必须使用与代码同一个 mask 变量')
  assert.equal(rule[0].includes('currentColor'), true, '图标必须用 currentColor 上色，才能跟随壳层的选中/悬停配色')
  assert.equal(rule[0].includes('flex:none'), true, '::before 是 flex item，必须固定尺寸，不能被挤压')

  const hideRule = new RegExp(`\\[data-${attribute}\\]>svg:first-child\\{[^}]*display:none[^}]*\\}`, 'u').exec(source)
  assert.notEqual(hideRule, null, '原 svg 必须被隐藏：否则齿轮与专属图标会叠在一起显示两个图标')

  // 必须在**布局阶段**安装：换成 useEffect 会先画出一帧齿轮再替换，用户看到图标闪一下。
  const navComponent = /function ExtraContextNavIcon\(\)[\s\S]*?\n    \}/u.exec(source)
  assert.notEqual(navComponent, null, '必须能找到导航挂载点组件')
  assert.equal(/React\.useLayoutEffect\(/u.test(navComponent[0]), true, '补丁必须在布局阶段安装（useLayoutEffect）')
})

test('导航补丁挂载点渲染隐藏模板，模板里是 16 档图标', () => {
  const plugin = loadPlugin()
  const registered = {}
  const context = {
    settingsScope: { bind: () => ({ mutate: async () => {}, getSnapshot: () => ({ value: null }) }) },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, Component) => { registered[options.name] = Component; return () => {} }
    },
    timer: { timeout: () => () => {} }
  }
  plugin.apply(context, {})

  const tree = React.createElement(registered['settings.action'], {})
  const template = collect(tree).find((node) => String(node.props.className).includes('dec-nav-icon-template'))
  assert.notEqual(template, undefined, '挂载点必须渲染出模板容器（补丁要从它取图标源码）')
  assert.equal(template.props['aria-hidden'], true, '模板只是源码载体，对读屏隐藏')
  const svg = collect(template).find((node) => node.type === 'svg')
  assert.notEqual(svg, undefined, '模板里必须有真实图标，否则补丁没有可用的 mask 源码')
  assert.equal(svg.props.viewBox, '0 0 16 16', '设置页导航那一列的图标都是 16 档')
})

test('回归护栏：apply 之后样式即已就位（不依赖任何组件渲染），标记组件只负责打标记', () => {
  // 实测缺陷（用户反馈："刷新后打开设置页，图标还是旧的齿轮；点一下额外上下文才对"）：
  // 样式注入原先挂在设置页分区组件上，而分区要等用户点开那一行才渲染
  // （壳层是 `renderSlot('settings.section', …, { only: active })`）；
  // 补丁却挂在 `settings.action`（面板一打开就渲染）。两者生命周期不再嵌套，
  // 于是"标记已打、CSS 未到"。现在注入移到 apply()（插件级），这条用例把它钉住：
  //   apply 之后——还没渲染任何组件——样式必须已经在文档里；挂载标记组件后必须已打上标记。
  const plugin = loadPlugin()
  const host = fakeStyleHost()
  const buttons = [fakeNavButton('通用'), fakeNavButton('额外上下文')]
  globalThis.document = {
    ...host.document,
    querySelectorAll: (selector) => (selector === 'nav button' ? buttons : []),
    body: {},
    defaultView: { MutationObserver: class { constructor(callback) { this.callback = callback } observe() {} disconnect() {} } }
  }
  try {
    const registered = {}
    const context = {
      settingsScope: { bind: () => ({ mutate: async () => {}, getSnapshot: () => ({ value: null }) }) },
      slots: {
        inject: (_name, callback) => callback(),
        register: (options, Component) => { registered[options.name] = Component; return () => {} }
      },
      timer: { timeout: () => () => {} }
    }
    trackEffects(context)
    plugin.apply(context, {})

    // 关键断言：一个组件都还没渲染，样式就必须已经在文档里
    assert.equal(host.created.length, 1, 'apply 时必须注入插件样式表（不依赖任何组件被渲染）')
    assert.equal(host.created[0].attributes['data-plugin'], 'dsh-extra-context', '样式表必须打 data-plugin 标签')
    assert.equal(host.created[0].textContent.includes('dec-nav-icon-template'), true, '样式表里必须含补丁相关规则')

    // 挂载标记组件（只做打标记）：桩 React 不接 ref，手动把模板塞进该实例的 ref 槽
    harness.effects = []
    React.createElement(registered['settings.action'], {})
    const pool = harness.instances.get(registered['settings.action'])
    assert.notEqual(pool, undefined, '标记组件必须被求值过（否则拿不到它的 hook 槽位）')
    pool.refs[0].current = { querySelector: () => ({ outerHTML: '<svg viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>' }) }
    for (const effect of harness.effects) effect.fn()

    assert.equal(host.created.length, 1, '标记组件不得再注入第二份样式表（注入者只有一个）')
    assert.equal(buttons[1].dataset.decNavIcon, '', '本插件那一行必须已打上标记')
    assert.equal(String(buttons[1].style.getProperty('--dec-nav-icon-mask')).startsWith('url("data:image/svg+xml,'), true, '必须已写入 mask 变量')
    assert.equal(buttons[0].dataset.decNavIcon, undefined, '别的行不得被改')
  } finally {
    delete globalThis.document
  }
})

test('坏数据不得让界面崩掉：规则 id 冲突、缺字段、超长摘要都要能渲染', async () => {
  // createSegmentId 的冲突分支与摘要折叠都是"数据脏了才走到"的路径，
  // 平时测不到，一旦在这里抛错就是整页空白（错误边界也救不回来）。
  const panel = mountPanel(() => oneSegmentReport({
    segments: [
      { id: 'a', enabled: true, text: 'a'.repeat(200) },
      { id: 'a', enabled: true, text: '同 id 的脏数据' },
      { id: 'a-2', enabled: true, text: '  ' }
    ]
  }))
  try {
    let tree = await panel.settle()
    assert.equal(gatherStrings(tree).some((text) => text.includes('设置页渲染失败')), false, '脏数据不得让整页报错')

    // 逐条断言，别用"任一命中"的析取：那种写法里 `'…'` 必然被超长那条满足，
    // 等于恒真，会漏掉"重复 id 的那条被整条丢弃"这种真实回归。
    const carets = collect(tree).filter((node) => node.type === 'button' && node.props['aria-expanded'] !== undefined)
    assert.equal(carets.length >= 3, true, '三条脏数据都必须渲染出可展开的行')
    for (const caret of carets) caret.props.onClick()
    const texts = gatherStrings(panel.render())
    assert.equal(texts.some((text) => text.includes('同 id 的脏数据')), true, '重复 id 的那条不得被整条丢弃')
    assert.equal(texts.some((text) => text.includes('未填写内容')), true, '空白正文必须显示"未填写内容"')

    // 添加一条：id 冲突时必须生成不重复的 id（否则新规则会和旧规则互相覆盖）
    const add = collect(tree).find((node) => node.type === 'button' && JSON.stringify(node.children).includes('添加规则'))
    assert.notEqual(add, undefined, '必须有添加规则按钮')
    const before = panel.mutations.length
    add.props.onClick()
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length > before, true, '添加必须提交')
    const submitted = panel.mutations[panel.mutations.length - 1][0]
    const ids = submitted.value.map((segment) => segment.id)
    assert.equal(new Set(ids).size, ids.length, '脏数据存在时新增规则也不得产生重复 id')
    assert.equal(gatherStrings(panel.render()).some((text) => text.includes('设置页渲染失败')), false, '添加时 id 冲突不得让整页报错')
  } finally {
    panel.unmount()
  }
})

test('备注功能默认关闭：不渲染入口，也不出现在预览里', async () => {
  // 默认关闭是明确的产品决定（模型维护的笔记会长期占用每轮上下文）。
  const panel = mountPanel(() => oneSegmentReport({ notes: '旧的备注内容' }))
  try {
    const tree = await panel.settle()
    assert.equal(collect(tree).filter((node) => node.type === 'textarea').length, 0, '默认收起时不应有任何输入框')
    // 展开规则后只应出现规则正文那一个，不得有备注输入框
    findCaret(collect(tree)).props.onClick()
    const expanded = panel.render()
    assert.equal(textareaCount(expanded), 1, '功能关闭时只应有规则正文输入框')
    assert.equal(collect(expanded).some((node) => String(node.props.className).includes('dec-textarea-notes')), false, '功能关闭时不得渲染备注输入框')
    assert.equal(gatherStrings(tree).some((text) => text.includes('旧的备注内容')), false, '功能关闭时备注不得出现在任何界面文案里')
    const preview = collect(tree).find((node) => node.props?.className === 'dec-preview-text')
    assert.equal(preview === undefined ? '' : gatherStrings(preview).join('').includes('旧的备注内容'), false, '功能关闭时备注不得进入预览（预览要对得上实际注入）')
  } finally {
    panel.unmount()
  }
})

test('备注功能打开：入口出现，输入同样失焦才写，并进入预览', async () => {
  const panel = mountPanel(() => oneSegmentReport({ notes: '' }), { config: { notes: true } })
  try {
    let tree = await panel.settle()
    const notesArea = collect(tree).find((node) => node.type === 'textarea' && String(node.props.className).includes('dec-textarea-notes'))
    assert.notEqual(notesArea, undefined, '功能打开后必须出现备注输入框')
    assert.equal(notesArea.props.disabled, false, '备注输入框不得被禁用')
    assert.equal(notesArea.props.value, '', '初始备注为空')

    const writesBefore = panel.mutations.length
    notesArea.props.onChange({ target: { value: '以后都用简体中文' } })
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length, writesBefore, '备注同样不得在打字过程中写设置')

    collect(panel.render()).find((node) => node.type === 'textarea' && String(node.props.className).includes('dec-textarea-notes')).props.onBlur()
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length > writesBefore, true, '备注失焦必须写入')
    assert.equal(panel.mutations[panel.mutations.length - 1][0].path[0], 'notes', '备注必须写到 notes 字段')

    tree = panel.render()
    const preview = collect(tree).find((node) => node.props?.className === 'dec-preview-text')
    assert.notEqual(preview, undefined, '预览必须存在')
    const body = gatherStrings(preview).join('')
    assert.equal(body.includes('以后都用简体中文'), true, '备注必须进入预览')
    assert.equal(body.includes('模型笔记'), true, '备注在预览里必须标明是模型笔记（避免被当成用户指令）')
  } finally {
    panel.unmount()
  }
})

test('回归护栏：读回未返回时不得用旧值回滚在途输入', async () => {
  // 产品侧守卫（client.js 的 commit 成功分支）：
  //   只在"没有新的待写改动"时才丢弃本地草稿，否则保持不动。
  //   写成无条件 setDraft(null) 时，写入落地与读回返回之间的窗口里，
  //   受控输入框会被旧读回值顶掉，用户在途敲的字静默消失。
  //
  // 这条测试的窗口构造方式（此前写错过一次，别再改成"等固定若干微任务"）：
  // 用 beforeReadback 同时挂住**第 2 次和第 3 次读回**——
  //   第 1 次读回 = 挂载时的初始读状态
  //   第 2 次读回 = 第一笔写入的校验读回
  //   第 3 次读回 = 在途那笔写入的校验读回
  // 于是"在途写入已落地、它的读回仍挂起"这一刻是稳定可断言的。
  let reads = 0
  const release = {}
  const panel = mountPanel(oneSegmentReport, {
    beforeReadback: async () => {
      reads += 1
      if (reads === 2 || reads === 3) await new Promise((resolve) => { release[reads] = resolve })
    }
  })
  const textareaValue = () => collect(panel.render()).find((node) => node.type === 'textarea')?.props.value
  try {
    let nodes = collect(await panel.settle())
    findCaret(nodes).props.onClick()

    // 第一笔写入：已提交内容
    collect(panel.render()).find((node) => node.type === 'textarea').props.onChange({ target: { value: '已提交内容' } })
    collect(panel.render()).find((node) => node.type === 'textarea').props.onBlur()
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length, 1, '第一笔写入必须已经落到宿主')
    assert.notEqual(release[2], undefined, '第一笔写入的校验读回必须仍挂起（窗口起点）')

    // 读回还没回来时，用户继续输入
    collect(panel.render()).find((node) => node.type === 'textarea').props.onChange({ target: { value: '在途输入' } })
    release[2]()
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length, 2, '在途那笔写入必须已经落到宿主')
    assert.notEqual(release[3], undefined, '在途写入的校验读回必须仍挂起（关键窗口）')
    assert.equal(textareaValue().includes('在途输入'), true, '读回未返回时不得用旧值回滚在途输入')

    // 放行最后一次读回，界面仍必须是用户最后输入的内容
    release[3]()
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(textareaValue().includes('在途输入'), true, '读回返回后也不得回滚')
  } finally {
    for (const key of Object.keys(release)) release[key]()
    panel.unmount()
  }
})

test('回归护栏：备注输入框在写入进行中同样不得被禁用', async () => {
  // 与规则正文同一类真实故障（给已聚焦元素加 disabled → 浏览器强制失焦），
  // 但备注框曾不在守护范围内：把它的 disabled 改成 busy，全套测试仍会通过。
  const panel = mountPanel(() => oneSegmentReport({ notes: '' }), { config: { notes: true } })
  try {
    await panel.settle()
    const notesArea = () => collect(panel.render()).find((node) => node.type === 'textarea'
      && String(node.props.className).includes('dec-textarea-notes'))
    assert.notEqual(notesArea(), undefined, '功能打开后必须出现备注输入框')

    notesArea().props.onChange({ target: { value: '写备注的过程中' } })
    panel.holdWrites()
    notesArea().props.onBlur()
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length, 0, '闸门未放行时不得已写入')
    assert.equal(notesArea().props.disabled, false, '写入进行中备注输入框不得被禁用')
    assert.equal(notesArea().props.value, '写备注的过程中', '写入进行中备注内容不得回滚')

    panel.releaseWrites()
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(notesArea().props.disabled, false, '写入结束后备注输入框也不得被禁用')
  } finally {
    panel.releaseWrites()
    panel.unmount()
  }
})

test('规则行的字数必须与用户看到的字数一致（不得用字节数冒充）', async () => {
  // 用户实测反馈："为什么规则的字符统计跟我看到的字数不一致?"
  // 根因：界面显示的是 UTF-8 **字节**数（一个汉字 3 字节），却写着"字"——
  // 实测一条 67 字的规则显示成 183，差 2.7 倍。
  const { characterCount } = loadPlugin().__internals
  assert.equal(typeof characterCount, 'function', '必须导出字符计数（用于断言口径）')

  // 纯函数口径：中文按字算、emoji 按"一个可见字符"算
  assert.equal(characterCount('中文四个字'), 5, '中文按字计数')
  assert.equal(characterCount(''), 0, '空串为 0')
  assert.equal(characterCount('abc'), 3, 'ASCII 按字符计数')
  assert.equal(characterCount('✅'), 1, '单码点符号算一个')
  assert.equal(characterCount('👨‍👩‍👧'), 1, '零宽连接符组合的 emoji 算一个（字素簇口径）')
  assert.equal(characterCount(undefined), 0, '非字符串按 0 处理，不得抛错')

  // 与字节数明确区分：中文下字节数约为字符数的 3 倍
  const cjk = '所有思维链'
  assert.equal(characterCount(cjk), 5, '中文 5 字')
  assert.equal(characterCount(cjk) === byteLengthOf(cjk), false, '字符数不得等于字节数（中文下必然不等）')

  // 端到端：界面那个数字必须等于正文的字符数
  const text = '所有思维链/回复/思考过程/工具使用/调用子代理等等, 只要涉及到给我展示的部分'
  const panel = mountPanel(() => oneSegmentReport({
    segments: [{ id: 'seg-1', label: '规则 1', enabled: true, text, bytes: text.length, effective: true }]
  }))
  try {
    const nodes = collect(await panel.settle())
    findCaret(nodes).props.onClick()
    const shown = gatherStrings(panel.render()).find((piece) => /^\d+ 字$/u.test(piece))
    assert.notEqual(shown, undefined, '展开后必须显示字数')
    const shownNumber = Number(/^(\d+) 字$/u.exec(shown)[1])
    assert.equal(shownNumber, characterCount(text), `界面字数(${String(shownNumber)})必须等于实际字符数(${String(characterCount(text))})`)
    assert.equal(shownNumber === new TextEncoder().encode(text).length, false, '不得再显示字节数')
  } finally {
    panel.unmount()
  }
})

test('回归护栏：两个图标按钮必须内容同型且几何一致（否则会差 1~2px 对不齐）', async () => {
  // 用户实测反馈："✕ 和 ▶ 不在同一水平线上"。
  // 量出来的原因：两个按钮 class 相同，但一个装**文本字符** '✕'、一个装 **SVG 图标**，
  // 基线对齐规则不同 → 垂直中心差 1.5px；字符还比图标大一圈，看着粗细也不一致。
  //
  // 修法：两者都换成官方图标组件（同来源、同尺寸），并让按钮用 flex 居中。
  // 这条测试同时守这两点——改成文本字符、或换成别的尺寸变体都会失败。
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const buttonRules = [...source.matchAll(/\.dec-icon-btn\{[^}]*\}/gu)].map((match) => match[0])
  assert.equal(buttonRules.length > 0, true, '必须定义图标按钮样式')
  for (const rule of buttonRules) {
    assert.equal(/display:inline-flex/u.test(rule), true, '图标按钮必须用 flex 居中，不能靠基线对齐')
    assert.equal(/align-items:center/u.test(rule), true, '图标按钮必须垂直居中内容')
    assert.equal(/justify-content:center/u.test(rule), true, '图标按钮必须水平居中内容')
  }
  assert.equal(/^\s*\}, '✕'\)/mu.test(source), false, '删除按钮不得再用文本字符 ✕（会与 SVG 箭头错位）')
  const iconImports = /const \{ ([^}]+) \} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u.exec(source)
  assert.notEqual(iconImports, null, '必须从官方图标集导入图标')
  // 关键：两个图标必须来自**同一尺寸集**（都以 14 结尾）。
  // 跨档搭配过一次（IconCloseOutline16 + IconTriangleRightFill14），
  // 实测 12x12 vs 5x8，视觉上一个明显大一圈。
  const iconNames = iconImports[1].split(',').map((piece) => piece.trim()).filter((piece) => piece !== '')
  assert.equal(iconNames.length >= 2, true, '必须同时导入关闭与三角图标')
  // 关键：**同一行里**的两个图标必须来自同一尺寸集（都以 14 结尾）。
  const rowIcons = iconNames.filter((name) => name.includes('Close') || name.includes('TriangleRight'))
  assert.equal(rowIcons.length, 2, '规则行必须导入关闭与展开两个图标')
  for (const name of rowIcons) {
    assert.equal(/14$/u.test(name), true, `规则行图标 ${name} 必须属于 14 尺寸集（与同一行其它图标同档）`)
  }
  // 其余导入只允许设置页导航那一个：导航整列都是 16 档，与规则行不同行、不受上面的同档约束。
  // 这条同时守着"别顺手再加第三个图标"——新增图标前必须先确定它属于哪一档、跟谁同行。
  const navIcons = iconNames.filter((name) => !rowIcons.includes(name))
  assert.deepEqual(navIcons, ['IconContextInjectionOutline16'], '除规则行两个图标外，只允许导入导航图标（16 档）')
  assert.equal(iconNames.some((name) => name.includes('Close')), true, '必须导入关闭图标')
  assert.equal(iconNames.some((name) => name.includes('TriangleRight')), true, '必须导入展开三角图标')

  const panel = mountPanel(oneSegmentReport)
  try {
    const tree = await panel.settle()
    const iconButtons = collect(tree).filter((node) => node.type === 'button'
      && String(node.props.className).includes('dec-icon-btn'))
    assert.equal(iconButtons.length >= 2, true, '规则行必须有删除与展开两个图标按钮')
    for (const button of iconButtons) {
      const content = Array.isArray(button.children) ? button.children : [button.children]
      assert.equal(content.some((child) => child !== null && typeof child === 'object'), true,
        `图标按钮必须装 SVG 图标而不是文本字符（title=${String(button.props.title)}）`)
      assert.equal(content.some((child) => typeof child === 'string'), false,
        `图标按钮不得混入文本字符（title=${String(button.props.title)}）`)
    }
  } finally {
    panel.unmount()
  }
})

test('回归护栏：总开关点击必须当场提交，并同步预览', async () => {
  // 总开关曾只在失败场景被点过（没有成功路径断言）：漏掉提交会表现为"切了像没切"。
  const panel = mountPanel(oneSegmentReport)
  try {
    let tree = await panel.settle()
    const switchButton = collect(tree).find((node) => node.type === 'button'
      && (JSON.stringify(node.children).includes('已开启') || JSON.stringify(node.children).includes('已关闭')))
    assert.notEqual(switchButton, undefined, '必须有总开关')

    const before = panel.mutations.length
    switchButton.props.onClick()
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length > before, true, '切换总开关必须当场提交')
    const submitted = panel.mutations[panel.mutations.length - 1]
    assert.equal(submitted[0].path[0], 'enabled', '提交的必须是 enabled 字段')
    assert.equal(submitted[0].value, false, '提交内容必须反映新的开关状态')

    // 关闭后预览必须立刻变空（总开关是硬开关，预览要与注入口径一致）
    tree = panel.render()
    const preview = collect(tree).find((node) => node.props?.className === 'dec-preview-text')
    const body = preview === undefined ? '' : gatherStrings(preview).join('')
    assert.equal(body.includes('用中文回答'), false, '关闭后预览不得再显示规则正文')
    assert.equal(body.includes('额外上下文开始'), false, '关闭后预览不得再渲染包裹结构')
  } finally {
    panel.unmount()
  }
})

test('回归护栏：添加规则必须提交、生成不重复的 id，并把新卡片展开', async () => {
  const panel = mountPanel(oneSegmentReport)
  try {
    let tree = await panel.settle()
    const add = collect(tree).find((node) => node.type === 'button' && JSON.stringify(node.children).includes('添加规则'))
    assert.notEqual(add, undefined, '必须有添加规则按钮')

    const before = panel.mutations.length
    add.props.onClick()
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length > before, true, '添加必须提交')
    const submitted = panel.mutations[panel.mutations.length - 1][0]
    assert.equal(submitted.path[0], 'segments', '提交的必须是 segments')
    assert.equal(submitted.value.length, 2, '必须提交包含新规则在内的完整列表')
    const ids = submitted.value.map((segment) => segment.id)
    assert.equal(new Set(ids).size, ids.length, '新规则的 id 不得与已有规则重复')

    // 新卡片必须展开（否则用户点了"添加"却看不到输入框）
    const textareas = collect(panel.render()).filter((node) => node.type === 'textarea')
    assert.equal(textareas.length >= 1, true, '添加后必须能看到新规则的输入框')
  } finally {
    panel.unmount()
  }
})

test('页面显示可核对的构建版本', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const build = /const CLIENT_BUILD = '([^']+)'/u.exec(source)
  assert.notEqual(build, null, 'bundle 必须有构建标识')
  const panel = mountPanel(oneSegmentReport)
  try {
    const texts = gatherStrings(await panel.settle())
    assert.equal(texts.some((text) => text.includes(build[1])), true, '页面必须显示当前构建版本，便于核对刷新是否生效')
  } finally {
    panel.unmount()
  }
})

test('回归护栏：写入失败后错误停留，重试必须真的重写失败的内容', async () => {
  // 两个真实缺陷一起守：
  // ① 失败后必须保留错误（唯一允许的提示），不允许静默失败；
  // ② "重试"必须重写**失败的那份补丁**——曾写成 flush({})（空补丁），
  //    点了等于什么都没做，用户的改动在失败后静默消失。
  let failNext = false
  let stored = null
  const panel = mountPanel(oneSegmentReport, {
    onMutate: (operations) => {
      if (failNext) throw new Error('mirror down')
      stored = operations
    }
  })
  try {
    let nodes = collect(await panel.settle())
    findCaret(nodes).props.onClick()
    nodes = collect(panel.render())
    const textarea = nodes.find((node) => node.type === 'textarea')
    textarea.props.onChange({ target: { value: '失败后必须留住的内容' } })

    failNext = true
    collect(panel.render()).find((node) => node.type === 'textarea').props.onBlur()
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r))

    let errorTree = panel.render()
    assert.equal(gatherStrings(errorTree).some((text) => text.includes('写入失败')), true, '写入失败必须报错')
    // 错误文案不得**建议**刷新：草稿只在组件内存里，刷新会把没写进去的内容一起丢掉。
    // （曾写"请刷新页面后重试"——那句话本身就是一条数据丢失的操作指引。
    //  注意这里判的是"请刷新/刷新后重试"这种建议句式，而不是"刷新"二字：
    //  文案需要明确提醒"先不要刷新"，所以"刷新"这个词本身必须出现。）
    const errorText = gatherStrings(errorTree).join('')
    assert.equal(/请刷新|刷新后重试|刷新页面后/.test(errorText), false, '不得建议刷新（会丢未写入内容）')
    assert.equal(errorText.includes('先不要刷新'), true, '必须明确警告不要刷新')
    assert.equal(errorText.includes('重试'), true, '必须指向重试入口')
    const retry = collect(errorTree).find((node) => node.type === 'button' && JSON.stringify(node.children).includes('重试'))
    assert.notEqual(retry, undefined, '错误必须带重试入口')

    // 错误必须停留：再渲染几轮也不得自己消失
    for (let i = 0; i < 4; i += 1) { await new Promise((r) => setImmediate(r)); errorTree = panel.render() }
    assert.equal(gatherStrings(errorTree).some((text) => text.includes('写入失败')), true, '错误提示不得自动消失')

    // 重试：闸门打开，这次必须把失败的那份内容写进去
    const writesBeforeRetry = panel.mutations.length
    failNext = false
    collect(errorTree).find((node) => node.type === 'button' && JSON.stringify(node.children).includes('重试')).props.onClick()
    // 重试经由 timer 服务离开本次点击的渲染周期（真实部署里它下一拍就执行）
    for (const timer of panel.timers) timer.callback()
    for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)) }
    const afterRetry = panel.render()
    assert.equal(gatherStrings(afterRetry).some((text) => text.includes('写入失败')), false, '重试成功后错误必须消失')
    assert.equal(panel.mutations.length > writesBeforeRetry, true, '重试必须真的发起写入')
    assert.notEqual(stored, null, '重试必须写入内容')
    assert.equal(stored[0].value[0].text, '失败后必须留住的内容', '重试必须重写失败的那份内容，而不是空补丁')
  } finally {
    panel.unmount()
  }
})

test('刷新场景：镜像未就绪时先到宿主报告，箭头依然可用且不被弹回', async () => {
  // 复现用户报告的问题：刷新后设置镜像还在加载，宿主报告先到；
  // 此时点击箭头必须能收起，且后续渲染不得把它弹回。
  const plugin = loadPlugin()
  const timers = []
  let Component
  let mirrorValue
  const context = {
    settingsScope: {
      bind: () => ({
        getSnapshot: () => ({ status: mirrorValue === undefined ? 'loading' : 'ready', writable: true, revision: 1, value: mirrorValue }),
        subscribe: () => () => {},
        mutate: async () => {},
        describe: () => ({ namespaces: [], writable: true })
      })
    },
    remote: { settings: { describe: async () => ({ ok: true, value: { writable: true, namespaces: [] } }), replace: async () => ({ ok: true }) } },
    timer: {
      timeout: (callback, delay) => {
        // 只记录：自动写入（debounce）已移除，测试用它断言"没有任何延时写入"。
        timers.push({ callback, delay })
        return () => {}
      }
    },
    slots: {
      inject: (_name, callback) => callback(),
      // 按插槽名取设置页分区：apply 还注册了导航图标挂载点，别依赖"最后一次注册"
      register: (options, C) => { if (options.name === 'settings.section') Component = C; return () => {} }
    }
  }
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => oneSegmentReport() })
  plugin.apply(context, {})
  harness.instances.clear()
  harness.classInstances = new Map()
  harness.current = null

  const render = makeRender(() => Component({}))
  const pump = async (rounds = 12) => {
    let tree = render()
    for (let attempt = 0; attempt < rounds; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve))
      tree = render()
    }
    return tree
  }

  try {
    // A. 首帧：镜像 loading，报告未到 → 不展开
    let tree = render()
    assert.equal(textareaCount(tree), 0, '首帧不应展开')

    // B. 宿主报告落地 → 仍然默认收起
    tree = await pump()
    assert.equal(textareaCount(tree), 0, '报告落地后仍应默认收起')

    // C. 镜像随后到达（内容一致）→ 不得擅自展开
    mirrorValue = { enabled: true, segments: oneSegmentReport().segments, notes: '', maxBytes: 8192 }
    tree = await pump(4)
    assert.equal(textareaCount(tree), 0, '镜像到达后不得擅自展开')

    // D. 点击箭头展开 → 必须展开
    findCaret(collect(tree)).props.onClick()
    tree = render()
    assert.equal(textareaCount(tree), 1, '刷新后点击箭头必须能展开')

    // E. 再渲染多轮 → 不得被收回（用户报告过的状态被弹回问题）
    tree = await pump(6)
    assert.equal(textareaCount(tree), 1, '展开后不得被弹回')

    // F. 再点一次 → 收起
    findCaret(collect(tree)).props.onClick()
    tree = render()
    assert.equal(textareaCount(tree), 0)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('可点击的行用 pointer 光标，而不是文本光标', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // 规则行是一个"展开/收起"按钮，光标必须是手型：
  // 之前写成 cursor:text（把行当成"点进文本框"的旧设计），悬停时显示为可输入状态。
  const rowRule = /\.dec-item-main\{[^}]*cursor:pointer[^}]*\}/u.test(source)
  assert.equal(rowRule, true, '规则行必须使用 cursor:pointer')
  const textCursorOnInteractive = /\.dec-(item-main|icon-btn|btn|switch)[^}]*cursor:text/u.test(source)
  assert.equal(textCursorOnInteractive, false, '可点击控件不得使用 cursor:text')
  assert.equal(source.includes('.dec-item-main:hover'), true, '可点击的行应有悬停反馈')
})

test('预览容器的边框足够可见：不用最淡的 l1', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // 设计系统里 border-l1 在深色下是 6% 白，几乎看不见；预览与列表必须用 l2。
  // 用户实测反馈："边框不太明显，看起来不像在同一个块内"。
  // 必须扫**每一条**匹配规则：后写的规则同样生效（层叠），
  // 只在第一条里查关键词会漏掉"末尾又追加一条 l1 边框"这种真实回归。
  const rulesFor = (selector) => [...source.matchAll(new RegExp(`\\${selector}\\{[^}]*\\}`, 'gu'))].map((match) => match[0])
  const previewRules = rulesFor('.dec-preview')
  assert.equal(previewRules.length > 0, true, '必须有预览容器样式')
  assert.equal(previewRules.some((rule) => rule.includes('var(--dsw-alias-border-l2)')), true, '预览容器边框必须用 l2 级')
  assert.equal(previewRules.every((rule) => !rule.includes('border-l1')), true, '预览容器的任何一条规则都不得用 l1 边框')

  const listRules = rulesFor('.dec-list')
  assert.equal(listRules.length > 0, true, '必须有列表容器样式')
  assert.equal(listRules.some((rule) => rule.includes('var(--dsw-alias-border-l2)')), true, '列表边框必须用 l2 级')

  // 说明是卡片首段，必须用底色与正文区分（用户明确要求）
  const noteRule = /\.dec-preview-note\{[^}]*\}/u.exec(source)
  assert.notEqual(noteRule, null, '必须定义说明区样式')
  assert.equal(noteRule[0].includes('background'), true, '说明区必须有底色，与正文区分')

  const costRule = /\.dec-preview-cost\{[^}]*\}/u.exec(source)
  assert.notEqual(costRule, null, '必须有消耗行样式')
  assert.equal(costRule[0].includes('border-top'), true, '消耗行与正文之间要有分隔')
  assert.equal(costRule[0].includes('background'), true, '消耗行要有区别于正文的底色')
  // 用户明确不要左侧品牌色标记：只用分隔线 + 底色区分即可
  assert.equal(costRule[0].includes('border-left'), false, '消耗行不应有左侧色标')
  assert.equal(costRule[0].includes('brand-primary'), false, '消耗行不应使用品牌色装饰')
})

test('按钮视觉：不再使用品牌色描边变体', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // 深色主题下 --dsw-alias-brand-primary 解析为近白色（#f9fafb），
  // 会让"已开启"变成刺眼白边，与相邻按钮不像一套。官方选中态用的是中性填充。
  assert.equal(source.includes('dec-btn-primary'), false, '不应再定义/使用品牌色按钮变体')
  const onRule = /\.dec-btn-on\{([^}]*)\}/u.exec(source)
  assert.notEqual(onRule, null, '必须定义开启态填充')
  assert.equal(onRule[1].includes('background'), true, '开启态必须靠背景填充区分')
  assert.equal(onRule[1].includes('brand'), false, '开启态不得使用品牌色')
})

test('P1：内容偏长时给出人话提醒，未超限时不出现', async () => {
  // 超限：宿主报告 overBudget=true
  const over = mountPanel(() => oneSegmentReport({ overBudget: true, maxBytes: 100 }))
  try {
    const tree = await over.settle()
    const container = collect(tree).find((node) => node.props.className === 'dec-preview')
    assert.notEqual(container, undefined)
    const warn = collect(container).find((node) => node.props.className === 'dec-preview-warn')
    assert.notEqual(warn, undefined, '超限时必须给出提醒')
    const warnText = gatherStrings(warn).join('')
    assert.equal(warnText.includes('精简'), true, '提醒必须给出可执行建议')
    assert.equal(warnText.includes('按需启用'), true, '提醒必须给出可行的替代做法')
    // 提醒里不得出现技术指标（字节 / 上限数值等）
    assert.equal(/字节|上限|预算|token/iu.test(warnText), false, `提醒不应出现技术指标: ${warnText}`)
  } finally {
    over.unmount()
  }

  // 未超限：不得出现提醒
  const normal = mountPanel(oneSegmentReport)
  try {
    const tree = await normal.settle()
    const container = collect(tree).find((node) => node.props.className === 'dec-preview')
    // container 缺失时 collect(undefined) 返回空数组，.some() 恒 false —— 会空过。
    // 所以先要求预览容器真的在，再断言提醒不出现。
    assert.notEqual(container, undefined, '未超限时预览容器仍必须存在（否则这条断言会空过）')
    assert.equal(collect(container).some((node) => node.props.className === 'dec-preview-warn'), false, '未超限时不应出现提醒')
  } finally {
    normal.unmount()
  }
})

test('P1：位置说明写明它在系统指令位、且会被预设覆盖', async () => {
  const panel = mountPanel(oneSegmentReport)
  try {
    const tree = await panel.settle()
    const where = collect(tree).find((node) => node.props.className === 'dec-preview-note')
    assert.notEqual(where, undefined, '必须有位置说明')
    const text = gatherStrings(where).join('')
    assert.equal(text.includes('最前面'), true, '必须说明它的位置')
    assert.equal(text.includes('优先'), true, '必须说明它的优先级')
  } finally {
    panel.unmount()
  }
})

test('生效时机说明与实机结果一致：改动只影响新开的对话，且不提任何命令', async () => {
  // 这条说法来自**实机对照**：同一对话里先问规则 → 改设置 → 不新开对话再问，
  // 模型仍只报旧规则。我曾按 dsh-agent-loop 的源码推断把它改成"下一次请求就生效"，
  // 被这次实测推翻。改动这条文案前必须先做同样的实机对照，别只读代码。
  const panel = mountPanel(oneSegmentReport)
  try {
    const texts = gatherStrings(await panel.settle())
    assert.equal(texts.some((text) => text.includes('改动只影响新开的对话')), true, '顶部必须交代生效时机')
    assert.equal(texts.some((text) => text.includes('下一次请求就生效')), false, '不得说"下一次请求就生效"')
    assert.equal(texts.some((text) => text.includes('斜杠')), false, '不应再提斜杠命令')
    assert.equal(texts.some((text) => text.includes('/context-refresh')), false, '不应再出现命令名')
  } finally {
    panel.unmount()
  }
})

test('没有保存操作：界面上不存在任何保存/放弃按钮', async () => {
  const panel = mountPanel(oneSegmentReport)
  try {
    let nodes = collect(await panel.settle())
    findCaret(nodes).props.onClick()
    nodes = collect(panel.render())
    const buttonTexts = nodes
      .filter((node) => node.type === 'button')
      .map((node) => (Array.isArray(node.children) ? node.children.join('') : String(node.children)))
    assert.equal(buttonTexts.some((text) => text.includes('保存')), false, '不应出现保存按钮')
    assert.equal(buttonTexts.some((text) => text.includes('放弃')), false, '不应出现放弃按钮')
    const texts = gatherStrings(panel.render())
    assert.equal(texts.some((text) => text.includes('未保存')), false, '不应出现未保存提示')
  } finally {
    panel.unmount()
  }
})

test('输入只改本地，失焦才写入（不打字过程中写设置）', async () => {
  const panel = mountPanel(oneSegmentReport)
  try {
    let nodes = collect(await panel.settle())
    findCaret(nodes).props.onClick()
    nodes = collect(panel.render())
    const textarea = nodes.find((node) => node.type === 'textarea')

    // 输入：界面立即反映，但不得触发任何写入（debounce 已移除）
    const writesBeforeTyping = panel.mutations.length
    textarea.props.onChange({ target: { value: '边打边看的第二段' } })
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r))
    const afterTyping = panel.render()
    assert.equal(gatherStrings(afterTyping).some((text) => text.includes('边打边看的第二段')), true, '输入后界面立即更新')
    assert.equal(panel.timers.some((t) => t.delay > 0), false, '打字过程中不得安排任何延时写入')
    // 实质断言：连续输入期间一次设置都不得写。
    // （只查"有没有定时器"是不够的——在 onChange 里直接提交同样能通过那条检查，
    //   这条断言就是这个缺口的守卫。）
    textarea.props.onChange({ target: { value: '边打边看的第三段' } })
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r))
    const afterSecond = panel.render()
    assert.equal(panel.mutations.length, writesBeforeTyping, '打字过程中不得写设置')

    // 失焦：此时才写入，且写入的是最新内容
    const afterType = collect(afterSecond).find((node) => node.type === 'textarea')
    assert.equal(typeof afterType.props.onBlur, 'function', '输入框必须有失焦提交')
    afterType.props.onBlur()
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length > writesBeforeTyping, true, '失焦必须写入')
    const lastWrite = panel.mutations[panel.mutations.length - 1]
    assert.equal(lastWrite[0].value[0].text, '边打边看的第三段', '失焦写入必须是最新内容，且不得吞掉中间输入')
    const settled = panel.render()
    const texts = gatherStrings(settled)
    assert.equal(texts.some((text) => text.includes('已保存')), false, '写入不得弹成功提示')
    assert.equal(texts.some((text) => text.includes('未保存')), false, '不应出现未保存提示')
  } finally {
    panel.unmount()
  }
})

test('写入失败必须报错并给出重试（这是唯一保留的提示）', async () => {
  // 镜像写入抛错 + 宿主回退也失败 → 必须出现错误与重试按钮，不允许静默失败
  const plugin = loadPlugin()
  let Component
  const context = {
    settingsScope: {
      bind: () => ({
        getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: { enabled: true, segments: [], notes: '', maxBytes: 8192 } }),
        subscribe: () => () => {},
        mutate: async () => { throw new Error('mirror down') },
        describe: () => ({ namespaces: [], writable: true })
      })
    },
    remote: { settings: { describe: async () => ({ ok: false }), replace: async () => ({ ok: false }) } },
    timer: {
      timeout: (callback, delay) => {
        // 只记录：自动写入（debounce）已移除，测试用它断言"没有任何延时写入"。
        timers.push({ callback, delay })
        return () => {}
      }
    },
    slots: {
      inject: (_name, callback) => callback(),
      // 按插槽名取设置页分区：apply 还注册了导航图标挂载点，别依赖"最后一次注册"
      register: (options, C) => { if (options.name === 'settings.section') Component = C; return () => {} }
    }
  }
  const timers = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => oneSegmentReport() })
  plugin.apply(context, {})
  harness.instances.clear()
  harness.classInstances = new Map()
  harness.current = null

  const render = makeRender(() => Component({}))

  try {
    let tree = render()
    for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); tree = render() }
    // 触发一次写入（切换总开关）
    const switchButton = collect(tree).find((node) => node.type === 'button' && JSON.stringify(node.children).includes('已开启'))
    switchButton.props.onClick()
    for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); tree = render() }

    const texts = gatherStrings(tree)
    assert.equal(texts.some((text) => text.includes('写入失败')), true, '写入失败必须报错')
    const retry = collect(tree).find((node) => node.type === 'button' && JSON.stringify(node.children).includes('重试'))
    assert.notEqual(retry, undefined, '错误必须带重试入口')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('回归护栏：写入进行中，输入控件绝不能被禁用（否则会强制失焦）', async () => {
  // 真实缺陷：写入时 busy 置真，而输入框绑定 disabled={busy}，
  // 浏览器会给已聚焦元素强制失焦 → "打字一停顿就再也输入不了"。
  //
  // 这条断言必须在**写入进行中**（busy=true）这一刻做：
  // 等写入结束后 busy 已回落，那时的 disabled 是 false，断言恒真——缺陷会溜过去。
  const panel = mountPanel(oneSegmentReport)
  try {
    let nodes = collect(await panel.settle())
    findCaret(nodes).props.onClick()
    nodes = collect(panel.render())
    const textarea = nodes.find((node) => node.type === 'textarea')
    assert.equal(textarea.props.disabled, false, '编辑前必须可输入')

    textarea.props.onChange({ target: { value: '连续输入的测试内容' } })
    const onBlur = collect(panel.render()).find((node) => node.type === 'textarea').props.onBlur
    panel.holdWrites()
    onBlur()
    // 让 flush 推进到"正在写"的状态，然后在这期间渲染
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r))
    const duringFlush = collect(panel.render())
    const busyTextarea = duringFlush.find((node) => node.type === 'textarea')
    assert.equal(busyTextarea.props.disabled, false, '写入进行中输入框不得被禁用')
    assert.equal(busyTextarea.props.value, '连续输入的测试内容', '写入进行中界面内容不得回滚')
    const busyCheckbox = duringFlush.find((node) => node.type === 'input' && node.props.className === 'dec-check')
    assert.equal(busyCheckbox.props.disabled, false, '写入进行中勾选框不得被禁用')
    // 写入尚未落地：这正是"提交期间"的可观测证据
    assert.equal(panel.mutations.length, 0, '闸门未放行时不得已写入')
    // 并确证此刻 busy 真的为真：写入期间按钮必须被禁用。
    // （少了这条，"写入进行中"就只是个假设——删掉 setBusy(true) 也不会被发现。）
    const busySwitch = duringFlush.find((node) => node.type === 'button'
      && (JSON.stringify(node.children).includes('已开启') || JSON.stringify(node.children).includes('已关闭')))
    assert.equal(busySwitch.props.disabled, true, '写入进行中动作按钮必须被禁用（busy 真的为真）')

    panel.releaseWrites()
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r))
    const afterFlush = collect(panel.render()).find((node) => node.type === 'textarea')
    assert.equal(afterFlush.props.disabled, false, '写入结束后输入框也不得被禁用')
    assert.equal(afterFlush.props.value, '连续输入的测试内容', '提交后本地内容不得被回滚')
    assert.equal(panel.mutations.length, 1, '闸门放行后必须恰好写入一次')
  } finally {
    panel.releaseWrites()
    panel.unmount()
  }
})

test('回归护栏：勾选/取消勾选必须立即提交，并让预览随之更新', async () => {
  // 真实缺陷：toggleSegment 只改本地状态、没有提交（勾了像没勾），
  // 且预览读的是宿主报告（提交前算的旧值），于是预览不动。
  const panel = mountPanel(oneSegmentReport)
  try {
    // 只检查预览区内的文本：整页扫描会把"规则行里的摘要"也算进来，曾因此误判
    const previewBodyOf = (tree) => {
      const node = collect(tree).find((item) => item.props?.className === 'dec-preview-text')
      return node === undefined ? '' : gatherStrings(node).join('')
    }

    let nodes = collect(await panel.settle())
    assert.equal(previewBodyOf(panel.render()).includes('用中文回答'), true, '初始预览必须包含规则正文')

    // 取消勾选
    const checked = nodes.find((node) => node.type === 'input' && node.props.className === 'dec-check')
    assert.notEqual(checked, undefined, '必须有勾选框')
    assert.equal(checked.props.checked, true)
    const before = panel.mutations.length
    checked.props.onChange({ target: { checked: false } })

    // ① 立即提交，不依赖失焦
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length > before, true, '勾选必须立即提交写入')
    const submitted = panel.mutations[panel.mutations.length - 1]
    assert.equal(submitted[0].value[0].enabled, false, '提交内容必须反映取消勾选')

    // ② 预览必须随之更新（曾经"勾选后预览不动"）
    assert.equal(previewBodyOf(panel.render()).includes('用中文回答'), false, '停用的规则不得出现在预览区')

    // ③ 再勾回来：预览恢复，并再次提交
    const again = collect(panel.render()).find((node) => node.type === 'input' && node.props.className === 'dec-check')
    const countBefore = panel.mutations.length
    again.props.onChange({ target: { checked: true } })
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r))
    assert.equal(panel.mutations.length > countBefore, true, '重新勾选也必须立即提交')
    assert.equal(previewBodyOf(panel.render()).includes('用中文回答'), true, '重新启用后预览恢复')
  } finally {
    panel.unmount()
  }
})

test('预览区内容必须与实际注入口径一致（含宿主的包裹文字）', async () => {
  // 有规则时：预览必须带上宿主的两段固定文字与前后标记，否则体积/token 会对不上实际注入
  const panel = mountPanel(oneSegmentReport)
  try {
    // 必须先等宿主报告落地，否则预览还没有内容
    const tree = await panel.settle()
    const node = collect(tree).find((item) => item.props?.className === 'dec-preview-text')
    const body = node === undefined ? '' : gatherStrings(node).join('')
    assert.equal(body.includes('--- 额外上下文开始 ---'), true, '预览必须包含起始标记')
    assert.equal(body.includes('--- 额外上下文结束 ---'), true, '预览必须包含结束标记')
    assert.equal(body.startsWith('以下内容由用户在'), true, '预览必须包含宿主的前置说明')
  } finally {
    panel.unmount()
  }

  // 没有任何规则时：不得渲染空的包裹结构（否则"当前为空"的提示永远不出现）
  const empty = mountPanel(() => oneSegmentReport({ rendered: '', segments: [], bytes: 0, estimatedTokens: 0 }))
  try {
    const node = collect(await empty.settle()).find((item) => item.props?.className === 'dec-preview-text')
    const body = node === undefined ? '' : gatherStrings(node).join('')
    assert.equal(body.includes('额外上下文开始'), false, '空内容不得渲染包裹标记')
  } finally {
    empty.unmount()
  }
})

test('跨端一致：宿主与本地的包裹文字必须相同', async () => {
  // 客户端的预览是本地渲染的，宿主的才是真正注入的；两者的固定文字漂移会让预览失真。
  const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const hostSource = await readFile(new URL('../lib/rules.js', import.meta.url), 'utf8')
  for (const marker of ['--- 额外上下文开始 ---', '--- 额外上下文结束 ---']) {
    assert.equal(clientSource.includes(marker), true, `客户端预览缺少标记 ${marker}`)
    assert.equal(hostSource.includes(marker), true, `宿主渲染缺少标记 ${marker}`)
  }
  const heading = /const SECTION_HEADING = `([^`]+)`/u.exec(hostSource)
  assert.notEqual(heading, null, '宿主必须定义前置说明')
  const literal = heading[1].replace('${PLUGIN_NAME}', 'dsh-extra-context')
  assert.equal(clientSource.includes(literal), true, '客户端预览的前置说明必须与宿主逐字一致')
})
