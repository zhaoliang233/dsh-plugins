import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const DEVTOOLS = process.env.DSH_MOBILE_DEVTOOLS
const APP = process.env.DSH_MOBILE_SMOKE_URL
const PREFIX = process.env.DSH_MOBILE_SMOKE_PREFIX || '/tmp/dsh-mobile-compat'
if (!DEVTOOLS || !APP) {
  throw new Error('DSH_MOBILE_DEVTOOLS and DSH_MOBILE_SMOKE_URL are required; use an isolated Chrome and DSH server')
}
const REPORT_PATH = `${PREFIX}-browser-report.json`
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class CDP {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
        else pending.resolve(message.result)
        return
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params)
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP socket closed'))
      this.pending.clear()
    })
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    return new CDP(socket)
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || []
    listeners.push(listener)
    this.listeners.set(method, listeners)
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return
    const closed = new Promise((resolve) => this.socket.addEventListener('close', resolve, { once: true }))
    this.socket.close()
    await Promise.race([closed, delay(1000)])
  }
}

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details === undefined ? '' : `: ${JSON.stringify(details)}`}`)
}

let cdp
let targetId
const diagnostics = []
const report = { passed: false, url: APP, viewports: {}, settings: {}, titleStripDrag: {}, diagnostics, screenshots: [] }

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}

async function waitFor(expression, timeout = 12000) {
  const started = Date.now()
  let value
  while (Date.now() - started < timeout) {
    value = await evaluate(expression)
    if (value) return value
    await delay(100)
  }
  throw new Error(`timed out waiting for ${expression}; last=${JSON.stringify(value)}`)
}

async function setViewport(width, height, touch) {
  await Promise.all([
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: touch ? 2 : 1,
      mobile: touch,
      screenWidth: width,
      screenHeight: height
    }),
    cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 }),
    cdp.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: touch
        ? [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }]
        : [{ name: 'pointer', value: 'fine' }, { name: 'hover', value: 'hover' }]
    })
  ])
  await delay(300)
}

async function screenshot(label) {
  const path = `${PREFIX}-${label}.png`
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(data, 'base64'))
  report.screenshots.push(path)
}

// Pointer drag on the title strip. CDP synthetic touch cannot move a programmatic scrollLeft,
// so this dispatches the real pointer events the plugin listens for and reads the effect.
const STRIP_DRAG = `(() => {
  const strip = document.querySelector('[data-dsh-mobile-title-strip]')
  if (!strip) return { supported: false, reason: 'no strip' }
  if (typeof PointerEvent === 'undefined') return { supported: false, reason: 'no PointerEvent' }
  const box = strip.getBoundingClientRect()
  const y = Math.round(box.top + box.height / 2)
  strip.scrollLeft = 0
  const x = Math.round(box.left + 10)
  const before = strip.scrollLeft
  const fire = (type, clientX, buttons) => strip.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'touch', isPrimary: true, buttons, clientX, clientY: y
  }))
  fire('pointerdown', x, 1)
  for (const step of [12, 24, 40, 56, 72]) fire('pointermove', x - step, 1)
  const during = strip.scrollLeft
  fire('pointerup', x - 72, 0)
  // A gesture that ends on the strip must not fire the control under the finger.
  const clicked = strip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
  return { supported: true, before, during, max: strip.scrollWidth - strip.clientWidth, gestureClickDelivered: clicked }
})()`

// Mount one attachment so the rail (and its 18px remove control) can be measured. The rail only
// renders while a pending attachment exists.
async function pasteAttachment() {
  return evaluate(`(() => {
    const composer = document.querySelector('[data-composer-card]')
    const target = composer?.querySelector("textarea, [role='textbox']") || composer
    if (!target) return false
    if (document.querySelector("[role='group'] button[aria-label^='移除']")) return true
    const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const file = new File([bytes], 'probe.png', { type: 'image/png' })
    const data = new DataTransfer()
    data.items.add(file)
    target.focus?.()
    target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    return true
  })()`)
}

// The phone header (and the strip inside it) only exists once a session with a conversation is
// mounted; a fresh isolated instance otherwise fails the header assertions for the wrong reason.
async function ensureSession() {
  const hasCluster = () => evaluate(`Boolean(document.querySelector("[data-dsh-mobile-conversation-compatible] [class*='titleRow'] [class*='titleCluster']"))`)
  const settle = async () => {
    try {
      await waitFor(`Boolean(document.querySelector("[data-dsh-mobile-conversation-compatible] [class*='titleRow'] [class*='titleCluster']"))`, 10000)
      return true
    } catch {
      return false
    }
  }
  if (await hasCluster()) return true
  await evaluate(`document.querySelector('.dmc-sidebar-toggle')?.click()`)
  await delay(1200)
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll("[class*='sessionRow']")]
    const real = rows.find((node) => !/^\s*(新会话|New session|New Session)/i.test(node.textContent || ''))
    const target = real || rows[0]
    if (target) {
      target.click()
      return true
    }
    const create = [...document.querySelectorAll('button')].find((node) => /新会话|New session|New Session/i.test(node.textContent || ''))
    if (create) create.click()
    return false
  })()`)
  await delay(2500)
  await evaluate(`document.querySelector('.dmc-sidebar-backdrop')?.click()`)
  await delay(800)
  if (await settle()) return true
  // Still empty: send one probe message so DSH mounts a titled conversation.
  await evaluate(`(() => {
    const input = document.querySelector("[role='textbox'][aria-multiline='true'], textarea")
    if (!input) return false
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (setter) setter.call(input, 'mobile compat probe')
    else input.value = 'mobile compat probe'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const send = [...document.querySelectorAll('button')].find((node) => /发送|Send/i.test(node.getAttribute('aria-label') || ''))
    if (send) send.click()
    return true
  })()`)
  return settle()
}

