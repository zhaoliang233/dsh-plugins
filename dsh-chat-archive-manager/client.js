window.__ModuleLoader__.load({
  id: 'dsh-chat-archive-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const {
      IconArchiveOutline20,
      IconFolderClose16,
      IconFolderOpen16,
      IconLoadingOutline16,
      IconRefreshOutline16,
      IconSearchOutline16,
      IconTrashOutline16,
      IconTriangleRightFill14,
      Modal,
      Switch
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const STATUS_PATH = '/dsh-chat-archive-manager/status'
    const DELETE_PATH = '/dsh-chat-archive-manager/delete'
    const RESTORE_PATH = '/dsh-chat-archive-manager/restore'
    const CLIENT_HEADER = 'x-dsh-chat-archive-manager-client'
    const STYLE_ID = 'dsh-chat-archive-manager-style'
    const UNGROUPED_TITLE = '未分组'
    /** Settings navigation label and page heading; the nav-icon patch matches this exact text. */
    const SECTION_TITLE = '归档管理'
    /**
     * 设置分区 order。DSH 自带分区是 general 0 / models 10 / plugins 15 /
     * agent-presets 20 / archived-sessions 25，**插件分区一律 ≥ 100**：排在内置之后，
     * 不插队、也不与内置并列（并列时只能靠注册顺序决胜）。
     */
    const SECTION_ORDER = 120
    /** 导航图标补丁的挂载点与本分区同号（动作区里只有壳层的 open-document 在 0）。 */
    const NAV_ICON_ORDER = SECTION_ORDER
    /**
     * DSH 0.1.6 ships its own "Archived sessions" Settings page (section id
     * `archived-sessions`). This manager already covers every recovery that page
     * runs, so the General section carries a browser-local switch that hides the
     * native nav row. The preference never reaches the Host: it is a viewing
     * habit of this browser, like the region's other client preferences.
     */
    const NATIVE_ARCHIVE_SECTION_ID = 'archived-sessions'
    const NATIVE_SUPPRESS_STORAGE_KEY = 'dsh-chat-archive-manager.hideNativeArchivedSessions'
    const NATIVE_SUPPRESS_ROW_ID = 'dsh-chat-archive-manager.native-archived-sessions'
    /** 通用设置行 order：内置行是 -20..20，插件行一律 ≥ 100（排在所有内置行之后）。 */
    const NATIVE_SUPPRESS_ROW_ORDER = 100
    const NATIVE_SUPPRESS_DATASET_KEY = 'dacNativeArchiveHidden'
    const NATIVE_SUPPRESS_REFERENCES_KEY = 'dacNativeArchiveHiddenReferences'
    /** General-settings row copy for the native-page suppression switch. */
    const NATIVE_SUPPRESS_TITLE = '屏蔽自带归档页'
    const NATIVE_SUPPRESS_DESCRIPTION = '隐藏 DSH 自带的「已归档会话」设置页，设置菜单只保留这里的「归档管理」。'
    /** Shown only while the switch is on but the DOM patch could not locate the native row. */
    const NATIVE_SUPPRESS_UNAVAILABLE = '未能定位 DSH 自带的「已归档会话」菜单项，原生页保持显示。'
    /** The Settings shell's own panel: `SettingsRoot` renders `role=dialog` + `aria-modal`, then one `nav`. */
    const SETTINGS_NAV_SELECTOR = '[role="dialog"][aria-modal="true"] nav'
    const BATCH_CONFIRM_THRESHOLD = 50
    const DAY_MS = 24 * 60 * 60 * 1000
    /**
     * Cutoffs. `hours`/`days` are rolling windows; `dayBoundary` starts at local
     * midnight so that "1 天前" means yesterday and earlier rather than being a
     * duplicate of the rolling 24-hour window; `unbounded` is "所有时间", the one
     * option that drops the time condition entirely so every chat is a
     * candidate. The archive rule is authored by the user, never by a timer.
     */
    const BATCH_PRESETS = [
      { id: 'all', label: '所有时间', unbounded: true },
      { id: '24h', label: '24 小时前', hours: 24 },
      { id: '1d', label: '1 天前', dayBoundary: true },
      { id: '7d', label: '7 天前', days: 7 },
      { id: '15d', label: '15 天前', days: 15 },
      { id: '30d', label: '30 天前', days: 30 },
      { id: '90d', label: '90 天前', days: 90 },
      { id: 'date', label: '自定义日期' }
    ]
    const inject = ['workspaces', 'sessions', 'slots']

    const styleText = `
.dac-nav-icon-template{display:none}
[data-dac-archive-nav]{position:relative}
[data-dac-archive-nav]>svg:first-child{opacity:0}
[data-dac-archive-nav]::before{content:"";position:absolute;left:12px;top:50%;width:16px;height:16px;transform:translateY(-50%);background:currentColor;pointer-events:none;-webkit-mask:var(--dac-archive-nav-mask) center/16px 16px no-repeat;mask:var(--dac-archive-nav-mask) center/16px 16px no-repeat}
[data-dac-native-archive-hidden]{display:none!important}
.dac-general-row{display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dac-general-row-text{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0;padding-right:48px}
.dac-general-row-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.dac-general-row-description{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
.dac-general-row-note{color:var(--dsw-alias-state-warn-label);font-size:12px;font-weight:400;line-height:18px}
.dac-section{width:100%;max-width:720px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}
.dac-section-heading{display:flex;align-items:baseline;gap:8px;min-width:0;min-height:24px}
.dac-section-title{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px;letter-spacing:0}
.dac-section-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dac-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.dac-search{position:relative;display:flex;flex:1 1 160px;min-width:110px;align-items:center;color:var(--dsw-alias-label-tertiary)}
.dac-search>svg{position:absolute;left:12px;pointer-events:none}
.dac-search input{flex:1 1 auto;width:100%;height:32px;box-sizing:border-box;padding:0 12px 0 36px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;letter-spacing:0}
.dac-search input::placeholder{color:var(--dsw-alias-label-caption)}
.dac-select-field{position:relative;display:inline-flex;align-items:center;min-width:0;width:100%;color:var(--dsw-alias-label-secondary);--dac-chevron-glyph:url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20d%3D%22M2.75%204.5L6%207.75L9.25%204.5%22%20fill%3D%22none%22%20stroke%3D%22%23000%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E");--dac-calendar-glyph:url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20d%3D%22M2%203.25h8v6.5H2z%22%20fill%3D%22none%22%20stroke%3D%22%23000%22%20stroke-width%3D%221.2%22%20stroke-linejoin%3D%22round%22%2F%3E%3Cpath%20d%3D%22M2%205.5h8M4%201.75v2M8%201.75v2%22%20fill%3D%22none%22%20stroke%3D%22%23000%22%20stroke-width%3D%221.2%22%20stroke-linecap%3D%22round%22%2F%3E%3C%2Fsvg%3E");--dac-field-glyph:var(--dac-chevron-glyph)}
.dac-select-field-date{--dac-field-glyph:var(--dac-calendar-glyph)}
.dac-select-field::after{content:"";position:absolute;right:9px;top:50%;width:12px;height:12px;transform:translateY(-50%);background:currentColor;opacity:.65;pointer-events:none;-webkit-mask:var(--dac-field-glyph) center/12px 12px no-repeat;mask:var(--dac-field-glyph) center/12px 12px no-repeat}
.dac-toolbar .dac-select-field{flex:none;width:auto}
.dac-select,.dac-date{width:100%;height:32px;box-sizing:border-box;padding:0 30px 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background-color:var(--dsw-specific-input-major,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;letter-spacing:0;cursor:pointer}
.dac-select{appearance:none;-webkit-appearance:none}
.dac-toolbar .dac-select{width:auto}
.dac-date{position:relative}
.dac-date::-webkit-calendar-picker-indicator{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
.dac-select:focus-visible,.dac-date:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dac-description{margin:0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}
.dac-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dac-list{display:flex;flex-direction:column;min-width:0;gap:2px}
.dac-groups{display:flex;flex-direction:column;min-width:0;gap:12px}
.dac-group{display:flex;flex-direction:column;min-width:0;gap:2px}
.dac-group-head{display:flex;align-items:center;gap:6px;min-width:0}
.dac-group-row{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;height:34px;padding:0 8px;border-radius:8px;color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none;outline:none}
.dac-group-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dac-group-row:focus-visible{box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
.dac-group-slot{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:20px;color:var(--dsw-alias-label-tertiary)}
.dac-group-chevron{display:none}
.dac-group-row:hover .dac-group-chevron{display:inline-flex}
.dac-group-row:hover .dac-group-folder{display:none}
.dac-group-arrow{transition:transform .15s var(--ds-ease-in-out,ease-in-out)}
.dac-group-arrow-open{transform:rotate(90deg)}
.dac-group-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:22px}
.dac-group-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dac-group-body{display:flex;flex-direction:column;min-width:0;gap:2px;padding-left:20px}
.dac-link-button{flex:none;height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;letter-spacing:0;cursor:pointer}
.dac-link-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dac-link-button:disabled{opacity:.45;cursor:not-allowed}
.dac-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:8px 10px;border-radius:8px}
.dac-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dac-row-copy{display:flex;flex-direction:column;min-width:0;gap:2px}
.dac-row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dac-row-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dac-row-actions{display:flex;align-items:center;gap:4px}
.dac-icon-button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dac-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dac-icon-button.danger{color:var(--dsw-alias-state-error-primary)}
.dac-icon-button.danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.dac-icon-button:disabled{opacity:.45;cursor:not-allowed}
.dac-empty{padding:32px 0;text-align:center;color:var(--dsw-alias-label-secondary);font-size:14px}
.dac-error{margin:0;padding:10px 12px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px;white-space:pre-wrap}
.dac-dialog{width:min(480px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 32px));border-radius:8px}
.dac-dialog.dac-dialog-batch{width:min(560px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 48px));gap:12px;padding-bottom:18px}
.dac-dialog-batch .dac-content-batch{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}
.dac-dialog-batch .dac-content-batch>:first-child{padding:16px 14px 8px 24px}
.dac-dialog-batch .dac-content-batch>:last-child{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;margin-top:8px;padding:0 20px;overflow:hidden}
.dac-batch{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:10px}
.dac-batch-scroll{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:auto;gap:12px}
.dac-batch-fixed{display:flex;flex-direction:column;flex:none;gap:6px}
.dac-batch-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.dac-button-small{flex:none;height:26px;padding:0 10px;font-size:12px}
.dac-list-actions{display:flex;align-items:center;gap:8px;min-width:0}
.dac-list-toggle{margin-left:auto}
.dac-batch-summary{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dac-content{max-height:min(480px,calc(100vh - 112px));overflow:auto}
.dac-confirm{display:flex;flex-direction:column;gap:10px;min-width:0}
.dac-confirm-title{overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dac-confirm-note{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dac-footer{display:flex;justify-content:flex-end;gap:8px}
.dac-button{height:34px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;letter-spacing:0;cursor:pointer}
.dac-button:hover{background:var(--dsw-alias-button-floating-hover)}
.dac-button.danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted)}
.dac-button.primary{border-color:transparent;background:var(--dsw-alias-button-info-fill,#4d6bfe);color:var(--dsw-alias-label-primary-inverted,#fff)}
.dac-button.primary:hover{background:var(--dsw-alias-button-info-hover,#3f5be0)}
.dac-button:disabled{opacity:.5;cursor:not-allowed}
.dac-batch{display:flex;flex-direction:column;gap:12px;min-width:0}
.dac-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dac-field-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dac-checks{display:flex;flex-direction:column;gap:6px;min-width:0}
.dac-check-row{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer}
.dac-check{width:16px;height:16px;flex:none;margin:0;accent-color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dac-preview{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:80px;overflow:auto;padding-right:4px}
.dac-preview-group{display:flex;flex-direction:column;gap:2px;min-width:0}
.dac-preview-head{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dac-preview-row{display:flex;align-items:center;gap:8px;min-height:32px;min-width:0}
.dac-preview-copy{display:flex;flex-direction:column;min-width:0}
.dac-preview-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dac-preview-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dac-progress{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dac-result{display:flex;flex-direction:column;gap:6px;min-width:0}
.dac-result-list{margin:0;padding-left:18px;max-height:160px;overflow:auto;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
@media(max-width:520px){.dac-dialog,.dac-dialog-batch{width:calc(100vw - 16px);max-height:calc(100vh - 16px)}.dac-content{max-height:calc(100vh - 96px)}}
`

    function createUiStore() {
      let revision = 0
      const listeners = new Set()
      return {
        getSnapshot: () => revision,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        refresh() {
          revision += 1
          for (const listener of listeners) listener()
        }
      }
    }

    function archiveCountLabel(count) {
      return `${count > 99 ? '99+' : count} 条聊天`
    }

    function sessionLabel(summary) {
      return summary.displayTitle || summary.title || '未命名聊天'
    }

    /**
     * Relative activity label with DSH's own thresholds (primitives
     * `relativeTime`): under a minute, then minutes, hours, days, 30-day months
     * and 365-day years. An unknown `updatedAt` has no label at all — the row
     * then keeps only its Workspace.
     */
    function relativeTimeLabel(updatedAt, now) {
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return ''
      const elapsed = Math.max(0, now - updatedAt)
      const step = (size, unit) => `${Math.floor(elapsed / size)} ${unit}`
      if (elapsed < 60 * 1000) return '刚刚'
      if (elapsed < 60 * 60 * 1000) return step(60 * 1000, '分钟')
      if (elapsed < 24 * 60 * 60 * 1000) return step(60 * 60 * 1000, '小时')
      if (elapsed < 30 * 24 * 60 * 60 * 1000) return step(24 * 60 * 60 * 1000, '天')
      if (elapsed < 365 * 24 * 60 * 60 * 1000) return step(30 * 24 * 60 * 60 * 1000, '个月')
      return step(365 * 24 * 60 * 60 * 1000, '年')
    }

    /**
     * Index the authoritative Workspace membership. An archived session keeps its
     * `sessionIds` slot, so this index answers "which workspace owns it" and
     * "which slot will restoration restore" without any additional Host call.
     */
    function workspaceIndex(workspaceState) {
      const bySession = new Map()
      const items = Array.isArray(workspaceState?.items) ? workspaceState.items : []
      for (const workspace of items) {
        const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
        for (const id of sessionIds) if (!bySession.has(id)) bySession.set(id, workspace)
      }
      return { bySession, items }
    }

    function summaryRows(workspaceState, sessionState, ids) {
      const byId = sessionState?.byId ?? {}
      const index = workspaceIndex(workspaceState)
      const rows = []
      for (const id of ids) {
        const summary = byId[id]
        if (summary === undefined) continue
        if (summary.origin === 'subagent') continue
        const owner = index.bySession.get(id)
        rows.push({
          id,
          title: sessionLabel(summary),
          updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
          cwd: typeof summary.cwd === 'string' ? summary.cwd : '',
          blank: summary.blank === true,
          running: summary.running === true,
          workspaceId: owner?.workspaceId ?? '',
          workspaceTitle: owner?.title ?? ''
        })
      }
      return rows
    }

    /** Archived rows in archive order plus the ids whose summary is currently unreadable. */
    function buildArchivedRows(workspaceState, sessionState) {
      const archivedIds = Array.isArray(workspaceState?.archivedSessionIds)
        ? workspaceState.archivedSessionIds
        : []
      const byId = sessionState?.byId ?? {}
      let unreadable = 0
      const readable = []
      archivedIds.forEach((id) => {
        if (byId[id] === undefined) unreadable += 1
        else readable.push(id)
      })
      const rows = summaryRows(workspaceState, sessionState, readable)
      rows.forEach((row) => { row.archiveOrder = archivedIds.indexOf(row.id) })
      return { rows, unreadable }
    }

    /**
     * The chat the main view currently shows — the one batch flows exclude by
     * default. DSH 0.1.6-alpha.1 carried it as `sessions.list.current`;
     * alpha.2 removed that field because view selection left the Session
     * Controller, and the fact now rides each row's local `retainedBy.mainView`
     * retention — the single source the shipped layout, sidebar, workspace
     * browser and General settings read (`Object.values(byId).find(row =>
     * (row.retainedBy.mainView ?? 0) > 0)`). Presence of the key decides which
     * generation answers, not its value: alpha.1 keeps its own selection
     * (including the deliberate "no session on stage" `undefined`), while alpha.2
     * — where the key is gone — falls back to retention. Returning `undefined`
     * only means no row is on stage.
     */
    function currentSessionId(sessionState) {
      const state = sessionState ?? {}
      if (Object.prototype.hasOwnProperty.call(state, 'current')) return state.current
      const byId = state.byId ?? {}
      for (const id of Object.keys(byId)) {
        if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
      }
      return undefined
    }

    /**
     * One group per Workspace in its authoritative Host order plus a single
     * Ungrouped bucket — the same grouping DSH's sidebar derives. Empty groups
     * are omitted: this page is a manager, not a navigation surface.
     */
    function groupRowsByWorkspace(rows, workspaceState) {
      const index = workspaceIndex(workspaceState)
      const groups = []
      const accounted = new Set()
      for (const workspace of index.items) {
        const members = rows.filter(row => row.workspaceId === workspace.workspaceId)
        if (members.length === 0) continue
        for (const row of members) accounted.add(row.id)
        groups.push({
          key: workspace.workspaceId,
          workspaceId: workspace.workspaceId,
          title: typeof workspace.title === 'string' && workspace.title !== ''
            ? workspace.title
            : workspace.path ?? '',
          rows: members
        })
      }
      const stray = rows.filter(row => !accounted.has(row.id))
      if (stray.length > 0) {
        groups.push({ key: '', workspaceId: '', title: UNGROUPED_TITLE, rows: stray })
      }
      return groups
    }

    function sortRows(rows, mode) {
      const sorted = [...rows]
      if (mode === 'archived') {
        sorted.sort((left, right) => (left.archiveOrder ?? 0) - (right.archiveOrder ?? 0)
          || right.updatedAt - left.updatedAt
          || String(left.id).localeCompare(String(right.id)))
        return sorted
      }
      sorted.sort((left, right) => right.updatedAt - left.updatedAt
        || String(left.id).localeCompare(String(right.id)))
      return sorted
    }

    function matchesQuery(row, query) {
      if (query === '') return true
      const haystack = `${row.title}\n${row.cwd}\n${row.workspaceTitle}`.toLowerCase()
      return haystack.includes(query)
    }

    function parseDateInput(value) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(typeof value === 'string' ? value : '')
      if (match === null) return undefined
      const year = Number(match[1])
      const month = Number(match[2])
      const day = Number(match[3])
      const time = new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
      const probe = new Date(time)
      if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
        return undefined
      }
      return time
    }

    /**
     * Resolve the chosen time condition to a local cutoff instant. `+Infinity`
     * is the explicit "所有时间" value — every chat is strictly older than it, so
     * the time filter accepts all of them — while an unknown preset or an
     * invalid custom date stays `undefined` and fails closed to no candidates.
     */
    function resolveCutoff(presetId, dateValue, now) {
      const preset = BATCH_PRESETS.find(item => item.id === presetId)
      if (preset === undefined) return undefined
      if (preset.unbounded === true) return Number.POSITIVE_INFINITY
      if (preset.dayBoundary === true) {
        const startOfToday = new Date(now)
        startOfToday.setHours(0, 0, 0, 0)
        return startOfToday.getTime()
      }
      if (typeof preset.hours === 'number') return now - preset.hours * 60 * 60 * 1000
      if (typeof preset.days === 'number') return now - preset.days * DAY_MS
      return parseDateInput(dateValue)
    }

    /**
     * Sessions eligible for batch archiving. Archived sessions are excluded by
     * construction, and every other exclusion is an explicit, user-visible
     * default: archiving a running chat would hide it without stopping it.
     */
    function batchCandidates(options) {
      const { workspaceState, sessionState, cutoff, scope, include } = options
      // `+Infinity` is 所有时间 and passes on purpose; only a missing or NaN
      // cutoff — an unknown preset, an unparsable custom date — still yields no
      // candidates. (A negative cutoff is kept as-is and matches nothing.)
      if (typeof cutoff !== 'number' || Number.isNaN(cutoff)) return []
      const archived = new Set(Array.isArray(workspaceState?.archivedSessionIds)
        ? workspaceState.archivedSessionIds
        : [])
      const index = workspaceIndex(workspaceState)
      const byId = sessionState?.byId ?? {}
      const ids = Array.isArray(sessionState?.ids) ? sessionState.ids : Object.keys(byId)
      const currentId = currentSessionId(sessionState)
      const keep = {
        running: include?.running === true,
        blank: include?.blank === true,
        current: include?.current === true
      }
      const eligible = []
      for (const id of ids) {
        const summary = byId[id]
        if (summary === undefined) continue
        if (archived.has(id)) continue
        if (summary.origin === 'subagent') continue
        if (summary.blank === true && !keep.blank) continue
        if (summary.running === true && !keep.running) continue
        if (id === currentId && !keep.current) continue
        const owner = index.bySession.get(id)
        if (scope?.kind === 'workspace' && owner?.workspaceId !== scope.workspaceId) continue
        if (scope?.kind === 'ungrouped' && owner !== undefined) continue
        const updatedAt = typeof summary.updatedAt === 'number' ? summary.updatedAt : 0
        if (!(updatedAt < cutoff)) continue
        eligible.push(id)
      }
      return sortRows(summaryRows(workspaceState, sessionState, eligible), 'updated')
    }

    /**
     * Run one frozen batch: every item is its own durable unit, so a stop or a
     * failure never rolls back what already succeeded. A chat that gained
     * activity after the preview is skipped and reported instead of archived.
     */
    async function runArchiveBatch(items, deps) {
      const archived = []
      const skipped = []
      const failed = []
      let processed = 0
      let stopped = false
      for (const item of items) {
        if (deps.shouldStop()) { stopped = true; break }
        deps.onProgress?.({ processed, total: items.length, current: item.title })
        if (deps.isArchived(item.id)) {
          skipped.push({ item, reason: '已在归档列表中' })
          processed += 1
          continue
        }
        const latest = deps.latestActivity(item.id)
        if (typeof latest === 'number' && latest > item.updatedAt) {
          skipped.push({ item, reason: '预览后有了新活动' })
          processed += 1
          continue
        }
        try {
          await deps.archive(item.id)
          archived.push(item)
        } catch (error) {
          failed.push({ item, message: error instanceof Error ? error.message : String(error) })
        }
        processed += 1
      }
      deps.onProgress?.({ processed, total: items.length, current: undefined })
      return { archived, skipped, failed, stopped, processed, total: items.length }
    }

    /**
     * Archived chats eligible for batch permanent deletion: the archived set is
     * the only candidate universe, because everything on this page is archived
     * by definition. The same explicit, user-visible default exclusions apply as
     * for archiving — the Host rejects a live session anyway, and reporting the
     * refusal per row is worse than not offering it.
     */
    function deletionCandidates(options) {
      const { workspaceState, sessionState, cutoff, scope, include } = options
      // `+Infinity` is 所有时间 and passes on purpose; only a missing or NaN
      // cutoff — an unknown preset, an unparsable custom date — still yields no
      // candidates. (A negative cutoff is kept as-is and matches nothing.)
      if (typeof cutoff !== 'number' || Number.isNaN(cutoff)) return []
      const archivedIds = Array.isArray(workspaceState?.archivedSessionIds)
        ? workspaceState.archivedSessionIds
        : []
      const index = workspaceIndex(workspaceState)
      const byId = sessionState?.byId ?? {}
      const currentId = currentSessionId(sessionState)
      const keep = {
        running: include?.running === true,
        blank: include?.blank === true,
        current: include?.current === true
      }
      const eligible = []
      for (const id of archivedIds) {
        const summary = byId[id]
        if (summary === undefined) continue
        if (summary.origin === 'subagent') continue
        if (summary.blank === true && !keep.blank) continue
        if (summary.running === true && !keep.running) continue
        if (id === currentId && !keep.current) continue
        const owner = index.bySession.get(id)
        if (scope?.kind === 'workspace' && owner?.workspaceId !== scope.workspaceId) continue
        if (scope?.kind === 'ungrouped' && owner !== undefined) continue
        const updatedAt = typeof summary.updatedAt === 'number' ? summary.updatedAt : 0
        if (!(updatedAt < cutoff)) continue
        eligible.push(id)
      }
      return sortRows(summaryRows(workspaceState, sessionState, eligible), 'updated')
    }

    /**
     * Run one frozen permanent-deletion batch. Nothing here can be rolled back,
     * so a chat that left the archive set or gained activity after the preview
     * is skipped and reported instead of being deleted, and a failure is
     * recorded per chat without stopping the rest.
     */
    async function runDeletionBatch(items, deps) {
      const deleted = []
      const skipped = []
      const failed = []
      let processed = 0
      let stopped = false
      for (const item of items) {
        if (deps.shouldStop()) { stopped = true; break }
        deps.onProgress?.({ processed, total: items.length, current: item.title })
        if (!deps.isArchived(item.id)) {
          skipped.push({ item, reason: '已不在归档列表' })
          processed += 1
          continue
        }
        const latest = deps.latestActivity(item.id)
        if (typeof latest === 'number' && latest > item.updatedAt) {
          skipped.push({ item, reason: '预览后有了新活动' })
          processed += 1
          continue
        }
        try {
          await deps.remove(item.id)
          deleted.push(item)
        } catch (error) {
          if (error?.code === 'session-not-archived') {
            skipped.push({ item, reason: '已不在归档列表' })
          } else {
            failed.push({ item, message: error instanceof Error ? error.message : String(error) })
          }
        }
        processed += 1
      }
      deps.onProgress?.({ processed, total: items.length, current: undefined })
      return { deleted, skipped, failed, stopped, processed, total: items.length }
    }

    async function runRestoreBatch(items, deps) {
      const restored = []
      const skipped = []
      const failed = []
      let processed = 0
      let stopped = false
      for (const item of items) {
        if (deps.shouldStop()) { stopped = true; break }
        deps.onProgress?.({ processed, total: items.length, current: item.title })
        if (!deps.isArchived(item.id)) {
          skipped.push({ item, reason: '已不在归档列表' })
          processed += 1
          continue
        }
        try {
          await deps.restore(item.id)
          restored.push(item)
        } catch (error) {
          if (error?.code === 'session-not-archived') {
            skipped.push({ item, reason: '已不在归档列表' })
          } else {
            failed.push({ item, message: error instanceof Error ? error.message : String(error) })
          }
        }
        processed += 1
      }
      deps.onProgress?.({ processed, total: items.length, current: undefined })
      return { restored, skipped, failed, stopped, processed, total: items.length }
    }

    /**
     * Wrap a form control so the plugin owns its indicator: the native select
     * arrow sits flush against the border, and the native date picker's glyph
     * does not match the theme.
     */
    function field(className, control) {
      return React.createElement('span', { className }, control)
    }

    function selectField(props, options) {
      const { className, ...rest } = props
      return field(
        className === undefined ? 'dac-select-field' : `dac-select-field ${className}`,
        React.createElement('select', { ...rest, className: 'dac-select' }, options)
      )
    }

    /**
     * One row's secondary line, shaped like DSH's own archived-session list:
     * `Workspace · 20 天`, and just `20 天` inside a Workspace group, whose
     * header already names the Workspace. Restore position and directory are
     * deliberately absent — the native page shows neither.
     */
    function rowMeta(row, options = {}) {
      const parts = []
      if (options.withWorkspace !== false) {
        parts.push(row.workspaceTitle === '' ? UNGROUPED_TITLE : row.workspaceTitle)
      }
      const activity = relativeTimeLabel(row.updatedAt, options.now ?? Date.now())
      if (activity !== '') parts.push(activity)
      return parts.join(' · ')
    }

    function batchOutcomeText(result, verb) {
      const count = result.deleted?.length ?? result.archived?.length ?? result.restored?.length ?? 0
      const parts = [`已${verb} ${count} 条`]
      if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length} 条`)
      if (result.failed.length > 0) parts.push(`失败 ${result.failed.length} 条`)
      if (result.stopped) parts.push('已中止')
      return `${parts.join('、')}。`
    }

    /**
     * Resolve client storage without letting a denied or absent store break apply.
     * @returns localStorage, or null when unusable.
     */
    function resolveClientStorage() {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return null
        return localStorage
      } catch {
        return null
      }
    }

    /**
     * Read the browser-local suppression preference. Anything but a stored
     * boolean literal resolves to the default (on): the native page duplicates
     * this manager's own section, so a fresh install must not show two archive
     * entries side by side.
     */
    function readNativeSuppression(storage) {
      if (storage === null || typeof storage?.getItem !== 'function') return true
      try {
        const raw = storage.getItem(NATIVE_SUPPRESS_STORAGE_KEY)
        if (raw === 'true') return true
        if (raw === 'false') return false
        return true
      } catch {
        return true
      }
    }

    /**
     * Persist the suppression preference, tolerating denied or full storage.
     */
    function writeNativeSuppression(storage, value) {
      if (storage === null || typeof storage?.setItem !== 'function') return
      try {
        storage.setItem(NATIVE_SUPPRESS_STORAGE_KEY, value ? 'true' : 'false')
      } catch {
        // A denied write keeps the in-memory value; the next apply re-reads storage.
      }
    }

    /**
     * Create the suppression preference consumed by the General row and the nav
     * patch. The value is browser-local viewing habit, so it never reaches the
     * Host, the profile, or the registry.
     *
     * `applied` is the patch's own report, not a preference: `null` while the
     * switch is off or nothing is installed, `true` when the native row is
     * actually hidden, `false` when the switch is on but the DOM patch could not
     * locate that row. The General row reads it so it never claims a suppression
     * that did not happen.
     */
    function createNativeSuppressionStore(storage) {
      let suppressed = readNativeSuppression(storage)
      let applied = null
      const listeners = new Set()
      const publish = () => {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.error('[dsh-chat-archive-manager] suppression listener failed:', error)
          }
        }
      }
      return {
        get: () => suppressed,
        getApplied: () => applied,
        setApplied: (next) => {
          const value = next === true ? true : (next === false ? false : null)
          if (value === applied) return
          applied = value
          publish()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set: (next) => {
          const value = next === true
          if (value === suppressed) return
          suppressed = value
          writeNativeSuppression(storage, value)
          publish()
        },
        reload: () => {
          const value = readNativeSuppression(storage)
          if (value === suppressed) return
          suppressed = value
          publish()
        }
      }
    }

    /**
     * The Settings nav's **section list**: the last direct child of the nav that
     * holds buttons. `SettingsRoot` renders the title seat first and the section
     * list after it, so scanning the nav's own children in reverse keeps a
     * replaced `settings.header` — a third-party plugin may legitimately put its
     * own button into the title seat — out of the button count, while any
     * structure this cannot read still yields an empty list and therefore keeps
     * the patch disabled (fail closed).
     *
     * @param nav - the Settings dialog's nav element, or null.
     * @returns the section buttons in document order, or an empty list.
     */
    function settingsNavListButtons(nav) {
      if (nav === null || nav === undefined || typeof nav.querySelectorAll !== 'function') return []
      const children = nav.children
      if (children === undefined || children === null) return []
      const containers = [...children]
      for (let index = containers.length - 1; index >= 0; index -= 1) {
        const buttons = [...containers[index].querySelectorAll('button')]
        if (buttons.length > 0) return buttons
      }
      return []
    }

    /**
     * Pick the native archived-sessions nav row to hide, or `undefined` when the
     * answer is not certain. The Settings shell projects `settings.section`
     * entries into one nav button per entry, in entry order, so position is the
     * stable join between the slot ledger and the DOM — another installation may
     * have more sections, order them differently, or run another language without
     * changing that join. Every guard is fail closed, because hiding the wrong
     * row is worse than hiding none:
     *
     * - the native entry must still exist (a DSH without it disables the switch);
     * - the button count must equal the entry count, so an unknown extra control
     *   inside the section list (a future shell affordance) turns the patch off;
     * - an empty label means the button is not a projected section row;
     * - this manager's own "归档管理" row is never a target.
     *
     * @param navButtons - the section-list buttons, in document order.
     * @param sectionIds - the `settings.section` entry ids, in slot order.
     * @returns the row to hide, or undefined.
     */
    function resolveNativeArchiveNavButton(navButtons, sectionIds) {
      if (!Array.isArray(navButtons) || !Array.isArray(sectionIds)) return undefined
      if (navButtons.length !== sectionIds.length) return undefined
      const index = sectionIds.indexOf(NATIVE_ARCHIVE_SECTION_ID)
      if (index === -1) return undefined
      const button = navButtons[index]
      if (button === null || button === undefined || typeof button !== 'object') return undefined
      const label = typeof button.textContent === 'string' ? button.textContent.trim() : ''
      if (label === '' || label === SECTION_TITLE) return undefined
      return button
    }

    /**
     * Hide the native archived-sessions Settings row while the preference is on,
     * and restore exactly what this run marked when it turns off or unloads.
     *
     * The row is hidden with a marked attribute plus the plugin's own
     * `display:none` rule rather than by removing the node: the shell's React
     * owns that subtree, and a removed node would make its own cleanup throw. The
     * attribute carries a reference count so two live bundle generations (HMR)
     * cannot restore a row the other still suppresses.
     */
    function installNativeArchiveSuppression(ctx, options) {
      const doc = options.document
      const view = options.window
      const preference = options.preference
      if (doc === null || doc === undefined || view === null || view === undefined) return
      const touched = new Set()

      const navButtons = () => {
        const nav = typeof doc.querySelector === 'function' ? doc.querySelector(SETTINGS_NAV_SELECTOR) : null
        return settingsNavListButtons(nav)
      }

      const sectionIds = () => {
        try {
          const entries = ctx.slots.entries('settings.section')
          if (!Array.isArray(entries)) return []
          return entries
            .map(entry => entry?.options?.id)
            .filter(id => typeof id === 'string')
        } catch {
          return []
        }
      }

      const release = (button) => {
        const current = Number(button.dataset?.[NATIVE_SUPPRESS_REFERENCES_KEY])
        const remaining = Number.isSafeInteger(current) && current > 0 ? current - 1 : 0
        if (remaining > 0) {
          button.dataset[NATIVE_SUPPRESS_REFERENCES_KEY] = String(remaining)
          return
        }
        delete button.dataset?.[NATIVE_SUPPRESS_DATASET_KEY]
        delete button.dataset?.[NATIVE_SUPPRESS_REFERENCES_KEY]
      }

      const mark = (button) => {
        if (touched.has(button)) return
        const current = Number(button.dataset?.[NATIVE_SUPPRESS_REFERENCES_KEY])
        const references = Number.isSafeInteger(current) && current >= 0 ? current : 0
        button.dataset[NATIVE_SUPPRESS_DATASET_KEY] = ''
        button.dataset[NATIVE_SUPPRESS_REFERENCES_KEY] = String(references + 1)
        touched.add(button)
      }

      const sync = () => {
        const buttons = navButtons()
        const hiding = preference.get() === true
        const target = hiding ? resolveNativeArchiveNavButton(buttons, sectionIds()) : undefined
        for (const button of [...touched]) {
          if (button === target) continue
          release(button)
          touched.delete(button)
        }
        if (target !== undefined) mark(target)
        // Report whether the switch is actually doing anything, so the General row
        // never claims a suppression this DOM patch could not apply.
        if (typeof preference.setApplied === 'function') {
          preference.setApplied(hiding ? target !== undefined : null)
        }
      }

      sync()
      const observer = typeof view.MutationObserver === 'function'
        ? new view.MutationObserver(sync)
        : undefined
      if (observer !== undefined && doc.body !== undefined && doc.body !== null) {
        observer.observe(doc.body, { childList: true, subtree: true })
      }
      const unsubscribe = preference.subscribe(sync)
      const removeStorageListener = typeof view.addEventListener === 'function'
        ? (() => {
            const listener = (event) => {
              if (event === null || event === undefined || event.key !== NATIVE_SUPPRESS_STORAGE_KEY) return
              preference.reload()
            }
            view.addEventListener('storage', listener)
            return () => view.removeEventListener('storage', listener)
          })()
        : undefined

      ctx.effect(() => () => {
        observer?.disconnect()
        unsubscribe()
        removeStorageListener?.()
        for (const button of touched) release(button)
        touched.clear()
      }, 'dsh-chat-archive-manager: native archived-sessions suppression')
    }

    /**
     * General-settings row for the suppression switch: title, description, and
     * the shell's own Switch primitive (never a self-drawn control). When the
     * switch is on but the nav patch could not locate the native row, the row
     * says so instead of pretending the page is hidden.
     */
    function NativeArchiveSuppressRow({ getSuppressed, subscribeSuppressed, setSuppressed, getApplied }) {
      const suppressed = React.useSyncExternalStore(subscribeSuppressed, getSuppressed, getSuppressed)
      const applied = React.useSyncExternalStore(subscribeSuppressed, getApplied, getApplied)
      return React.createElement('div', {
        className: 'dac-general-row',
        'data-dac-native-archive-row': ''
      },
      React.createElement('div', { className: 'dac-general-row-text' },
        React.createElement('div', { className: 'dac-general-row-title' }, NATIVE_SUPPRESS_TITLE),
        React.createElement('div', { className: 'dac-general-row-description' }, NATIVE_SUPPRESS_DESCRIPTION),
        suppressed === true && applied === false && React.createElement('div', {
          className: 'dac-general-row-note',
          role: 'status'
        }, NATIVE_SUPPRESS_UNAVAILABLE)),
      React.createElement(Switch, {
        checked: suppressed === true,
        onChange: (next) => {
          setSuppressed(next === true)
        },
        label: NATIVE_SUPPRESS_TITLE
      }))
    }

    function ArchiveNavIconMarker() {
      const templateRef = React.useRef(null)
      React.useLayoutEffect(() => {
        if (typeof document === 'undefined' || typeof window === 'undefined') return undefined
        const svg = templateRef.current?.querySelector?.('svg')
        if (svg === null || svg === undefined) return undefined
        const source = svg.outerHTML.includes('xmlns=')
          ? svg.outerHTML
          : svg.outerHTML.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
        const mask = `url("data:image/svg+xml,${encodeURIComponent(source)}")`
        const touched = new Set()

        const mark = () => {
          for (const button of document.querySelectorAll('nav button')) {
            if (button.textContent.trim() !== SECTION_TITLE || touched.has(button)) continue
            const parsedReferences = Number(button.dataset.dacArchiveNavReferences)
            const references = Number.isSafeInteger(parsedReferences) && parsedReferences >= 0
              ? parsedReferences
              : 0
            button.dataset.dacArchiveNav = ''
            button.dataset.dacArchiveNavReferences = String(references + 1)
            button.style.setProperty('--dac-archive-nav-mask', mask)
            touched.add(button)
          }
        }

        mark()
        const observer = typeof window.MutationObserver === 'function'
          ? new window.MutationObserver(mark)
          : undefined
        observer?.observe(document.body, { childList: true, subtree: true })

        return () => {
          observer?.disconnect()
          for (const button of touched) {
            const current = Number(button.dataset.dacArchiveNavReferences)
            const remaining = Number.isSafeInteger(current) && current > 0 ? current - 1 : 0
            if (remaining > 0) {
              button.dataset.dacArchiveNavReferences = String(remaining)
              continue
            }
            delete button.dataset.dacArchiveNav
            delete button.dataset.dacArchiveNavReferences
            button.style.removeProperty('--dac-archive-nav-mask')
          }
        }
      }, [])

      return React.createElement(
        'div',
        { ref: templateRef, className: 'dac-nav-icon-template', 'aria-hidden': true },
        React.createElement(IconArchiveOutline20, { size: 16 })
      )
    }

    function apply(ctx) {
      const workspaces = ctx.workspaces
      const sessions = ctx.sessions
      const workspaceList = workspaces.list
      const sessionList = sessions.list
      const subscribeWorkspaces = listener => workspaceList.subscribe(listener)
      const getWorkspaceSnapshot = () => workspaceList.getSnapshot()
      const subscribeSessions = listener => sessionList.subscribe(listener)
      const getSessionSnapshot = () => sessionList.getSnapshot()
      const archiveBatchSupported = typeof workspaces.archiveSession === 'function'
      const statusControllers = new Set()
      const mutationControllers = new Set()
      const ui = createUiStore()
      let statusPromise
      let archiveStatus
      let disposed = false

      function loadStatus(force = false) {
        if (force) statusPromise = undefined
        if (statusPromise !== undefined) return statusPromise
        const controller = new AbortController()
        statusControllers.add(controller)
        const request = fetch(STATUS_PATH, { method: 'GET', credentials: 'same-origin', signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (!body || body.ok !== true
              || typeof body.deletionSupported !== 'boolean'
              || typeof body.restorationSupported !== 'boolean') {
              throw new Error('invalid archive manager response')
            }
            archiveStatus = body
            if (!disposed) ui.refresh()
            return body
          })
          .catch((error) => {
            if (statusPromise === request) statusPromise = undefined
            throw error
          })
          .finally(() => { statusControllers.delete(controller) })
        statusPromise = request
        return request
      }

      async function mutateArchivedSession(path, sessionId, options = {}) {
        const controller = new AbortController()
        mutationControllers.add(controller)
        try {
          const response = await fetch(path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              [CLIENT_HEADER]: '1'
            },
            body: JSON.stringify({ sessionId }),
            signal: controller.signal
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok || body.ok !== true) {
            const error = new Error(body.error || `HTTP ${response.status}`)
            error.code = body.code
            throw error
          }
          if (options.refresh !== false) await refreshCoreSnapshots()
          return body
        } finally {
          mutationControllers.delete(controller)
        }
      }

      async function refreshCoreSnapshots() {
        await Promise.all([
          typeof sessions.refresh === 'function' ? sessions.refresh() : undefined,
          typeof workspaces.refresh === 'function' ? workspaces.refresh() : undefined
        ])
      }

      const deleteArchivedSession = (sessionId, options) => mutateArchivedSession(DELETE_PATH, sessionId, options)
      const restoreArchivedSession = (sessionId, options) => mutateArchivedSession(RESTORE_PATH, sessionId, options)
      const archiveSession = async (sessionId) => {
        await workspaces.archiveSession(sessionId)
      }

      function currentArchivedSet() {
        const snapshot = getWorkspaceSnapshot()
        return new Set(Array.isArray(snapshot?.archivedSessionIds) ? snapshot.archivedSessionIds : [])
      }

      function currentSummary(sessionId) {
        return getSessionSnapshot()?.byId?.[sessionId]
      }

      function ArchiveSettingsSection() {
        React.useSyncExternalStore(ui.subscribe, ui.getSnapshot, ui.getSnapshot)
        const workspaceState = React.useSyncExternalStore(
          subscribeWorkspaces,
          getWorkspaceSnapshot,
          getWorkspaceSnapshot
        )
        const sessionState = React.useSyncExternalStore(
          subscribeSessions,
          getSessionSnapshot,
          getSessionSnapshot
        )
        const [confirmTarget, setConfirmTarget] = React.useState(null)
        const [deleting, setDeleting] = React.useState(false)
        const [restoringId, setRestoringId] = React.useState(null)
        const [error, setError] = React.useState(null)
        const [query, setQuery] = React.useState('')
        const [viewMode, setViewMode] = React.useState('grouped')
        const [sortMode, setSortMode] = React.useState('updated')
        const [expandedKeys, setExpandedKeys] = React.useState([])
        const [batch, setBatch] = React.useState(null)
        const abortRef = React.useRef(false)
        const normalizedQuery = query.trim().toLowerCase()

        React.useEffect(() => () => { abortRef.current = true }, [])

        const { rows: allRows, unreadable } = buildArchivedRows(workspaceState, sessionState)
        const filtered = allRows.filter(row => matchesQuery(row, normalizedQuery))
        const rows = sortRows(filtered, sortMode)
        const groups = groupRowsByWorkspace(rows, workspaceState)
        const expanded = new Set(expandedKeys)
        const searchActive = normalizedQuery !== ''

        const closeConfirm = () => {
          if (deleting) return
          setConfirmTarget(null)
          setError(null)
        }
        const confirmDelete = async () => {
          if (confirmTarget === null || deleting || restoringId !== null) return
          setDeleting(true)
          setError(null)
          try {
            await deleteArchivedSession(confirmTarget.id)
            setConfirmTarget(null)
          } catch (reason) {
            await loadStatus(true).catch(() => undefined)
            setError(reason instanceof Error ? reason.message : String(reason))
          } finally {
            setDeleting(false)
          }
        }
        const restoreRow = async (row) => {
          if (deleting || restoringId !== null) return
          setRestoringId(row.id)
          setError(null)
          try {
            await restoreArchivedSession(row.id)
          } catch (reason) {
            await loadStatus(true).catch(() => undefined)
            setError(reason instanceof Error ? reason.message : String(reason))
          } finally {
            setRestoringId(null)
          }
        }
        const toggleGroup = (key) => {
          setExpandedKeys(current => current.includes(key)
            ? current.filter(item => item !== key)
            : [...current, key])
        }
        const toggleAllGroups = (keys) => {
          setExpandedKeys(current => current.length > 0 ? [] : [...keys])
        }

        /**
         * Open the three-step dialog. `mode` decides the whole flow: `archive`
         * offers non-archived chats and is undoable through restore, `delete`
         * offers archived chats and is permanent.
         */
        const openBatch = (scope, mode = 'archive') => {
          abortRef.current = false
          setError(null)
          setBatch({
            mode,
            step: 1,
            scope,
            cutoffPreset: '30d',
            cutoffDate: '',
            include: { running: false, blank: false, current: false },
            acknowledged: false,
            candidates: [],
            deselected: [],
            progress: { processed: 0, total: 0, current: '' },
            running: false,
            result: null,
            undoResult: null,
            undoing: false,
            error: null
          })
        }
        const closeBatch = () => {
          if (batch?.running === true || batch?.undoing === true) return
          abortRef.current = true
          setBatch(null)
        }
        const patchBatch = (patch) => {
          setBatch(current => current === null ? current : { ...current, ...patch })
        }
        const batchDeleting = batch?.mode === 'delete'
        const batchScopeOptions = [{
          value: 'all',
          label: batchDeleting ? '全部归档聊天' : '全部会话'
        }]
        for (const workspace of Array.isArray(workspaceState.items) ? workspaceState.items : []) {
          const title = typeof workspace.title === 'string' && workspace.title !== ''
            ? workspace.title
            : workspace.path ?? ''
          batchScopeOptions.push({ value: `workspace:${workspace.workspaceId}`, label: `工作区 · ${title}` })
        }
        batchScopeOptions.push({ value: 'ungrouped', label: UNGROUPED_TITLE })

        const scopeValueOf = (scope) => scope.kind === 'workspace'
          ? `workspace:${scope.workspaceId}`
          : scope.kind === 'ungrouped' ? 'ungrouped' : 'all'
        const scopeFromValue = (value) => {
          if (value === 'ungrouped') return { kind: 'ungrouped' }
          if (value.startsWith('workspace:')) return { kind: 'workspace', workspaceId: value.slice('workspace:'.length) }
          return { kind: 'all' }
        }

        const batchNow = Date.now()
        const batchCutoff = batch === null
          ? undefined
          : resolveCutoff(batch.cutoffPreset, batch.cutoffDate, batchNow)
        const batchInclude = batch?.include ?? { running: false, blank: false, current: false }
        let batchMatches = []
        let batchExcluded = 0
        let batchIncluded = 0
        if (batch !== null && batch.step === 1) {
          const common = {
            workspaceState,
            sessionState,
            cutoff: batchCutoff,
            scope: batch.scope
          }
          const candidates = batchDeleting ? deletionCandidates : batchCandidates
          batchMatches = candidates({ ...common, include: batchInclude })
          batchIncluded = candidates({ ...common, include: { running: true, blank: true, current: true } }).length
          batchExcluded = batchIncluded - batchMatches.length
        }

        const previewStep = () => {
          if (batch === null || batchMatches.length === 0) return
          patchBatch({
            step: 2,
            candidates: batchMatches,
            deselected: [],
            acknowledged: false,
            error: null
          })
        }
        /**
         * The preview stores the rows the user REMOVED, so a fresh preview is
         * "everything selected" by construction: no selection state to lose and
         * no empty batch reachable without an explicit uncheck.
         */
        const deselectedSet = new Set(batch?.deselected ?? [])
        const selectedCandidates = (batch?.candidates ?? []).filter(row => !deselectedSet.has(row.id))
        const toggleCandidate = (id) => {
          setBatch(current => {
            if (current === null) return current
            const deselected = current.deselected.includes(id)
              ? current.deselected.filter(item => item !== id)
              : [...current.deselected, id]
            return { ...current, deselected }
          })
        }
        const toggleAllCandidates = (selectAll) => {
          setBatch(current => current === null
            ? current
            : {
                ...current,
                deselected: selectAll ? [] : current.candidates.map(row => row.id)
              })
        }
        const startBatch = async () => {
          if (batch === null || batch.running) return
          const items = selectedCandidates
          if (items.length === 0) return
          const deletingMode = batchDeleting
          abortRef.current = false
          patchBatch({
            step: 3,
            running: true,
            error: null,
            result: null,
            undoResult: null,
            progress: { processed: 0, total: items.length, current: '' }
          })
          const deps = {
            shouldStop: () => abortRef.current || disposed,
            isArchived: id => currentArchivedSet().has(id),
            latestActivity: id => {
              const summary = currentSummary(id)
              return typeof summary?.updatedAt === 'number' ? summary.updatedAt : undefined
            },
            onProgress: (progress) => { patchBatch({ progress }) }
          }
          const result = deletingMode
            // Deletion refreshes the page once at the end: one refresh per chat
            // would multiply a long batch by two extra Host round trips.
            ? await runDeletionBatch(items, {
                ...deps,
                remove: id => deleteArchivedSession(id, { refresh: false })
              })
            : await runArchiveBatch(items, { ...deps, archive: archiveSession })
          if (!disposed) patchBatch({ running: false, result })
          if (deletingMode) await loadStatus(true).catch(() => undefined)
          await refreshCoreSnapshots().catch(() => undefined)
        }
        const stopBatch = () => { abortRef.current = true }
        const undoBatch = async () => {
          if (batch?.result === null || batch?.result === undefined || batch.undoing === true) return
          const items = batch.result.archived
          if (items.length === 0) return
          abortRef.current = false
          patchBatch({ undoing: true, error: null, undoResult: null })
          const result = await runRestoreBatch(items, {
            shouldStop: () => abortRef.current || disposed,
            isArchived: id => currentArchivedSet().has(id),
            restore: id => restoreArchivedSession(id, { refresh: false }),
            onProgress: (progress) => { patchBatch({ progress }) }
          })
          if (!disposed) patchBatch({ undoing: false, undoResult: result })
          await refreshCoreSnapshots().catch(() => undefined)
        }

        const statusPending = archiveStatus === undefined
        const deletionSupported = archiveStatus?.deletionSupported === true
        const restorationSupported = archiveStatus?.restorationSupported === true
        const restorationNote = statusPending
          ? '正在读取归档操作能力…'
          : restorationSupported
            ? '恢复会回到原来的工作区，原 Workspace 已删除时进入未分组'
            : (archiveStatus.restorationUnavailable || '当前无法恢复归档聊天')
        const deletionNote = statusPending
          ? ''
          : deletionSupported
            ? '永久删除会移除会话日志，但不删除共享附件'
            : (archiveStatus.deletionUnavailable || '当前会话存储不支持永久删除')
        const unavailableTitle = statusPending ? '正在读取归档操作能力…' : undefined
        /**
         * Restore and permanent deletion read as one sentence while both work,
         * and each stands alone when the Host reports it unavailable. A
         * message that already ends in its own punctuation is left untouched.
         */
        const endSentence = part => (/[。…!?！？]$/u.test(part) ? part : `${part}。`)
        const capabilityNote = statusPending
          ? restorationNote
          : restorationSupported && deletionSupported
            ? `${restorationNote}；${endSentence(deletionNote)}`
            : [restorationNote, deletionNote].filter(part => part !== '').map(endSentence).join('')
        /**
         * One paragraph for the whole page, directly under the heading: how the
         * list can be viewed plus the bulk entry point, then what restore and
         * permanent deletion do. Availability comes from the Host status.
         */
        const description = `${archiveBatchSupported
          ? '按工作区分组或单列表浏览归档聊天；批量归档支持按时间条件筛选'
          : '按工作区分组或单列表浏览归档聊天；当前 DSH 客户端不支持批量归档'}。${capabilityNote}`
        const confirmFooter = confirmTarget === null ? undefined : React.createElement(
          'div',
          { className: 'dac-footer' },
          React.createElement('button', {
            type: 'button',
            className: 'dac-button',
            disabled: deleting,
            onClick: closeConfirm
          }, '取消'),
          React.createElement('button', {
            type: 'button',
            className: 'dac-button danger',
            disabled: deleting,
            onClick: () => { void confirmDelete() }
          }, deleting ? '正在删除…' : '永久删除')
        )

        /** One instant per render: every relative label on the page agrees. */
        const now = Date.now()
        const renderRow = (row, options = {}) => React.createElement('div', {
          className: 'dac-row',
          key: row.id
        },
        React.createElement('div', { className: 'dac-row-copy' },
          React.createElement('span', {
            className: 'dac-row-title',
            title: row.title
          }, row.title),
          React.createElement('span', { className: 'dac-row-meta' }, rowMeta(row, { ...options, now }))
        ),
        React.createElement('div', { className: 'dac-row-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'dac-icon-button danger',
            title: deletionSupported
              ? '永久删除'
              : (unavailableTitle || archiveStatus?.deletionUnavailable || '当前会话存储不支持永久删除。'),
            'aria-label': `永久删除“${row.title}”`,
            disabled: !deletionSupported || restoringId !== null,
            onClick: () => { setConfirmTarget(row); setError(null) }
          }, React.createElement(IconTrashOutline16, { size: 16 })),
          React.createElement('button', {
            type: 'button',
            className: 'dac-icon-button',
            title: restorationSupported
              ? (restoringId === row.id ? '正在恢复…' : '恢复到聊天列表')
              : (unavailableTitle || archiveStatus?.restorationUnavailable || '当前无法恢复归档聊天。'),
            'aria-label': `恢复“${row.title}”`,
            disabled: !restorationSupported || deleting || restoringId !== null,
            onClick: () => { void restoreRow(row) }
          }, React.createElement(
            restoringId === row.id ? IconLoadingOutline16 : IconRefreshOutline16,
            { size: 16 }
          ))
        ))

        const toolbar = React.createElement('div', { className: 'dac-toolbar' },
          React.createElement('div', { className: 'dac-search' },
            React.createElement(IconSearchOutline16, { 'aria-hidden': true }),
            React.createElement('input', {
              type: 'search',
              placeholder: '搜索标题、目录或工作区…',
              'aria-label': '搜索归档聊天',
              value: query,
              onChange: (event) => { setQuery(event.target.value) }
            })),
          selectField({
            'aria-label': '归档列表视图',
            value: viewMode,
            onChange: (event) => { setViewMode(event.target.value) }
          }, [
            React.createElement('option', { key: 'grouped', value: 'grouped' }, '按工作区分组'),
            React.createElement('option', { key: 'flat', value: 'flat' }, '单列表')
          ]),
          selectField({
            'aria-label': '归档列表排序',
            value: sortMode,
            onChange: (event) => { setSortMode(event.target.value) }
          }, [
            React.createElement('option', { key: 'updated', value: 'updated' }, '最近更新'),
            React.createElement('option', { key: 'archived', value: 'archived' }, '归档先后')
          ])
        )
        /**
         * The only row above the list: both bulk entry points sit at its left
         * end (archiving first, then the destructive one), and the collapse
         * toggle keeps the right end via `margin-left:auto`.
         */
        const listActions = React.createElement('div', { className: 'dac-list-actions' },
          React.createElement('button', {
            type: 'button',
            className: 'dac-button dac-button-small',
            title: archiveBatchSupported
              ? '批量归档一段时间没有活动的聊天'
              : '当前 DSH 客户端不支持批量归档',
            disabled: !archiveBatchSupported,
            onClick: () => { openBatch({ kind: 'all' }) }
          }, '批量归档'),
          React.createElement('button', {
            type: 'button',
            className: 'dac-button dac-button-small danger',
            title: deletionSupported
              ? '永久删除一批归档聊天（不可撤销）'
              : (unavailableTitle || archiveStatus?.deletionUnavailable || '当前会话存储不支持永久删除。'),
            disabled: !deletionSupported,
            onClick: () => { openBatch({ kind: 'all' }, 'delete') }
          }, '批量删除'),
          viewMode === 'grouped' && groups.length > 1 && React.createElement('button', {
            type: 'button',
            className: 'dac-button dac-button-small dac-list-toggle',
            onClick: () => { toggleAllGroups(groups.map(group => group.key)) }
          }, expanded.size > 0 ? '折叠全部' : '展开全部'))

        let body
        if (allRows.length === 0) {
          body = React.createElement('div', { className: 'dac-empty' }, '暂无归档聊天')
        } else if (rows.length === 0) {
          body = React.createElement('div', { className: 'dac-empty' }, '没有匹配的归档聊天')
        } else if (viewMode === 'flat') {
          body = React.createElement('div', { className: 'dac-list' },
            rows.map(row => renderRow(row)))
        } else {
          body = React.createElement('div', { className: 'dac-groups' }, groups.map((group) => {
            const isCollapsed = !expanded.has(group.key) && !searchActive
            return React.createElement('div', { className: 'dac-group', key: group.key === '' ? 'ungrouped' : group.key },
              React.createElement('div', { className: 'dac-group-head' },
                React.createElement('div', {
                  className: 'dac-group-row',
                  role: 'treeitem',
                  tabIndex: 0,
                  'aria-expanded': !isCollapsed,
                  title: group.title,
                  onClick: () => { toggleGroup(group.key) },
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    toggleGroup(group.key)
                  }
                },
                React.createElement('span', { className: 'dac-group-slot', 'aria-hidden': true },
                  React.createElement('span', { className: 'dac-group-folder' },
                    React.createElement(isCollapsed ? IconFolderClose16 : IconFolderOpen16)),
                  React.createElement('span', { className: 'dac-group-chevron' },
                    React.createElement(IconTriangleRightFill14, {
                      className: isCollapsed ? 'dac-group-arrow' : 'dac-group-arrow dac-group-arrow-open'
                    }))),
                React.createElement('span', { className: 'dac-group-title' }, group.title),
                React.createElement('span', { className: 'dac-group-count' }, `${group.rows.length} 条`))),
              !isCollapsed && React.createElement('div', { className: 'dac-group-body' },
                group.rows.map(row => renderRow(row, { withWorkspace: false })))
            )
          }))
        }

        const batchFooter = batch === null ? undefined : React.createElement(React.Fragment, null,
          batch.step === 1 && React.createElement(React.Fragment, null,
            React.createElement('button', {
              type: 'button',
              className: 'dac-button',
              onClick: closeBatch
            }, '取消'),
            React.createElement('button', {
              type: 'button',
              className: 'dac-button primary',
              disabled: batchMatches.length === 0,
              onClick: previewStep
            }, '下一步')),
          batch.step === 2 && React.createElement(React.Fragment, null,
            React.createElement('button', {
              type: 'button',
              className: 'dac-button',
              onClick: () => { patchBatch({ step: 1, acknowledged: false, error: null }) }
            }, '上一步'),
            React.createElement('button', {
              type: 'button',
              className: batchDeleting ? 'dac-button danger' : 'dac-button primary',
              disabled: selectedCandidates.length === 0
                || ((batchDeleting || selectedCandidates.length >= BATCH_CONFIRM_THRESHOLD)
                  && !batch.acknowledged),
              onClick: () => { void startBatch() }
            }, selectedCandidates.length === 0
              ? (batchDeleting ? '开始删除' : '开始归档')
              : `${batchDeleting ? '开始删除' : '开始归档'}(${selectedCandidates.length})`)),
          batch.step === 3 && (batch.running || batch.undoing
            ? React.createElement('button', {
                type: 'button',
                className: 'dac-button',
                onClick: stopBatch
              }, '中止')
            : React.createElement(React.Fragment, null,
                !batchDeleting
                  && batch.result !== null && batch.result !== undefined
                  && batch.result.archived.length > 0
                  && batch.undoResult === null
                  && restorationSupported
                  && React.createElement('button', {
                    type: 'button',
                    className: 'dac-button',
                    onClick: () => { void undoBatch() }
                  }, `撤销本次归档(${batch.result.archived.length})`),
                React.createElement('button', {
                  type: 'button',
                  className: 'dac-button primary',
                  onClick: closeBatch
                }, '完成'))))

        const batchModal = batch !== null && React.createElement(
          Modal,
          {
            open: true,
            onClose: closeBatch,
            title: batch.step === 1
              ? (batchDeleting ? '批量删除聊天' : '批量归档聊天')
              : batch.step === 2
                ? (batchDeleting ? '确认永久删除清单' : '确认归档清单')
                : (batchDeleting ? '批量删除结果' : '批量归档结果'),
            closeLabel: '关闭',
            className: 'dac-dialog dac-dialog-batch',
            contentClassName: 'dac-content-batch',
            footer: batchFooter
          },
          React.createElement('div', { className: 'dac-batch' },
            batch.step === 1 && React.createElement('div', { className: 'dac-batch-scroll' },
              React.createElement('div', { className: 'dac-field' },
                React.createElement('span', { className: 'dac-field-label' }, '范围'),
                selectField({
                  'aria-label': batchDeleting ? '批量删除范围' : '批量归档范围',
                  value: scopeValueOf(batch.scope),
                  onChange: (event) => { patchBatch({ scope: scopeFromValue(event.target.value) }) }
                }, batchScopeOptions.map(option => React.createElement('option', {
                  key: option.value,
                  value: option.value
                }, option.label)))),
              React.createElement('div', { className: 'dac-field' },
                React.createElement('span', { className: 'dac-field-label' },
                  batch.cutoffPreset === 'all'
                    ? '时间条件（不做时间过滤）'
                    : batchDeleting
                      ? '时间条件（删除最近更新早于该时间点的归档聊天）'
                      : '时间条件（归档最近更新早于该时间点的聊天）'),
                selectField({
                  'aria-label': batchDeleting ? '批量删除时间条件' : '批量归档时间条件',
                  value: batch.cutoffPreset,
                  onChange: (event) => { patchBatch({ cutoffPreset: event.target.value }) }
                }, BATCH_PRESETS.map(preset => React.createElement('option', {
                  key: preset.id,
                  value: preset.id
                }, preset.label))),
                batch.cutoffPreset === 'date' && field('dac-select-field dac-select-field-date',
                  React.createElement('input', {
                    type: 'date',
                    className: 'dac-date',
                    'aria-label': batchDeleting ? '批量删除自定义日期' : '批量归档自定义日期',
                    value: batch.cutoffDate,
                    onChange: (event) => { patchBatch({ cutoffDate: event.target.value }) }
                  }))),
              React.createElement('div', { className: 'dac-checks' },
                React.createElement('label', { className: 'dac-check-row' },
                  React.createElement('input', {
                    type: 'checkbox',
                    className: 'dac-check',
                    checked: batch.include.running,
                    onChange: (event) => { patchBatch({ include: { ...batch.include, running: event.target.checked } }) }
                  }),
                  '包含运行中或等待交互的会话'),
                React.createElement('label', { className: 'dac-check-row' },
                  React.createElement('input', {
                    type: 'checkbox',
                    className: 'dac-check',
                    checked: batch.include.blank,
                    onChange: (event) => { patchBatch({ include: { ...batch.include, blank: event.target.checked } }) }
                  }),
                  '包含还没有任何对话的空会话'),
                React.createElement('label', { className: 'dac-check-row' },
                  React.createElement('input', {
                    type: 'checkbox',
                    className: 'dac-check',
                    checked: batch.include.current,
                    onChange: (event) => { patchBatch({ include: { ...batch.include, current: event.target.checked } }) }
                  }),
                  '包含当前打开的会话')),
              React.createElement('p', { className: 'dac-note' },
                `匹配 ${batchMatches.length} 条。${batchExcluded > 0 ? `另有 ${batchExcluded} 条因上述排除项未计入。` : ''}`),
              React.createElement('p', { className: 'dac-note' },
                '“24 小时前”是从当前时间往前数 24 小时；“1 天前”包含昨天以及更早，即从本地今天 00:00 起算。其余预设为滚动 N×24 小时，自定义日期取所选日期的本地 00:00；“所有时间”不做时间过滤。'),
              React.createElement('p', { className: 'dac-note' },
                '时间依据 DSH 列表显示的“最近更新”（创建时间与最后一次你的输入中较晚者）；子代理会话始终不参与。',
                batchDeleting
                  ? '永久删除不可撤销：会话日志会被移除，共享附件不会被删除。'
                  : '归档不会终止正在运行的会话。')),
            batch.step === 2 && React.createElement(React.Fragment, null,
              React.createElement('div', { className: 'dac-batch-fixed' },
                React.createElement('div', { className: 'dac-batch-head' },
                  React.createElement('span', { className: 'dac-batch-summary' },
                    selectedCandidates.length === 0
                      ? `尚未勾选任何聊天，共 ${batch.candidates.length} 条候选。`
                      : `${batchDeleting ? '将永久删除' : '将归档'} ${selectedCandidates.length} 条，共 ${batch.candidates.length} 条候选。`),
                  React.createElement('button', {
                    type: 'button',
                    className: 'dac-button dac-button-small',
                    onClick: () => { toggleAllCandidates(deselectedSet.size > 0) }
                  }, deselectedSet.size > 0 ? '全选' : '全不选')),
                selectedCandidates.length === 0 && React.createElement('p', { className: 'dac-note' },
                  batchDeleting
                    ? '取消勾选的聊天不会被删除；点击“全选”可以恢复全部候选。'
                    : '取消勾选的聊天不会被归档；点击“全选”可以恢复全部候选。')),
              React.createElement('div', { className: 'dac-preview' },
                groupRowsByWorkspace(batch.candidates, workspaceState).map((group) => {
                  const selectedInGroup = group.rows.filter(row => !deselectedSet.has(row.id)).length
                  return React.createElement('div', {
                    className: 'dac-preview-group',
                    key: group.key === '' ? 'ungrouped' : group.key
                  },
                  React.createElement('span', { className: 'dac-preview-head' },
                    `${group.title} · ${selectedInGroup}/${group.rows.length}`),
                  group.rows.map(row => React.createElement('label', {
                    className: 'dac-preview-row',
                    key: row.id
                  },
                  React.createElement('input', {
                    type: 'checkbox',
                    className: 'dac-check',
                    checked: !deselectedSet.has(row.id),
                    onChange: () => { toggleCandidate(row.id) }
                  }),
                  React.createElement('span', { className: 'dac-preview-copy' },
                    React.createElement('span', { className: 'dac-preview-title', title: row.title }, row.title),
                    React.createElement('span', { className: 'dac-preview-meta' },
                      rowMeta(row, { withWorkspace: false, now }))))))
                })),
              React.createElement('div', { className: 'dac-batch-fixed' },
                (batchDeleting || selectedCandidates.length >= BATCH_CONFIRM_THRESHOLD)
                  && React.createElement('label', { className: 'dac-check-row' },
                    React.createElement('input', {
                      type: 'checkbox',
                      className: 'dac-check',
                      checked: batch.acknowledged,
                      onChange: (event) => { patchBatch({ acknowledged: event.target.checked }) }
                    }),
                    batchDeleting
                      ? `我已核对清单，确认永久删除这 ${selectedCandidates.length} 条聊天（不可撤销）`
                      : `我已核对清单，确认归档 ${selectedCandidates.length} 条聊天`),
                React.createElement('p', { className: 'dac-note' },
                  batchDeleting
                    ? '永久删除无法撤销，会话日志会被移除（共享附件不会被删除）。从预览到执行之间若某条聊天有了新活动，会自动跳过并列出。'
                    : '从预览到执行之间若某条聊天有了新活动，会自动跳过并列出；可随时在“归档管理”中恢复。'))),
            batch.step === 3 && React.createElement('div', { className: 'dac-batch-scroll' },
              (batch.running || batch.undoing) && React.createElement(React.Fragment, null,
                React.createElement('p', { className: 'dac-progress' },
                  batch.undoing
                    ? `正在恢复 ${batch.progress.processed} / ${batch.progress.total}`
                    : `${batchDeleting ? '正在永久删除' : '正在归档'} ${batch.progress.processed} / ${batch.progress.total}`),
                batch.progress.current !== undefined && batch.progress.current !== '' && React.createElement('p', { className: 'dac-note' },
                  `当前：${batch.progress.current}`)),
              batch.error !== null && batch.error !== undefined && React.createElement('p', { className: 'dac-error' }, batch.error),
              batch.result !== null && batch.result !== undefined && React.createElement('div', { className: 'dac-result' },
                React.createElement('p', { className: 'dac-progress' },
                  batchOutcomeText(batch.result, batchDeleting ? '永久删除' : '归档')),
                batch.result.skipped.length > 0 && React.createElement('ul', { className: 'dac-result-list' },
                  batch.result.skipped.map(entry => React.createElement('li', { key: `skip-${entry.item.id}` },
                    `${entry.item.title} — ${entry.reason}`))),
                batch.result.failed.length > 0 && React.createElement('ul', { className: 'dac-result-list' },
                  batch.result.failed.map(entry => React.createElement('li', { key: `fail-${entry.item.id}` },
                    `${entry.item.title} — ${entry.message}`)))),
              batch.undoResult !== null && batch.undoResult !== undefined && React.createElement('div', { className: 'dac-result' },
                React.createElement('p', { className: 'dac-progress' }, batchOutcomeText(batch.undoResult, '恢复')),
                batch.undoResult.failed.length > 0 && React.createElement('ul', { className: 'dac-result-list' },
                  batch.undoResult.failed.map(entry => React.createElement('li', { key: `undo-fail-${entry.item.id}` },
                    `${entry.item.title} — ${entry.message}`)))))
          )
        )

        return React.createElement(
          React.Fragment,
          null,
          React.createElement(
            'section',
            { className: 'dac-section', 'aria-label': SECTION_TITLE },
            React.createElement(
              'div',
              { className: 'dac-section-heading' },
              React.createElement('h2', { className: 'dac-section-title' }, SECTION_TITLE),
              React.createElement('span', { className: 'dac-section-count' }, archiveCountLabel(allRows.length))
            ),
            React.createElement('p', { className: 'dac-description' }, description),
            toolbar,
            unreadable > 0 && React.createElement('p', { className: 'dac-note' },
              `另有 ${unreadable} 条归档记录暂时读不到会话摘要，请刷新页面后重试。`),
            confirmTarget === null && error && React.createElement('p', { className: 'dac-error' }, error),
            listActions,
            body
          ),
          React.createElement(
            Modal,
            {
              open: confirmTarget !== null,
              onClose: closeConfirm,
              title: '永久删除聊天？',
              closeLabel: '关闭',
              description: '此操作不能撤销。会话日志删除后，聊天内容无法恢复；若该聊天仍由当前 dsh web 打开，会先关闭它的会话。',
              className: 'dac-dialog',
              contentClassName: 'dac-content',
              footer: confirmFooter
            },
            confirmTarget === null
              ? null
              : React.createElement('div', { className: 'dac-confirm' },
                  React.createElement('div', { className: 'dac-confirm-title' }, confirmTarget.title),
                  React.createElement('p', { className: 'dac-confirm-note' },
                    `原 Workspace：${confirmTarget.workspaceTitle === '' ? UNGROUPED_TITLE : confirmTarget.workspaceTitle}`
                  ),
                  error && React.createElement('p', { className: 'dac-error' }, error)
                )
          ),
          batchModal
        )
      }

      ctx.effect(() => () => {
        disposed = true
        for (const controller of statusControllers) controller.abort()
        for (const controller of mutationControllers) controller.abort()
        statusControllers.clear()
        mutationControllers.clear()
        statusPromise = undefined
        archiveStatus = undefined
      }, 'dsh-chat-archive-manager: client lifecycle')

      if (typeof document !== 'undefined') {
        const styleOwner = 'dsh-chat-archive-manager-v1'
        let style = document.querySelector(`style[data-dac-owner="${styleOwner}"]`)
        if (style === null) {
          style = document.createElement('style')
          if (document.getElementById(STYLE_ID) === null) style.id = STYLE_ID
          style.dataset.dacOwner = styleOwner
          style.dataset.references = '0'
          document.head.appendChild(style)
        }
        // DSH's client module loader claims untagged <style> tags for whichever bundle
        // materializes next, and HMR then removes style[data-plugin=<id>]: tag our own
        // sheet so it is never mis-attributed to another plugin and never lost with it.
        style.dataset.plugin = 'dsh-chat-archive-manager'
        style.textContent = styleText
        const parsedReferences = Number(style.dataset.references)
        const references = Number.isSafeInteger(parsedReferences) && parsedReferences >= 0
          ? parsedReferences
          : 0
        style.dataset.references = String(references + 1)
        ctx.effect(() => () => {
          const current = Number(style.dataset.references)
          const remaining = Number.isSafeInteger(current) && current > 0 ? current - 1 : 0
          style.dataset.references = String(remaining)
          if (remaining === 0 && style.parentNode !== null) style.parentNode.removeChild(style)
        }, 'dsh-chat-archive-manager: styles')
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'archived-chats',
        order: SECTION_ORDER,
        label: SECTION_TITLE
      }, ArchiveSettingsSection))
      ctx.slots.inject('settings.action', () => ctx.slots.register({
        name: 'settings.action',
        id: 'dsh-chat-archive-manager.nav-icon',
        order: NAV_ICON_ORDER
      }, ArchiveNavIconMarker))

      const suppression = createNativeSuppressionStore(resolveClientStorage())
      installNativeArchiveSuppression(ctx, {
        document: typeof document === 'undefined' ? null : document,
        window: typeof window === 'undefined' ? null : window,
        preference: suppression
      })
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: NATIVE_SUPPRESS_ROW_ID,
        order: NATIVE_SUPPRESS_ROW_ORDER,
        inject: () => ({
          getSuppressed: suppression.get,
          subscribeSuppressed: suppression.subscribe,
          setSuppressed: suppression.set,
          getApplied: suppression.getApplied
        })
      }, NativeArchiveSuppressRow))

      void loadStatus().catch((error) => {
        if (!disposed) console.warn('archived chats status unavailable:', error)
      })
    }

    exports.inject = inject
    exports.apply = apply
    /**
     * Pure helpers and batch executors. Inspector-visible test surface only:
     * no product code outside this bundle may depend on these names.
     */
    exports.__internals = Object.freeze({
      archiveCountLabel,
      relativeTimeLabel,
      buildArchivedRows,
      groupRowsByWorkspace,
      sortRows,
      matchesQuery,
      parseDateInput,
      resolveCutoff,
      currentSessionId,
      batchCandidates,
      deletionCandidates,
      runArchiveBatch,
      runDeletionBatch,
      runRestoreBatch,
      readNativeSuppression,
      createNativeSuppressionStore,
      settingsNavListButtons,
      resolveNativeArchiveNavButton,
      installNativeArchiveSuppression,
      BATCH_PRESETS,
      BATCH_CONFIRM_THRESHOLD,
      NATIVE_ARCHIVE_SECTION_ID,
      NATIVE_SUPPRESS_STORAGE_KEY,
      NATIVE_SUPPRESS_DATASET_KEY,
      NATIVE_SUPPRESS_UNAVAILABLE
    })
    return module.exports
  }
})
