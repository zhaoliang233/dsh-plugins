// dsh-sticky-user-bubble — browser half loaded by dsh-client-modules.
// The package owns one additive shell overlay entry and leaves core chat markup
// and session state untouched.
window.__ModuleLoader__.load({
  id: 'dsh-sticky-user-bubble',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const PLUGIN_ID = 'dsh-sticky-user-bubble'
    const OVERLAY_ID = PLUGIN_ID
    const SCROLL_SELECTOR = '[data-conversation-scroll]'
    const FLOW_SELECTOR = '[data-chat-flow]'
    const ROW_SELECTOR = '[data-chat-anchor-key]'
    // The composer is sticky at the bottom inside the conversation scrollport, so the
    // scrollport's own bottom edge is not the end of the reading area.
    const COMPOSER_SELECTOR = '[data-composer-seat]'
    const USER_KINDS = new Set(['user', 'steering'])
    const BUBBLE_MARKERS = ['[data-user-bubble]', '[data-chat-user-bubble]']
    // DSH's user-text projector emits `data-ref-chip="<kind>"` plus `title="<raw token>"`
    // for each projected `@`/slash token; the rendered chip text is only the token's last
    // path segment with an icon in front of it.
    const REFERENCE_CHIP_MARKER = 'data-ref-chip'
    const REFERENCE_CHIP_TITLE = 'title'
    const MAX_PROJECTION_NODES = 512
    const EPSILON = 0.75
    const LINE_MERGE_EPSILON = 2
    const MAX_COLLAPSED_LINES = 3
    const MAX_LINE_TEXT_NODES = 256
    const MAX_SOURCE_ANCESTORS = 12
    const MAX_STYLE_TREE_NODES = 128
    // Clearance kept between the yielding clone and the incoming card. The audited DSH flow
    // spaces consecutive items with a 16px `margin-top` (`--dsh-chat-flow-gap`), so the clone
    // follows that spacing instead of sliding flush against the next card.
    const MIN_PUSH_GAP = 16
    const MAX_PUSH_GAP = 48
    const JUMP_TITLE = 'Jump to original message'
    const DESCENDANT_STYLE_PROPERTIES = [
      'background', 'backgroundClip', 'backgroundOrigin', 'backgroundPosition',
      'backgroundRepeat', 'backgroundSize', 'border', 'borderRadius', 'color',
      'display', 'fontFamily', 'fontFeatureSettings', 'fontKerning', 'fontSize',
      'fontStretch', 'fontStyle', 'fontVariant', 'fontWeight', 'hyphens',
      'letterSpacing', 'lineHeight', 'margin', 'overflowWrap', 'padding',
      'tabSize', 'textAlign', 'textDecoration', 'textIndent', 'textShadow',
      'textTransform', 'verticalAlign', 'whiteSpace', 'wordBreak'
    ]

    const EMPTY_SESSION_SOURCE = {
      subscribe() { return () => {} },
      getSnapshot() { return undefined }
    }

    const EMPTY_CHAT_SOURCE = {
      subscribe() { return () => {} },
      getSnapshot() { return undefined }
    }

    function textFromContent(content) {
      if (typeof content === 'string') return content
      if (!Array.isArray(content)) return ''
      return content.map((block) => {
        if (block === null || typeof block !== 'object') return ''
        if (block.type !== 'text' && block.type !== 'reasoning') return ''
        return typeof block.text === 'string' ? block.text : ''
      }).join('')
    }

    // Chat data is a separate target snapshot in the audited DSH line. Keep the old
    // nested shape as a compatibility fallback for older DSH bundles.
    function buildUserIndex(snapshot, chatSnapshot) {
      const index = new Map()
      const chat = chatSnapshot !== undefined
        ? chatSnapshot
        : snapshot?.chat ?? (Array.isArray(snapshot?.order) ? snapshot : undefined)
      const order = chat?.order
      const nodes = chat?.nodes
      if (!Array.isArray(order) || nodes === undefined || typeof nodes.get !== 'function') return index

      for (const orderKey of order) {
        const node = nodes.get(orderKey)
        if (node === undefined || node === null || !USER_KINDS.has(node.kind)) continue
        const key = typeof node.key === 'string' ? node.key : String(orderKey)
        const text = textFromContent(node.data?.content)
        if (text.trim() === '') continue
        index.set(key, { key, text })
      }
      return index
    }

    function viewportOf() {
      return typeof window === 'undefined' ? undefined : window
    }

    function computedStyleOf(element) {
      const viewport = viewportOf()
      if (viewport !== undefined && typeof viewport.getComputedStyle === 'function') {
        return viewport.getComputedStyle(element)
      }
      return element?.currentStyle || {}
    }

    function finiteDimension(value) {
      return typeof value === 'number' && Number.isFinite(value) && value > 0
    }

    function rectOf(element) {
      if (element === null || element === undefined || typeof element.getBoundingClientRect !== 'function') return null
      const rect = element.getBoundingClientRect()
      return finiteDimension(rect.width) && finiteDimension(rect.height) ? rect : null
    }

    function visibleFlow(scroll) {
      if (scroll === null || typeof scroll.querySelectorAll !== 'function') return null
      const flows = scroll.querySelectorAll(FLOW_SELECTOR)
      for (const flow of flows) if (rectOf(flow) !== null) return flow
      return null
    }

    function matchingRowCount(flow, userIndex) {
      if (flow === null || typeof flow.querySelectorAll !== 'function') return 0
      let count = 0
      for (const row of flow.querySelectorAll(ROW_SELECTOR)) {
        const kind = row.getAttribute?.('data-chat-flow-kind')
        if (!USER_KINDS.has(kind)) continue
        const key = row.getAttribute?.('data-chat-flow-key') || row.getAttribute?.('data-chat-anchor-key')
        if (key !== null && key !== undefined && userIndex.has(key)) count += 1
      }
      return count
    }

    function findConversationScroll(userIndex) {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null
      let best = null
      let bestScore = -1
      for (const candidate of document.querySelectorAll(SCROLL_SELECTOR)) {
        const flow = visibleFlow(candidate)
        if (flow === null || rectOf(candidate) === null) continue
        const score = matchingRowCount(flow, userIndex)
        if (score > bestScore) {
          best = candidate
          bestScore = score
        }
      }
      return best
    }

    function parsePixels(value) {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) ? parsed : 0
    }

    function verticalShorthand(value) {
      if (typeof value !== 'string') return 0
      const parts = value.trim().split(/\s+/).filter(Boolean).map(parsePixels)
      if (parts.length === 0) return 0
      if (parts.length === 1) return parts[0] * 2
      if (parts.length === 2) return parts[0] * 2
      return parts[0] + parts[2]
    }

    function verticalBoxInset(style) {
      const explicitPadding = parsePixels(style.paddingTop) + parsePixels(style.paddingBottom)
      const padding = explicitPadding > 0 ? explicitPadding : verticalShorthand(style.padding)
      const border = parsePixels(style.borderTopWidth) + parsePixels(style.borderBottomWidth)
      return padding + border
    }

    function horizontalBoxInset(style) {
      const explicitPadding = parsePixels(style.paddingLeft) + parsePixels(style.paddingRight)
      const padding = explicitPadding > 0
        ? explicitPadding
        : (() => {
            const parts = String(style.padding || '').trim().split(/\s+/).filter(Boolean).map(parsePixels)
            if (parts.length === 0) return 0
            if (parts.length === 1) return parts[0] * 2
            if (parts.length === 2) return parts[1] * 2
            return (parts[1] || 0) + (parts[3] ?? parts[1] ?? 0)
          })()
      const border = parsePixels(style.borderLeftWidth) + parsePixels(style.borderRightWidth)
      return padding + border
    }

    function resolvedLineHeight(style) {
      const fontSize = parsePixels(style.fontSize) || 16
      return parsePixels(style.lineHeight) || fontSize * 1.5
    }

    function readingInset(flow, scroll) {
      const candidates = [flow?.parentElement, scroll]
      for (const candidate of candidates) {
        if (candidate === null || candidate === undefined) continue
        const top = parsePixels(computedStyleOf(candidate).paddingTop)
        if (top > 0) return top
      }
      return 16
    }

    function clipsVertically(style) {
      const overflow = String(style?.overflowY || style?.overflow || '').trim().toLowerCase()
      return overflow !== '' && overflow !== 'visible'
    }

    // Spacing the clone keeps above the incoming card: follow the row's own leading margin
    // (the core's flow gap), never less than `MIN_PUSH_GAP` and never a runaway value.
    function pushGapOf(row) {
      const marginTop = parsePixels(computedStyleOf(row).marginTop)
      if (!Number.isFinite(marginTop) || marginTop <= 0) return MIN_PUSH_GAP
      return Math.min(MAX_PUSH_GAP, Math.max(MIN_PUSH_GAP, marginTop))
    }

    // Bottom of the reading area. The scrollport ends at the frame edge, but its last child is
    // the sticky composer seat, so an expanded bubble capped only by the scrollport would grow
    // over the composer and the frame's status bar below it. Missing or unmeasurable seats keep
    // the old viewport-only limit.
    function readingLowerBoundary(scroll, scrollRect, overlayRect) {
      let boundary = Math.min(scrollRect.bottom, overlayRect.bottom)
      const composerRect = rectOf(scroll?.querySelector?.(COMPOSER_SELECTOR) ?? null)
      if (composerRect !== null && composerRect.top < boundary) boundary = composerRect.top
      return boundary
    }

    // Top of the band where the browser still paints the source bubble. The reading line
    // (`scrollRect.top + readingInset`) only places the clone, so it must not gate
    // visibility; painting really stops at the scrollport's own clip edge, narrowed by a
    // clipping or independently scrolling ancestor in between.
    function paintedTopBoundary(source, scroll, scrollRect) {
      let boundary = scrollRect.top + parsePixels(computedStyleOf(scroll).borderTopWidth)
      let ancestor = source?.parentElement
      let depth = 0
      while (ancestor !== null && ancestor !== undefined && depth <= MAX_SOURCE_ANCESTORS) {
        const rect = rectOf(ancestor)
        if (rect !== null) {
          const style = computedStyleOf(ancestor)
          if (clipsVertically(style)) {
            boundary = Math.max(boundary, rect.top + parsePixels(style.borderTopWidth))
          }
        }
        if (ancestor === scroll) break
        ancestor = ancestor.parentElement
        depth += 1
      }
      return boundary
    }

    function normalizedText(value) {
      return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
    }

    function comparableText(value) {
      const normalized = normalizedText(value).toLocaleLowerCase()
      return normalized.replace(/[^\p{L}\p{N}]+/gu, '') || normalized
    }

    function textAffinity(candidateText, expectedText) {
      const candidate = comparableText(candidateText)
      const expected = comparableText(expectedText)
      if (candidate === '' || expected === '') return 0
      if (candidate === expected) return 5000
      if (candidate.includes(expected)) return 4500
      if (expected.includes(candidate) && candidate.length >= Math.max(8, expected.length * 0.6)) return 3000
      return 0
    }

    function nodeAttribute(node, name) {
      if (node === null || node === undefined || typeof node.getAttribute !== 'function') return null
      return node.getAttribute(name)
    }

    // DSH renders each projected `@`/slash token as a reference chip whose visible text is
    // only the token's last path segment (preceded by an icon), while the raw token the
    // snapshot carries survives only in the chip's `title` attribute. A snapshot text that
    // contains such a token therefore never matches the rendered `textContent`, so rebuild
    // the rendered text with every chip replaced by its own `title`. Elements without the
    // marker and bundles without the attribute reproduce the plain `textContent` exactly.
    function referenceProjectedText(element) {
      if (element === null || element === undefined) return ''
      let text = ''
      const pending = [element]
      let visited = 0
      while (pending.length > 0) {
        // Fail closed instead of comparing a truncated reconstruction.
        if (visited >= MAX_PROJECTION_NODES) return ''
        const node = pending.pop()
        visited += 1
        if (node === null || node === undefined) continue
        if (node.nodeType === 3) {
          text += node.nodeValue || ''
          continue
        }
        if (node.nodeType !== undefined && node.nodeType !== 1) continue
        if (nodeAttribute(node, REFERENCE_CHIP_MARKER) !== null) {
          const title = nodeAttribute(node, REFERENCE_CHIP_TITLE)
          if (typeof title === 'string' && title !== '') {
            text += title
            continue
          }
        }
        const children = node.childNodes === undefined || node.childNodes === null
          ? Array.from(node.children || [])
          : Array.from(node.childNodes)
        if (children.length === 0) {
          if (typeof node.textContent === 'string') text += node.textContent
          continue
        }
        for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index])
      }
      return text
    }

    function elementTextAffinity(element, expectedText) {
      const plain = textAffinity(element?.textContent, expectedText)
      if (plain === 5000) return plain
      const projected = referenceProjectedText(element)
      if (projected === '') return plain
      return Math.max(plain, textAffinity(projected, expectedText))
    }

    function nonTransparentColor(value) {
      const color = String(value || '').replace(/\s+/gu, '').toLowerCase()
      if (color === '' || color === 'transparent') return false
      return !/^rgba\([^)]*,0(?:\.0+)?\)$/u.test(color)
    }

    function bubbleSurfaceOf(style) {
      const backgroundImage = String(style.backgroundImage || '').toLowerCase()
      const borderWidth = Math.max(
        parsePixels(style.borderTopWidth),
        parsePixels(style.borderRightWidth),
        parsePixels(style.borderBottomWidth),
        parsePixels(style.borderLeftWidth)
      )
      const radius = Math.max(
        parsePixels(style.borderTopLeftRadius),
        parsePixels(style.borderTopRightRadius),
        parsePixels(style.borderBottomLeftRadius),
        parsePixels(style.borderBottomRightRadius)
      )
      const padding = verticalBoxInset(style)
      const painted = nonTransparentColor(style.backgroundColor)
        || (backgroundImage !== '' && backgroundImage !== 'none')
        || borderWidth > 0
      return { painted, padding, radius }
    }

    function roundedBackgroundElement(row, expectedText) {
      if (row === null || typeof row.querySelector !== 'function') return null
      const hoverRoot = typeof row.matches === 'function' && row.matches('[data-time-hover-root]')
        ? row
        : row.querySelector('[data-time-hover-root]')
      // The audited DSH line removed the hover-root marker. The row itself remains an
      // authoritative boundary, so score only that row and its descendants.
      const root = hoverRoot ?? row

      for (const selector of BUBBLE_MARKERS) {
        const marked = typeof root.matches === 'function' && root.matches(selector)
          ? root
          : root.querySelector(selector)
        if (rectOf(marked) !== null && elementTextAffinity(marked, expectedText) > 0) return marked
      }

      const candidates = [root]
      if (typeof root.querySelectorAll === 'function') {
        for (const child of root.querySelectorAll('*')) candidates.push(child)
      }
      let best = null
      let bestScore = -1
      let secondScore = -1
      for (const candidate of candidates) {
        const rect = rectOf(candidate)
        if (rect === null) continue
        // Reject non-surfaces before reconstructing projected text, so the bounded
        // chip-title walk only runs for plausible bubbles.
        const surface = bubbleSurfaceOf(computedStyleOf(candidate))
        if (!surface.painted && surface.padding <= 0) continue
        const affinity = elementTextAffinity(candidate, expectedText)
        if (affinity === 0) continue
        const areaPenalty = Math.min(500, rect.width * rect.height / 10000)
        const score = affinity
          + (surface.painted ? 1000 : 0)
          + Math.min(500, surface.padding * 10)
          + Math.min(100, surface.radius)
          - areaPenalty
        if (score > bestScore) {
          secondScore = bestScore
          best = candidate
          bestScore = score
        } else if (score > secondScore) {
          secondScore = score
        }
      }

      return best !== null && bestScore - secondScore > 25 ? best : null
    }

    function ownedStyleValues(style, properties) {
      const owned = {}
      for (const property of properties) {
        const value = style[property]
        if (typeof value === 'string' && value !== '') owned[property] = value
      }
      return owned
    }

    function applyStyleValues(element, values) {
      if (element?.style === undefined) return
      Object.assign(element.style, values)
    }

    function visualStyleOf(source) {
      const style = computedStyleOf(source)
      const visual = {
        boxSizing: style.boxSizing || 'border-box',
        background: style.background || 'var(--dsw-specific-bubble)',
        backgroundClip: style.backgroundClip || 'border-box',
        backgroundOrigin: style.backgroundOrigin || 'padding-box',
        backgroundPosition: style.backgroundPosition || '0% 0%',
        backgroundRepeat: style.backgroundRepeat || 'repeat',
        backgroundSize: style.backgroundSize || 'auto',
        color: style.color || 'inherit',
        border: style.border || '0px solid transparent',
        borderRadius: style.borderRadius || '22px',
        padding: style.padding || '10px 16px',
        fontFamily: style.fontFamily || 'inherit',
        fontSize: style.fontSize || '16px',
        fontWeight: style.fontWeight || '400',
        fontStyle: style.fontStyle || 'normal',
        fontVariant: style.fontVariant || 'normal',
        fontStretch: style.fontStretch || 'normal',
        fontFeatureSettings: style.fontFeatureSettings || 'normal',
        fontKerning: style.fontKerning || 'auto',
        lineHeight: style.lineHeight || '24px',
        letterSpacing: style.letterSpacing || 'normal',
        textAlign: style.textAlign || 'start',
        textDecoration: style.textDecoration || 'none',
        textIndent: style.textIndent || '0px',
        textShadow: style.textShadow || 'none',
        textTransform: style.textTransform || 'none',
        wordBreak: style.wordBreak || 'normal',
        overflowWrap: style.overflowWrap || 'normal',
        whiteSpace: style.whiteSpace || 'normal',
        direction: style.direction || 'ltr',
        writingMode: style.writingMode || 'horizontal-tb',
        hyphens: style.hyphens || 'manual',
        tabSize: style.tabSize || '8',
        display: style.display || 'block',
        overflow: style.overflow || 'visible',
        overflowX: style.overflowX || style.overflow || 'visible',
        overflowY: style.overflowY || style.overflow || 'visible',
        textOverflow: style.textOverflow || 'clip',
        boxShadow: style.boxShadow || 'none',
        opacity: style.opacity || '1',
        filter: style.filter || 'none',
        backdropFilter: style.backdropFilter || 'none'
      }
      const metrics = {
        horizontalInset: horizontalBoxInset(style),
        lineHeight: resolvedLineHeight(style),
        transform: style.transform || 'none',
        verticalInset: verticalBoxInset(style),
        zoom: style.zoom || '1'
      }
      return {
        style: visual,
        metrics,
        signature: [...Object.values(visual), ...Object.values(metrics)].join('|')
      }
    }

    function copyDescendantStyles(source, clone) {
      const pending = [[source, clone]]
      let visited = 0
      while (pending.length > 0 && visited < MAX_STYLE_TREE_NODES) {
        const [sourceNode, cloneNode] = pending.shift()
        const sourceChildren = Array.from(sourceNode?.children || [])
        const cloneChildren = Array.from(cloneNode?.children || [])
        const count = Math.min(sourceChildren.length, cloneChildren.length)
        for (let index = 0; index < count; index += 1) {
          const sourceChild = sourceChildren[index]
          const cloneChild = cloneChildren[index]
          applyStyleValues(cloneChild, ownedStyleValues(
            computedStyleOf(sourceChild),
            DESCENDANT_STYLE_PROPERTIES
          ))
          pending.push([sourceChild, cloneChild])
          visited += 1
          if (visited >= MAX_STYLE_TREE_NODES) break
        }
      }
    }

    function measurementState(failure) {
      return { failure }
    }

    function measurePinned(scroll, overlay, userIndex) {
      if (userIndex.size === 0) return measurementState('inactive-snapshot')
      if (scroll === null) return measurementState('missing-scroll')
      if (overlay === null) return measurementState('missing-overlay')
      const flow = visibleFlow(scroll)
      if (flow === null) return measurementState('missing-flow')
      const scrollRect = rectOf(scroll)
      const overlayRect = rectOf(overlay)
      if (scrollRect === null) return measurementState('invalid-scroll-geometry')
      if (overlayRect === null) return measurementState('invalid-overlay-geometry')

      const edge = scrollRect.top + readingInset(flow, scroll)
      let active = null
      let incoming = null
      const rows = flow.querySelectorAll(ROW_SELECTOR)
      for (const row of rows) {
        const kind = row.getAttribute?.('data-chat-flow-kind')
        if (!USER_KINDS.has(kind)) continue
        const key = row.getAttribute?.('data-chat-flow-key') || row.getAttribute?.('data-chat-anchor-key')
        const message = key === null || key === undefined ? undefined : userIndex.get(key)
        if (message === undefined) continue
        const rowRect = rectOf(row)
        if (rowRect === null) continue
        if (rowRect.top <= edge + EPSILON) {
          active = { row, message }
          incoming = null
          continue
        }
        // The first user row below the reading line is the card the clone must yield to.
        if (active !== null && incoming === null) incoming = { row, rect: rowRect }
      }
      if (active === null) return measurementState('inactive-before-edge')

      const source = roundedBackgroundElement(active.row, active.message.text)
      if (source === null) return measurementState('bubble-not-found')
      const sourceRect = rectOf(source)
      if (sourceRect === null) return measurementState('invalid-source-geometry')
      // Do not duplicate the original while any part of its bubble is still painted.
      // The bubble only disappears once its bottom clears the scrollport's clip edge,
      // which sits `readingInset` above the reading line the clone is laid out on.
      if (sourceRect.bottom > paintedTopBoundary(source, scroll, scrollRect) + EPSILON) {
        return measurementState('inactive-source-visible')
      }

      const visual = visualStyleOf(source)
      const lowerBoundary = readingLowerBoundary(scroll, scrollRect, overlayRect)
      const availableHeight = Math.max(1, lowerBoundary - edge - 16)
      // Hand the slot over to the next user card instead of covering it: once that card's
      // leading edge comes within the flow gap of the clone's bottom, the clone is pushed up
      // — clipped at the scrollport edge — exactly like a sticky list header yielding to the
      // next section, while keeping `gap` of clearance instead of sliding flush against it.
      // `collapsedHeight` is not known before the clone is measured, so cap the estimate at
      // the natural three-line bubble height. At the reading line the required push is
      // exactly `collapsedHeight + gap`, which is also the clamp.
      const collapsedHeight = Math.min(
        sourceRect.height,
        visual.metrics.lineHeight * MAX_COLLAPSED_LINES + visual.metrics.verticalInset
      )
      const gap = incoming === null ? 0 : pushGapOf(incoming.row)
      const push = incoming === null
        ? 0
        : Math.max(0, Math.min(collapsedHeight + gap, gap + edge + collapsedHeight - incoming.rect.top))
      // Expanding the pinned bubble may not invade that card either: cap the expanded box by
      // the room between the reading line and the card's reserved gap, so a long pinned
      // message scrolls inside its box instead of growing over the next message.
      const expansionRoom = incoming === null
        ? availableHeight
        : Math.min(availableHeight, Math.max(0, incoming.rect.top - gap - edge))
      return {
        key: active.message.key,
        text: active.message.text,
        row: active.row,
        flow,
        source,
        scroll,
        left: sourceRect.left - overlayRect.left,
        top: edge - overlayRect.top,
        width: sourceRect.width,
        sourceHeight: sourceRect.height,
        availableHeight,
        push,
        inset: edge - scrollRect.top,
        expansionRoom,
        visual: visual.style,
        visualMetrics: visual.metrics,
        visualSignature: visual.signature
      }
    }

    function sameNumber(left, right) {
      return typeof left === 'number' && typeof right === 'number' && Math.abs(left - right) <= EPSILON
    }

    function samePin(left, right) {
      if (left === right) return true
      if (left === null || right === null) return false
      if (left.failure !== undefined || right.failure !== undefined) return left.failure === right.failure
      return left.key === right.key
        && left.text === right.text
        && left.row === right.row
        && left.flow === right.flow
        && left.source === right.source
        && left.scroll === right.scroll
        && sameNumber(left.left, right.left)
        && sameNumber(left.top, right.top)
        && sameNumber(left.width, right.width)
        && sameNumber(left.sourceHeight, right.sourceHeight)
        && sameNumber(left.availableHeight, right.availableHeight)
        && left.visualSignature === right.visualSignature
    }

    function sanitizeClone(element, root = true) {
      if (element === null || element === undefined) return
      element.removeAttribute?.('id')
      element.removeAttribute?.('for')
      element.removeAttribute?.('href')
      element.removeAttribute?.('target')
      element.removeAttribute?.('tabindex')
      element.removeAttribute?.('contenteditable')
      element.removeAttribute?.('accesskey')
      element.removeAttribute?.('autofocus')
      if ('tabIndex' in element) element.tabIndex = -1
      if (element.disabled !== undefined) element.disabled = true

      if (typeof element.attributes === 'object' && element.attributes !== null) {
        for (const attribute of Array.from(element.attributes)) {
          const name = String(attribute.name).toLowerCase()
          if (name.startsWith('aria-') || name.startsWith('data-chat-') || name.startsWith('on')) {
            element.removeAttribute(name)
          }
        }
      }
      if (!root && element.style !== undefined) element.style.pointerEvents = 'none'
      if (element.children !== undefined) {
        for (const child of Array.from(element.children)) sanitizeClone(child, false)
      }
    }

    function clearHost(host) {
      if (host === null || host === undefined) return
      while (host.firstChild !== null && host.firstChild !== undefined) host.removeChild(host.firstChild)
    }

    function wrapCloneContent(clone) {
      const ownerDocument = clone?.ownerDocument
        || (typeof document === 'undefined' ? undefined : document)
      if (typeof ownerDocument?.createElement !== 'function') return null

      const content = ownerDocument.createElement('div')
      content.setAttribute?.('data-dsh-sticky-user-bubble-content', '')
      if (content.style !== undefined) {
        Object.assign(content.style, {
          boxSizing: 'border-box',
          minWidth: '0',
          maxWidth: '100%',
          pointerEvents: 'none'
        })
      }
      const nodes = clone.childNodes !== undefined
        ? Array.from(clone.childNodes)
        : Array.from(clone.children || [])
      for (const node of nodes) content.appendChild(node)
      clone.appendChild(content)
      return content
    }

    function cssPropertyName(property) {
      if (property.startsWith('Webkit')) {
        return `-webkit-${property.slice(6).replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`).replace(/^-+/u, '')}`
      }
      return property.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)
    }

    function setStyleValue(element, property, value, important = false) {
      if (element?.style === undefined) return
      if (typeof element.style.setProperty === 'function') {
        element.style.setProperty(cssPropertyName(property), String(value), important ? 'important' : '')
      } else {
        element.style[property] = String(value)
      }
    }

    function setCriticalStyles(element, values) {
      for (const [property, value] of Object.entries(values)) setStyleValue(element, property, value, true)
    }

    function rangeRectsOf(ownerDocument, node) {
      let range
      try {
        range = ownerDocument.createRange()
        range.selectNodeContents(node)
        return Array.from(range.getClientRects?.() || [])
      } catch {
        return []
      } finally {
        range?.detach?.()
      }
    }

    function textRectFragmentsOf(content, ownerDocument) {
      if (typeof ownerDocument.createTreeWalker === 'function') {
        const fragments = []
        try {
          const showText = ownerDocument.defaultView?.NodeFilter?.SHOW_TEXT || 4
          const walker = ownerDocument.createTreeWalker(content, showText)
          let textNode = walker.nextNode()
          let visited = 0
          while (textNode !== null && visited < MAX_LINE_TEXT_NODES) {
            if (/\S/u.test(textNode.nodeValue || '')) {
              fragments.push(...rangeRectsOf(ownerDocument, textNode))
            }
            textNode = walker.nextNode()
            visited += 1
          }
        } catch {
          // Fall through to a whole-content range on older DOM implementations.
        }
        if (fragments.length > 0) return fragments
      }
      return rangeRectsOf(ownerDocument, content)
    }

    function lineBoxesOf(content) {
      const ownerDocument = content?.ownerDocument
        || (typeof document === 'undefined' ? undefined : document)
      if (typeof ownerDocument?.createRange !== 'function') return []
      const contentRect = rectOf(content)
      if (contentRect === null) return []

      const rects = textRectFragmentsOf(content, ownerDocument)
        .filter((rect) => finiteDimension(rect.height) && Number.isFinite(rect.top) && Number.isFinite(rect.bottom))
        .sort((left, right) => left.top - right.top || (left.left || 0) - (right.left || 0))
      const lines = []
      for (const rect of rects) {
        const line = lines.find((candidate) => (
          rect.top < candidate.bottom - LINE_MERGE_EPSILON
          && rect.bottom > candidate.top + LINE_MERGE_EPSILON
        ))
        if (line === undefined) {
          lines.push({ top: rect.top, bottom: rect.bottom })
        } else {
          line.top = Math.min(line.top, rect.top)
          line.bottom = Math.max(line.bottom, rect.bottom)
        }
      }
      return lines.map((line) => ({
        top: line.top - contentRect.top,
        bottom: line.bottom - contentRect.top
      }))
    }

    function naturalCloneGeometry(content, pin) {
      const fallbackContentHeight = Math.max(
        1,
        pin.sourceHeight - pin.visualMetrics.verticalInset
      )
      const contentRect = rectOf(content)
      const scrollHeight = Number(content?.scrollHeight)
      const measuredContentHeight = Math.max(
        Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : 0,
        contentRect?.height || 0
      )
      const naturalContentHeight = measuredContentHeight > 0
        ? measuredContentHeight
        : fallbackContentHeight
      const lines = lineBoxesOf(content)
      const fallbackLimit = pin.visualMetrics.lineHeight * MAX_COLLAPSED_LINES
      const measuredLimit = lines.length > MAX_COLLAPSED_LINES
        ? lines[MAX_COLLAPSED_LINES].top - lines[0].top
        : lines.length === MAX_COLLAPSED_LINES
          ? lines[MAX_COLLAPSED_LINES - 1].bottom + Math.max(0, lines[0].top)
          : fallbackLimit
      const collapsedContentHeight = Math.max(
        pin.visualMetrics.lineHeight,
        Math.min(naturalContentHeight, measuredLimit)
      )
      const clamped = lines.length > MAX_COLLAPSED_LINES
        || naturalContentHeight > collapsedContentHeight + EPSILON
      const fullHeight = pin.visualMetrics.verticalInset + naturalContentHeight
      const collapsedHeight = pin.visualMetrics.verticalInset + collapsedContentHeight
      const expandedHeight = Math.min(
        fullHeight,
        Math.max(collapsedHeight, expansionRoomOf(pin))
      )
      return {
        clamped,
        collapsedContentHeight,
        collapsedHeight,
        expandedHeight,
        fullHeight,
        lineCount: lines.length,
        naturalContentHeight,
        viewportClamped: fullHeight > expandedHeight + EPSILON
      }
    }

    // Room the expanded bubble may occupy: the viewport, narrowed by the space the next user
    // card reserves. `collapsedHeight` stays the floor, so a card already inside the
    // footprint means the hovered bubble simply stays collapsed — it never grows over it.
    function expansionRoomOf(pin) {
      return Number.isFinite(pin?.expansionRoom) ? pin.expansionRoom : pin?.availableHeight
    }

    // Re-derive the expanded height for a newer pin without re-measuring the clone: only the
    // free room changes while the next user card approaches.
    function withExpansionRoom(geometry, pin) {
      const expandedHeight = Math.min(
        geometry.fullHeight,
        Math.max(geometry.collapsedHeight, expansionRoomOf(pin))
      )
      return {
        ...geometry,
        expandedHeight,
        viewportClamped: geometry.fullHeight > expandedHeight + EPSILON
      }
    }

    function compatibleRootLayout(pin) {
      const display = String(pin.visual.display || '').toLowerCase()
      const writingMode = String(pin.visual.writingMode || '').toLowerCase()
      if (writingMode !== '' && writingMode !== 'horizontal-tb') return 'unsupported-writing-mode'
      if (display.includes('flex') || display.includes('grid') || display.includes('table')) return 'unsupported-root-display'
      if (String(pin.visualMetrics.transform || '').toLowerCase() !== 'none') return 'unsupported-transform'
      const zoom = Number.parseFloat(pin.visualMetrics.zoom)
      if (Number.isFinite(zoom) && Math.abs(zoom - 1) > EPSILON / 100) return 'unsupported-zoom'
      return null
    }

    function containsNode(parent, node) {
      if (parent === null || parent === undefined || node === null || node === undefined) return false
      if (typeof parent.contains === 'function') return parent.contains(node)
      let current = node
      while (current !== null && current !== undefined) {
        if (current === parent) return true
        current = current.parentElement
      }
      return false
    }

    function cloneCompatibilityState(clone, content, pin, geometry) {
      const layoutFailure = compatibleRootLayout(pin)
      if (layoutFailure !== null) return layoutFailure
      if (!containsNode(pin.flow, pin.source)) return 'detached-source'
      if (!finiteDimension(geometry.fullHeight) || !finiteDimension(geometry.collapsedHeight)) return 'invalid-height'
      const cloneRect = rectOf(clone)
      if (cloneRect === null || Math.abs(cloneRect.width - pin.width) > 2) return 'width-mismatch'
      const contentRect = rectOf(content)
      const expectedContentWidth = Math.max(1, pin.width - pin.visualMetrics.horizontalInset)
      if (contentRect !== null && Math.abs(contentRect.width - expectedContentWidth) > 4) return 'content-width-mismatch'
      if (geometry.clamped && geometry.collapsedContentHeight < pin.visualMetrics.lineHeight - EPSILON) return 'invalid-line-limit'
      if (content === null || content === undefined) return 'missing-content'
      return 'ready'
    }

    function setHostState(host, state) {
      if (host === null || host === undefined) return
      if (state === null) host.removeAttribute?.('data-dsh-sticky-user-bubble-state')
      else host.setAttribute?.('data-dsh-sticky-user-bubble-state', state)
    }

    function setCloneExpanded(clone, content, pin, geometry, expanded) {
      if (clone?.style === undefined || content?.style === undefined) return
      // Expanding only makes sense while the extra height really fits: a bubble whose room is
      // taken by the next user card keeps its three-line presentation instead of turning into
      // a sliver-high internal scroller.
      const expandable = expanded && geometry.expandedHeight > geometry.collapsedHeight + EPSILON
      const showFull = expandable || !geometry.clamped
      const targetHeight = showFull ? geometry.expandedHeight : geometry.collapsedHeight
      const scrollable = expandable && geometry.viewportClamped
      setCriticalStyles(clone, {
        height: `${targetHeight}px`,
        maxHeight: `${targetHeight}px`,
        display: pin.visual.display,
        // The bubble itself never scrolls: the copied padding and rounded corners stay intact
        // and the scrollbar of a capped expansion lives inside the content instead.
        overflow: showFull ? (scrollable ? 'hidden' : pin.visual.overflow) : 'hidden',
        overflowX: showFull && !scrollable ? pin.visual.overflowX : 'hidden',
        overflowY: showFull && !scrollable ? pin.visual.overflowY : 'hidden',
        textOverflow: pin.visual.textOverflow,
        WebkitBoxOrient: 'initial',
        WebkitLineClamp: 'unset'
      })

      const contentHeight = Math.max(1, targetHeight - pin.visualMetrics.verticalInset)
      setCriticalStyles(content, {
        height: showFull ? (scrollable ? `${contentHeight}px` : 'auto') : `${geometry.collapsedContentHeight}px`,
        maxHeight: showFull ? (scrollable ? `${contentHeight}px` : 'none') : `${geometry.collapsedContentHeight}px`,
        display: showFull ? 'block' : '-webkit-box',
        // `overflow-y: visible` next to a clipped axis would compute to `auto`, so the full
        // non-scrollable case keeps the bubble's own axis values (both `visible`).
        overflow: showFull && !scrollable ? 'visible' : 'hidden',
        overflowX: showFull && !scrollable ? pin.visual.overflowX : 'hidden',
        overflowY: scrollable ? 'auto' : (showFull ? pin.visual.overflowY : 'hidden'),
        // A `pointer-events: none` scroller can receive neither wheel scrolling nor a
        // scrollbar drag, so the wrapper becomes an input target exactly while it owns the
        // inner scrollbar. Copied descendants stay inert and clicks still bubble to the
        // clone root, so hovering and jumping are unaffected.
        pointerEvents: scrollable ? 'auto' : 'none',
        textOverflow: showFull ? 'clip' : 'ellipsis',
        WebkitBoxOrient: showFull ? 'initial' : 'vertical',
        WebkitLineClamp: showFull ? 'unset' : String(MAX_COLLAPSED_LINES)
      })
      if (scrollable) {
        // DSH dims the thumb to `l2` for scroll areas inside a card (the composer card does
        // the same), so the inner scrollbar does not stand out against the bubble surface.
        setStyleValue(content, '--dsh-scrollbar-thumb', 'var(--dsw-alias-scrollbar-bg-l2)', true)
        setStyleValue(content, '--dsh-scrollbar-thumb-hover', 'var(--dsw-alias-scrollbar-hover-l2)', true)
      }
    }

    function jumpToOriginal(pin) {
      const target = rectOf(pin.source) === null ? pin.row : pin.source
      const targetRect = rectOf(target)
      const scrollRect = rectOf(pin.scroll)
      const currentScrollTop = pin.scroll?.scrollTop
      if (targetRect !== null && scrollRect !== null && Number.isFinite(currentScrollTop)) {
        const flow = visibleFlow(pin.scroll)
        const edge = scrollRect.top + readingInset(flow, pin.scroll)
        const top = Math.max(0, currentScrollTop + targetRect.top - edge)
        if (typeof pin.scroll.scrollTo === 'function') {
          try {
            pin.scroll.scrollTo({ top, behavior: 'smooth' })
            return
          } catch {}
        }
        try {
          pin.scroll.scrollTop = top
          return
        } catch {}
      }
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }

    // The clone is only moved while it yields to the next user card, never rebuilt:
    // re-measuring the whole bubble on every scroll frame would jitter. Only the clone's
    // layout origin and the clip at the scrollport edge change, so both stay cheap
    // `!important` writes on the already rendered clone.
    function applyCloneOffset(host, pin) {
      const clone = host?.firstChild
      if (clone?.style === undefined) return
      const push = Number.isFinite(pin.push) && pin.push > 0 ? pin.push : 0
      const inset = Number.isFinite(pin.inset) && pin.inset > 0 ? pin.inset : 0
      const clipped = Math.max(0, push - inset)
      setStyleValue(clone, 'top', `${pin.top - push}px`, true)
      setStyleValue(clone, 'clipPath', clipped > EPSILON ? `inset(${clipped}px 0 0 0)` : 'none', true)
    }

    function renderPinnedClone(host, pin, stateRef) {
      if (host === null || host === undefined) return false
      const state = stateRef?.current ?? null
      // A rebuild replaces the mounted clone, so the pointer/keyboard expansion intent is
      // captured here and handed to its successor. Without that, every remeasure while the
      // answer streams collapses the hovered bubble, and the browser's own hover recompute
      // expands the fresh clone again — a collapse/expand flicker on every update.
      const hovered = state?.hovered === true
      const focused = state?.focused === true
      // Nothing of ours is mounted from here on: a clone that is built later starts neutral
      // unless it is told otherwise at the end of this function.
      if (state !== null) {
        state.update = null
        state.hovered = false
        state.focused = false
      }
      clearHost(host)
      if (pin === null) {
        setHostState(host, null)
        return true
      }
      if (pin.failure !== undefined) {
        setHostState(host, pin.failure)
        return pin.failure.startsWith('inactive-')
      }
      if (pin.source === null || typeof pin.source.cloneNode !== 'function') {
        setHostState(host, 'missing-source')
        return false
      }
      const layoutFailure = compatibleRootLayout(pin)
      if (layoutFailure !== null) {
        setHostState(host, layoutFailure)
        return false
      }

      let clone
      try {
        clone = pin.source.cloneNode(true)
      } catch {
        setHostState(host, 'clone-failed')
        return false
      }
      copyDescendantStyles(pin.source, clone)
      sanitizeClone(clone)
      const content = wrapCloneContent(clone)
      if (content === null) {
        setHostState(host, 'missing-content')
        return false
      }

      applyStyleValues(clone, pin.visual)
      setCriticalStyles(clone, {
        boxSizing: 'border-box',
        position: 'absolute',
        left: `${pin.left}px`,
        top: `${pin.top}px`,
        width: `${pin.width}px`,
        height: 'auto',
        maxWidth: 'none',
        maxHeight: 'none',
        minWidth: '0',
        minHeight: '0',
        margin: '0',
        overflow: 'visible',
        pointerEvents: 'none',
        visibility: 'hidden',
        userSelect: 'none',
        zIndex: '1'
      })
      setCriticalStyles(content, {
        height: 'auto',
        maxHeight: 'none',
        display: 'block',
        overflow: 'visible',
        pointerEvents: 'none'
      })
      clone.setAttribute?.('data-dsh-sticky-user-bubble-clone', '')
      host.appendChild(clone)

      const geometry = naturalCloneGeometry(content, pin)
      const compatibilityState = cloneCompatibilityState(clone, content, pin, geometry)
      if (compatibilityState !== 'ready') {
        clearHost(host)
        setHostState(host, compatibilityState)
        return false
      }

      clone.removeAttribute?.('aria-hidden')
      clone.removeAttribute?.('inert')
      clone.setAttribute?.('role', 'button')
      clone.setAttribute?.('tabindex', '0')
      clone.setAttribute?.('aria-label', JUMP_TITLE)
      clone.setAttribute?.('title', JUMP_TITLE)

      let pointerInside = hovered
      let keyboardFocus = focused
      let activePin = pin
      const rememberIntent = () => {
        if (state === null) return
        state.hovered = pointerInside
        state.focused = keyboardFocus
      }
      const updateExpanded = () => setCloneExpanded(
        clone,
        content,
        activePin,
        withExpansionRoom(geometry, activePin),
        pointerInside || keyboardFocus
      )
      clone.addEventListener?.('mouseenter', () => {
        pointerInside = true
        rememberIntent()
        updateExpanded()
      })
      clone.addEventListener?.('mouseleave', () => {
        pointerInside = false
        rememberIntent()
        updateExpanded()
      })
      clone.addEventListener?.('focus', () => {
        keyboardFocus = true
        rememberIntent()
        updateExpanded()
      })
      clone.addEventListener?.('blur', () => {
        keyboardFocus = false
        rememberIntent()
        updateExpanded()
      })
      clone.addEventListener?.('click', (event) => {
        event.preventDefault?.()
        event.stopPropagation?.()
        jumpToOriginal(activePin)
      })
      clone.addEventListener?.('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
        event.preventDefault?.()
        event.stopPropagation?.()
        jumpToOriginal(activePin)
      })
      if (keyboardFocus) {
        // Keyboard expansion has to move to the rebuilt node, otherwise no `blur` can end it.
        try {
          clone.focus?.({ preventScroll: true })
        } catch {
          keyboardFocus = false
        }
      }
      rememberIntent()
      updateExpanded()
      applyCloneOffset(host, pin)
      setCriticalStyles(clone, {
        cursor: 'pointer',
        pointerEvents: 'auto',
        touchAction: 'manipulation',
        visibility: 'visible'
      })
      // Keep an already expanded bubble inside the free room as the next card approaches:
      // the measurement loop hands each newer pin to the rendered clone instead of
      // rebuilding it, so hovering survives the yield and can never cover that card.
      if (state !== null) {
        state.update = (next) => {
          activePin = next
          if (pointerInside || keyboardFocus) updateExpanded()
        }
      }
      setHostState(host, 'ready')
      return true
    }

    function usePinnedMeasurement(currentId, userIndex) {
      const overlayRef = React.useRef(null)
      const copyHostRef = React.useRef(null)
      const modelRef = React.useRef(userIndex)
      const refreshRef = React.useRef(null)
      modelRef.current = userIndex

      React.useEffect(() => {
        let disposed = false
        let scroll = null
        let currentPin = null
        // Shared with the rendered clone: the in-place pin updater (null while nothing is
        // mounted) plus the pointer/keyboard expansion intent, which has to outlive the clone
        // rebuilds that streaming updates trigger.
        const cloneStateRef = { current: { update: null, hovered: false, focused: false } }
        let frameId = null
        let timeoutId = null
        let forceMeasure = false
        let resizeObserver = null
        let structureMutationObserver = null
        let sourceMutationObserver = null
        let styleMutationObserver = null
        let observedFlow = null
        let observedSource = null
        let observedSourceRoot = null
        const viewport = viewportOf()
        const visualViewport = viewport?.visualViewport
        const fontSet = typeof document === 'undefined' ? undefined : document.fonts

        const observeSource = (next, root) => {
          if (next === observedSource && root === observedSourceRoot) return
          if (observedSource !== null) resizeObserver?.unobserve(observedSource)
          sourceMutationObserver?.disconnect()
          observedSource = next
          observedSourceRoot = root
          if (observedSource === null) return
          resizeObserver?.observe(observedSource)
          const attributeFilter = ['class', 'style', 'dir', 'hidden', 'data-theme', 'data-ds-dark-theme']
          sourceMutationObserver?.observe(observedSource, {
            attributes: true,
            attributeFilter,
            characterData: true,
            childList: true,
            subtree: true
          })
          let ancestor = observedSource.parentElement
          let visited = 0
          while (ancestor !== null && ancestor !== undefined && visited < MAX_SOURCE_ANCESTORS) {
            sourceMutationObserver?.observe(ancestor, { attributes: true, attributeFilter })
            if (ancestor === observedSourceRoot) break
            ancestor = ancestor.parentElement
            visited += 1
          }
        }

        const measure = (forced) => {
          if (disposed) return
          const next = measurePinned(scroll, overlayRef.current, modelRef.current)
          observeSource(next?.source || null, next?.scroll || null)
          if (!forced && samePin(currentPin, next)) {
            // `samePin` intentionally ignores `push`/`expansionRoom`: yielding to the next
            // user card only moves the rendered clone and re-caps its expanded height, so
            // keep the clone (and the hover state) and update it in place.
            if (next !== null && next.failure === undefined) {
              applyCloneOffset(copyHostRef.current, next)
              cloneStateRef.current.update?.(next)
            }
            currentPin = next
            return
          }
          currentPin = next
          renderPinnedClone(copyHostRef.current, next, cloneStateRef)
        }

        const runMeasure = () => {
          frameId = null
          timeoutId = null
          const forced = forceMeasure
          forceMeasure = false
          measure(forced)
        }

        const schedule = (force = false) => {
          if (disposed) return
          if (force) forceMeasure = true
          if (frameId !== null || timeoutId !== null) return
          if (viewport !== undefined && typeof viewport.requestAnimationFrame === 'function') {
            frameId = viewport.requestAnimationFrame(runMeasure)
          } else {
            timeoutId = setTimeout(runMeasure, 0)
          }
        }
        const onScroll = () => schedule(false)
        const onResize = () => schedule(true)
        // A resized scrollport, flow or source bubble is re-measured through the ordinary pin
        // comparison, which rebuilds the clone whenever any measured geometry or style really
        // changed. Forcing it instead would rebuild the clone — and drop the hovered expansion —
        // on every token of a streaming answer, because that keeps resizing the flow.
        const onLayoutChange = () => schedule(false)

        const observeScroll = (next) => {
          const nextFlow = visibleFlow(next)
          if (next === scroll && nextFlow === observedFlow) return
          if (scroll !== null) scroll.removeEventListener('scroll', onScroll)
          if (scroll !== null) resizeObserver?.unobserve(scroll)
          if (observedFlow !== null) resizeObserver?.unobserve(observedFlow)
          scroll = next
          observedFlow = nextFlow
          if (scroll !== null) scroll.addEventListener('scroll', onScroll, { passive: true })
          if (scroll !== null) resizeObserver?.observe(scroll)
          if (observedFlow !== null) resizeObserver?.observe(observedFlow)
        }

        const refresh = (force = true) => {
          observeScroll(findConversationScroll(modelRef.current))
          schedule(force)
        }
        const mutationOutsideCloneHost = (records) => {
          const host = copyHostRef.current
          return Array.from(records || []).some((record) => (
            host === null || host === undefined || !containsNode(host, record.target)
          ))
        }
        refreshRef.current = refresh

        if (typeof document !== 'undefined') {
          if (typeof ResizeObserver !== 'undefined') resizeObserver = new ResizeObserver(onLayoutChange)
          if (typeof MutationObserver !== 'undefined') {
            structureMutationObserver = new MutationObserver((records) => {
              if (mutationOutsideCloneHost(records)) refresh(false)
            })
            sourceMutationObserver = new MutationObserver(() => schedule(true))
            styleMutationObserver = new MutationObserver(() => schedule(true))
          }
          const observationRoot = document.body || document.documentElement
          if (observationRoot !== undefined) {
            structureMutationObserver?.observe(observationRoot, { childList: true, subtree: true })
          }
          const themeTargets = [document.documentElement, document.body]
            .filter((target, index, values) => target !== undefined && target !== null && values.indexOf(target) === index)
          for (const target of themeTargets) {
            styleMutationObserver?.observe(target, {
              attributes: true,
              attributeFilter: ['class', 'style', 'dir', 'data-theme', 'data-ds-dark-theme']
            })
          }
          if (document.head !== undefined && document.head !== null) {
            styleMutationObserver?.observe(document.head, {
              attributes: true,
              attributeFilter: ['class', 'style', 'href', 'media', 'disabled'],
              characterData: true,
              childList: true,
              subtree: true
            })
          }
          fontSet?.addEventListener?.('loadingdone', onResize)
          fontSet?.ready?.then?.(() => schedule(true)).catch?.(() => {})
          refresh(true)
        }
        viewport?.addEventListener?.('resize', onResize)
        visualViewport?.addEventListener?.('resize', onResize)
        schedule(true)

        return () => {
          disposed = true
          refreshRef.current = null
          cloneStateRef.current.update = null
          cloneStateRef.current.hovered = false
          cloneStateRef.current.focused = false
          if (frameId !== null && viewport !== undefined && typeof viewport.cancelAnimationFrame === 'function') viewport.cancelAnimationFrame(frameId)
          if (timeoutId !== null) clearTimeout(timeoutId)
          if (scroll !== null) scroll.removeEventListener('scroll', onScroll)
          structureMutationObserver?.disconnect()
          sourceMutationObserver?.disconnect()
          styleMutationObserver?.disconnect()
          resizeObserver?.disconnect()
          fontSet?.removeEventListener?.('loadingdone', onResize)
          viewport?.removeEventListener?.('resize', onResize)
          visualViewport?.removeEventListener?.('resize', onResize)
          clearHost(copyHostRef.current)
          setHostState(copyHostRef.current, null)
          currentPin = null
          observedSource = null
          observedSourceRoot = null
        }
      }, [currentId])

      React.useEffect(() => {
        refreshRef.current?.(false)
      }, [currentId, userIndex])

      return { overlayRef, copyHostRef }
    }

    // The Session list moved its navigation cell between DSH 0.1.6 alphas: `state.current`
    // exists through alpha.1, while alpha.2 drops it and derives the main-view Session from
    // the `mainView` retention count — the same shape the shell's own title/panel code reads.
    function currentSessionIdOf(state) {
      if (state === undefined || state === null) return undefined
      if (typeof state.current === 'string' && state.current !== '') return state.current
      const byId = state.byId
      if (byId === null || typeof byId !== 'object') return undefined
      for (const summary of Object.values(byId)) {
        if (summary === null || summary === undefined) continue
        const retainedBy = summary.retainedBy
        if (retainedBy === null || retainedBy === undefined) continue
        if ((retainedBy.mainView ?? 0) > 0 && typeof summary.id === 'string') return summary.id
      }
      return undefined
    }

    function createStickyUserBubbleOverlay(sessions, uiConversation) {
      return function StickyUserBubbleOverlay({ useSessions }) {
        const currentId = useSessions(currentSessionIdOf)
        let binding
        let session
        let chatSource = EMPTY_CHAT_SOURCE
        if (currentId !== undefined && currentId !== null) {
          try {
            binding = sessions.binding(currentId)
            session = binding?.session
            const conversation = typeof uiConversation?.binding === 'function'
              ? uiConversation.binding(currentId)
              : undefined
            const target = conversation?.target?.('chat')
            if (target !== undefined
              && target !== null
              && typeof target.subscribe === 'function'
              && typeof target.getSnapshot === 'function') {
              chatSource = target
            }
          } catch {
            binding = undefined
            session = undefined
            chatSource = EMPTY_CHAT_SOURCE
          }
        }
        const source = session !== undefined
          && typeof session.subscribe === 'function'
          && typeof session.getSnapshot === 'function'
          ? session
          : EMPTY_SESSION_SOURCE
        const subscribe = React.useCallback((callback) => source.subscribe(callback), [source])
        const getSnapshot = React.useCallback(() => source.getSnapshot(), [source])
        const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
        const subscribeChat = React.useCallback((callback) => chatSource.subscribe(callback), [chatSource])
        const getChatSnapshot = React.useCallback(() => chatSource.getSnapshot(), [chatSource])
        const chatSnapshot = React.useSyncExternalStore(subscribeChat, getChatSnapshot, getChatSnapshot)
        const activeSnapshot = snapshot !== undefined
          && snapshot !== null
          && snapshot.sessionId === currentId
          && snapshot.removed !== true
          && snapshot.openState === 'open'
          ? snapshot
          : undefined
        const userIndex = activeSnapshot === undefined
          ? new Map()
          : buildUserIndex(activeSnapshot, chatSnapshot)
        const measured = usePinnedMeasurement(currentId, userIndex)

        const layerStyle = {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 0
        }
        const hostStyle = {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }
        return React.createElement('div', {
          ref: measured.overlayRef,
          'data-dsh-sticky-user-bubble-layer': '',
          style: layerStyle
        }, React.createElement('div', {
          ref: measured.copyHostRef,
          'data-dsh-sticky-user-bubble-host': '',
          style: hostStyle
        }))
      }
    }

    const inject = ['slots', 'sessions', 'uiConversation']
    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: OVERLAY_ID, order: 0 },
        createStickyUserBubbleOverlay(ctx.sessions, ctx.uiConversation)
      ))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
