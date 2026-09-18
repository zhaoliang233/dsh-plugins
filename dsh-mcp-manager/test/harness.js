/**
 * 客户端测试用的小 React 运行时（不是测试文件，不被 `node --test test/*.test.js` 收集）。
 *
 * 为什么需要它：`client.js` 里有一类缺陷是**纯函数测试永远盖不住**的——
 * 组件把状态置真却没渲染任何东西（「+」按钮失效就是这么漏出去的）、onClick 没接上、
 * 受控输入没绑 onChange。只有"真渲染 + 真点"才能发现。
 *
 * 实现取舍：hook 槽按组件实例的**树路径**保存（同一路径在多次渲染之间复用），
 * 状态更新触发从根重渲染直到收敛；宿主元素渲染成 `{ tag, props, children }` 的纯对象。
 * 够用、可解释，不追求 React 的全部语义。
 */

export function createHarness() {
  const instances = new Map()
  const warnings = []
  const current = { instance: null }
  const state = { tree: null, element: null, dirty: false, passes: 0 }

  const createElement = (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
  })

  const contextStack = []
  const useContext = (context) => {
    if (context === null || context === undefined) return undefined
    for (let index = contextStack.length - 1; index >= 0; index -= 1) {
      if (contextStack[index].context === context) return contextStack[index].value
    }
    return context.defaultValue
  }

  function instanceAt(path) {
    let instance = instances.get(path)
    if (instance === undefined) {
      instance = { hooks: [], cursor: 0, pendingEffects: [] }
      instances.set(path, instance)
    }
    instance.cursor = 0
    return instance
  }

  function slotAt(kind, create) {
    const instance = current.instance
    const index = instance.cursor++
    let slot = instance.hooks[index]
    if (slot === undefined || slot.kind !== kind) {
      slot = { kind, ...create() }
      instance.hooks[index] = slot
    }
    return slot
  }

  const rerender = () => {
    state.dirty = true
  }

  function useState(initial) {
    const slot = slotAt('state', () => ({ value: typeof initial === 'function' ? initial() : initial }))
    if (slot.setter === undefined) {
      slot.setter = (next) => {
        const resolved = typeof next === 'function' ? next(slot.value) : next
        if (resolved === slot.value) return
        slot.value = resolved
        rerender()
      }
    }
    return [slot.value, slot.setter]
  }

  /**
   * 必须返回 **ref 对象本身**（`{current}`），不能返回 `initial`。
   *
   * 早先写成 `slotAt('ref', () => ({current: initial})).current`，于是 `useRef(null)`
   * 在测试里就是 `null`、`ref.current` 直接抛 TypeError——组件用了 DOM ref 时，
   * 整个分区都渲染不出来（踩过）。宿主元素上的 `ref` 本桩仍不赋值，
   * 所以组件必须自己处理 `current === null`（真实 React 里首次渲染前也是 null）。
   */
  const useRef = (initial) => slotAt('ref', () => ({ value: { current: initial } })).value

  /**
   * 必须**按依赖真记忆化**：写成"直接返回本次的 fn"会让依赖它的 effect/回调
   * 每轮都换标识（真实的坑见 dsh-extra-context 的测试基建说明）；
   * 而写成"永远返回第一次的 fn"更糟——闭包会一直看着旧状态，
   * `useCallback(id => status.servers.find(...), [status])` 就会永远读到初始的 null，
   * 看起来像产品缺陷、其实是我的桩的错（本文件踩过）。
   */
  function useCallback(fn, deps) {
    const slot = slotAt('callback', () => ({ deps: undefined, fn }))
    const changed =
      slot.deps === undefined ||
      deps === undefined ||
      deps.length !== slot.deps.length ||
      deps.some((value, index) => value !== slot.deps[index])
    if (changed) {
      slot.fn = fn
      slot.deps = deps
    }
    return slot.fn
  }

  function useEffectLike(kind, fn, deps) {
    const slot = slotAt(kind, () => ({ deps: undefined, cleanup: undefined, fn }))
    slot.fn = fn
    const changed = slot.deps === undefined || deps === undefined || deps.length !== slot.deps.length || deps.some((value, index) => value !== slot.deps[index])
    if (changed) {
      slot.deps = deps
      current.instance.pendingEffects.push(slot)
    }
  }

  const useEffect = (fn, deps) => useEffectLike('effect', fn, deps)
  const useLayoutEffect = (fn, deps) => useEffectLike('layout', fn, deps)

  class Component {
    constructor(props) {
      this.props = props ?? {}
      this.state = {}
    }
  }
  Component.prototype.isReactComponent = true

  const createContext = (defaultValue) => {
    const context = { defaultValue, value: defaultValue }
    context.Provider = { __provider: context }
    return context
  }

  function renderNode(element, path) {
    if (element === null || element === undefined || typeof element === 'boolean') return null
    // React 允许组件返回数组（`this.props.children` 也是数组），必须显式展平
    if (Array.isArray(element)) {
      return element.map((child, index) => renderNode(child, `${path}.a${index}`)).filter((child) => child !== null)
    }
    if (typeof element !== 'object') return element
    const { type, props, children } = element

    if (type !== null && typeof type === 'object' && type.__provider !== undefined) {
      const context = type.__provider
      const previous = context.value
      context.value = props.value
      contextStack.push({ context, value: props.value })
      try {
        return children.map((child, index) => renderNode(child, `${path}.p${index}`))
      } finally {
        contextStack.pop()
        context.value = previous
      }
    }

    if (typeof type === 'function') {
      const instance = instanceAt(path)
      const previous = current.instance
      const inherited = instance.pendingEffects
      current.instance = instance
      instance.pendingEffects = []
      /**
       * children 要并进 props，但**不能覆盖用 props 形式传进来的 children**。
       *
       * 真实 React 两种写法等价：`createElement(C, {children: x})` 与
       * `createElement(C, {}, x)`。这里曾经无脑 `{...props, children}`，
       * 于是 `{children: x}` 被位置参数的**空数组**盖掉，组件里 `props.children`
       * 就成了 `[]`——单元格看着"组件没渲染东西"（本文件踩过，见 AGENTS.md）。
       */
      const merged = children.length === 0 && 'children' in props ? { ...props } : { ...props, children }
      let output
      try {
        if (type.prototype?.isReactComponent === true) {
          // 类组件里 `this.props.children` 也要有（错误边界正是这么写的）。
          const fullProps = merged
          const component = new type(fullProps)
          component.props = fullProps
          component.setState = (next) => {
            component.state = { ...component.state, ...(typeof next === 'function' ? next(component.state) : next) }
            rerender()
          }
          output = component.render()
        } else {
          output = type(merged)
        }
      } finally {
        const flushed = instance.pendingEffects
        instance.pendingEffects = inherited
        current.instance = previous
        for (const slot of flushed) {
          if (typeof slot.cleanup === 'function') slot.cleanup()
          slot.cleanup = slot.fn()
        }
      }
      return renderNode(output, `${path}>`)
    }

    return {
      tag: type,
      props,
      children: children.map((child, index) => renderNode(child, `${path}.${index}`)).filter((child) => child !== null)
    }
  }

  function renderTree(element) {
    state.element = element
    state.dirty = false
    let output = renderNode(element, 'root')
    let passes = 0
    while (state.dirty && passes < 25) {
      state.dirty = false
      passes += 1
      output = renderNode(element, 'root')
    }
    if (passes >= 25) warnings.push('渲染未收敛（疑似 setState 循环）')
    state.passes = passes
    state.tree = output
    return output
  }

  const walk = (node, visit) => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, visit)
      return
    }
    if (typeof node !== 'object' || node.tag === undefined) return
    visit(node)
    for (const child of node.children ?? []) walk(child, visit)
  }

  function textOf(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (typeof node !== 'object') return ''
    return (node.children ?? []).map(textOf).join('')
  }

  const findAll = (predicate) => {
    const found = []
    walk(state.tree, (node) => {
      if (predicate(node)) found.push(node)
    })
    return found
  }

  const find = (predicate) => findAll(predicate)[0]
  const labelOf = (node) => String(node.props['aria-label'] ?? textOf(node)).trim()

  /** 交给 bundle 的 React 面：只包含 client.js 真正用到的那些。 */
  const React = {
    createElement,
    Fragment: Symbol('Fragment'),
    createContext,
    useContext,
    useState,
    useRef,
    useCallback,
    useEffect,
    useLayoutEffect,
    useId: () => 'id',
    Component
  }

  return {
    React,
    render: renderTree,
    get tree() {
      return state.tree
    },
    text: () => textOf(state.tree),
    find,
    findAll,
    buttonByLabel: (label) => find((node) => node.tag === 'button' && labelOf(node) === label),
    buttons: () => findAll((node) => node.tag === 'button'),
    /**
     * 表单里某个标签对应的输入控件（弹窗表单全靠它来填值）。
     *
     * class 必须按 **token 精确匹配**：`.dmm-field-row` 也包含 "dmm-field" 这个子串，
     * 用 `includes` 会先命中外层的行容器，于是取到同排第一个输入框（备注名），
     * 看起来像"表单没预填/没写进去"，其实是助手选错了元素（踩过）。
     */
    inputByLabel(label) {
      const isField = (node) => String(node.props.className ?? '').split(/\s+/u).includes('dmm-field')
      const field = find(
        (node) =>
          node.tag === 'div' &&
          isField(node) &&
          (node.children ?? []).some((child) => typeof child === 'object' && textOf(child).includes(label))
      )
      if (field === undefined) return undefined
      let found
      walk(field, (node) => {
        if (found === undefined && (node.tag === 'input' || node.tag === 'textarea')) found = node
      })
      return found
    },
    fieldByLabel: (label) =>
      find((node) => {
        const tokens = String(node.props.className ?? '').split(/\s+/u)
        if (node.tag !== 'div' || !tokens.includes('dmm-field')) return false
        return (node.children ?? []).some((child) => typeof child === 'object' && textOf(child).includes(label))
      }),
    click(element) {
      if (element === undefined || element === null) throw new Error('click: 目标不存在')
      if (typeof element.props.onClick !== 'function') throw new Error(`click: 「${labelOf(element)}」没有 onClick`)
      element.props.onClick({ preventDefault() {}, stopPropagation() {} })
      return renderTree(state.element)
    },
    change(element, value) {
      if (element === undefined || element === null) throw new Error('change: 目标不存在')
      if (typeof element.props.onChange !== 'function') throw new Error('change: 目标没有 onChange')
      element.props.onChange({ target: { value, checked: value } })
      return renderTree(state.element)
    },
    warnings,
    get renderPasses() {
      return state.passes
    }
  }
}
