// dsh-auto-load-history — browser half loaded by dsh-client-modules.
// One job: as soon as the viewed Session is open, page its whole history in.
// DSH only clears `hasMore` through the top "Load earlier" button or a turn-rail
// jump, and the compact transcript refuses to fold any Turn while history is
// incomplete (`ChatNodeSeat`: `!historyIncomplete`), so a reader either pages by
// hand or never sees the compact view. This plugin automates that paging through
// the public client Session face and adds one Settings → General preference row
// that turns the behavior off.
//
// Which Session is being viewed is a view-owned fact: the client Controller
// stopped publishing a `current` selection in its list snapshot (0.1.6-alpha.2),
// so the identity arrives here through a Session-scoped slot instead — the same
// hand-over every Session-scoped UI contribution receives.
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
    /**
     * Session-scoped list slot this plugin occupies to learn which Session the
     * Conversation is showing. It is declared by `dsh-client-ui-conversation` and
     * renders for every view (Chat, Trajectory), in the resident Session header.
     */
    const DRIVER_SLOT = 'conversation.session.header.actions'
    /** Invisible driver entry inside that list slot; renders nothing. */
    const DRIVER_ID = `${PLUGIN_ID}/driver`
    const STYLE_TAG_ID = `${PLUGIN_ID}/AutoLoadHistoryRow.css`
    /** Scrollport marker owned by the Conversation shell (`[data-conversation-scroll]`). */
    const SCROLL_SELECTOR = '[data-conversation-scroll]'
    /** Distance from the flow bottom still treated as "reading at the bottom". */
    const BOTTOM_SLACK_PX = 64
    /**
     * Input events that put the viewport under the reader's own control. The
     * Conversation positions the viewport itself when a Session opens (and DSH
     * keeps compensating while pages are prepended), so a viewport that merely
     * is not at the bottom yet must not be mistaken for a reader who scrolled
     * away — paging would stall until the reader happened to scroll back.
     */
    const USER_INTENT_EVENTS = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown']
    /**
     * How long a reader-intent signal stays valid after the last input. A reader
     * who scrolled away pauses paging, but only while they are actually driving the
     * viewport: once they settle, the run resumes on its own (the anchor correction
     * below keeps their place), so a brief scroll never leaves the history half
     * loaded — and half-loaded is exactly what keeps the compact transcript from
     * folding its Turns.
     */
    const READER_IDLE_MS = 1000
    /**
     * Row markers used as the reader's visual anchor, most precise first. They are
     * the same rows DSH anchors a manual "load earlier" click on; paging must hold
     * one steady across a prepend or the reader's viewport slides.
     */
    const ANCHOR_ATTRIBUTES = ['chatAnchorKey', 'turnTail']
    /**
     * Older events pulled per run. The Controller serves a run as a continuous
     * sequence of 200-event prepends and each prepend commits a render, so a single
     * run that swallows a whole huge history blocks the main thread for seconds —
     * scrolling stops responding right when the load lands. Batching keeps every
     * commit small, and the gap below lets the browser lay out and take input between
     * batches.
     */
    const BATCH_EVENTS = 600
    /** Quiet gap between runs, so layout and input are not starved by the next batch. */
    const BATCH_GAP_MS = 32
    /** Yield one frame between pages so opening a Session can paint first. */
    const PAGE_DELAY_MS = 16
    /** Completed pages without a moved window head before the run gives up. */
    const MAX_STALLED_PAGES = 3
    /**
     * Attempts to resolve a Session binding when the view paints ahead of the
     * Controller's retention (one frame apart, so roughly half a second).
     */
    const MAX_BINDING_RETRIES = 30
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
     *
     * Yielding is reserved for a reader who drives the viewport: a viewport that is
     * merely not at the bottom yet — the Conversation placing it on open, or DSH
     * compensating while pages land — must keep paging, otherwise the run stalls
     * until the reader happens to scroll back down.
     * @param input - snapshot facts, scroll position, reader intent, and stall budget.
     * @returns 'idle' | 'wait' | 'done' | 'defer' | 'page'.
     */
    function nextAutoLoadAction(input) {
      if (input.enabled !== true) return 'idle'
      if (input.openState !== 'open') return 'wait'
      if (input.removed === true) return 'idle'
      if (input.hasMore !== true) return 'done'
      if (input.loadingOlder === true) return 'wait'
      if (input.atBottom !== true && input.readerScrolled === true) return 'defer'
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
     * "Load earlier" click) is simply waited on. A run asks the Session to load
     * through the earliest seq once, which the Controller serves as a continuous
     * sequence of prepends — far fewer round trips than paging page by page.
     * Progress is measured by the event window head, so a run that does not extend
     * the window stops after `MAX_STALLED_PAGES` instead of retrying forever. A
     * reader who scrolls away pauses the run only while they are actually scrolling,
     * and each prepend is anchor-corrected so their viewport does not slide.
     * @param options - sessions service, preference store, and injectable environment.
     * @returns start/attach/detach/drive/dispose handles bound to the plugin fiber.
     */
    function createAutoLoader(options) {
      const sessions = options.sessions
      const preference = options.preference
      const documentRef = options.documentRef ?? (() => (typeof document === 'undefined' ? null : document))
      const setTimeoutFn = options.setTimeout ?? (typeof setTimeout === 'function' ? setTimeout : null)
      const clearTimeoutFn = options.clearTimeout ?? (typeof clearTimeout === 'function' ? clearTimeout : null)
      const requestFrameFn = options.requestAnimationFrame ?? (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null)
      const readerIdleMs = typeof options.readerIdleMs === 'number' ? options.readerIdleMs : READER_IDLE_MS
      const batchGapMs = typeof options.batchGapMs === 'number' ? options.batchGapMs : BATCH_GAP_MS
      const requestIdleFn = options.requestIdleCallback ?? (typeof requestIdleCallback === 'function' ? requestIdleCallback : null)
      const cancelIdleFn = options.cancelIdleCallback ?? (typeof cancelIdleCallback === 'function' ? cancelIdleCallback : null)
      let disposed = false
      let timer = null
      let idleTimer = null
      let unsubscribePreference = null
      let unsubscribeSession = null
      let unsubscribeScroll = null
      let unsubscribeIntent = null
      let boundSessionId = null
      let boundSession = null
      let bindingRetries = 0
      let pendingHead = null
      let stalled = 0
      let readerScrolled = false
      /**
       * The reader's anchor captured before the in-flight run and restored when that
       * run lands. Measured twice per batch at most: `getBoundingClientRect` forces a
       * synchronous layout, so reading it on every step — or every scroll frame — would
       * stall a long transcript.
       */
      let pendingAnchor = null
      /** When the last run settled, so batches keep a quiet gap between them. */
      let lastRunSettledAt = 0

      /**
       * Classify the Session this loader was attached to.
       * A missing binding means the view painted before the Controller retained
       * the Session (retry briefly); a face without `loadOlder` means the release
       * moved the capability, and the plugin stays inert for that Session.
       * @param sessionId - identity handed over by the Session-scoped view.
       * @returns `ready` with the face and event source, else `pending`/`unsupported`.
       */
      function resolveFace(sessionId) {
        if (typeof sessionId !== 'string' || sessionId === '') return { state: 'pending' }
        if (sessions === null || sessions === undefined || typeof sessions.binding !== 'function') return { state: 'pending' }
        let binding
        try {
          binding = sessions.binding(sessionId)
        } catch {
          return { state: 'pending' }
        }
        if (binding === null || binding === undefined) return { state: 'pending' }
        const session = binding.session
        if (session === null || session === undefined) return { state: 'pending' }
        if (typeof session.getSnapshot !== 'function' || typeof session.subscribe !== 'function') return { state: 'pending' }
        // The audited capabilities: the jump loader when the release exposes it,
        // otherwise one-page paging; without either the plugin stays inert.
        if (typeof session.loadThrough !== 'function' && typeof session.loadOlder !== 'function') return { state: 'unsupported' }
        return { state: 'ready', session, events: binding.eventSource }
      }

      /**
       * The Conversation's scrollport element.
       * @returns the element carrying the `[data-conversation-scroll]` marker, or null.
       */
      function scrollport() {
        const doc = documentRef()
        if (doc === null || doc === undefined || typeof doc.querySelector !== 'function') return null
        let element
        try {
          element = doc.querySelector(SCROLL_SELECTOR)
        } catch {
          return null
        }
        return element === undefined ? null : element
      }

      /**
       * Read the scrollport metrics the defer decision needs.
       * @returns metrics, or null when the scrollport is not measurable.
       */
      function metrics() {
        const element = scrollport()
        if (element === null) return null
        return {
          scrollHeight: element.scrollHeight,
          scrollTop: element.scrollTop,
          clientHeight: element.clientHeight
        }
      }

      /** CSS attribute selector for one camelCase dataset key (`turnTail` → `[data-turn-tail]`). */
      function anchorSelector(attribute) {
        return `[data-${attribute.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}]`
      }

      /**
       * Collect the anchor rows for one marker, in document order.
       * @param doc - document to query.
       * @param attribute - camelCase dataset key.
       * @returns the rows, or an empty array when the marker is absent.
       */
      function anchorRows(doc, attribute) {
        try {
          const rows = doc.querySelectorAll(anchorSelector(attribute))
          if (rows === null || rows === undefined || typeof rows.length !== 'number') return []
          return Array.from(rows)
        } catch {
          return []
        }
      }

      /** Dataset key of one row, or undefined when it is not a usable anchor. */
      function anchorKeyOf(row, attribute) {
        if (row === null || row === undefined || row.dataset === undefined || row.dataset === null) return undefined
        const key = row.dataset[attribute]
        return typeof key === 'string' && key !== '' ? key : undefined
      }

      /** Viewport offset of one row, or null when it cannot be measured. */
      function anchorTopOf(row) {
        if (row === null || row === undefined || typeof row.getBoundingClientRect !== 'function') return null
        const rect = row.getBoundingClientRect()
        return rect === null || rect === undefined ? null : rect
      }

      /**
       * Read the reader's visual anchor: the topmost anchor row still visible in the
       * scrollport. DSH marks the same rows it anchors a manual "load earlier" click
       * on, so a prepend can put the reader's place back exactly.
       *
       * Rows are ordered by position, and every measurement forces a layout, so the
       * first visible row is found by binary search — a long transcript must not pay a
       * layout per row just to keep the reader's place.
       * @returns `{ attribute, key, top }`, or null when no anchor row is visible.
       */
      function readAnchor() {
        const doc = documentRef()
        const element = scrollport()
        if (doc === null || element === null || typeof doc.querySelectorAll !== 'function') return null
        const height = typeof element.clientHeight === 'number' ? element.clientHeight : null
        for (const attribute of ANCHOR_ATTRIBUTES) {
          const rows = anchorRows(doc, attribute)
          let low = 0
          let high = rows.length - 1
          let found = -1
          while (low <= high) {
            const mid = (low + high) >> 1
            const rect = anchorTopOf(rows[mid])
            if (rect === null) {
              low = mid + 1
              continue
            }
            if (rect.bottom > 0) {
              found = mid
              high = mid - 1
            } else {
              low = mid + 1
            }
          }
          if (found < 0) continue
          const row = rows[found]
          const key = anchorKeyOf(row, attribute)
          const rect = anchorTopOf(row)
          if (key === undefined || rect === null) continue
          if (height !== null && rect.top >= height) continue
          return { attribute, key, top: rect.top }
        }
        return null
      }

      /**
       * Put the anchored row back where the reader had it. A prepend grows the flow
       * above the viewport, which would otherwise slide what the reader is looking at
       * downward; DSH corrects this for its own paging button, and automatic paging
       * has to correct it for itself.
       * @param saved - anchor captured before the prepend landed.
       */
      function restoreAnchor(saved) {
        if (saved === null) return
        const doc = documentRef()
        const element = scrollport()
        if (doc === null || element === null) return
        const row = findAnchorRow(doc, saved.attribute, saved.key)
        if (row === null) return
        const rect = anchorTopOf(row)
        if (rect === null) return
        const delta = rect.top - saved.top
        if (Math.abs(delta) < 1) return
        element.scrollTop += delta
      }

      /**
       * Find one anchor row by its marker value.
       * @param doc - document to search.
       * @param attribute - camelCase dataset key.
       * @param key - marker value captured earlier.
       * @returns the row, or null when it is gone.
       */
      function findAnchorRow(doc, attribute, key) {
        const selector = `${anchorSelector(attribute)}`
        if (typeof doc.querySelector === 'function' && typeof CSS !== 'undefined' && CSS !== null && typeof CSS.escape === 'function') {
          try {
            const direct = doc.querySelector(`${selector}[data-${attribute.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}="${CSS.escape(key)}"]`)
            if (direct !== null && direct !== undefined) return direct
          } catch {
            // Fall through to the scan.
          }
        }
        for (const row of anchorRows(doc, attribute)) {
          if (anchorKeyOf(row, attribute) === key) return row
        }
        return null
      }

      /**
       * Run once the prepend is laid out, so the correction measures real geometry.
       * @param callback - work to run after layout.
       */
      function afterLayout(callback) {
        if (requestFrameFn === null) {
          callback()
          return
        }
        requestFrameFn(() => {
          requestFrameFn(callback)
        })
      }

      /** Drop the Session-subscription half only; the attach target stays. */
      function unbindSession() {
        if (unsubscribeSession === null) return
        const unsubscribe = unsubscribeSession
        unsubscribeSession = null
        try {
          unsubscribe()
        } catch (error) {
          console.error(`[${PLUGIN_ID}] session unsubscribe failed:`, error)
        }
        boundSession = null
      }

      /**
       * Attach the loader to the Session the view is showing. A fresh Session
       * starts with no reader intent: its viewport placement is the Conversation's
       * own until the reader touches the viewport.
       * @param sessionId - identity handed over by the Session-scoped slot.
       */
      function attach(sessionId) {
        if (disposed) return
        if (typeof sessionId !== 'string' || sessionId === '') {
          detach()
          return
        }
        if (sessionId === boundSessionId) {
          drive()
          return
        }
        detach()
        boundSessionId = sessionId
        readerScrolled = false
        pendingAnchor = null
        drive()
      }

      /**
       * Stop driving. A Session identity detaches only its own binding, so the
       * unmount of a replaced view cannot unbind the Session that replaced it.
       * @param sessionId - identity the caller attached; omitted forces a detach.
       */
      function detach(sessionId) {
        if (sessionId !== undefined && sessionId !== null && sessionId !== boundSessionId) return
        cancel()
        clearReaderIdle()
        unbindSession()
        boundSessionId = null
        bindingRetries = 0
        pendingHead = null
        stalled = 0
        pendingAnchor = null
      }

      function cancel() {
        if (timer === null) return
        const pending = timer
        timer = null
        if (typeof pending === 'object' && pending !== null) {
          if (cancelIdleFn !== null && pending.handle !== null) cancelIdleFn(pending.handle)
          return
        }
        if (clearTimeoutFn !== null) clearTimeoutFn(pending)
      }

      function schedule(delay) {
        if (disposed || timer !== null || setTimeoutFn === null) return
        timer = setTimeoutFn(() => {
          timer = null
          drive()
        }, delay)
      }

      /**
       * Wait for a quiet moment before the next batch. A fixed delay cannot know how
       * long the previous commit needs to lay out, so the browser's own idle signal
       * decides when there is room again; the timeout keeps a busy page progressing.
       */
      function scheduleBatchYield() {
        if (disposed || timer !== null) return
        if (requestIdleFn === null) {
          schedule(batchGapMs)
          return
        }
        const pending = { handle: null }
        pending.handle = requestIdleFn(() => {
          timer = null
          pending.handle = null
          drive()
        }, { timeout: batchGapMs * 8 })
        timer = pending
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

      function unwatchUserIntent() {
        if (unsubscribeIntent === null) return
        const unsubscribe = unsubscribeIntent
        unsubscribeIntent = null
        try {
          unsubscribe()
        } catch (error) {
          console.error(`[${PLUGIN_ID}] intent unsubscribe failed:`, error)
        }
      }

      /** Drop the armed reader-intent expiry. */
      function clearReaderIdle() {
        if (idleTimer === null) return
        if (clearTimeoutFn !== null) clearTimeoutFn(idleTimer)
        idleTimer = null
      }

      /**
       * Arm (or re-arm) the reader-intent expiry. A reader mid-scroll pauses the run,
       * but a reader who merely stopped looking — settled, no input for
       * `READER_IDLE_MS` — must not leave the history half loaded: the anchor
       * correction keeps their place, and an unfinished window is exactly what stops
       * the compact transcript from folding.
       */
      function armReaderIdle() {
        if (setTimeoutFn === null) return
        clearReaderIdle()
        idleTimer = setTimeoutFn(() => {
          idleTimer = null
          readerScrolled = false
          drive()
        }, readerIdleMs)
      }

      /**
       * Learn whether the reader is driving the viewport, and for how long. Until one
       * of these inputs happens, a viewport away from the bottom belongs to the
       * Conversation's own placement, and paging must continue through it; once the
       * reader settles, the intent expires and the run resumes by itself.
       */
      function watchUserIntent() {
        if (disposed || unsubscribeIntent !== null) return
        const doc = documentRef()
        if (doc === null || doc === undefined || typeof doc.addEventListener !== 'function') return
        const listener = () => {
          readerScrolled = true
          armReaderIdle()
          schedule(0)
        }
        for (const type of USER_INTENT_EVENTS) doc.addEventListener(type, listener, { capture: true, passive: true })
        unsubscribeIntent = () => {
          for (const type of USER_INTENT_EVENTS) doc.removeEventListener(type, listener, { capture: true })
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
       * Ask the Session for the next slice of earlier events. The Controller serves a
       * `loadThrough` request as a continuous sequence of 200-event prepends — the same
       * loader its own turn navigation uses — and this asks for `BATCH_EVENTS` at a
       * time so no single commit stalls the main thread; `loadOlder` stays the fallback
       * for a face that does not expose it.
       * @param face - resolved Session face of the attached identity.
       * @returns the run's completion.
       */
      function startRun(face) {
        if (typeof face.session.loadThrough === 'function') {
          const head = windowHead(face.events)
          const target = head === null ? 0 : Math.max(0, head - BATCH_EVENTS)
          return face.session.loadThrough(target)
        }
        return face.session.loadOlder()
      }

      /**
       * One evaluation: (re)bind the attached Session, score the last page, and act.
       */
      function step() {
        if (boundSessionId === null) return
        const resolved = resolveFace(boundSessionId)
        if (resolved.state === 'unsupported') return
        if (resolved.state === 'pending') {
          // The view painted before the Controller retained this Session: retry on
          // a short frame budget instead of polling for the whole page lifetime.
          if (bindingRetries >= MAX_BINDING_RETRIES) return
          bindingRetries += 1
          schedule(PAGE_DELAY_MS)
          return
        }
        bindingRetries = 0
        const face = resolved
        if (face.session !== boundSession) {
          unbindSession()
          boundSession = face.session
          const unsubscribe = face.session.subscribe(() => {
            drive()
          })
          unsubscribeSession = typeof unsubscribe === 'function' ? unsubscribe : null
        }
        const snapshot = face.session.getSnapshot()
        const loadingOlder = snapshot.loadingOlder === true
        const head = windowHead(face.events)
        // One run settled: score it by whether the window actually grew, then put the
        // reader's anchor back. A smaller head than the one captured when the run was
        // issued means older history landed above the viewport. The re-entrant drive
        // published by the load itself is filtered here, because `loadingOlder` is
        // already true at that point.
        if (pendingHead !== null && !loadingOlder) {
          if (head !== null) {
            stalled = advanceStall(stalled, pendingHead, head)
            const prepended = head < pendingHead
            pendingHead = null
            lastRunSettledAt = Date.now()
            if (prepended && pendingAnchor !== null && !readerAtBottom(metrics())) {
              const saved = pendingAnchor
              afterLayout(() => {
                restoreAnchor(saved)
              })
            }
            pendingAnchor = null
          }
        }
        const action = nextAutoLoadAction({
          enabled: preference.get() === true,
          openState: snapshot.openState,
          removed: snapshot.removed === true,
          hasMore: snapshot.hasMore === true,
          loadingOlder,
          atBottom: readerAtBottom(metrics()),
          readerScrolled,
          stalled,
          maxStalled: MAX_STALLED_PAGES
        })
        if (action === 'page') {
          // Give the previous batch a quiet moment: the browser lays out and answers
          // input before the next slice of history lands.
          const sinceSettled = Date.now() - lastRunSettledAt
          if (lastRunSettledAt !== 0 && sinceSettled < batchGapMs) {
            scheduleBatchYield()
            return
          }
          pendingHead = windowHead(face.events)
          // Capture the reader's place once, just before the slice lands (null while
          // they sit at the bottom, where DSH's own follow-scroll owns the position).
          pendingAnchor = readerAtBottom(metrics()) ? null : readAnchor()
          try {
            const result = startRun(face)
            if (result !== null && result !== undefined && typeof result.then === 'function') {
              result.then(undefined, (error) => {
                console.warn(`[${PLUGIN_ID}] history load rejected:`, error)
                // A run that never published leaves no snapshot to react to.
                schedule(PAGE_DELAY_MS)
              })
            }
          } catch (error) {
            pendingHead = null
            stalled += 1
            console.warn(`[${PLUGIN_ID}] history load failed:`, error)
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

      /**
       * Attach the preference subscription and the reader-intent watch. The Session
       * identity arrives through `attach()` — only the view showing a Session knows
       * which one it is.
       */
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
        watchUserIntent()
        drive()
      }

      /** Remove every listener, timer, and pending step. */
      function dispose() {
        if (disposed) return
        disposed = true
        detach()
        unwatchScroll()
        unwatchUserIntent()
        clearReaderIdle()
        if (unsubscribePreference !== null) {
          const unsubscribe = unsubscribePreference
          unsubscribePreference = null
          try {
            unsubscribe()
          } catch (error) {
            console.error(`[${PLUGIN_ID}] unsubscribe failed:`, error)
          }
        }
      }

      return { start, attach, detach, drive, dispose }
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

    // ------------------------------------------------------------------ driver seat

    /**
     * Invisible Session-scoped driver. The Conversation hands over the identity of
     * the Session it is showing — the view-owned replacement for the selection the
     * Client Controller stopped publishing — and the loader follows it.
     * @param props - composed slot props: Session identity plus loader handles.
     * @returns nothing to render.
     */
    function AutoLoadDriver({ sessionId, attach, detach }) {
      React.useEffect(() => {
        attach(sessionId)
        return () => {
          detach(sessionId)
        }
      }, [sessionId, attach, detach])
      return null
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
      slots.inject(DRIVER_SLOT, () => slots.register({
        name: DRIVER_SLOT,
        id: DRIVER_ID,
        order: 0,
        inject: () => ({
          attach: loader.attach,
          detach: loader.detach
        })
      }, AutoLoadDriver))
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
      ANCHOR_ATTRIBUTES,
      BATCH_EVENTS,
      BATCH_GAP_MS,
      BOTTOM_SLACK_PX,
      DEFAULT_ENABLED,
      DRIVER_ID,
      DRIVER_SLOT,
      MAX_BINDING_RETRIES,
      MAX_STALLED_PAGES,
      PAGE_DELAY_MS,
      PLUGIN_ID,
      READER_IDLE_MS,
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