async function shellMetrics() {
  return evaluate(`(() => {
    const overlay = document.querySelector('[data-shell-overlay]')
    const frame = overlay?.parentElement
    const sidebar = frame?.children[0]
    const center = frame?.children[1]
    const rightbar = frame?.children[2]
    const sidebarSeat = sidebar?.querySelector(":scope > [data-slot='sidebar']")
    const sidebarRoot = sidebarSeat?.firstElementChild
    const workspaceSeat = sidebar?.querySelector("[data-slot='sidebar.workspaces']")
    const toggle = document.querySelector('.dmc-sidebar-toggle')
    const composer = document.querySelector('[data-composer-card]')
    const input = composer?.querySelector("textarea, input, [role='textbox'][aria-multiline='true']")
    const rect = (node) => node ? (() => {
      const value = node.getBoundingClientRect()
      return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom }
    })() : null
    const visible = (node) => {
      if (!node) return false
      const value = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return value.width > 0 && value.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const workspaceButtons = workspaceSeat ? [...workspaceSeat.querySelectorAll('button')].filter(visible) : []
    // The rebuilt surfaces: the scrollable title strip, the mirrored header nav pair, and the
    // composer's attachment rail. Each carries its own contract from compatibility.json.
    const headerRow = document.querySelector("[data-dsh-mobile-conversation-compatible] [class*='titleRow']")
    const strip = document.querySelector('[data-dsh-mobile-title-strip]')
    const stripStyle = strip ? getComputedStyle(strip) : null
    const stripControls = strip ? [...strip.querySelectorAll('button, [role=button]')].filter(visible) : []
    const stripInfo = strip ? (() => {
      const band = strip.getBoundingClientRect()
      const maxScroll = strip.scrollWidth - strip.clientWidth
      const leftEdge = band.left - maxScroll
      const rightEdge = band.right + maxScroll
      const boxes = stripControls.map((node) => node.getBoundingClientRect())
      const reachable = (box) => box.right <= rightEdge + 1 && box.left >= leftEdge - 1
      return {
        rowHeight: headerRow ? Math.round(headerRow.getBoundingClientRect().height) : null,
        height: Math.round(band.height),
        overflowX: stripStyle.overflowX,
        scrollbarWidth: stripStyle.scrollbarWidth,
        scrollbarGutter: strip.offsetHeight - strip.clientHeight,
        scrollable: maxScroll > 0,
        inlineActions: boxes.filter((box) => box.top >= band.top - 0.5 && box.bottom <= band.bottom + 0.5).length,
        clippedActions: boxes.filter((box) => box.top < band.top || box.bottom > band.bottom).length,
        actionsOutOfReach: boxes.filter((box) => !reachable(box)).length,
        containsNativeActions: strip.querySelector("[class*='headerActions'], [class*='headerUtilities']") !== null
      }
    })() : null
    const nativeExpand = document.querySelector('[data-sidebar-right-expand]')
    return {
      inner: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth },
      titleStrip: stripInfo,
      composerButtons: [...(composer?.querySelectorAll('button') ?? [])].filter(visible).map((node) => {
        const box = node.getBoundingClientRect()
        return {
          label: node.getAttribute('aria-label') || String(node.className).slice(0, 26),
          inRail: Boolean(node.closest("[role='group']")),
          width: Math.round(box.width),
          height: Math.round(box.height)
        }
      }),
      toggleStyle: toggle ? (() => {
        const style = getComputedStyle(toggle)
        const after = getComputedStyle(toggle, '::after')
        const icon = toggle.querySelector('svg')
        return {
          background: style.backgroundColor,
          borderStyle: style.borderStyle,
          boxShadow: style.boxShadow,
          borderRadius: style.borderRadius,
          color: style.color,
          chipBackground: after.backgroundColor,
          chipBorderStyle: after.borderStyle,
          chipBoxShadow: after.boxShadow,
          inset: after.inset,
          icon: icon ? [getComputedStyle(icon).width, getComputedStyle(icon).height] : null,
          iconRect: rect(icon)
        }
      })() : null,
      nativeHeaderButton: (() => {
        if (!nativeExpand) return null
        const style = getComputedStyle(nativeExpand)
        const icon = nativeExpand.querySelector('svg')
        return {
          background: style.backgroundColor,
          borderStyle: style.borderStyle,
          boxShadow: style.boxShadow,
          borderRadius: style.borderRadius,
          color: style.color,
          icon: icon ? [getComputedStyle(icon).width, getComputedStyle(icon).height] : null,
          iconRect: rect(icon),
          rect: rect(nativeExpand)
        }
      })(),
      inner: { width: innerWidth, height: innerHeight },
      bodyMarker: document.body.hasAttribute('data-dsh-mobile-compat'),
      shellCompatibleMarker: frame?.hasAttribute('data-dsh-mobile-shell-compatible') ?? false,
      viewport: document.querySelector("meta[name='viewport']")?.content || '',
      frame: rect(frame),
      grid: frame ? getComputedStyle(frame).gridTemplateColumns : null,
      collapsed: frame?.hasAttribute('data-sidebar-collapsed') ?? null,
      sidebar: rect(sidebar),
      sidebarRoot: rect(sidebarRoot),
      sidebarPosition: sidebar ? getComputedStyle(sidebar).position : null,
      sidebarVisibility: sidebar ? getComputedStyle(sidebar).visibility : null,
      center: rect(center),
      rightbar: rect(rightbar),
      rightbarDisplay: rightbar ? getComputedStyle(rightbar).display : null,
      toggle: rect(toggle),
      toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
      toggleDisabled: toggle?.disabled ?? null,
      inputFontSize: input ? getComputedStyle(input).fontSize : null,
      workspaceButtons: workspaceButtons.map(rect),
      backdropDisplay: (() => {
        const node = document.querySelector('.dmc-sidebar-backdrop')
        return node ? getComputedStyle(node).display : null
      })()
    }
  })()`)
}

