// dsh-auto-load-history — browser half loaded by dsh-client-modules.
// One job: as soon as the viewed Session is open, page its whole history in.
// DSH only clears `hasMore` through the top "Load earlier" button or a turn-rail
// jump, and the compact transcript refuses to fold any Turn while history is
// incomplete (`ChatNodeSeat`: `!historyIncomplete`), so a reader either pages by
// hand or never sees the compact view. This plugin automates that paging through
// the public client Session face and adds one Settings → General preference row
// that turns the behavior off.
window.__ModuleLoader__.load({
  id: 'dsh-auto-load-history',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { IconChevronDownOutline14, Menu } = require('@deepseek-ai/dsh-client-ui-primitives')

    // ------------------------------------------------------------------ identity
    const PLUGIN_ID = 'dsh-auto-load-history'
    const LOCALE_NS = PLUGIN_ID
    // Client-local preference: what to load on open is a browser reading choice,
    // not Host state, and DSH's own client keeps such preferences in localStorage
    // (conversation draft, transcript width).
    const STORAGE_KEY = `${PLUGIN_ID}.enabled`
    const DEFAULT_ENABLED = true
    const ROW_ID = PLUGIN_ID
    // Settings → General row order: permission -20, language 0, appearance 10,
    // font-size 11, transcript-view 12, composer-enter 20. This belongs beside
    // the transcript-display row it exists to serve.
    const ROW_ORDER = 13
    const STYLE_TAG_ID = `${PLUGIN_ID}/AutoLoadHistoryRow.css`
    /** Scrollport marker owned by the Conversation shell (`[data-conversation-scroll]`). */
    const SCROLL_SELECTOR = '[data-conversation-scroll]'
    /** Distance from the flow bottom still treated as "reading at the bottom". */
    const BOTTOM_SLACK_PX = 64
    /** Yield one frame between pages so opening a Session can paint first. */
    const PAGE_DELAY_MS = 16
    /** Completed pages without a moved window head before the run gives up. */
    const MAX_STALLED_PAGES = 3
    const ROW_OPTIONS = [
      { id: 'on', labelKey: 'row.option.automatic' },
      { id: 'off', labelKey: 'row.option.manual' }
    ]
    const LOCALE_ZH = {
      'row.title': '会话历史',
      'row.description': '打开会话时自动加载全部历史；加载完成后，“紧凑”排版会立即折叠每个回合的思考过程。',
      'row.option.automatic': '自动',
      'row.option.manual': '手动'
    }
    const LOCALE_EN = {
      'row.title': 'Session history',
      'row.description': 'Load the whole history when a session opens; Compact then folds each turn’s process immediately.',
      'row.option.automatic': 'Automatic',
      'row.option.manual': 'Manual'
    }

    // Mirrors the shipped General preference row chrome (`row`/`rowText`/`title`/
    // `desc`/`selector`) so the contribution is visually native; only the class
    // prefix and the stylesheet tag are ours.
    const CSS_TEXT = '.dshalh_row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}'
      + '.dshalh_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}'
      + '.dshalh_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}'
      + '.dshalh_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}'
      + '.dshalh_selector{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}'
      + '.dshalh_selector:hover{background:var(--dsw-alias-interactive-bg-hover)}'
      + '.dshalh_chevron{flex:none}'
    const CSS_CLASS = {
      row: 'dshalh_row',
      rowText: 'dshalh_rowText',
      title: 'dshalh_title',
      desc: 'dshalh_desc',
      selector: 'dshalh_selector',
      chevron: 'dshalh_chevron'
    }

    // ------------------------------------------------------------- pure decisions

    /**
     * Resolve the persisted preference. Only an explicit stored off value disables
     * the behavior, so an unreadable or corrupted entry falls back to the default.
     * @param raw - value read from client storage, or null when absent.
     * @returns the resolved preference.
     */
    function parseStoredEnabled(raw) {
      if (raw === null || raw === undefined) return DEFAULT_ENABLED
      const normalized = String(raw).trim().toLowerCase()
      if (normalized === 'false' || normalized === 'off' || normalized === '0') return false
      if (normalized === 'true' || normalized === 'on' || normalized === '1') return true
      return DEFAULT_ENABLED
    }

    /**
     * Whether the reader is close enough to the flow bottom that prepending one
     * page will not move what they are looking at.
     * @param metrics - scrollport metrics, or null when the scrollport is unknown.
     * @param slack - tolerated distance from the bottom in pixels.
     * @returns whether paging may proceed (unknown geometry fails open).
     */
    function readerAtBottom(metrics, slack = BOTTOM_SLACK_PX) {
      if (metrics === null || metrics === undefined) return true
      const values = [metrics.scrollHeight, metrics.scrollTop, metrics.clientHeight]
      if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return true
      return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= slack
    }

    /**
     * Count one finished page against the run's progress.
     * @param stalled - stalled pages before this page.
     * @param previousHead - window head recorded when the page was issued.
     * @param currentHead - window head after the page settled.
     * @returns the next stalled count; a moved head resets it.
     */
    function advanceStall(stalled, previousHead, currentHead) {
      if (typeof previousHead !== 'number' || typeof currentHead !== 'number') return stalled
      return currentHead < previousHead ? 0 : stalled + 1
    }

    /**
     * Decide the auto-loader's next move for one Session snapshot.
     * `wait` and `defer` stay attached for a later signal; `done` and `idle` stop
     * the run until the preference or the Session changes.
     * @param input - snapshot facts plus the run's stall budget.
     * @returns 'idle' | 'wait' | 'done' | 'defer' | 'page'.
     */
    function nextAutoLoadAction(input) {
      if (input.enabled !== true) return 'idle'
      if (input.openState !== 'open') return 'wait'
      if (input.removed === true) return 'idle'
      if (input.hasMore !== true) return 'done'
      if (input.loadingOlder === true) return 'wait'
      if (input.atBottom !== true) return 'defer'
      if (input.stalled >= input.maxStalled) return 'idle'
      return 'page'
    }

    /**
     * Read the first durable seq of a Session event window.
     * @param events - binding event source, when the binding exposes one.
     * @returns the window head seq, or null when it is unreadable.
     */
    function windowHead(events) {
      if (events === null || events === undefined || typeof events.getSnapshot !== 'function') return null
      let window
      try {
        window = events.getSnapshot()
      } catch {
        return null
      }
      const entries = window === null || window === undefined ? undefined : window.entries
      if (!Array.isArray(entries) || entries.length === 0) return null
      const seq = entries[0]?.event?.seq
      return typeof seq === 'number' && Number.isFinite(seq) ? seq : null
    }

    // ----------------------------------------------------------- preference store

    /**
     * Read one preference value from client storage.
     * @param storage - storage-like object, or null when unavailable.
     * @returns the stored preference, or the default.
     */
    function readEnabled(storage) {
      if (storage === null || storage === undefined || typeof storage.getItem !== 'function') return DEFAULT_ENABLED
      try {
        return parseStoredEnabled(storage.getItem(STORAGE_KEY))
      } catch {
        return DEFAULT_ENABLED
      }
    }

    /**
     * Persist one preference value, tolerating denied or full storage.
     * @param storage - storage-like object, or null when unavailable.
     * @param value - resolved preference.
     */
    function writeEnabled(storage, value) {
      if (storage === null || storage === undefined || typeof storage.setItem !== 'function') return
      try {
        storage.setItem(STORAGE_KEY, value ? 'true' : 'false')
      } catch {
        // A denied write keeps the in-memory value; the next apply re-reads storage.
      }
    }

    /**
     * Create the preference store consumed by the loader and the settings row.
     * @param storage - storage-like object, or null when unavailable.
     * @returns stable reader, subscriber, writer, and cross-tab reload.
     */
    function createPreferenceStore(storage) {
      let enabled = readEnabled(storage)
      const listeners = new Set()
      const publish = () => {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.error(`[${PLUGIN_ID}] preference listener failed:`, error)
          }
        }
      }
      return {
        get: () => enabled,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set: (next) => {
          const value = next === true
          if (value === enabled) return
          enabled = value
          writeEnabled(storage, value)
          publish()
        },
        reload: () => {
          const value = readEnabled(storage)
          if (value === enabled) return
          enabled = value
          publish()
        }
      }
    }

    // -------------------------------------------------------------- history loader

    /**
     * Drive complete-history paging for the viewed Session.
     *
     * The loader never owns a polling loop: every step is a reaction to a Session
     * snapshot publication, so a page in flight (ours, or the reader's own
     * "Load earlier" click) is simply waited on. Progress is measured by the event
     * window head, so pages that do not extend the window stop the run after
     * `MAX_STALLED_PAGES` instead of retrying forever. Paging from a scrolled-away
     * reader defers until they return to the bottom, so prepended content never
     * moves what is being read.
     * @param options - sessions service, preference store, and injectable environment.
     * @returns start/drive/dispose handles bound to the current plugin fiber.
     */
    function createAutoLoader(options) {
      const sessions = options.sessions
      const preference = options.preference
      const documentRef = options.documentRef ?? (() => (typeof document === 'undefined' ? null : document))
      const setTimeoutFn = options.setTimeout ?? (typeof setTimeout === 'function' ? setTimeout : null)
      const clearTimeoutFn = options.clearTimeout ?? (typeof clearTimeout === 'function' ? clearTimeout : null)
      let disposed = false
      let timer = null
      let unsubscribeList = null
      let unsubscribePreference = null
      let unsubscribeSession = null
      let unsubscribeScroll = null
      let boundSession = null
      let pendingHead = null
      let stalled = 0

      /**
       * Resolve the viewed Session's public client face.
       * @returns the face plus its event source, or null when unavailable.
       */
      function currentFace() {
        if (sessions === null || sessions === undefined || typeof sessions.binding !== 'function') return null
        const list = sessions.list
        if (list === null || list === undefined || typeof list.getSnapshot !== 'function') return null
        let current
        try {
          current = list.getSnapshot()?.current
        } catch {
          return null
        }
        if (current === null || current === undefined) return null
        let binding
        try {
          binding = sessions.binding(current)
        } catch {
          return null
        }
        if (binding === null || binding === undefined) return null
        const session = binding.session
        if (session === null || session === undefined) return null
        if (typeof session.getSnapshot !== 'function' || typeof session.subscribe !== 'function') return null
        // The one audited capability: without it the plugin stays inert.
        if (typeof session.loadOlder !== 'function') return null
        return { sessionId: current, session, events: binding.eventSource }
      }

      /**
       * Read the scrollport metrics the defer decision needs.
       * @returns metrics, or null when the scrollport is not measurable.
       */
      function metrics() {
        const doc = documentRef()
        if (doc === null || doc === undefined || typeof doc.querySelector !== 'function') return null
        let element
        try {
          element = doc.querySelector(SCROLL_SELECTOR)
        } catch {
          return null
        }
        if (element === null || element === undefined) return null
        return {
          scrollHeight: element.scrollHeight,
          scrollTop: element.scrollTop,
          clientHeight: element.clientHeight
        }
      }

      function detachSession() {
        if (unsubscribeSession !== null) {
          try {
            unsubscribeSession()
          } catch (error) {
            console.error(`[${PLUGIN_ID}] session unsubscribe failed:`, error)
          }
          unsubscribeSession = null
        }
        boundSession = null
        pendingHead = null
        stalled = 0
      }

      function cancel() {
        if (timer === null) return
        if (clearTimeoutFn !== null) clearTimeoutFn(timer)
        timer = null
      }

      function schedule(delay) {
        if (disposed || timer !== null || setTimeoutFn === null) return
        timer = setTimeoutFn(() => {
          timer = null
          drive()
        }, delay)
      }

      function unwatchScroll() {
        if (unsubscribeScroll === null) return
        const unsubscribe = unsubscribeScroll
        unsubscribeScroll = null
        try {
          unsubscribe()
        } catch (error) {
          console.error(`[${PLUGIN_ID}] scroll unsubscribe failed:`, error)
        }
      }

      /**
       * Resume on the next scroll that returns the reader to the bottom. The
       * listener sits on the document in capture phase, so a replaced scrollport
       * (Chat ↔ Trajectory) needs no re-attachment; each check re-queries it.
       */
      function watchScroll() {
        if (disposed || unsubscribeScroll !== null) return
        const doc = documentRef()
        if (doc === null || doc === undefined || typeof doc.addEventListener !== 'function') return
        const listener = () => {
          if (!readerAtBottom(metrics())) return
          unwatchScroll()
          schedule(0)
        }
        doc.addEventListener('scroll', listener, { capture: true, passive: true })
        unsubscribeScroll = () => {
          doc.removeEventListener('scroll', listener, { capture: true })
        }
      }

      /**
       * Evaluate the current Session once and take at most one step. Listener
       * failures must never escape into the Session notifier that published them.
       */
      function drive() {
        if (disposed) return
        try {
          step()
        } catch (error) {
          console.warn(`[${PLUGIN_ID}] auto-load step failed:`, error)
        }
      }

      /**
       * One evaluation: (re)bind the viewed Session, score the last page, and act.
       */
      function step() {
        const face = currentFace()
        if (face === null) {
          detachSession()
          return
        }
        if (face.session !== boundSession) {
          detachSession()
          boundSession = face.session
          const unsubscribe = face.session.subscribe(() => {
            drive()
          })
          unsubscribeSession = typeof unsubscribe === 'function' ? unsubscribe : null
        }
        const snapshot = face.session.getSnapshot()
        const loadingOlder = snapshot.loadingOlder === true
        // One page settled: score it by whether the window actually grew. The
        // re-entrant drive published by `loadOlder()` itself is filtered here,
        // because `loadingOlder` is already true at that point.
        if (pendingHead !== null && !loadingOlder) {
          const head = windowHead(face.events)
          if (head !== null) {
            stalled = advanceStall(stalled, pendingHead, head)
            pendingHead = null
          }
        }
        const action = nextAutoLoadAction({
          enabled: preference.get() === true,
          openState: snapshot.openState,
          removed: snapshot.removed === true,
          hasMore: snapshot.hasMore === true,
          loadingOlder,
          atBottom: readerAtBottom(metrics()),
          stalled,
          maxStalled: MAX_STALLED_PAGES
        })
        if (action === 'page') {
          pendingHead = windowHead(face.events)
          try {
            const result = face.session.loadOlder()
            if (result !== null && result !== undefined && typeof result.then === 'function') {
              result.then(undefined, (error) => {
                console.warn(`[${PLUGIN_ID}] loadOlder rejected:`, error)
                // A page that never published leaves no snapshot to react to.
                schedule(PAGE_DELAY_MS)
              })
            }
          } catch (error) {
            pendingHead = null
            stalled += 1
            console.warn(`[${PLUGIN_ID}] loadOlder failed:`, error)
            schedule(PAGE_DELAY_MS)
          }
          return
        }
        if (action === 'defer') {
          watchScroll()
          return
        }
        unwatchScroll()
        if (action === 'done') stalled = 0
      }

      /** Attach every input this feature reacts to. */
      function start() {
        if (disposed) return
        if (typeof preference.subscribe === 'function') {
          const unsubscribe = preference.subscribe(() => {
            if (preference.get() === true) {
              // Re-enabling is fresh intent: give the run its stall budget back.
              stalled = 0
              schedule(0)
              return
            }
            cancel()
            drive()
          })
          unsubscribePreference = typeof unsubscribe === 'function' ? unsubscribe : null
        }
        const list = sessions === null || sessions === undefined ? undefined : sessions.list
        if (list !== null && list !== undefined && typeof list.subscribe === 'function') {
          const unsubscribe = list.subscribe(() => {
            drive()
          })
          unsubscribeList = typeof unsubscribe === 'function' ? unsubscribe : null
        }
        drive()
      }

      /** Remove every listener, timer, and pending step. */
      function dispose() {
        if (disposed) return
        disposed = true
        cancel()
        unwatchScroll()
        detachSession()
        for (const unsubscribe of [unsubscribeList, unsubscribePreference]) {
          if (unsubscribe === null) continue
          try {
            unsubscribe()
          } catch (error) {
            console.error(`[${PLUGIN_ID}] unsubscribe failed:`, error)
          }
        }
        unsubscribeList = null
        unsubscribePreference = null
      }

      return { start, drive, dispose }
    }

    // ------------------------------------------------------------------ settings row

    /**
     * Render the General-settings row for the auto-load preference.
     * @param props - composed slot props: preference face, writer, and locale seat.
     * @returns the row element.
     */
    function AutoLoadHistoryRow({ getEnabled, subscribeEnabled, setEnabled, t }) {
      const enabled = React.useSyncExternalStore(subscribeEnabled, getEnabled, getEnabled)
      const [open, setOpen] = React.useState(false)
      const selectedId = enabled ? 'on' : 'off'
      const selected = ROW_OPTIONS.find((option) => option.id === selectedId) ?? ROW_OPTIONS[0]
      const anchor = React.createElement('button', {
        type: 'button',
        className: CSS_CLASS.selector,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: () => {
          setOpen((value) => !value)
        }
      }, t(selected.labelKey), React.createElement(IconChevronDownOutline14, { className: CSS_CLASS.chevron }))
      return React.createElement('div', {
        className: CSS_CLASS.row,
        'data-dsh-auto-load-history-row': ''
      },
      React.createElement('div', { className: CSS_CLASS.rowText },
        React.createElement('div', { className: CSS_CLASS.title }, t('row.title')),
        React.createElement('div', { className: CSS_CLASS.desc }, t('row.description'))),
      React.createElement(Menu, {
        open,
        onClose: () => {
          setOpen(false)
        },
        items: ROW_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) })),
        selectedId,
        onSelect: (id) => {
          setOpen(false)
          setEnabled(id === 'on')
        },
        align: 'end',
        portal: true,
        anchor
      }))
    }

    /**
     * Install this plugin's stylesheet once per page.
     * @param ctx - client plugin context owning the disposer.
     * @param doc - document when one exists.
     */
    function installStyleTag(ctx, doc) {
      if (doc === null || typeof doc.createElement !== 'function') return
      const existing = typeof doc.querySelector === 'function'
        ? doc.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`)
        : null
      if (existing !== null) return
      if (doc.head === null || doc.head === undefined) return
      const tag = doc.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = STYLE_TAG_ID
      tag.textContent = CSS_TEXT
      doc.head.appendChild(tag)
      ctx.effect(() => () => {
        if (tag.parentNode !== null && tag.parentNode !== undefined) tag.parentNode.removeChild(tag)
      }, `${PLUGIN_ID}: styles`)
    }

    /**
     * Resolve client storage without letting a denied or absent store break apply.
     * @returns localStorage, or null when unusable.
     */
    function resolveStorage() {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return null
        return localStorage
      } catch {
        return null
      }
    }

    const inject = ['slots', 'sessions', 'locale']

    /**
     * Mount the loader and the preference row.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const slots = ctx.slots
      const sessions = ctx.sessions
      const locale = ctx.locale
      const doc = typeof document === 'undefined' ? null : document
      installStyleTag(ctx, doc)
      ctx.effect(() => locale.register(LOCALE_NS, { zh: LOCALE_ZH, en: LOCALE_EN }), `${PLUGIN_ID}: dictionaries`)
      const storage = resolveStorage()
      const preference = createPreferenceStore(storage)
      const loader = createAutoLoader({ sessions, preference })
      ctx.effect(() => () => {
        loader.dispose()
      }, `${PLUGIN_ID}: history loader`)
      // Another tab changing the preference is the same intent as this one changing it.
      ctx.effect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
        const listener = (event) => {
          if (event === null || event === undefined || event.key !== STORAGE_KEY) return
          preference.reload()
        }
        window.addEventListener('storage', listener)
        return () => {
          window.removeEventListener('storage', listener)
        }
      }, `${PLUGIN_ID}: preference sync`)
      loader.start()
      slots.inject('settings.general.item', () => slots.register({
        name: 'settings.general.item',
        id: ROW_ID,
        order: ROW_ORDER,
        locale: LOCALE_NS,
        inject: () => ({
          getEnabled: preference.get,
          subscribeEnabled: preference.subscribe,
          setEnabled: preference.set
        })
      }, AutoLoadHistoryRow))
    }

    exports.inject = inject
    exports.apply = apply
    // Inspector-visible test surface only; not part of the plugin's runtime API.
    exports.__test = {
      BOTTOM_SLACK_PX,
      DEFAULT_ENABLED,
      MAX_STALLED_PAGES,
      PAGE_DELAY_MS,
      PLUGIN_ID,
      ROW_ORDER,
      SCROLL_SELECTOR,
      STORAGE_KEY,
      advanceStall,
      createAutoLoader,
      createPreferenceStore,
      nextAutoLoadAction,
      parseStoredEnabled,
      readerAtBottom,
      windowHead
    }
    return module.exports
  }
})
