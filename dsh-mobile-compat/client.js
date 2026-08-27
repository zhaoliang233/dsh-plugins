// dsh-mobile-compat - browser half loaded by dsh-client-modules.
window.__ModuleLoader__.load({
  id: 'dsh-mobile-compat',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const {
      IconCloseOutline16,
      IconPanelLeftOutline16
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const PLUGIN_ID = 'dsh-mobile-compat'
    const LOCALE_NAMESPACE = PLUGIN_ID
    const OVERLAY_ID = PLUGIN_ID
    const STYLE_ID = `${PLUGIN_ID}-style`
    const BODY_ATTRIBUTE = 'data-dsh-mobile-compat'
    const VIEWPORT_REFS_ATTRIBUTE = 'data-dsh-mobile-compat-refs'
    const VIEWPORT_ORIGINAL_ATTRIBUTE = 'data-dsh-mobile-compat-original'
    const VIEWPORT_PATCHED_ATTRIBUTE = 'data-dsh-mobile-compat-patched'
    const SHELL_ATTRIBUTE = 'data-dsh-mobile-shell-compatible'
    const WORKSPACES_ATTRIBUTE = 'data-dsh-mobile-workspaces-compatible'
    const CONVERSATION_ATTRIBUTE = 'data-dsh-mobile-conversation-compatible'
    const LAYER_GENERATION_ATTRIBUTE = 'data-dsh-mobile-layer-generation'
    const LAYER_ORPHAN_ATTRIBUTE = 'data-dsh-mobile-orphan'
    const SIDEBAR_ID = 'dsh-mobile-sidebar'
    const STATUS_PATH = '/dsh-mobile-compat/status'
    const DSH_COMPATIBILITY_RANGE = '>=0.1.6-alpha.1 <0.1.7'
    const VERIFIED_DSH_VERSIONS = new Set(['0.1.6-alpha.1'])
    const DSH_RELEASE_LINE = '0.1.6'
    const DSH_MINIMUM_ALPHA = 1
    const MOBILE_QUERY = '(max-width: 720px), (pointer: coarse) and (max-width: 900px)'
    const DSH_NARROW_BREAKPOINT = 1024

    const MOBILE_CSS = `
body[${BODY_ATTRIBUTE}] {
  --dmc-mobile-control-size: 44px;
  --dmc-mobile-edge: 10px;
}

.dmc-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none !important;
}

/* A layer from an earlier bundle generation can outlive its own plugin instance (client HMR,
   an interrupted apply). Its chip and full-screen backdrop would cover the live UI and eat
   clicks, so anything the current generation does not own is parked here. */
[${LAYER_ORPHAN_ATTRIBUTE}] {
  display: none !important;
  pointer-events: none !important;
}

.dmc-sidebar-toggle,
.dmc-sidebar-backdrop {
  display: none;
}

@media (max-width: 720px), (pointer: coarse) and (max-width: 900px) {
  html:has(> body[${BODY_ATTRIBUTE}]),
  body[${BODY_ATTRIBUTE}],
  body[${BODY_ATTRIBUTE}] #root {
    height: 100vh;
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
  }

  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] {
    grid-template-columns: 0 minmax(0, 1fr) 0 !important;
  }

  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :first-child {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 30;
    box-sizing: border-box;
    width: min(88vw, 360px) !important;
    max-width: calc(100vw - 48px);
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    transform: translateX(0);
    transition:
      transform var(--ds-transition-duration-slow, 180ms) var(--ds-ease-in-out, ease),
      visibility 0s;
    box-shadow: var(--dsw-shadow-lv3);
  }

  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}][data-sidebar-collapsed] > :first-child {
    visibility: hidden;
    pointer-events: none;
    transform: translateX(-100%);
    transition:
      transform var(--ds-transition-duration-slow, 180ms) var(--ds-ease-in-out, ease),
      visibility 0s var(--ds-transition-duration-slow, 180ms);
  }

  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :first-child > [data-slot='sidebar'] > :first-child {
    width: 100% !important;
    max-width: 100%;
  }

  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :first-child:has(div[role='dialog'][aria-modal='true'] > nav:first-child) {
    width: 100vw !important;
    max-width: none;
    overflow: visible;
    transform: none !important;
    box-shadow: none;
  }

  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :nth-child(2) {
    grid-column: 2;
    width: 100%;
    min-width: 0;
  }

  /* The rightbar column keeps its zero-width grid track. Do NOT hide the column:
     0.1.6 renders the right panel as an absolutely positioned overlay inside it
     (position: fixed and inset: 0 while fullscreen, which is automatic below
     768px), so display:none on the column would collapse the open right sidebar
     to 0x0 and make it impossible to display on mobile. */

  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > [data-side] {
    display: none !important;
  }

  .dmc-layer {
    display: block;
  }

  .dmc-sidebar-toggle {
    position: absolute;
    top: max(4px, env(safe-area-inset-top));
    left: max(var(--dmc-mobile-edge), env(safe-area-inset-left));
    z-index: 1;
    display: inline-grid;
    place-items: center;
    width: var(--dmc-mobile-control-size);
    height: var(--dmc-mobile-control-size);
    padding: 0;
    border: 0;
    color: var(--dsw-alias-label-primary);
    background: transparent;
    cursor: pointer;
    pointer-events: auto;
    touch-action: manipulation;
  }

  /* Keep the 44px hit box but draw a smaller visual chip inside it: the control
     no longer dominates the header row and its 36px chip (y8..44) stays clear
     of the tab row, which starts at y50. */
  .dmc-sidebar-toggle::after {
    content: '';
    position: absolute;
    inset: 4px;
    z-index: -1;
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 8px;
    background: var(--dsw-alias-button-floating-fill);
    box-shadow: var(--dsw-shadow-lv2);
  }

  .dmc-sidebar-toggle:focus-visible {
    outline: none;
  }

  .dmc-sidebar-toggle:focus-visible::after {
    outline: 2px solid var(--dsw-alias-state-business-primary);
    outline-offset: 2px;
  }

  .dmc-layer[data-sidebar-open] .dmc-sidebar-toggle {
    visibility: hidden;
    pointer-events: none;
  }

  .dmc-sidebar-backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: var(--dsw-alias-bg-mask-1);
    cursor: default;
    pointer-events: auto;
  }

  body[${BODY_ATTRIBUTE}] [${CONVERSATION_ATTRIBUTE}] {
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top);
  }

  /* Reserve the floating toggle's lane on the header's FIRST row only. The
     conversation view tabs row below it keeps DSH's native gutter instead of
     being indented by the whole reserve. The header keeps its own 20px gutter,
     so 38px here yields ~58px of clearance: the toggle's 36px visual chip ends
     at x50 and its 44px hit box at x54, leaving a visible gap. */
  body[${BODY_ATTRIBUTE}] [${CONVERSATION_ATTRIBUTE}] > :first-child:not(:last-child) > :first-child > :first-child {
    padding-left: calc(38px + env(safe-area-inset-left)) !important;
  }

  body[${BODY_ATTRIBUTE}] [data-conversation-scroll],
  body[${BODY_ATTRIBUTE}] [data-composer-seat] {
    --dsh-composer-side-clearance: 8px;
    --dsh-composer-dock-inset: 4px;
  }

  body[${BODY_ATTRIBUTE}] [data-conversation-scroll] {
    overflow-wrap: anywhere;
    overscroll-behavior-y: contain;
  }

  body[${BODY_ATTRIBUTE}] [data-composer-seat] {
    box-sizing: border-box;
    padding-bottom: env(safe-area-inset-bottom);
  }

  body[${BODY_ATTRIBUTE}] [data-conversation-scroll] pre {
    max-width: 100%;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
  }

  body[${BODY_ATTRIBUTE}] [data-conversation-scroll] :not(pre) > code {
    overflow-wrap: anywhere;
  }

  body[${BODY_ATTRIBUTE}] [data-conversation-scroll] img,
  body[${BODY_ATTRIBUTE}] [data-conversation-scroll] video {
    max-width: 100%;
    height: auto;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) {
    box-sizing: border-box;
    width: 100vw !important;
    max-width: none !important;
    height: 100vh !important;
    height: 100dvh !important;
    max-height: none !important;
    border-radius: 0 !important;
    flex-direction: column !important;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child {
    flex: none !important;
    width: 100% !important;
    min-height: 0 !important;
    gap: 8px !important;
    padding: max(10px, env(safe-area-inset-top)) 8px 0 !important;
    border-bottom: 1px solid var(--dsw-alias-border-l2);
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child > :first-child {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    overflow: hidden !important;
    clip: rect(0 0 0 0) !important;
    white-space: nowrap !important;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child > :last-child {
    display: flex !important;
    flex-direction: row !important;
    gap: 4px !important;
    padding-bottom: 8px !important;
    overflow-x: auto !important;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child > :last-child::-webkit-scrollbar {
    display: none;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child button {
    flex: 0 0 auto !important;
    min-width: 44px;
    min-height: 44px;
    padding-inline: 12px !important;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div {
    flex: 1 1 auto !important;
    width: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div > :first-child {
    min-height: 52px !important;
    height: auto !important;
    padding: 8px 12px !important;
    align-items: center !important;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div > :first-child > button:last-child {
    width: 44px !important;
    height: 44px !important;
    min-width: 44px;
    min-height: 44px;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div > :last-child {
    min-width: 0 !important;
    padding: 4px 16px calc(16px + env(safe-area-inset-bottom)) !important;
    overflow-y: auto !important;
    overscroll-behavior-y: contain;
  }
}

@media (max-width: 720px), (pointer: coarse) and (max-width: 900px) {
  body[${BODY_ATTRIBUTE}] button {
    touch-action: manipulation;
  }

  body[${BODY_ATTRIBUTE}] [data-composer-card] button,
  body[${BODY_ATTRIBUTE}] [data-conversation-scroll] button,
  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :first-child button,
  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true'] button {
    min-width: 44px;
    min-height: 44px;
  }

  body[${BODY_ATTRIBUTE}] [${WORKSPACES_ATTRIBUTE}] > :first-child > :first-child {
    height: 48px !important;
    overflow: visible !important;
  }

  body[${BODY_ATTRIBUTE}] [${WORKSPACES_ATTRIBUTE}] > :first-child > :first-child > :has(button[aria-expanded]) > :first-child {
    height: 44px !important;
  }

  body[${BODY_ATTRIBUTE}] [${WORKSPACES_ATTRIBUTE}] > :first-child > :first-child:not(:has(button[aria-expanded='true'])) > :has(button[aria-expanded]) {
    max-width: 44px !important;
  }

  body[${BODY_ATTRIBUTE}] [${WORKSPACES_ATTRIBUTE}] > :first-child > :first-child:not(:has(button[aria-expanded='true'])) > :has(button[aria-expanded]) + div {
    max-width: 92px !important;
    overflow: visible !important;
  }

  body[${BODY_ATTRIBUTE}] [${WORKSPACES_ATTRIBUTE}] > :first-child > :first-child:not(:has(button[aria-expanded='true'])) > :has(button[aria-expanded]) + div > * {
    min-width: 44px;
    min-height: 44px;
  }

  body[${BODY_ATTRIBUTE}] [data-composer-card] :is(input, textarea, select, [role='textbox'][aria-multiline='true']),
  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true'] :is(input, textarea, select) {
    font-size: 16px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :first-child {
    transition: none !important;
  }
}
`

    function installStyles() {
      if (typeof document === 'undefined' || document.head === null || document.body === null) return () => {}

      let style = document.getElementById(STYLE_ID)
      if (style === null) {
        style = document.createElement('style')
        style.id = STYLE_ID
        style.dataset.owner = PLUGIN_ID
        style.dataset.refs = '0'
        style.textContent = MOBILE_CSS
        document.head.appendChild(style)
      } else if (style.textContent !== MOBILE_CSS) {
        // A surviving element keeps the previous bundle's rules: the stylesheet must always
        // describe the code that is running now, never the generation that wrote it.
        style.textContent = MOBILE_CSS
      }
      // DSH claims untagged <style> tags for whichever bundle materializes next and HMR
      // removes style[data-plugin=<id>]: tag our own sheet so it is never mis-attributed
      // to another plugin and never removed together with that plugin.
      style.dataset.plugin = PLUGIN_ID

      const references = Number.parseInt(style.dataset.refs || '0', 10)
      style.dataset.refs = String(Number.isFinite(references) ? references + 1 : 1)
      document.body.setAttribute(BODY_ATTRIBUTE, '')

      return () => {
        const current = document.getElementById(STYLE_ID)
        if (current !== style) return
        const count = Number.parseInt(style.dataset.refs || '1', 10) - 1
        if (count > 0) {
          style.dataset.refs = String(count)
          return
        }
        style.remove()
        document.body?.removeAttribute(BODY_ATTRIBUTE)
      }
    }

    /** Mark the overlay layers this activation does not own, so a previous generation's chip
     *  and full-screen backdrop can never cover the live UI or swallow its clicks. Runs after
     *  the current layer has mounted: everything else in the document is by definition stale. */
    function sweepOrphanLayers(generation) {
      if (typeof document === 'undefined') return
      for (const layer of document.querySelectorAll('.dmc-layer')) {
        if (layer.getAttribute(LAYER_GENERATION_ATTRIBUTE) === generation) continue
        layer.setAttribute(LAYER_ORPHAN_ATTRIBUTE, '')
      }
    }

    function scheduleOrphanSweep(generation) {
      const run = () => sweepOrphanLayers(generation)
      if (typeof globalThis.requestAnimationFrame === 'function') {
        globalThis.requestAnimationFrame(run)
        return
      }
      if (typeof globalThis.setTimeout === 'function') globalThis.setTimeout(run, 0)
    }

    function createLayerGeneration() {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    }

    function installViewportFit() {
      if (typeof document === 'undefined') return () => {}
      const viewport = document.querySelector("meta[name='viewport']")
      if (viewport === null) return () => {}

      const activeReferences = Number.parseInt(viewport.getAttribute(VIEWPORT_REFS_ATTRIBUTE) || '0', 10)
      if (activeReferences > 0) {
        viewport.setAttribute(VIEWPORT_REFS_ATTRIBUTE, String(activeReferences + 1))
      } else {
        const original = viewport.getAttribute('content') || ''
        if (/(?:^|,)\s*viewport-fit\s*=/.test(original)) return () => {}
        const patched = `${original}${original.trim() === '' ? '' : ', '}viewport-fit=cover`
        viewport.setAttribute(VIEWPORT_ORIGINAL_ATTRIBUTE, original)
        viewport.setAttribute(VIEWPORT_PATCHED_ATTRIBUTE, patched)
        viewport.setAttribute(VIEWPORT_REFS_ATTRIBUTE, '1')
        viewport.setAttribute('content', patched)
      }

      return () => {
        const references = Number.parseInt(viewport.getAttribute(VIEWPORT_REFS_ATTRIBUTE) || '1', 10) - 1
        if (references > 0) {
          viewport.setAttribute(VIEWPORT_REFS_ATTRIBUTE, String(references))
          return
        }
        const original = viewport.getAttribute(VIEWPORT_ORIGINAL_ATTRIBUTE) || ''
        const patched = viewport.getAttribute(VIEWPORT_PATCHED_ATTRIBUTE)
        if (viewport.getAttribute('content') === patched) {
          viewport.setAttribute('content', original)
        }
        viewport.removeAttribute(VIEWPORT_REFS_ATTRIBUTE)
        viewport.removeAttribute(VIEWPORT_ORIGINAL_ATTRIBUTE)
        viewport.removeAttribute(VIEWPORT_PATCHED_ATTRIBUTE)
      }
    }

    function registerLocale(locale) {
      const disposeZh = locale.register(LOCALE_NAMESPACE, 'zh', {
        'sidebar.open': '打开侧边栏',
        'sidebar.close': '关闭侧边栏',
        'sidebar.navigation': '侧边栏导航'
      })
      try {
        const disposeEn = locale.register(LOCALE_NAMESPACE, 'en', {
          'sidebar.open': 'Open sidebar',
          'sidebar.close': 'Close sidebar',
          'sidebar.navigation': 'Sidebar navigation'
        })
        return () => {
          disposeEn()
          disposeZh()
        }
      } catch (error) {
        disposeZh()
        throw error
      }
    }

    function directSlot(parent, name) {
      if (parent === null || parent === undefined) return null
      for (const child of Array.from(parent.children || [])) {
        if (child.getAttribute?.('data-slot') === name) return child
      }
      return null
    }

    // 0.1.6 composes the center column as centerCol > main seat > (main.conversation
    // Slot anchor) > ConversationRoot. Descend through the single-child Slot anchors
    // that render as display:contents until the root whose last direct child holds a
    // direct [data-conversation-scroll] appears, without naming internal slot ids.
    function resolveConversationRoot(mainSeat) {
      let candidate = mainSeat?.firstElementChild || null
      for (let depth = 0; depth < 3 && candidate !== null; depth += 1) {
        const body = candidate.lastElementChild
        const hasScroll = Array.from(body?.children || [])
          .some(child => child.hasAttribute?.('data-conversation-scroll'))
        if (hasScroll) return candidate
        if (candidate.children.length !== 1) return null
        candidate = candidate.firstElementChild
      }
      return null
    }

    function probeShellStructure() {
      if (typeof document === 'undefined') return { state: 'pending' }
      const overlays = Array.from(document.querySelectorAll?.('[data-shell-overlay]') || [])
      if (overlays.length === 0) return { state: 'pending' }

      let pending = false
      for (const overlay of overlays) {
        const frame = overlay.parentElement
        const children = Array.from(frame?.children || [])
        if (frame === null || children.length < 4) {
          pending = true
          continue
        }
        if (children[3] !== overlay) continue

        const sidebar = children[0]
        const center = children[1]
        const rightbar = children[2]
        const sidebarSeat = directSlot(sidebar, 'sidebar')
        const mainSeat = directSlot(center, 'main')
        const rightbarSeat = directSlot(rightbar, 'rightbar')
        if (sidebarSeat === null || mainSeat === null || rightbarSeat === null) {
          if ([sidebar, center, rightbar].some(column => column.children.length === 0)) pending = true
          continue
        }
        const conversationRoot = resolveConversationRoot(mainSeat)
        if (sidebarSeat.firstElementChild === null || conversationRoot === null) {
          pending = true
          continue
        }

        let workspacesSeat = null
        const candidate = sidebar.querySelector?.("[data-slot='sidebar.workspaces']") || null
        const workspaceRoot = candidate?.firstElementChild || null
        const workspaceHeader = workspaceRoot?.firstElementChild || null
        if (workspaceHeader !== null) {
          const headerChildren = Array.from(workspaceHeader.children || [])
          const searchSlot = headerChildren.find((child) => child.querySelector?.("button[aria-expanded]")) || null
          const actionCluster = searchSlot?.nextElementSibling || null
          if (searchSlot !== null && actionCluster !== null && actionCluster.parentElement === workspaceHeader) {
            workspacesSeat = candidate
          }
        }

        return {
          state: 'compatible',
          frame,
          sidebar,
          conversationRoot,
          workspacesSeat
        }
      }
      return { state: pending ? 'pending' : 'incompatible' }
    }

    function createStructureMarkers() {
      let frame = null
      let sidebar = null
      let conversationRoot = null
      let workspacesSeat = null
      let ownedSidebarId = false

      const clear = () => {
        frame?.removeAttribute?.(SHELL_ATTRIBUTE)
        conversationRoot?.removeAttribute?.(CONVERSATION_ATTRIBUTE)
        workspacesSeat?.removeAttribute?.(WORKSPACES_ATTRIBUTE)
        if (ownedSidebarId && sidebar?.getAttribute?.('id') === SIDEBAR_ID) sidebar.removeAttribute('id')
        frame = null
        sidebar = null
        conversationRoot = null
        workspacesSeat = null
        ownedSidebarId = false
      }

      const update = (snapshot) => {
        if (snapshot.state !== 'compatible') {
          clear()
          return
        }
        if (frame !== snapshot.frame || sidebar !== snapshot.sidebar) {
          clear()
          frame = snapshot.frame
          sidebar = snapshot.sidebar
          frame.setAttribute(SHELL_ATTRIBUTE, '')
          if (!sidebar.hasAttribute('id')) {
            sidebar.setAttribute('id', SIDEBAR_ID)
            ownedSidebarId = true
          }
        }
        if (conversationRoot !== snapshot.conversationRoot) {
          conversationRoot?.removeAttribute?.(CONVERSATION_ATTRIBUTE)
          conversationRoot = snapshot.conversationRoot
          conversationRoot.setAttribute(CONVERSATION_ATTRIBUTE, '')
        }
        if (workspacesSeat !== snapshot.workspacesSeat) {
          workspacesSeat?.removeAttribute?.(WORKSPACES_ATTRIBUTE)
          workspacesSeat = snapshot.workspacesSeat
          workspacesSeat?.setAttribute?.(WORKSPACES_ATTRIBUTE, '')
        }
      }

      return { update, clear }
    }

    function currentFrame(layer) {
      const overlay = layer?.closest?.('[data-shell-overlay]')
      return overlay?.parentElement || null
    }

    function initialSidebarCollapsed() {
      if (typeof document === 'undefined') return true
      const overlay = document.querySelector('[data-shell-overlay]')
      return overlay?.parentElement?.hasAttribute('data-sidebar-collapsed') !== false
    }

    function saveAttribute(element, name) {
      return {
        element,
        name,
        present: element.hasAttribute(name),
        value: element.getAttribute(name),
        ownedPresent: null,
        ownedValue: null
      }
    }

    function matchesOwnedAttribute(saved) {
      if (saved.ownedPresent === null) return true
      const present = saved.element.hasAttribute(saved.name)
      if (present !== saved.ownedPresent) return false
      return !present || saved.element.getAttribute(saved.name) === saved.ownedValue
    }

    function claimAttribute(saved, value) {
      if (!matchesOwnedAttribute(saved)) return false
      if (value === null) {
        if (saved.element.hasAttribute(saved.name)) saved.element.removeAttribute(saved.name)
        saved.ownedPresent = false
        saved.ownedValue = null
      } else {
        const normalized = String(value)
        if (saved.element.getAttribute(saved.name) !== normalized) saved.element.setAttribute(saved.name, normalized)
        saved.ownedPresent = true
        saved.ownedValue = normalized
      }
      return true
    }

    function restoreAttribute(saved) {
      if (!matchesOwnedAttribute(saved) || saved.ownedPresent === null) return
      if (saved.present) saved.element.setAttribute(saved.name, saved.value || '')
      else saved.element.removeAttribute(saved.name)
      saved.ownedPresent = null
      saved.ownedValue = null
    }

    function focusableElements(container) {
      const selector = [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])"
      ].join(',')
      return Array.from(container.querySelectorAll?.(selector) || []).filter((element) => {
        const inertParent = element.closest?.('[inert]')
        if (inertParent !== null && inertParent !== undefined) return false
        if (element.hasAttribute?.('hidden') || element.getAttribute?.('aria-hidden') === 'true') return false
        const rects = element.getClientRects?.()
        return rects === undefined || rects.length > 0
      })
    }

    function activateDrawerAccess(layer, label, closeDrawer) {
      if (typeof document === 'undefined') return () => {}
      const frame = currentFrame(layer)
      if (frame === null || !frame.hasAttribute(SHELL_ATTRIBUTE)) return () => {}
      const sidebar = frame.children?.[0]
      const covered = [frame.children?.[1], frame.children?.[2]].filter(Boolean)
      if (sidebar === undefined) return () => {}

      const previousFocus = document.activeElement
      const saved = []
      for (const element of covered) {
        const inert = saveAttribute(element, 'inert')
        const hidden = saveAttribute(element, 'aria-hidden')
        saved.push(inert, hidden)
        claimAttribute(inert, '')
        claimAttribute(hidden, 'true')
      }
      const role = saveAttribute(sidebar, 'role')
      const modal = saveAttribute(sidebar, 'aria-modal')
      const ariaLabel = saveAttribute(sidebar, 'aria-label')
      const tabIndex = saveAttribute(sidebar, 'tabindex')
      saved.push(role, modal, ariaLabel, tabIndex)
      claimAttribute(tabIndex, '-1')

      const hasCompetingModal = () => {
        const candidates = Array.from(document.querySelectorAll?.("[role='dialog'][aria-modal='true']") || [])
        return candidates.some((candidate) => {
          if (candidate === sidebar || candidate.hasAttribute?.('hidden')) return false
          const rects = candidate.getClientRects?.()
          return rects === undefined || rects.length > 0
        })
      }
      const syncSemantics = () => {
        if (hasCompetingModal()) {
          claimAttribute(role, null)
          claimAttribute(modal, null)
          claimAttribute(ariaLabel, null)
          return
        }
        claimAttribute(role, 'dialog')
        claimAttribute(modal, 'true')
        claimAttribute(ariaLabel, label)
      }
      syncSemantics()

      const focusables = focusableElements(sidebar)
      const sidebarRect = sidebar.getBoundingClientRect?.()
      const headerToggle = focusables.find((element) => {
        if (element.tagName !== 'BUTTON' || !element.hasAttribute('aria-label') || sidebarRect === undefined) return false
        const rect = element.getBoundingClientRect?.()
        return rect !== undefined && rect.width <= 64 && rect.top < sidebarRect.top + 96 && rect.right > sidebarRect.right - 64
      })
      const entry = headerToggle || focusables[0] || sidebar
      entry.focus?.({ preventScroll: true })

      const onKeyDown = (event) => {
        if (hasCompetingModal()) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeDrawer()
          return
        }
        if (event.key !== 'Tab') return
        const current = focusableElements(sidebar)
        if (current.length === 0) {
          event.preventDefault()
          sidebar.focus?.({ preventScroll: true })
          return
        }
        const first = current[0]
        const last = current[current.length - 1]
        if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
          event.preventDefault()
          last.focus?.({ preventScroll: true })
        } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
          event.preventDefault()
          first.focus?.({ preventScroll: true })
        }
      }
      document.addEventListener('keydown', onKeyDown, true)

      let observer = null
      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(syncSemantics)
        observer.observe(document.body || frame, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['role', 'aria-modal', 'hidden']
        })
      }

      return () => {
        const restoreFocus = !hasCompetingModal()
        observer?.disconnect()
        document.removeEventListener('keydown', onKeyDown, true)
        for (const attribute of saved.reverse()) restoreAttribute(attribute)
        const previousRects = previousFocus?.getClientRects?.()
        const previousVisible = previousRects === undefined || previousRects.length > 0
        if (restoreFocus && previousVisible && previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true })
      }
    }

    function createMobileControls(layout, locale, layerGeneration) {
      const t = locale.bind(LOCALE_NAMESPACE)

      return function MobileControls() {
        const layerRef = React.useRef(null)
        const [sidebarCollapsed, setSidebarCollapsed] = React.useState(initialSidebarCollapsed)
        const [mobileMode, setMobileMode] = React.useState(() => (
          typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(MOBILE_QUERY).matches
            : false
        ))
        React.useSyncExternalStore(
          (notify) => locale.subscribe(notify),
          () => locale.getSnapshot(),
          () => locale.getSnapshot()
        )

        React.useEffect(() => {
          const frame = currentFrame(layerRef.current)
          if (frame === null) return undefined

          const sync = () => {
            setSidebarCollapsed(frame.hasAttribute('data-sidebar-collapsed'))
          }
          sync()

          if (typeof MutationObserver === 'undefined') return undefined
          const observer = new MutationObserver(sync)
          observer.observe(frame, {
            attributes: true,
            attributeFilter: ['data-sidebar-collapsed']
          })
          return () => { observer.disconnect() }
        }, [])

        React.useEffect(() => {
          if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
          const media = window.matchMedia(MOBILE_QUERY)
          let wasMobile = media.matches
          const reconcile = (event) => {
            const isMobile = event?.matches ?? media.matches
            if (wasMobile && !isMobile && window.innerWidth < DSH_NARROW_BREAKPOINT) {
              const frame = currentFrame(layerRef.current)
              if (frame !== null && !frame.hasAttribute('data-sidebar-collapsed')) layout.toggleSidebar()
            }
            wasMobile = isMobile
            setMobileMode(isMobile)
          }
          if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', reconcile)
            return () => { media.removeEventListener('change', reconcile) }
          }
          media.addListener(reconcile)
          return () => { media.removeListener(reconcile) }
        }, [])

        const openLabel = t('sidebar.open')
        const closeLabel = t('sidebar.close')
        const navigationLabel = t('sidebar.navigation')

        React.useEffect(() => {
          if (sidebarCollapsed || !mobileMode) return undefined
          return activateDrawerAccess(layerRef.current, navigationLabel, () => {
            const frame = currentFrame(layerRef.current)
            if (frame !== null && !frame.hasAttribute('data-sidebar-collapsed')) layout.toggleSidebar()
          })
        }, [sidebarCollapsed, mobileMode, navigationLabel])

        const label = sidebarCollapsed ? openLabel : closeLabel
        const icon = sidebarCollapsed
          ? React.createElement(IconPanelLeftOutline16, { size: 20 })
          : React.createElement(IconCloseOutline16, { size: 20 })

        return React.createElement('div', {
          ref: layerRef,
          className: 'dmc-layer',
          'data-dsh-mobile-controls': '',
          [LAYER_GENERATION_ATTRIBUTE]: layerGeneration,
          'data-sidebar-open': sidebarCollapsed ? undefined : ''
        },
        sidebarCollapsed ? null : React.createElement('button', {
          key: 'backdrop',
          type: 'button',
          className: 'dmc-sidebar-backdrop',
          'aria-hidden': 'true',
          tabIndex: -1,
          onClick: () => { layout.toggleSidebar() }
        }),
        React.createElement('button', {
          key: 'toggle',
          type: 'button',
          className: 'dmc-sidebar-toggle',
          'aria-label': label,
          'aria-controls': SIDEBAR_ID,
          'aria-expanded': !sidebarCollapsed,
          'aria-hidden': sidebarCollapsed ? undefined : 'true',
          tabIndex: sidebarCollapsed ? 0 : -1,
          title: label,
          onClick: () => { layout.toggleSidebar() }
        }, icon))
      }
    }

    function activateCompatibleClient(ctx) {
      const disposers = []
      const layerGeneration = createLayerGeneration()
      const own = (dispose) => {
        if (typeof dispose === 'function') disposers.push(dispose)
      }
      try {
        own(installViewportFit())
        own(installStyles())
        own(registerLocale(ctx.locale))
        own(ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: OVERLAY_ID, order: -1000 },
          createMobileControls(ctx.layout, ctx.locale, layerGeneration)
        )))
        scheduleOrphanSweep(layerGeneration)
      } catch (error) {
        for (const dispose of disposers.reverse()) dispose()
        throw error
      }
      return () => {
        for (const dispose of disposers.reverse()) dispose()
      }
    }

    function classifyDshVersion(version) {
      if (typeof version !== 'string') return { supported: false, verified: false }
      const normalized = version.split('+', 1)[0]
      const verified = VERIFIED_DSH_VERSIONS.has(normalized)
      if (normalized === DSH_RELEASE_LINE) return { supported: true, verified, normalized }

      const prerelease = new RegExp(`^${DSH_RELEASE_LINE.replace(/\./g, '\\.')}-(alpha|beta|rc)\\.(0|[1-9]\\d*)$`).exec(normalized)
      if (prerelease === null) return { supported: false, verified: false, normalized }
      const supported = prerelease[1] !== 'alpha' || Number(prerelease[2]) >= DSH_MINIMUM_ALPHA
      return { supported, verified: supported && verified, normalized }
    }

    function bindCompatibility(ctx) {
      const markers = createStructureMarkers()
      let activeDispose = null
      let runtimeVersion = null
      let requestSequence = 0
      let requestController = null
      let disposed = false
      let scheduled = false
      let pendingTimer = null
      const warnings = new Set()

      const warnOnce = (key, message) => {
        if (warnings.has(key)) return
        warnings.add(key)
        console.warn(`[${PLUGIN_ID}] ${message}`)
      }
      const deactivate = () => {
        const dispose = activeDispose
        activeDispose = null
        if (dispose !== null) dispose()
        markers.clear()
      }
      const clearPendingTimer = () => {
        if (pendingTimer === null) return
        globalThis.clearTimeout(pendingTimer)
        pendingTimer = null
      }
      const schedulePendingDiagnostic = () => {
        if (pendingTimer !== null || typeof globalThis.setTimeout !== 'function') return
        pendingTimer = globalThis.setTimeout(() => {
          pendingTimer = null
          if (disposed || runtimeVersion === null) return
          if (probeShellStructure().state === 'pending') {
            warnOnce(`structure-pending:${runtimeVersion}`, `DSH ${runtimeVersion} shell structure did not finish mounting; mobile compatibility remains disabled.`)
          }
        }, 1500)
      }
      const sync = () => {
        if (disposed || runtimeVersion === null) return
        const compatibility = classifyDshVersion(runtimeVersion)
        if (!compatibility.supported) {
          clearPendingTimer()
          deactivate()
          warnOnce(`version:${runtimeVersion}`, `DSH ${runtimeVersion} is outside the compatible release line ${DSH_COMPATIBILITY_RANGE}; mobile compatibility remains disabled.`)
          return
        }
        if (!compatibility.verified) {
          warnOnce(`unverified:${compatibility.normalized}`, `DSH ${runtimeVersion} is inside ${DSH_COMPATIBILITY_RANGE} but has not been individually verified; runtime capability checks remain authoritative.`)
        }

        const structure = probeShellStructure()
        if (structure.state !== 'compatible') {
          deactivate()
          if (structure.state === 'pending') {
            schedulePendingDiagnostic()
          } else {
            clearPendingTimer()
            warnOnce(`structure:${runtimeVersion}`, `DSH ${runtimeVersion} shell structure does not match its validated contract; native layout was preserved.`)
          }
          return
        }

        clearPendingTimer()
        markers.update(structure)
        if (activeDispose === null) {
          try {
            activeDispose = activateCompatibleClient(ctx)
          } catch (error) {
            markers.clear()
            warnOnce('activation', `activation failed; native layout was preserved: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      const schedule = () => {
        if (scheduled || disposed) return
        scheduled = true
        Promise.resolve().then(() => {
          scheduled = false
          sync()
        })
      }
      const refreshRuntimeVersion = async () => {
        const sequence = ++requestSequence
        requestController?.abort()
        const controller = new AbortController()
        requestController = controller
        try {
          const response = await fetch(STATUS_PATH, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: controller.signal
          })
          const payload = await response.json()
          if (disposed || sequence !== requestSequence) return
          if (!response.ok || payload?.ok !== true || payload.package !== '@deepseek-ai/dsh'
            || typeof payload.version !== 'string' || payload.version.trim() === '') {
            throw new Error(payload?.error || `runtime version endpoint returned HTTP ${response.status}`)
          }
          runtimeVersion = payload.version
          sync()
        } catch (error) {
          if (controller.signal.aborted || disposed || sequence !== requestSequence) return
          runtimeVersion = null
          deactivate()
          warnOnce('runtime-version', `cannot verify the installed DSH npm package; mobile compatibility remains disabled: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          if (requestController === controller) requestController = null
        }
      }
      if (typeof ctx.layout?.toggleSidebar !== 'function') {
        warnOnce('layout-capability', 'layout.toggleSidebar is unavailable; mobile compatibility remains disabled.')
        return () => { markers.clear() }
      }
      const readiness = ctx.connection?.generation
      if (typeof readiness?.getSnapshot !== 'function' || typeof readiness?.subscribe !== 'function') {
        warnOnce('connection-capability', 'connection.generation is unavailable; mobile compatibility remains disabled.')
        return () => { markers.clear() }
      }
      const onConnection = () => {
        if (readiness.getSnapshot() !== undefined) void refreshRuntimeVersion()
      }

      const unsubscribe = readiness.subscribe(onConnection)
      let observer = null
      const observationRoot = typeof document === 'undefined' ? null : document.documentElement || document.body
      if (observationRoot !== null && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(schedule)
        observer.observe(observationRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            'data-shell-overlay',
            'data-slot',
            'data-sidebar-collapsed',
            'data-conversation-scroll',
            'data-composer-seat',
            'data-composer-card',
            'aria-expanded',
            'role',
            'aria-modal'
          ]
        })
      }
      onConnection()

      return () => {
        disposed = true
        requestSequence += 1
        requestController?.abort()
        clearPendingTimer()
        observer?.disconnect()
        unsubscribe()
        deactivate()
      }
    }

    const inject = ['slots', 'layout', 'locale', 'connection']
    function apply(ctx) {
      ctx.effect(() => bindCompatibility(ctx))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