async function openSidebar() {
  const collapsed = await evaluate(`document.querySelector('[data-shell-overlay]')?.parentElement?.hasAttribute('data-sidebar-collapsed')`)
  if (collapsed) {
    const clicked = await evaluate(`(() => { const node = document.querySelector('.dmc-sidebar-toggle'); node?.click(); return Boolean(node) })()`)
    assert(clicked, 'mobile sidebar toggle not found')
  }
  await waitFor(`document.querySelector('[data-shell-overlay]')?.parentElement?.hasAttribute('data-sidebar-collapsed') === false`)
  await waitFor(`(() => { const frame = document.querySelector('[data-shell-overlay]')?.parentElement; const r = frame?.children[0]?.getBoundingClientRect(); return Boolean(r && r.x >= -0.5) })()`)
}

async function closeSidebar() {
  const collapsed = await evaluate(`document.querySelector('[data-shell-overlay]')?.parentElement?.hasAttribute('data-sidebar-collapsed')`)
  if (!collapsed) {
    const clicked = await evaluate(`(() => { const node = document.querySelector('.dmc-sidebar-backdrop'); node?.click(); return Boolean(node) })()`)
    assert(clicked, 'mobile sidebar backdrop not found')
  }
  await waitFor(`document.querySelector('[data-shell-overlay]')?.parentElement?.hasAttribute('data-sidebar-collapsed') === true`)
}

async function openSettings() {
  await openSidebar()
  const clicked = await evaluate(`(() => {
    const button = document.querySelector("button[aria-haspopup='dialog']")
    button?.click()
    return Boolean(button)
  })()`)
  assert(clicked, 'settings trigger not found')
  await waitFor(`Boolean(document.querySelector("div[role='dialog'][aria-modal='true']:has(> nav:first-child)"))`)
  await delay(150)
  return evaluate(`(() => {
    const panel = document.querySelector("div[role='dialog'][aria-modal='true']:has(> nav:first-child)")
    const nav = panel?.querySelector(':scope > nav:first-child')
    const content = nav?.nextElementSibling
    const rect = (node) => node ? (() => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })() : null
    return {
      panel: rect(panel),
      nav: rect(nav),
      content: rect(content),
      direction: panel ? getComputedStyle(panel).flexDirection : null,
      radius: panel ? getComputedStyle(panel).borderRadius : null,
      navDirection: nav?.lastElementChild ? getComputedStyle(nav.lastElementChild).flexDirection : null,
      outerSidebarRole: document.querySelector('[data-shell-overlay]')?.parentElement?.children[0]?.getAttribute('role') ?? null
    }
  })()`)
}

async function closeSettings() {
  const clicked = await evaluate(`(() => {
    const panel = document.querySelector("div[role='dialog'][aria-modal='true']:has(> nav:first-child)")
    const button = panel?.querySelector(':scope > nav:first-child + div > :first-child > button:last-child')
    button?.click()
    return Boolean(button)
  })()`)
  assert(clicked, 'settings close button not found')
  await waitFor(`!document.querySelector("div[role='dialog'][aria-modal='true']:has(> nav:first-child)")`)
}

