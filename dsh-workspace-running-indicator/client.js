// dsh-workspace-running-indicator — browser half loaded by dsh-client-modules.
// 侧边栏工作区标题行没有 slot 扩展点，所以这里只做两件最小的事：
// 从客户端快照算出「每个工作区当前最需要你知道的那个会话状态」，
// 再给对应的收起工作区行追加一个与原生 StateDot 同款的指示器。
// 指示器在鼠标移入时 display:none，让 hover 完全回到宿主原本的排版与效果。
window.__ModuleLoader__.load({
  id: 'dsh-workspace-running-indicator',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const PLUGIN_ID = 'dsh-workspace-running-indicator'
    // 工作区标题行的稳定契约：role=treeitem + data-row-key="workspace:<key>"。
    // 同一棵树里的会话行是 "session:<id>"，空态行是 "empty"，所以前缀过滤足够精确。
    const ROW_SELECTOR = '[role="treeitem"][data-row-key^="workspace:"]'
    const ROW_KEY_ATTRIBUTE = 'data-row-key'
    const WORKSPACE_PREFIX = 'workspace:'
    const EXPANDED_ATTRIBUTE = 'aria-expanded'
    const EMPTY_WORKSPACE_KEY = ''
    const STATE_ATTRIBUTE = 'data-dsh-workspace-state'
    const STATE_SELECTOR = `[${STATE_ATTRIBUTE}]`
    const STYLE_SELECTOR = `style[data-plugin="${PLUGIN_ID}"]`
    const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
    const ONGOING = 'ongoing'
    const WARNING = 'warning'
    const DONE = 'done'
    // 与 @deepseek-ai/dsh-client-ui-workspace 的 sessionStatuses() 同序：
    // 原生把它设计成「pending interaction 压过 running」，因为前者是阻塞态。
    // 三种 pending 在本插件合并成同一个 warning 视觉（方案 A）。
    const STATE_RANK = { [WARNING]: 3, [ONGOING]: 2, [DONE]: 1 }
    const PENDING_KINDS = new Set(['approval', 'plan-review', 'question'])

    // 视觉照抄 @deepseek-ai/dsh-client-ui-primitives 的 StateDot：
    // ongoing = 14px 转圈（viewBox 24、r=9.5、双层圆、1.5s）；
    // warning / done = 10px 实心点（:after inset 20%），颜色用各自的 state token。
    const STYLE_TEXT = [
      '[data-row-key^="workspace:"] ' + STATE_SELECTOR + ' {',
      '  flex: none;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  pointer-events: none;',
      '}',
      // 鼠标移入时整个指示器消失，工作区行回到宿主原本的布局与 hover 效果。
      '@media (hover: hover) {',
      '  [data-row-key^="workspace:"]:hover ' + STATE_SELECTOR + ' { display: none; }',
      '}',
      STATE_SELECTOR + '[data-state="ongoing"] {',
      '  width: 14px;',
      '  height: 14px;',
      '  color: var(--dsw-alias-label-tertiary);',
      '}',
      STATE_SELECTOR + '[data-state="ongoing"] [data-part="motion"] {',
      '  transform-origin: center;',
      '  animation: dsh-workspace-state-spin 1.5s linear infinite;',
      '}',
      STATE_SELECTOR + '[data-state="ongoing"] circle {',
      '  fill: none;',
      '  stroke: currentColor;',
      '  stroke-width: 2;',
      '  stroke-linecap: round;',
      '}',
      STATE_SELECTOR + '[data-state="ongoing"] [data-part="track"] { opacity: 0.25; }',
      STATE_SELECTOR + '[data-state="ongoing"] [data-part="arc"] {',
      '  stroke-dasharray: 12 150;',
      '  animation: dsh-workspace-state-dash 1.5s ease-in-out infinite;',
      '}',
      STATE_SELECTOR + '[data-state="warning"],',
      STATE_SELECTOR + '[data-state="done"] {',
      '  position: relative;',
      '  width: 10px;',
      '  height: 10px;',
      '}',
      STATE_SELECTOR + '[data-state="warning"] { color: var(--dsw-alias-state-warn-primary); }',
      STATE_SELECTOR + '[data-state="done"] { color: var(--dsw-alias-state-success-primary); }',
      STATE_SELECTOR + '[data-state="warning"]::after,',
      STATE_SELECTOR + '[data-state="done"]::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 20%;',
      '  border-radius: 50%;',
      '  background: currentColor;',
      '}',
      '@keyframes dsh-workspace-state-spin { to { transform: rotate(360deg); } }',
      '@keyframes dsh-workspace-state-dash {',
      '  0% { stroke-dasharray: 12 150; stroke-dashoffset: 0; }',
      '  50% { stroke-dasharray: 24 150; stroke-dashoffset: -6; }',
      '  100% { stroke-dasharray: 12 150; stroke-dashoffset: 0; }',
      '}',
      // 减少动效时与原生一致：停转并固定成一段静态弧。
      '@media (prefers-reduced-motion: reduce) {',
      '  ' + STATE_SELECTOR + '[data-state="ongoing"] [data-part="motion"],',
      '  ' + STATE_SELECTOR + '[data-state="ongoing"] [data-part="arc"] { animation: none; }',
      '  ' + STATE_SELECTOR + '[data-state="ongoing"] [data-part="arc"] { stroke-dasharray: 18 150; stroke-dashoffset: -3; }',
      '}'
    ].join('\n')

    /** 读一个 DOM 属性；节点不支持时按「缺失」处理，让调用方 fail closed。 */
    function readAttribute(node, name) {
      return node !== null && typeof node === 'object' && typeof node.getAttribute === 'function'
        ? node.getAttribute(name)
        : null
    }

    /**
     * 从 data-row-key 取出工作区 key。
     * @param rowKey - 行的 data-row-key 原值。
     * @returns 工作区 key（未分组桶是空串），或 undefined 表示这不是工作区行。
     */
    function workspaceKeyOfRow(rowKey) {
      if (typeof rowKey !== 'string' || rowKey.startsWith(WORKSPACE_PREFIX) === false) return undefined
      return rowKey.slice(WORKSPACE_PREFIX.length)
    }

    /** 收起状态读 aria-expanded；属性缺失时不当作收起，避免在未知结构上显示。 */
    function isCollapsedRow(row) {
      return readAttribute(row, EXPANDED_ATTRIBUTE) === 'false'
    }

    /** 一个会话自己的状态快照；`uiSession` 不可用时退回 `sessions.list` 的 running。 */
    function statusOf(sessionId, sessionSnapshot, statuses) {
      if (statuses !== undefined) {
        const status = statuses.get(sessionId)
        return status !== null && typeof status === 'object' ? status : undefined
      }
      const row = sessionSnapshot === null || typeof sessionSnapshot !== 'object'
        ? undefined
        : sessionSnapshot.byId?.[sessionId]
      return row !== null && typeof row === 'object' ? { running: row.running } : undefined
    }

    /** 该会话下仍在运行的子代理数量（原生 runningChildCount 的等价实现）。 */
    function runningChildCount(sessionSnapshot, parentId, statuses) {
      const catalog = sessionSnapshot === null || typeof sessionSnapshot !== 'object'
        ? undefined
        : sessionSnapshot.projectionsBySession?.[parentId]?.values?.subagentCatalog
      if (Array.isArray(catalog) === false) return 0
      let running = 0
      for (const child of catalog) {
        const childId = child === null || typeof child !== 'object' ? undefined : child.id
        if (typeof childId !== 'string') continue
        if (statusOf(childId, sessionSnapshot, statuses)?.running === true) running += 1
      }
      return running
    }

    /**
     * 把一个会话映射成本插件显示的三种状态之一。
     * 顺序照抄原生 sessionStatuses()：pending（阻塞态）> running > 子代理 > completed > idle。
     * @returns `warning` / `ongoing` / `done`，或 undefined 表示不显示（idle）。
     */
    function sessionState(status, subagentRunning) {
      if (status === null || typeof status !== 'object') return undefined
      const pending = status.pendingInteraction
      if (pending !== null && typeof pending === 'object' && PENDING_KINDS.has(pending.kind)) return WARNING
      if (status.running === true) return ONGOING
      if (subagentRunning === true) return ONGOING
      if (status.completionUnread === true) return DONE
      return undefined
    }

    function rankOf(state) {
      const rank = STATE_RANK[state]
      return rank === undefined ? 0 : rank
    }

    /**
     * 算出每个工作区当前要显示的状态（同工作区只保留优先级最高的一个）。
     *
     * 归属来自 Host 的 Workspace 实体（`items[].sessionIds`）；状态优先级与原生
     * sessionStatuses() 一致：等待处理 > 进行中 > 已完成待查看，空闲不显示。
     * 归档会话不计入——默认视图里它们本来就不显示，计入会出现「收起有状态、
     * 展开却看不到会话」。不属于任何工作区的会话归到未分组桶（空 key）。
     * @param workspaceSnapshot - `ctx.workspaces.list` 快照。
     * @param sessionSnapshot - `ctx.sessions.list` 快照。
     * @param statuses - `ctx.uiSession.sessionStatus` 的 Map；缺省时退回 running。
     * @returns 工作区 key → 状态。
     */
    function workspaceStates(workspaceSnapshot, sessionSnapshot, statuses) {
      const states = new Map()
      const items = workspaceSnapshot === null || typeof workspaceSnapshot !== 'object'
        ? undefined
        : workspaceSnapshot.items
      if (Array.isArray(items) === false) return states
      const archivedSource = workspaceSnapshot.archivedSessionIds
      const archived = new Set(Array.isArray(archivedSource) ? archivedSource : [])
      const accounted = new Set()

      const consider = (key, sessionId) => {
        if (archived.has(sessionId)) return
        const state = sessionState(
          statusOf(sessionId, sessionSnapshot, statuses),
          runningChildCount(sessionSnapshot, sessionId, statuses) > 0
        )
        if (state === undefined) return
        const previous = states.get(key)
        if (previous === undefined || rankOf(state) > rankOf(previous)) states.set(key, state)
      }

      for (const workspace of items) {
        const workspaceId = workspace === null || typeof workspace !== 'object' ? undefined : workspace.workspaceId
        if (typeof workspaceId !== 'string' || workspaceId === EMPTY_WORKSPACE_KEY) continue
        const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
        for (const sessionId of sessionIds) {
          accounted.add(sessionId)
          consider(workspaceId, sessionId)
        }
      }

      const ids = sessionSnapshot === null || typeof sessionSnapshot !== 'object'
        ? undefined
        : sessionSnapshot.ids
      if (Array.isArray(ids)) {
        for (const sessionId of ids) {
          if (accounted.has(sessionId)) continue
          consider(EMPTY_WORKSPACE_KEY, sessionId)
        }
      }
      return states
    }

    /** 在行内找本插件插入的指示器；行不支持查询时按「没有」处理。 */
    function findIndicator(row) {
      if (row === null || typeof row !== 'object' || typeof row.querySelector !== 'function') return null
      try {
        return row.querySelector(STATE_SELECTOR) ?? null
      } catch {
        return null
      }
    }

    /** 移除一个节点；兼容没有 Element.remove 的宿主。 */
    function removeNode(node) {
      if (node === null || node === undefined) return
      if (typeof node.remove === 'function') {
        node.remove()
        return
      }
      const parent = node.parentElement
      if (parent !== null && parent !== undefined && typeof parent.removeChild === 'function') parent.removeChild(node)
    }

    /** 造 ongoing 的转圈；结构与原生 StateDot 一致。 */
    function createSpinner(doc) {
      const svg = doc.createElementNS(SVG_NAMESPACE, 'svg')
      svg.setAttribute(STATE_ATTRIBUTE, ONGOING)
      svg.setAttribute('data-state', ONGOING)
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('width', '14')
      svg.setAttribute('height', '14')
      svg.setAttribute('viewBox', '0 0 24 24')
      const motion = doc.createElementNS(SVG_NAMESPACE, 'g')
      motion.setAttribute('data-part', 'motion')
      for (const part of ['track', 'arc']) {
        const circle = doc.createElementNS(SVG_NAMESPACE, 'circle')
        circle.setAttribute('data-part', part)
        circle.setAttribute('cx', '12')
        circle.setAttribute('cy', '12')
        circle.setAttribute('r', '9.5')
        motion.appendChild(circle)
      }
      svg.appendChild(motion)
      return svg
    }

    /** 造 warning / done 的实心点；尺寸与配色同原生 StateDot。 */
    function createDot(doc, state) {
      const dot = doc.createElement('span')
      dot.setAttribute(STATE_ATTRIBUTE, state)
      dot.setAttribute('data-state', state)
      dot.setAttribute('aria-hidden', 'true')
      return dot
    }

    /**
     * 造指示器节点。
     * @returns 节点；文档不支持 SVG 命名空间且需要转圈时返回 null（fail closed）。
     */
    function createIndicator(doc, state) {
      if (doc === null || typeof doc !== 'object') return null
      if (state === ONGOING) {
        if (typeof doc.createElementNS !== 'function') return null
        return createSpinner(doc)
      }
      if (typeof doc.createElement !== 'function') return null
      return createDot(doc, state)
    }

    /**
     * 把指示器同步到当前 DOM：收起且有状态的行显示一个，其余行移除。
     * 只追加/移除自己那一个节点，并且始终排在行尾，不参与宿主子节点的位置假设。
     * @param doc - 渲染文档。
     * @param states - `workspaceStates` 的结果。
     * @returns 本次显示指示器的行数（供诊断/测试使用）。
     */
    function syncIndicators(doc, states) {
      if (doc === null || typeof doc !== 'object' || typeof doc.querySelectorAll !== 'function') return 0
      let rows
      try {
        rows = doc.querySelectorAll(ROW_SELECTOR)
      } catch {
        return 0
      }
      let shown = 0
      for (const row of rows) {
        const key = workspaceKeyOfRow(readAttribute(row, ROW_KEY_ATTRIBUTE))
        if (key === undefined) continue
        const wanted = isCollapsedRow(row) ? states.get(key) : undefined
        const existing = findIndicator(row)
        const current = readAttribute(existing, 'data-state')
        if (wanted === undefined) {
          removeNode(existing)
          continue
        }
        if (existing !== null && current === wanted) {
          shown += 1
          continue
        }
        // 状态变了就重建：转圈与实心点是两种节点结构。
        removeNode(existing)
        const indicator = createIndicator(doc, wanted)
        if (indicator === null) continue
        row.appendChild(indicator)
        shown += 1
      }
      return shown
    }

    /** 卸载时移除所有指示器，保证插件移除后页面上不留任何痕迹。 */
    function clearIndicators(doc) {
      if (doc === null || typeof doc !== 'object' || typeof doc.querySelectorAll !== 'function') return
      let indicators
      try {
        indicators = doc.querySelectorAll(STATE_SELECTOR)
      } catch {
        return
      }
      for (const indicator of indicators) removeNode(indicator)
    }

    /**
     * 注入本插件自己的样式表。必须打 data-plugin 标记：dsh-client-modules 在
     * materialize 时会把未打标签的 style 认领给下一个 bundle，热更新会因此删错样式。
     * @param doc - 渲染文档。
     * @returns 移除该样式表的 disposer。
     */
    function ensureStyle(doc) {
      if (doc === null || typeof doc !== 'object' || typeof doc.createElement !== 'function') return () => {}
      let style = null
      try {
        style = doc.querySelector(STYLE_SELECTOR)
      } catch {
        style = null
      }
      if (style !== null && style !== undefined) {
        // 元素存活但文本过期时重写内容，避免热更新后停在旧样式。
        if (style.textContent !== STYLE_TEXT) style.textContent = STYLE_TEXT
        return () => {}
      }
      style = doc.createElement('style')
      style.setAttribute('data-plugin', PLUGIN_ID)
      style.textContent = STYLE_TEXT
      const parent = doc.head ?? doc.documentElement
      if (parent === null || parent === undefined) return () => {}
      parent.appendChild(style)
      return () => {
        removeNode(style)
      }
    }

    /** 合并同一帧内的多次触发；取消后不再执行排队中的回调。 */
    function createScheduler(run) {
      let handle = null
      let cancelled = false
      const flush = () => {
        handle = null
        if (cancelled === false) run()
      }
      const schedule = () => {
        if (cancelled || handle !== null) return
        if (typeof globalThis.requestAnimationFrame === 'function') {
          handle = globalThis.requestAnimationFrame(flush)
        } else {
          handle = globalThis.setTimeout(flush, 16)
        }
      }
      schedule.cancel = () => {
        cancelled = true
        if (handle === null) return
        if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(handle)
        else if (typeof globalThis.clearTimeout === 'function') globalThis.clearTimeout(handle)
        handle = null
      }
      return schedule
    }

    function hasSnapshotSource(source) {
      return source !== null
        && typeof source === 'object'
        && typeof source.getSnapshot === 'function'
        && typeof source.subscribe === 'function'
    }

    const inject = ['sessions', 'workspaces']

    function apply(ctx) {
      const doc = globalThis.document
      if (doc === null || typeof doc !== 'object' || typeof doc.querySelectorAll !== 'function') return
      if (ctx === null || typeof ctx !== 'object' || typeof ctx.effect !== 'function') return
      // 能力检查 fail closed：服务或快照形状缺失时整个功能保持 inert。
      const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
      const workspaces = typeof ctx.get === 'function' ? ctx.get('workspaces') : undefined
      const sessionList = sessions === null || typeof sessions !== 'object' ? undefined : sessions.list
      const workspaceList = workspaces === null || typeof workspaces !== 'object' ? undefined : workspaces.list
      if (hasSnapshotSource(sessionList) === false || hasSnapshotSource(workspaceList) === false) return

      // uiSession 是可选增强：用动态注入，等它在 apply 之后才就绪时也能自动接上；
      // 拿不到时只显示「进行中」，其余状态静默缺席。
      let statuses
      const schedule = createScheduler(() => {
        syncIndicators(doc, workspaceStates(workspaceList.getSnapshot(), sessionList.getSnapshot(), statuses))
      })

      ctx.effect(() => {
        const removeStyle = ensureStyle(doc)
        const observer = typeof globalThis.MutationObserver === 'function'
          ? new globalThis.MutationObserver(schedule)
          : undefined
        // 只关心工作区行的增删与展开属性变化；子树范围用于捕获 React 重建的整棵树。
        observer?.observe(doc.documentElement ?? doc, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: [EXPANDED_ATTRIBUTE]
        })
        const unsubscribeSessions = sessionList.subscribe(schedule)
        const unsubscribeWorkspaces = workspaceList.subscribe(schedule)
        schedule()
        return () => {
          if (typeof unsubscribeSessions === 'function') unsubscribeSessions()
          if (typeof unsubscribeWorkspaces === 'function') unsubscribeWorkspaces()
          observer?.disconnect()
          schedule.cancel()
          clearIndicators(doc)
          removeStyle()
        }
      }, 'workspace state indicator')

      if (typeof ctx.inject === 'function') {
        ctx.inject(['uiSession'], (inner) => {
          const source = inner === null || typeof inner !== 'object' ? undefined : inner.uiSession?.sessionStatus
          if (hasSnapshotSource(source) === false) return
          statuses = source.getSnapshot()
          const unsubscribe = source.subscribe(() => {
            statuses = source.getSnapshot()
            schedule()
          })
          schedule()
          return () => {
            statuses = undefined
            if (typeof unsubscribe === 'function') unsubscribe()
            schedule()
          }
        })
      }
    }

    exports.inject = inject
    exports.apply = apply
    // 纯逻辑与 DOM 同步函数暴露给离线测试；生产路径只经 apply 使用。
    exports.__internals = {
      DONE,
      EMPTY_WORKSPACE_KEY,
      ONGOING,
      STATE_ATTRIBUTE,
      STATE_SELECTOR,
      STYLE_SELECTOR,
      STYLE_TEXT,
      WARNING,
      clearIndicators,
      createIndicator,
      createScheduler,
      ensureStyle,
      findIndicator,
      isCollapsedRow,
      runningChildCount,
      sessionState,
      syncIndicators,
      workspaceKeyOfRow,
      workspaceStates
    }
    return module.exports
  }
})
