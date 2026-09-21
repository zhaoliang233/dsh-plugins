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
    const RIGHT_PANEL_ATTRIBUTE = 'data-sidebar-right-panel'
    const RIGHT_PANEL_OPEN_ATTRIBUTE = 'data-sidebar-right-open'
    const RIGHT_PANEL_TOGGLE_ATTRIBUTE = 'data-sidebar-right-toggle'
    const SHELL_ATTRIBUTE = 'data-dsh-mobile-shell-compatible'
    const WORKSPACES_ATTRIBUTE = 'data-dsh-mobile-workspaces-compatible'
    const CONVERSATION_ATTRIBUTE = 'data-dsh-mobile-conversation-compatible'
    const LAYER_GENERATION_ATTRIBUTE = 'data-dsh-mobile-layer-generation'
    const LAYER_ORPHAN_ATTRIBUTE = 'data-dsh-mobile-orphan'
    const TITLE_STRIP_ATTRIBUTE = 'data-dsh-mobile-title-strip'
    const SIDEBAR_ID = 'dsh-mobile-sidebar'
    const STATUS_PATH = '/dsh-mobile-compat/status'
    const DSH_COMPATIBILITY_RANGE = '>=0.1.6-alpha.1 <0.1.7'
    const VERIFIED_DSH_VERSIONS = new Set(['0.1.6-alpha.1', '0.1.6-alpha.2'])
    const DSH_RELEASE_LINE = '0.1.6'
    const DSH_MINIMUM_ALPHA = 1
    const MOBILE_QUERY = '(max-width: 720px), (pointer: coarse) and (max-width: 900px)'
    const DSH_NARROW_BREAKPOINT = 1024

    const MOBILE_CSS = `
body[${BODY_ATTRIBUTE}] {
  --dmc-mobile-control-size: 44px;
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

@media ${MOBILE_QUERY} {
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

  /* 0.3.4: the drawer is fullscreen on a phone, matching the right panel's own automatic
     fullscreen below 768px. Width is a percentage rather than a viewport unit so it hugs the
     frame without picking up scrollbar or zoom error. */
  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :first-child {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 30;
    box-sizing: border-box;
    width: 100% !important;
    max-width: none;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    transform: translateX(0);
    transition:
      transform var(--ds-transition-duration-slow, 180ms) var(--ds-ease-in-out, ease),
      visibility 0s;
    box-shadow: var(--dsw-shadow-lv3);
  }

  /* 0.3.4: pin the drawer's height through all three levels. While the rail is collapsed its
     owner writes the desktop panel height (820px in an 844px viewport) onto this column, which
     used to leave 24px of still-clickable conversation below the drawer. Only min-height wins:
     with inset or a plain height the content still pushes the column taller. */
  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :first-child,
  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :first-child > [data-slot='sidebar'],
  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :first-child > [data-slot='sidebar'] > :first-child {
    min-height: 100%;
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

  /* 0.3.6: the phone session header keeps the title AND both control clusters in one
     horizontally scrollable strip, so nothing is dropped from the phone chrome:

       titleRow
       |- headerLeading         (left seat: kept; the drawer entry lives in shell.overlay)
       |- titleCluster
       |  |- nav.crumbs         (kept: the session title lives here)
       |  '- div.headerActions  (kept: tasks / schedule / agent preset / terminal)
       |- div.headerUtilities   (kept: mode chip, agent-team button, overflow menu)
       '- div.headerCorner      (kept: DSH's right-panel control)

     headerActions nests INSIDE the title cluster, so hiding by position would take the title
     with it; every rule names the exact container class instead. The strip scrolls horizontally
     with no drawn scrollbar (a drawn one would add height and invite mis-taps);
     scrollTitleStrip() below supplies the drag. */
  body[${BODY_ATTRIBUTE}] [${CONVERSATION_ATTRIBUTE}] [class*='titleRow'] [class*='headerActions'],
  body[${BODY_ATTRIBUTE}] [${CONVERSATION_ATTRIBUTE}] [class*='titleRow'] [class*='headerUtilities'] {
    flex: 0 0 auto;
    flex-wrap: nowrap;
    align-items: center;
  }

  /* A session opened from a subagent keeps its parent chain in the crumbs; on a phone only the
     current session matters, so the ancestor segments go while the current title stays. */
  body[${BODY_ATTRIBUTE}] [${CONVERSATION_ATTRIBUTE}] [class*='titleRow'] nav[class*='crumbs'] > [class*='crumbSeg']:has([class*='crumb']:not([class*='crumbCurrent'])) {
    display: none !important;
  }

  body[${BODY_ATTRIBUTE}] [${CONVERSATION_ATTRIBUTE}] [class*='titleRow'] [class*='titleCluster'] {
    flex: 1 1 auto;
    min-width: 0;
    justify-content: flex-start;
    gap: 0;
    overflow: hidden;
  }

  /* The marked overflow container: horizontal strip, scrollbar hidden, height locked to the row
     so the header does not grow. */
  [data-dsh-mobile-title-strip] {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    height: 28px;
    overflow-x: auto;
    overflow-y: hidden;
    flex-wrap: nowrap;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
    touch-action: pan-x;
  }

  [data-dsh-mobile-title-strip]::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  /* The title takes the free space but never pushes the chips out of reach: it shrinks with an
     ellipsis and the strip scrolls whenever the chips need their room. */
  body[${BODY_ATTRIBUTE}] [${CONVERSATION_ATTRIBUTE}] [class*='titleRow'] [class*='crumbs'] {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }

  /* 0.3.6: the entry reads as DSH's own header chrome. A 44px hit box holds a 28px visual box
     (bare glyph, radius 28, secondary ink, hover fill) and its glyph is drawn at the native
     15px header-control size (IconPanelLeftOutline16 at size 15, the same token
     dsh-client-ui-sidebar-right uses). The hit box sits at left 12px so the visual box lands on
     20..48 — the phone header's own left gutter, where DSH puts its first header element — and
     the glyph ink then starts 26.5px from the edge, mirroring the native control's 26.5px from
     the right edge (measured identical at 320/390/457/568/578/844). Collapsed here means
     "no rail", so this stands in for the control the zero-width track no longer renders. */
  .dmc-sidebar-toggle {
    position: absolute;
    top: max(10px, env(safe-area-inset-top));
    left: max(12px, env(safe-area-inset-left));
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--dmc-mobile-control-size);
    height: var(--dmc-mobile-control-size);
    padding: 0;
    border: 0;
    border-radius: 28px;
    color: var(--dsw-alias-label-secondary);
    background: transparent;
    cursor: pointer;
    pointer-events: auto;
    touch-action: manipulation;
  }

  /* The visual box inside the 44px hit box: bare glyph, no border or fill, hover only. */
  .dmc-sidebar-toggle::after {
    content: '';
    position: absolute;
    inset: 8px;
    z-index: -1;
    border-radius: 28px;
    background: transparent;
    transition: background var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease);
  }

  @media (hover: hover) {
    .dmc-sidebar-toggle:hover::after {
      background: var(--dsw-alias-interactive-bg-hover);
    }
  }

  .dmc-sidebar-toggle:focus-visible {
    outline: none;
  }

  .dmc-sidebar-toggle:focus-visible::after {
    outline: 2px solid var(--dsw-alias-state-business-primary);
    outline-offset: 0;
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
     so 38px here yields ~58px of clearance: the toggle's 28px visual box ends
     at x48 and its 44px hit box at x56, leaving a visible gap. */
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

  /* 0.3.7: the phone layout puts the actions row (open config file / close) on TOP and the
     settings tabs BELOW it — the close control belongs in the top corner within thumb reach, and
     the tabs then read as the row that switches what is underneath. DSH's DOM has it the other way
     round (nav holds the tabs, the actions row lives inside the content container), so the
     container is folded with display:contents and the three rows are ordered explicitly. */
  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child {
    order: 2 !important;
    flex: none !important;
    width: 100% !important;
    min-height: 0 !important;
    gap: 8px !important;
    padding: 0 8px !important;
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

  /* Folded so the actions row and the scroller become rows of the dialog itself. */
  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div {
    display: contents !important;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div > :first-child {
    order: 1 !important;
    flex: none !important;
    width: 100% !important;
    min-width: 0 !important;
    min-height: 52px !important;
    height: auto !important;
    padding: max(10px, env(safe-area-inset-top)) 12px 4px !important;
    align-items: center !important;
    /* Secondary action on the left, close on the right. */
    justify-content: space-between !important;
  }

  /* The secondary action lives in its own flex row inside the header (DSH pushes that row right
     with a large margin-left); pull it back to the left edge so the row reads "action left, close
     right". Keep DSH's compact shape — the 44px floor had made it as heavy as the close button —
     and grow an invisible 44px target instead, like the rail controls and switches. */
  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div > :first-child > :first-child {
    margin-left: 0 !important;
    min-height: 0 !important;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div > :first-child > :first-child button {
    position: relative;
    min-width: 0 !important;
    min-height: 28px !important;
    height: 28px !important;
    padding: 0 10px !important;
    font-size: 12px !important;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div > :first-child > :first-child button::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 44px;
    height: 44px;
    transform: translate(-50%, -50%);
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div > :first-child > button:last-child {
    width: 44px !important;
    height: 44px !important;
    min-width: 44px;
    min-height: 44px;
  }

  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true']:has(> nav:first-child) > nav:first-child + div > :last-child {
    order: 3 !important;
    flex: 1 1 auto !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 4px 16px calc(16px + env(safe-area-inset-bottom)) !important;
    overflow-y: auto !important;
    overscroll-behavior-y: contain;
  }
}

@media ${MOBILE_QUERY} {
  body[${BODY_ATTRIBUTE}] button {
    touch-action: manipulation;
  }

  /* The composer's own action row needs the 44px minimum, but two kinds of control must not get
     it, because they are fixed-size shapes rather than glyph buttons:

     - the attachment rail: DSH already renders that rail for touch (its 18px remove button is
       forced visible under the coarse-pointer media query), and a 44px square on a 64px
       thumbnail is huge and spills onto the photo. The rail is the only role=group inside the
       composer card, so it is excluded structurally instead of by locale-dependent label text;
     - a switch: primitives draw it as a 36x20 capsule with a 16px thumb (Switch.module.css), so
       a 44px floor squares it off and drags the thumb out of place. Switches keep their shape and
       grow an invisible 44px target instead, exactly like the rail controls.

     Buttons inside both keep their intrinsic size; only the small round controls get the
     invisible pointer target below. */
  body[${BODY_ATTRIBUTE}] [data-composer-card] button:not(:is([role='group'], [role='group'] *, [role='switch'])),
  body[${BODY_ATTRIBUTE}] [data-conversation-scroll] button:not(:is([role='group'], [role='group'] *, [role='switch'])),
  body[${BODY_ATTRIBUTE}] [${SHELL_ATTRIBUTE}] > :first-child button:not(:is([role='group'], [role='group'] *, [role='switch'])),
  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true'] button:not(:is([role='group'], [role='group'] *, [role='switch'])) {
    min-width: 44px;
    min-height: 44px;
  }

  /* Small glyph controls inside the rail (thumbnail remove, rail arrows) and every switch keep
     their DSH size and grow only their touch area. DSH's own switch stylesheet positions the
     capsule relatively, so the target anchors to the capsule itself. */
  body[${BODY_ATTRIBUTE}] [data-composer-card] [role='group'] button::after,
  body[${BODY_ATTRIBUTE}] [data-composer-seat] [role='group'] button::after,
  body[${BODY_ATTRIBUTE}] [role='switch']::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 44px;
    height: 44px;
    transform: translate(-50%, -50%);
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
  body[${BODY_ATTRIBUTE}] [data-conversation-scroll] :is(input, textarea, select),
  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true'] :is(input, textarea, select),
  body[${BODY_ATTRIBUTE}] [${RIGHT_PANEL_ATTRIBUTE}] :is(input, textarea, select) {
    font-size: 16px !important;
  }

  /* The composer dock also hosts inline cards (goal bar and similar) whose own chrome is
     36px tall; on a pointer device the tap targets inside must still reach 44px. The attachment
     rail and switches inside the same seat are excluded for the same reasons as above. */
  body[${BODY_ATTRIBUTE}] [data-composer-seat] button:not(:is([role='group'], [role='group'] *, [role='switch'])) {
    min-width: 44px;
    min-height: 44px;
  }

  /* 0.3.7: 0.1.6 renders the right sidebar as a dockkit panel that goes fullscreen below 768px.
     Only the pane body lacks a data attribute, so that single rule anchors on its class suffix;
     the strip and its chrome are named through dockkit's own data attributes. When either drifts
     the selectors stop matching and the panel falls back to DSH's own rendering.
     The dockkit strip has exactly one host in this release: this panel. */
  body[${BODY_ATTRIBUTE}] [${RIGHT_PANEL_ATTRIBUTE}] {
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top);
  }

  body[${BODY_ATTRIBUTE}] [data-dockkit-strip],
  body[${BODY_ATTRIBUTE}] [data-dockkit-strip-chrome] {
    box-sizing: border-box;
    min-height: 44px;
  }

  /* The 44px hit box belongs to the strip's own controls (new tab, split pane) and to the pane
     chrome's buttons — never to a button INSIDE a tab. A tab's close control is absolutely
     anchored (position:absolute; top:4px; right:4px) at DSH's native 20x20: growing the box keeps
     that anchor, so the glyph slides 12px down out of the pill (a drifting x on a phone). The
     tab's context menu also renders inside the tab and must keep its own row height. */
  body[${BODY_ATTRIBUTE}] [data-dockkit-strip] > button,
  body[${BODY_ATTRIBUTE}] [data-dockkit-strip] [data-dockkit-strip-chrome] button {
    width: 44px !important;
    height: 44px !important;
    min-width: 44px;
    min-height: 44px;
  }

  body[${BODY_ATTRIBUTE}] [${RIGHT_PANEL_ATTRIBUTE}] [class*='paneBody'] {
    box-sizing: border-box;
    padding-bottom: env(safe-area-inset-bottom);
    overscroll-behavior-y: contain;
  }

  /* The session-header expand control is the drawer toggle's counterpart and belongs to the same
     44px rule. Its glyph keeps the native 15px header size: the control is generous for the
     finger, the ink matches the row it lives in. */
  body[${BODY_ATTRIBUTE}] [data-sidebar-right-expand] {
    box-sizing: border-box;
    width: 44px !important;
    height: 44px !important;
    min-width: 44px;
    min-height: 44px;
  }

  /* Popover surfaces anchored to a control are positioned from the layout viewport, which iOS
     does not resize for the software keyboard. Clipping them to the visible viewport keeps the
     list reachable instead of leaving it behind the keyboard. */
  body[${BODY_ATTRIBUTE}] [role='menu'],
  body[${BODY_ATTRIBUTE}] [role='listbox'] {
    max-height: calc(var(--dmc-visual-viewport-height, 100dvh) - 96px) !important;
    overflow-y: auto;
  }

  /* DSH dialogs are centered in the layout viewport, so the iOS keyboard pushes their footer
     behind itself with nothing to scroll. Bound the dialog and let its content scroll instead. */
  body[${BODY_ATTRIBUTE}] div[role='dialog'][aria-modal='true'] {
    max-height: calc(var(--dmc-visual-viewport-height, 100dvh) - 24px) !important;
    overflow-y: auto;
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

    /** Collapse a burst of DOM events into one microtask run; later calls in the same tick are
     *  dropped, so observers and media-query listeners can fire as often as they like. */
    function coalesce(run) {
      let scheduled = false
      return () => {
        if (scheduled) return
        scheduled = true
        Promise.resolve().then(() => {
          scheduled = false
          run()
        })
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
    // Returns null while the seat holds something else — the plugin manager page, for
    // example — which is a valid shell, just not a conversation.
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
        // Only the rail must already have mounted. The main seat may hold a non-conversation page
        // (the plugin manager replaces the conversation there): the shell-level adaptation has to
        // survive that, so the conversation root only gates the conversation-scoped machinery.
        if (sidebarSeat.firstElementChild === null) {
          pending = true
          continue
        }
        const conversationRoot = resolveConversationRoot(mainSeat)

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
          conversationRoot?.setAttribute?.(CONVERSATION_ATTRIBUTE, '')
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

    /** 0.3.4: is the dockkit right panel actually open? Its toggle is symmetric
     *  (actions.toggleExpanded), so clicking it while the panel is closed OPENS it — and the
     *  panel is a fullscreen z-index 40 overlay on a phone, which is how tapping the drawer
     *  entry used to hide the drawer behind a right panel nobody asked for.
     *  The open marker lives on the panel itself; the toggle carries only its own attribute. */
    function rightPanelOpen(frame) {
      return Boolean(frame?.querySelector?.(`[${RIGHT_PANEL_ATTRIBUTE}][${RIGHT_PANEL_OPEN_ATTRIBUTE}]`))
    }

    /** Close the right panel only when it is open. Never click the symmetric toggle blindly. */
    function closeRightPanel(frame) {
      if (!rightPanelOpen(frame)) return
      const toggle = frame?.querySelector?.(`[${RIGHT_PANEL_TOGGLE_ATTRIBUTE}]`)
      toggle?.click?.()
    }

    /** 0.3.3: iOS shrinks visualViewport for the software keyboard while the layout viewport
     *  stays put, so surfaces positioned with 100vh/innerHeight end up behind the keyboard. The
     *  variable is published only while a real viewport exists; rotation (a width change) hands
     *  the job back to 100dvh, and the last disposer removes it. */
    function installVisualViewportHeight() {
      const viewport = globalThis.visualViewport
      if (viewport === undefined || viewport === null) return () => {}
      const root = document.documentElement || document.body
      if (root === null) return () => {}

      let width = viewport.width
      const publish = () => {
        if (viewport.width !== width) {
          width = viewport.width
          root.style.removeProperty('--dmc-visual-viewport-height')
          return
        }
        root.style.setProperty('--dmc-visual-viewport-height', `${Math.round(viewport.height)}px`)
      }
      const schedule = coalesce(publish)
      publish()
      viewport.addEventListener('resize', schedule)
      viewport.addEventListener('scroll', schedule)
      return () => {
        viewport.removeEventListener('resize', schedule)
        viewport.removeEventListener('scroll', schedule)
        root.style.removeProperty('--dmc-visual-viewport-height')
      }
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

    /** The session header's title cluster (0.1.6: titleRow > titleCluster). */
    function titleCluster() {
      if (typeof document === 'undefined') return null
      const conversation = document.querySelector(`[${CONVERSATION_ATTRIBUTE}]`)
      const row = conversation?.querySelector?.(`[class*='titleRow']`) || null
      return row?.querySelector?.(`[class*='titleCluster']`) || null
    }

    /** Turn the title cluster into a scrollable strip without changing its height: its own
     *  children are parked in a marker-owned wrapper that scrolls horizontally, and the touch
     *  drag below gives it motion because the strip's scrollbar is hidden by CSS (a drawn
     *  scrollbar would add height and invite mis-taps). The disposer puts the children back at
     *  the wrapper's original position and drops the wrapper, so nothing is left behind.
     *  Returns null when there is no cluster, or when it carries no child to move. */
    function scrollTitleStrip(cluster) {
      if (cluster === null || typeof document === 'undefined') return null
      let wrapper = null
      let insertionPoint = null
      for (const child of Array.from(cluster.children)) {
        if (child.hasAttribute?.(TITLE_STRIP_ATTRIBUTE)) {
          wrapper = child
          continue
        }
        if (wrapper === null) {
          wrapper = document.createElement('div')
          wrapper.setAttribute(TITLE_STRIP_ATTRIBUTE, '')
          insertionPoint = child
          cluster.insertBefore(wrapper, child)
        }
        wrapper.appendChild(child)
      }
      if (wrapper === null) return null

      // Touch drag: the strip is the element that scrolls, so the pointer only steers it. A
      // gesture that starts at either edge and pulls outward keeps DSH's own gestures, matching
      // what native overflow scrolling does.
      let active = null
      let swallow = null
      // Removal matches on the option values (capture flag), so the disposer repeats them exactly.
      const passiveOptions = { passive: true }
      const dragOptions = { passive: false }
      const swallowOptions = { capture: true }
      const onDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (!wrapper.isConnected) return
        active = { id: event.pointerId, x: event.clientX, y: event.clientY, left: wrapper.scrollLeft, axis: null, moved: false }
      }
      const onMove = (event) => {
        if (active === null || event.pointerId !== active.id) return
        if (!wrapper.isConnected) {
          active = null
          return
        }
        if ((event.buttons & 1) === 0) return
        const dx = event.clientX - active.x
        const dy = event.clientY - active.y
        if (active.axis === null) {
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
          active.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        }
        if (active.axis !== 'x') return
        if (dx > 0 && wrapper.scrollLeft <= 0) return
        if (dx < 0 && wrapper.scrollLeft >= wrapper.scrollWidth - wrapper.clientWidth - 1) return
        active.moved = true
        wrapper.scrollLeft = active.left - dx
        wrapper.setPointerCapture?.(event.pointerId)
        if (event.cancelable) event.preventDefault()
      }
      const onEnd = (event) => {
        if (active === null || event.pointerId !== active.id) return
        const moved = active.moved
        active = null
        wrapper.releasePointerCapture?.(event.pointerId)
        if (!moved) return
        // Swallow the click the gesture would otherwise deliver to the control under the finger.
        swallow = (clickEvent) => {
          clickEvent.stopPropagation()
          clickEvent.preventDefault()
        }
        wrapper.addEventListener('click', swallow, swallowOptions)
        globalThis.setTimeout?.(() => wrapper.removeEventListener('click', swallow, swallowOptions), 350)
      }
      const onCancel = () => { active = null }

      wrapper.addEventListener('pointerdown', onDown, passiveOptions)
      wrapper.addEventListener('pointermove', onMove, dragOptions)
      wrapper.addEventListener('pointerup', onEnd, passiveOptions)
      wrapper.addEventListener('pointercancel', onCancel, passiveOptions)

      return () => {
        wrapper.removeEventListener('pointerdown', onDown, passiveOptions)
        wrapper.removeEventListener('pointermove', onMove, dragOptions)
        wrapper.removeEventListener('pointerup', onEnd, passiveOptions)
        wrapper.removeEventListener('pointercancel', onCancel, passiveOptions)
        if (swallow !== null) wrapper.removeEventListener('click', swallow, swallowOptions)
        active = null
        for (const child of Array.from(wrapper.children)) {
          if (insertionPoint?.parentNode === cluster) cluster.insertBefore(child, insertionPoint)
          else cluster.appendChild(child)
        }
        wrapper.remove()
      }
    }

    /** Keep the header's title cluster scrollable for as long as the plugin is active. The
     *  cluster mounts asynchronously (the session header appears with the first session, and
     *  both React and DSH's own slot owners rebuild its children), so this re-runs on header
     *  mutations and dismantles the wrapper when the structure goes away. */
    function installTitleStrip() {
      if (typeof document === 'undefined') return () => {}
      let disposeStrip = null
      // The strip is a phone-only rewrite of the header row. A wide pointer viewport keeps DSH's
      // own layout, so the cluster must not be touched there at all — wrapping it in an unstyled
      // div folded the title and the control clusters onto two rows on the desktop.
      const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(MOBILE_QUERY)
        : null
      // Always drop the current wiring before re-examining the cluster: the unwrap mutates the
      // child list, and a disposer that runs twice would move children out of a live strip.
      const releaseStrip = () => {
        const dispose = disposeStrip
        disposeStrip = null
        dispose?.()
      }
      const sync = () => {
        const cluster = media !== null && !media.matches ? null : titleCluster()
        if (cluster === null) {
          releaseStrip()
          return
        }
        // Adopt anything the header owner appended next to the strip: a control that stays a
        // sibling of the strip is clipped by the cluster's own overflow instead of being
        // reachable by scrolling. The wrapper itself is the only marker child, so an intact
        // cluster has nothing left to adopt and is left untouched.
        const stray = Array.from(cluster.children).filter((child) => child.getAttribute?.(TITLE_STRIP_ATTRIBUTE) === null)
        const settled = disposeStrip !== null && cluster.children.length === 1 && stray.length === 0
        if (settled) return
        releaseStrip()
        disposeStrip = scrollTitleStrip(cluster)
      }
      const schedule = coalesce(sync)
      sync()

      const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule)
      const observationRoot = document.documentElement || document.body
      observer?.observe(observationRoot, { childList: true, subtree: true })
      // Crossing the breakpoint rewires too: the wrapper is added on the way into the phone range
      // and unwrapped again on the way out.
      const detachMedia = media === null ? null : (() => {
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', schedule)
          return () => media.removeEventListener('change', schedule)
        }
        media.addListener(schedule)
        return () => media.removeListener(schedule)
      })()
      return () => {
        observer?.disconnect()
        detachMedia?.()
        releaseStrip()
      }
    }

    function focusableElements(container) {      const selector = [
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

        // The drawer owns the screen while it is open, so opening it must first take the right
        // panel off that screen: the panel is a fullscreen z-index 40 overlay on a phone and
        // would otherwise cover the drawer that was just opened.
        const openDrawer = () => {
          layout.toggleSidebar()
          closeRightPanel(currentFrame(layerRef.current))
        }

        React.useEffect(() => {
          if (sidebarCollapsed || !mobileMode) return undefined
          return activateDrawerAccess(layerRef.current, navigationLabel, () => {
            const frame = currentFrame(layerRef.current)
            if (frame !== null && !frame.hasAttribute('data-sidebar-collapsed')) layout.toggleSidebar()
          })
        }, [sidebarCollapsed, mobileMode, navigationLabel])

        // The drawer is a fullscreen surface, so anything that navigates away from the page behind
        // it must take the drawer off the screen by itself. Two rules cooperate, both funneled
        // through one collapse() with a short cooldown — without the cooldown, one tap that fires
        // both rules would toggle twice and leave the drawer open again:
        //
        // 1. a click on a navigation row: the new-session button, a panels row (conversations /
        //    plugins), or a session row. Sessions are rows of a tree (`role=treeitem` divs), and
        //    switching between two sessions reuses the same conversation occupant, so watching the
        //    seat alone never sees it — that was the reported "tapping a conversation does
        //    nothing". A button INSIDE such a row (a row's own "…" menu) keeps the drawer: it opens
        //    a popover anchored to the row rather than navigating.
        // 2. a child-list change of the main seat, which covers the paths that reuse the clicked
        //    row instead of the seat (creating a session, for example).
        React.useEffect(() => {
          if (sidebarCollapsed || !mobileMode) return undefined
          const frame = currentFrame(layerRef.current)
          const mainSeat = frame?.children?.[1]?.querySelector?.("[data-slot='main']")
          const sidebar = frame?.children?.[0]
          if (sidebar === undefined || sidebar === null) return undefined
          let collapsedAt = 0
          const collapse = () => {
            const now = Date.now()
            if (now - collapsedAt < 400) return
            const current = currentFrame(layerRef.current)
            if (current === null || current.hasAttribute('data-sidebar-collapsed')) return
            collapsedAt = now
            layout.toggleSidebar()
          }
          const navigationRows = "[class*='newSession'], [class*='panelRow'], [class*='sessionRow']"
          const onClick = (event) => {
            const target = event.target
            const row = target?.closest?.(navigationRows)
            if (row === null || row === undefined) return
            if (target !== row && target.tagName === 'BUTTON' && row.tagName !== 'BUTTON') return
            collapse()
          }
          sidebar.addEventListener('click', onClick)
          const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(collapse)
          observer?.observe(mainSeat ?? sidebar, { childList: true })
          return () => {
            observer?.disconnect()
            sidebar.removeEventListener('click', onClick)
          }
        }, [sidebarCollapsed, mobileMode])

        const label = sidebarCollapsed ? openLabel : closeLabel
        // The same icon token the right panel's own control draws (dsh-client-ui-sidebar-right
        // renders IconPanelLeftOutline16 at size 15), so the pair reads as one icon family —
        // measured ink identical (15x14.06, same y) once both are drawn this way.
        const icon = sidebarCollapsed
          ? React.createElement(IconPanelLeftOutline16, { size: 15 })
          : React.createElement(IconCloseOutline16, { size: 15 })

        return React.createElement('div', {
          ref: layerRef,
          className: 'dmc-layer',
          [LAYER_GENERATION_ATTRIBUTE]: layerGeneration,
          'data-sidebar-open': sidebarCollapsed ? undefined : ''
        },
        sidebarCollapsed ? null : React.createElement('button', {
          key: 'backdrop',
          type: 'button',
          className: 'dmc-sidebar-backdrop',
          'aria-hidden': 'true',
          tabIndex: -1,
          onClick: openDrawer
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
          onClick: openDrawer
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
        own(installVisualViewportHeight())
        own(installStyles())
        own(registerLocale(ctx.locale))
        own(installTitleStrip())
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
      const schedule = coalesce(() => {
        if (disposed) return
        sync()
      })
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