try {
  await mkdir(dirname(PREFIX), { recursive: true })
  const targetResponse = await fetch(`${DEVTOOLS}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
  assert(targetResponse.ok, 'failed to create DevTools target', targetResponse.status)
  const target = await targetResponse.json()
  targetId = target.id
  cdp = await CDP.connect(target.webSocketDebuggerUrl)

  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => diagnostics.push({
    type: 'exception',
    text: exceptionDetails.text,
    description: exceptionDetails.exception?.description
  }))
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error' || type === 'warning') diagnostics.push({
      type: `console.${type}`,
      text: args.map((arg) => arg.value ?? arg.description ?? '').join(' ')
    })
  })
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error' || entry.level === 'warning') diagnostics.push({ type: `log.${entry.level}`, text: entry.text, source: entry.source })
  })
  cdp.on('Network.loadingFailed', (event) => {
    if (!event.canceled) diagnostics.push({ type: 'network', text: event.errorText, requestId: event.requestId })
  })
  cdp.on('Network.responseReceived', ({ response }) => {
    if (response.status >= 400) diagnostics.push({ type: 'http', text: `${response.status} ${response.statusText}`, url: response.url })
  })

  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Log.enable'),
    cdp.send('Network.enable')
  ])
  await cdp.send('Page.bringToFront')
  await setViewport(390, 844, true)
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(`document.readyState === 'complete'`)
  await waitFor(`document.body.hasAttribute('data-dsh-mobile-compat')`)
  await waitFor(`document.querySelector('[data-shell-overlay]')?.parentElement?.hasAttribute('data-dsh-mobile-shell-compatible')`)
  await waitFor(`Boolean(document.querySelector('[data-shell-overlay]'))`)
  await delay(500)

  for (let step = 0; step < 4; step += 1) {
    const dismissed = await evaluate(`(() => {
      const dialog = document.querySelector("div[role='dialog'][aria-modal='true']:not(:has(> nav:first-child))")
      const button = dialog?.querySelector('button')
      button?.click()
      return Boolean(button)
    })()`)
    if (!dismissed) break
    await delay(250)
  }

  await setViewport(1280, 800, false)
  // The desktop track animates back from the phone's zero-width column and the mobile layer may
  // still be dismantling its drawer, so settle the layout before reading the preference.
  await delay(300)
  await waitFor(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const sidebar = frame?.children[0]
    const root = sidebar?.querySelector(":scope > [data-slot='sidebar'] > :first-child")
    return Boolean(sidebar && root && getComputedStyle(sidebar).position !== 'absolute' && Math.abs(sidebar.getBoundingClientRect().width - root.getBoundingClientRect().width) <= 1)
  })()`)
  await delay(250)
  const desktopBaseline = await shellMetrics()
  report.desktopPreferenceRoundTrip = { baseline: desktopBaseline }
  assert(desktopBaseline.sidebar.width >= 200 && !desktopBaseline.collapsed, 'fresh desktop Sidebar preference is not expanded', desktopBaseline)
  await setViewport(390, 844, true)
  await openSidebar()
  await setViewport(1280, 800, false)
  await waitFor(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const sidebar = frame?.children[0]
    const center = frame?.children[1]
    return Boolean(sidebar && getComputedStyle(sidebar).position !== 'absolute' && !center?.hasAttribute('inert'))
  })()`)
  await delay(300)
  const directDesktop = await shellMetrics()
  report.desktopPreferenceRoundTrip.directFromOpenDrawer = directDesktop
  assert(!directDesktop.collapsed, 'direct mobile-to-desktop transition collapsed the desktop preference', directDesktop)
  assert(Math.abs(directDesktop.sidebar.width - desktopBaseline.sidebar.width) <= 1, 'direct mobile-to-desktop transition changed the desktop Sidebar width', { baseline: desktopBaseline.sidebar, actual: directDesktop.sidebar })
  const directAccess = await evaluate(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    return {
      sidebarRole: frame?.children[0]?.getAttribute('role') ?? null,
      centerInert: frame?.children[1]?.hasAttribute('inert') ?? null,
      centerHidden: frame?.children[1]?.getAttribute('aria-hidden') ?? null
    }
  })()`)
  report.desktopPreferenceRoundTrip.accessibility = directAccess
  assert(directAccess.sidebarRole === null && directAccess.centerInert === false && directAccess.centerHidden === null, 'Drawer accessibility state leaked into direct desktop transition', directAccess)

  for (const [width, height, label] of [
    [320, 568, '320x568'],
    [390, 844, '390x844'],
    [457, 707, '457x707'],
    [568, 320, '568x320'],
    [844, 390, '844x390']
  ]) {
    await setViewport(width, height, true)
    if (!(await evaluate(`document.querySelector('[data-shell-overlay]')?.parentElement?.hasAttribute('data-sidebar-collapsed')`))) await closeSidebar()
    await waitFor(`(() => {
      const sidebar = document.querySelector('[data-shell-overlay]')?.parentElement?.children[0]
      return Boolean(sidebar && getComputedStyle(sidebar).visibility === 'hidden')
    })()`)
    if (!(await ensureSession())) throw new Error(`${label}: could not mount a session header for the header assertions`)
    const metrics = await shellMetrics()
    report.viewports[label] = metrics
    assert(metrics.bodyMarker, `${label} body marker missing`, metrics)
    assert(metrics.shellCompatibleMarker, `${label} shell-compatible marker missing`, metrics)
    assert(metrics.viewport.includes('viewport-fit=cover'), `${label} viewport-fit missing`, metrics.viewport)
    assert(metrics.collapsed, `${label} sidebar is not closed`, metrics)
    assert(metrics.sidebarVisibility === 'hidden', `${label} closed sidebar is visible`, metrics)
    assert(metrics.rightbarDisplay !== 'none', `${label} rightbar column is display:none, so the open right sidebar could never render`, metrics)
    assert(metrics.rightbar.width <= 1, `${label} rightbar track is not closed`, metrics.rightbar)
    assert(metrics.toggleDisplay === 'flex', `${label} plugin toggle is not enabled`, metrics)
    assert(Math.abs(metrics.toggle.width - 44) <= 1 && Math.abs(metrics.toggle.height - 44) <= 1, `${label} plugin toggle is not 44px`, metrics.toggle)
    assert(metrics.inputFontSize === '16px', `${label} composer input is not 16px`, metrics.inputFontSize)

    // The entry must read as DSH's own header chrome: a bare 28px visual box inside the 44px hit
    // box, on the header's own gutter, mirroring the right panel control's glyph ink exactly.
    assert(metrics.toggleStyle !== null && metrics.toggleStyle.chipBorderStyle === 'none', `${label} drawer entry draws a bordered chip`, metrics.toggleStyle)
    assert(metrics.toggleStyle.chipBackground === 'rgba(0, 0, 0, 0)' && metrics.toggleStyle.chipBoxShadow === 'none', `${label} drawer entry paints a floating pill`, metrics.toggleStyle)
    assert(metrics.toggleStyle.borderRadius === '28px', `${label} drawer entry is not a round native control`, metrics.toggleStyle)
    assert(metrics.toggleStyle.inset === '8px', `${label} drawer entry visual box is not the 28px one`, metrics.toggleStyle)
    if (metrics.nativeHeaderButton) {
      const native = metrics.nativeHeaderButton
      assert(metrics.toggleStyle.color === native.color, `${label} drawer entry ink differs from the native header control`, { mine: metrics.toggleStyle.color, native: native.color })
      assert(Math.abs(metrics.toggle.y - native.rect.y) <= 1, `${label} drawer entry and the right panel control are not on the same row`, { mine: metrics.toggle, native: native.rect })
      const mine = metrics.toggleStyle.iconRect
      const theirs = native.iconRect
      assert(mine && theirs, `${label} one of the header controls has no icon to compare`, { mine, theirs })
      const inkLeft = mine.x
      const theirInkRight = metrics.inner.width - theirs.right
      assert(Math.abs(inkLeft - theirInkRight) <= 1.5, `${label} the two header glyphs are not equidistant from the edges`, { mine, theirs, inkLeft, theirInkRight })
      assert(Math.abs(mine.width - theirs.width) <= 1 && Math.abs(mine.height - theirs.height) <= 1, `${label} the two header glyphs are not the same size`, { mine, theirs })
      assert(metrics.toggleStyle.icon[0] === '15px' && native.icon[0] === '15px', `${label} header glyphs are not the native 15px size`, { mine: metrics.toggleStyle.icon, theirs: native.icon })
    }

    // The phone session header keeps the title and both control clusters inside one horizontally
    // scrollable strip with no visible scrollbar and no extra header height.
    assert(metrics.titleStrip !== null, `${label} session header has no scrollable action strip`, metrics)
    assert(metrics.titleStrip.containsNativeActions, `${label} action strip holds no native header controls`, metrics.titleStrip)
    assert(metrics.titleStrip.height <= 28.5, `${label} action strip is taller than the row budget`, metrics.titleStrip)
    assert(metrics.titleStrip.rowHeight <= 44.5, `${label} session header grew past its 44px row`, metrics.titleStrip)
    assert(metrics.titleStrip.overflowX === 'auto', `${label} action strip is not the scroll container`, metrics.titleStrip)
    assert(metrics.titleStrip.scrollbarWidth === 'none', `${label} action strip shows a scrollbar`, metrics.titleStrip)
    assert(metrics.titleStrip.scrollbarGutter === 0, `${label} hidden scrollbar still reserves layout space`, metrics.titleStrip)
    assert(metrics.titleStrip.clippedActions === 0 && metrics.titleStrip.inlineActions > 0, `${label} header controls are missing or vertically clipped inside the strip`, metrics.titleStrip)
    assert(metrics.titleStrip.actionsOutOfReach === 0, `${label} header controls are outside the strip's scroll range`, metrics.titleStrip)
    // A hidden scrollbar is only acceptable if the drag itself moves the strip.
    const drag = await evaluate(STRIP_DRAG)
    report.titleStripDrag[label] = drag
    assert(drag.supported, `${label} title strip drag cannot be probed: ${drag.reason}`, drag)
    if (drag.max > 0) {
      assert(drag.during > drag.before, `${label} dragging the title strip does not scroll it`, drag)
      assert(drag.during <= drag.max, `${label} dragging the title strip scrolled past its content`, drag)
      assert(drag.gestureClickDelivered === false, `${label} the drag gesture also fired a click on the header control`, drag)
    } else {
      assert(drag.during === drag.before, `${label} a non-scrollable title strip moved during a drag`, drag)
    }

    // DSH's attachment rail keeps its own sizing on touch; only the composer's action row gets the
    // 44px floor. An 18px remove control blown up to 44px is exactly what this guards against.
    const pasted = await pasteAttachment()
    if (!pasted) throw new Error(`${label}: could not mount the attachment rail for measurement`)
    await delay(400)
    const railMetrics = await shellMetrics()
    report.viewports[label].attachmentRail = railMetrics.composerButtons.filter((button) => button.inRail)
    const railButtons = railMetrics.composerButtons.filter((button) => button.inRail)
    assert(railButtons.length > 0, `${label} no attachment rail control to measure`, railMetrics.composerButtons)
    const leaked = railButtons.filter((button) => button.width === 44 || button.height === 44)
    assert(leaked.length === 0, `${label} the 44px floor leaked into the attachment rail`, leaked)
    const underSized = railMetrics.composerButtons.filter((button) => !button.inRail).filter((button) => button.width < 44 || button.height < 44)
    assert(underSized.length === 0, `${label} a composer action lost its 44px touch target`, underSized)
    await evaluate(`document.querySelector("[role='group'] button[aria-label^='移除']")?.click()`)
    await delay(400)
    report.viewports[label].titleStrip = (await shellMetrics()).titleStrip
    await screenshot(label)
  }

  report.landscapeDrawers = {}
  for (const [width, height, label] of [[568, 320, '568x320'], [844, 390, '844x390']]) {
    await setViewport(width, height, true)
    await openSidebar()
    const landscape = await evaluate(`(() => {
      const frame = document.querySelector('[data-shell-overlay]')?.parentElement
      const sidebar = frame?.children[0]
      const root = sidebar?.querySelector(":scope > [data-slot='sidebar'] > :first-child")
      const settings = sidebar?.querySelector("button[aria-haspopup='dialog']")
      const rect = (node) => node ? (() => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } })() : null
      return {
        sidebar: rect(sidebar),
        root: rect(root),
        settings: rect(settings),
        rootClientHeight: root?.clientHeight ?? null,
        rootScrollHeight: root?.scrollHeight ?? null
      }
    })()`)
    report.landscapeDrawers[label] = landscape
    assert(landscape.settings !== null, `${label} Settings action is missing`, landscape)
    assert(landscape.settings.y >= -0.5 && landscape.settings.bottom <= height + 0.5, `${label} Settings action is not reachable`, landscape)
    assert(Math.abs(landscape.sidebar.width - landscape.root.width) <= 1.5, `${label} SidebarRoot does not fill drawer`, landscape)
    assert(Math.abs(landscape.sidebar.height - height) <= 1, `${label} landscape drawer does not fill the viewport height`, landscape.sidebar)
    await screenshot(`drawer-${label}`)
    await closeSidebar()
  }

  await setViewport(390, 844, true)
  await evaluate(`document.querySelector('.dmc-sidebar-toggle')?.focus()`)
  await openSidebar()
  const drawer = await shellMetrics()
  report.drawer = drawer
  assert(drawer.sidebarPosition === 'absolute', 'mobile sidebar is not an absolute drawer', drawer)
  assert(drawer.sidebarVisibility === 'visible', 'open mobile drawer is hidden', drawer)
  // The drawer is fullscreen on a phone (the right panel already is below 768px), so it must fill
  // the viewport instead of leaving a strip of conversation visible beside or below it.
  assert(Math.abs(drawer.sidebar.width - drawer.inner.width) <= 1, 'mobile drawer is not fullscreen', drawer.sidebar)
  assert(drawer.sidebar.x === 0 && Math.abs(drawer.sidebar.right - drawer.inner.width) <= 1, 'mobile drawer does not cover the viewport', drawer.sidebar)
  // Vertically too: the collapsed rail's owner writes the desktop panel height onto this column,
  // which used to leave a strip of still-clickable conversation below the drawer.
  assert(Math.abs(drawer.sidebar.height - drawer.inner.height) <= 1 && Math.abs(drawer.sidebar.bottom - drawer.inner.height) <= 1, 'mobile drawer does not fill the viewport height', drawer.sidebar)
  assert(Math.abs(drawer.sidebar.width - drawer.sidebarRoot.width) <= 1.5, 'SidebarRoot width does not match drawer', drawer)
  assert(Math.abs(drawer.sidebarRoot.height - drawer.inner.height) <= 1.5, 'SidebarRoot does not fill the drawer height', drawer.sidebarRoot)
  const drawerBelow = await evaluate(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const column = frame?.children?.[0]
    if (!column) return null
    const box = column.getBoundingClientRect()
    const y = Math.round(box.bottom) + 4
    if (y >= innerHeight) return null
    const node = document.elementFromPoint(Math.round(box.width / 2), y)
    return node ? node.tagName + '.' + String(node.className).slice(0, 30) : null
  })()`)
  report.drawer.drawerBelow = drawerBelow
  assert(drawerBelow === null, 'an element is still reachable below the open drawer', { below: drawerBelow, sidebar: drawer.sidebar })
  assert(drawer.workspaceButtons.length >= 2, 'workspace header controls are missing', drawer.workspaceButtons)
  assert(drawer.workspaceButtons.every((rect) => rect.x >= drawer.sidebar.x - 0.5 && rect.right <= drawer.sidebar.right + 0.5), 'workspace header controls leave drawer bounds', drawer)
  assert(Math.abs(drawer.center.width - 390) <= 1, 'open drawer squeezes center content', drawer.center)
  assert(drawer.backdropDisplay === 'block', 'open drawer backdrop is missing', drawer)
  await screenshot('drawer-390x844')

  const focusedInside = await waitFor(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const sidebar = frame?.children[0]
    return Boolean(sidebar && sidebar.contains(document.activeElement))
  })()`)
  assert(focusedInside, 'focus did not move inside Sidebar')

  // Panel handoff: the right panel is a fullscreen z-index 40 overlay while the drawer is z-index
  // 30, so opening the drawer must first take the panel off the screen — and opening the drawer
  // while the panel is CLOSED must not touch the panel's symmetric toggle, which would open it
  // right over the drawer (the "left entry never shows the left drawer" report).
  await closeSidebar()
  const expandClicked = await evaluate(`(() => {
    const button = document.querySelector('[data-sidebar-right-expand]')
    button?.click()
    return Boolean(button)
  })()`)
  if (expandClicked) {
    await waitFor(`Boolean(document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]'))`)
    const alreadyOpen = await shellMetrics()
    assert(alreadyOpen.collapsed, 'panel handoff precondition: drawer should be closed', alreadyOpen)
    await openSidebar()
    const handoff = await evaluate(`(() => {
      const frame = document.querySelector('[data-shell-overlay]')?.parentElement
      const sidebar = frame?.children[0]
      const box = sidebar?.getBoundingClientRect()
      return {
        drawerOpen: frame?.hasAttribute('data-sidebar-collapsed') === false,
        panelOpen: Boolean(document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]')),
        sidebar: box ? { x: Math.round(box.x), w: Math.round(box.width), right: Math.round(box.right) } : null,
        innerWidth
      }
    })()`)
    report.drawerPanelHandoff = handoff
    assert(handoff.drawerOpen, 'opening the drawer with the panel open did not open the drawer', handoff)
    assert(!handoff.panelOpen, 'the right panel stayed open over the drawer', handoff)
    assert(handoff.sidebar && handoff.sidebar.x === 0 && Math.abs(handoff.sidebar.right - handoff.innerWidth) <= 1, 'drawer is not the visible surface after the handoff', handoff)
    await screenshot('drawer-after-panel-handoff')
    await closeSidebar()
  }

  // Now the same click order with the panel CLOSED: the drawer must open and the panel must stay
  // closed. A blind click on the symmetric toggle used to open the panel right over the drawer.
  const panelClosed = await openSidebar()
  const noPanel = await evaluate(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const box = frame?.children[0]?.getBoundingClientRect()
    return {
      drawerOpen: frame?.hasAttribute('data-sidebar-collapsed') === false,
      panelOpen: Boolean(document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]')),
      sidebarWidth: box ? Math.round(box.width) : null,
      innerWidth
    }
  })()`)
  report.drawerTapWithClosedPanel = noPanel
  assert(noPanel.drawerOpen, 'tapping the entry with the panel closed did not open the drawer', noPanel)
  assert(!noPanel.panelOpen, 'tapping the entry with the panel closed opened the right panel', noPanel)
  assert(noPanel.sidebarWidth !== null && Math.abs(noPanel.sidebarWidth - noPanel.innerWidth) <= 1, 'drawer is not fullscreen after the closed-panel tap', noPanel)
  await closeSidebar()

  // The focus-trap section below asserts that closing restores focus to the entry, so the entry
  // must be what had focus before this drawer opened.
  await evaluate(`document.querySelector('.dmc-sidebar-toggle')?.focus()`)
  await openSidebar()
  const drawerSemantics = await evaluate(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const sidebar = frame?.children[0]
    const active = document.activeElement
    const rect = active?.getBoundingClientRect()
    return {
      role: sidebar?.getAttribute('role'),
      modal: sidebar?.getAttribute('aria-modal'),
      label: sidebar?.getAttribute('aria-label'),
      activeTag: active?.tagName || null,
      activeLabel: active?.getAttribute?.('aria-label') || null,
      activeWidth: rect?.width ?? null
    }
  })()`)
  report.drawerSemantics = drawerSemantics
  assert(drawerSemantics.role === 'dialog' && drawerSemantics.modal === 'true' && drawerSemantics.label, 'Drawer is not a named modal dialog', drawerSemantics)
  assert(drawerSemantics.activeTag === 'BUTTON' && drawerSemantics.activeLabel && drawerSemantics.activeWidth <= 64, 'Drawer did not focus its compact close control', drawerSemantics)
  const isolation = await evaluate(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const center = frame?.children[1]
    const details = frame?.children[2]
    return {
      centerInert: center?.inert === true || center?.hasAttribute('inert'),
      centerHidden: center?.getAttribute('aria-hidden'),
      detailsInert: details?.inert === true || details?.hasAttribute('inert'),
      detailsHidden: details?.getAttribute('aria-hidden')
    }
  })()`)
  report.focusIsolation = isolation
  assert(isolation.centerInert && isolation.centerHidden === 'true', 'center is not inert and aria-hidden', isolation)
  assert(isolation.detailsInert && isolation.detailsHidden === 'true', 'details are not inert and aria-hidden', isolation)

  await evaluate(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    frame?.children[2]?.setAttribute('aria-hidden', 'external-owner')
    const modal = document.createElement('div')
    modal.id = 'dmc-competing-modal-test'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('aria-label', 'Competing test modal')
    modal.style.cssText = 'position:fixed;inset:20px;width:100px;height:100px;display:block'
    document.querySelector('[data-shell-overlay]')?.appendChild(modal)
  })()`)
  await waitFor(`document.querySelector('[data-shell-overlay]')?.parentElement?.children[0]?.getAttribute('role') === null`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  const competingModalIsolation = await evaluate(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    return {
      drawerOpen: frame?.hasAttribute('data-sidebar-collapsed') === false,
      sidebarRole: frame?.children[0]?.getAttribute('role') ?? null,
      modalPresent: Boolean(document.getElementById('dmc-competing-modal-test'))
    }
  })()`)
  report.competingModalIsolation = competingModalIsolation
  assert(competingModalIsolation.drawerOpen && competingModalIsolation.sidebarRole === null && competingModalIsolation.modalPresent, 'top-level modal did not suspend Drawer semantics and Escape trap', competingModalIsolation)
  await evaluate(`document.getElementById('dmc-competing-modal-test')?.remove()`)
  await waitFor(`document.querySelector('[data-shell-overlay]')?.parentElement?.children[0]?.getAttribute('role') === 'dialog'`)

  const focusSelector = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])"
  await evaluate(`(() => {
    const sidebar = document.querySelector('[data-shell-overlay]')?.parentElement?.children[0]
    const nodes = [...(sidebar?.querySelectorAll(${JSON.stringify(focusSelector)}) || [])].filter((node) => node.getClientRects().length > 0 && node.getAttribute('aria-hidden') !== 'true')
    nodes[nodes.length - 1]?.focus()
  })()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  const forwardWrapped = await evaluate(`(() => {
    const sidebar = document.querySelector('[data-shell-overlay]')?.parentElement?.children[0]
    const nodes = [...(sidebar?.querySelectorAll(${JSON.stringify(focusSelector)}) || [])].filter((node) => node.getClientRects().length > 0 && node.getAttribute('aria-hidden') !== 'true')
    return document.activeElement === nodes[0]
  })()`)
  assert(forwardWrapped, 'Tab did not wrap from the last to first Sidebar control')
  await evaluate(`(() => {
    const sidebar = document.querySelector('[data-shell-overlay]')?.parentElement?.children[0]
    const nodes = [...(sidebar?.querySelectorAll(${JSON.stringify(focusSelector)}) || [])].filter((node) => node.getClientRects().length > 0 && node.getAttribute('aria-hidden') !== 'true')
    nodes[0]?.focus()
  })()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 })
  const backwardWrapped = await evaluate(`(() => {
    const sidebar = document.querySelector('[data-shell-overlay]')?.parentElement?.children[0]
    const nodes = [...(sidebar?.querySelectorAll(${JSON.stringify(focusSelector)}) || [])].filter((node) => node.getClientRects().length > 0 && node.getAttribute('aria-hidden') !== 'true')
    return document.activeElement === nodes[nodes.length - 1]
  })()`)
  assert(backwardWrapped, 'Shift+Tab did not wrap from the first to last Sidebar control')
  report.focusWrap = { forward: forwardWrapped, backward: backwardWrapped }
  // Re-establish the state this assertion is about: the drawer closes here, the entry takes focus
  // on the closed screen, and reopening it must hand that focus back on Escape.
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(`document.querySelector('[data-shell-overlay]')?.parentElement?.hasAttribute('data-sidebar-collapsed') === true`)
  await evaluate(`document.querySelector('.dmc-sidebar-toggle')?.focus()`)
  await delay(150)
  await openSidebar()
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(`document.querySelector('[data-shell-overlay]')?.parentElement?.hasAttribute('data-sidebar-collapsed') === true`)
  const focusState = await evaluate(`(() => {
    const active = document.activeElement
    const toggle = document.querySelector('.dmc-sidebar-toggle')
    return {
      activeTag: active?.tagName ?? null,
      activeLabel: active?.getAttribute?.('aria-label') ?? null,
      activeClass: String(active?.className ?? '').slice(0, 40),
      toggleConnected: Boolean(toggle),
      toggleRects: toggle ? toggle.getClientRects().length : null,
      toggleTabIndex: toggle?.tabIndex ?? null,
      activeIsToggle: active === toggle
    }
  })()`)
  report.escapeFocus = focusState
  const restored = focusState.activeIsToggle
  assert(restored, 'Escape did not restore focus to plugin toggle', focusState)
  const ownershipPreserved = await evaluate(`(() => {
    const details = document.querySelector('[data-shell-overlay]')?.parentElement?.children[2]
    const value = details?.getAttribute('aria-hidden') ?? null
    details?.removeAttribute('aria-hidden')
    return value
  })()`)
  report.attributeOwnership = { externallyChangedAriaHidden: ownershipPreserved }
  assert(ownershipPreserved === 'external-owner', 'Drawer cleanup overwrote an externally changed ARIA attribute', ownershipPreserved)

  await openSidebar()
  const searchClicked = await evaluate(`(() => {
    const button = document.querySelector("[data-slot='sidebar.workspaces'] button[aria-expanded='false']")
    button?.click()
    return Boolean(button)
  })()`)
  assert(searchClicked, 'workspace search toggle not found')
  await waitFor(`Boolean(document.querySelector("[data-slot='sidebar.workspaces'] button[aria-expanded='true']"))`)
  await delay(300)
  const search = await evaluate(`(() => {
    const button = document.querySelector("[data-slot='sidebar.workspaces'] button[aria-expanded='true']")
    const root = button?.parentElement
    const input = root?.querySelector('input')
    const rect = (node) => node ? (() => { const r = node.getBoundingClientRect(); return { x: r.x, width: r.width, right: r.right } })() : null
    return { root: rect(root), input: rect(input) }
  })()`)
  report.search = search
  assert(search.root.width > 250, 'expanded search does not fill workspace header', search)
  assert(search.input.width > 120, 'expanded search input is too narrow', search)
  assert(search.root.x >= drawer.sidebar.x - 0.5 && search.root.right <= drawer.sidebar.right + 0.5, 'expanded search leaves drawer bounds', search)
  await closeSidebar()

  await setViewport(900, 700, true)
  await openSidebar()
  await setViewport(901, 700, true)
  await waitFor(`document.querySelector('[data-shell-overlay]')?.parentElement?.hasAttribute('data-sidebar-collapsed') === true`)
  // Let the columns settle: measuring mid-transition reads the desktop rail's controls at their
  // mobile coordinates and reports a leak that does not exist once the track has converged.
  await waitFor(`(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const sidebar = frame?.children[0]
    if (!sidebar) return false
    const box = sidebar.getBoundingClientRect()
    return box.width > 40 && box.width < 80
  })()`)
  await delay(400)
  const breakpoint901 = await shellMetrics()
  report.viewports['901x700'] = breakpoint901
  assert(breakpoint901.toggleDisplay === 'none', 'mobile toggle remains enabled at 901px', breakpoint901)
  assert(breakpoint901.collapsed, 'stale narrow drawer remained open at 901px', breakpoint901)
  assert(breakpoint901.workspaceButtons.every((rect) => rect.x >= breakpoint901.sidebar.x - 0.5 && rect.right <= breakpoint901.sidebar.right + 0.5), 'mobile touch sizing leaked outside the 901px native rail', breakpoint901)

  await setViewport(1023, 700, false)
  const narrow1023 = await shellMetrics()
  report.viewports['1023x700'] = narrow1023
  assert(narrow1023.collapsed, 'DSH narrow layout should be collapsed at 1023px', narrow1023)
  await setViewport(1024, 700, false)
  const desktop1024 = await shellMetrics()
  report.viewports['1024x700'] = desktop1024
  const desktopTrack = Number.parseFloat(desktop1024.grid)
  assert(Number.isFinite(desktopTrack) && desktopTrack >= 55.5, 'native desktop sidebar track did not recover at 1024px', desktop1024)
  assert(desktop1024.sidebarPosition !== 'absolute', 'mobile drawer positioning leaked at 1024px', desktop1024)
  assert(desktop1024.toggleDisplay === 'none', 'plugin toggle leaked at 1024px', desktop1024)

  await setViewport(390, 844, true)
  const mobileSettings = await openSettings()
  report.settings['390x844'] = mobileSettings
  assert(Math.abs(mobileSettings.panel.width - 390) <= 1 && Math.abs(mobileSettings.panel.height - 844) <= 1, 'mobile Settings is not full viewport', mobileSettings)
  assert(mobileSettings.direction === 'column' && mobileSettings.radius === '0px', 'mobile Settings shell is not mobile layout', mobileSettings)
  assert(Math.abs(mobileSettings.nav.width - 390) <= 1 && Math.abs(mobileSettings.content.width - 390) <= 1, 'mobile Settings children are squeezed', mobileSettings)
  assert(mobileSettings.navDirection === 'row', 'mobile Settings navigation is not horizontal', mobileSettings)
  assert(mobileSettings.outerSidebarRole === null, 'Drawer modal semantics were not suspended for nested Settings', mobileSettings)
  await screenshot('settings-mobile-390x844')
  await closeSettings()
  await closeSidebar()

  await setViewport(1280, 800, false)
  const desktopSettings = await openSettings()
  report.settings['1280x800'] = desktopSettings
  assert(Math.abs(desktopSettings.panel.width - 800) <= 1, 'desktop Settings width was overridden', desktopSettings)
  assert(desktopSettings.direction === 'row', 'desktop Settings direction was overridden', desktopSettings)
  assert(desktopSettings.radius !== '0px', 'desktop Settings radius was overridden', desktopSettings)
  assert(desktopSettings.navDirection !== 'row', 'desktop Settings navigation was overridden', desktopSettings)
  await screenshot('settings-desktop-1280x800')
  await closeSettings()

  await delay(300)
  const actionable = diagnostics.filter((entry) => {
    const text = `${entry.text || ''} ${entry.description || ''} ${entry.url || ''}`
    // Known noise: the favicon, layout effects, and the host-side changes summary route the app
    // polls even when the isolated profile has no changes service to answer it.
    return !/favicon|ResizeObserver loop|Failed to load resource.*404|\/api\/changes\.summary/i.test(text)
  })
  report.diagnostics = actionable
  assert(actionable.length === 0, 'browser diagnostics are not empty', actionable)
  report.passed = true
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ passed: true, report: REPORT_PATH, screenshots: report.screenshots }, null, 2))
} catch (error) {
  report.error = { message: error.message, stack: error.stack }
  try {
    await mkdir(dirname(PREFIX), { recursive: true })
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  } catch {}
  throw error
} finally {
  if (cdp) await cdp.close()
  if (targetId) {
    try { await fetch(`${DEVTOOLS}/json/close/${encodeURIComponent(targetId)}`) } catch {}
  }
}
