// Dragging, zooming, and focusing the active card.

const CARD_DRAG_DELAY = 150
const CARD_DRAG_SLOP = 5

function bindCardDrag(card) {
  // Cards survive a render, so bind each one once.
  if (card.dataset.dragBound === '1') return
  card.dataset.dragBound = '1'
  card.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, textarea, input, select, label, a, form')) return
    const cardId = card.dataset.cardId
    if (cardId === undefined) return
    const origin = { x: event.clientX, y: event.clientY, position: { x: Number.parseFloat(card.style.left), y: Number.parseFloat(card.style.top) } }
    const aliases = card.dataset.positionKey === undefined ? [] : [card.dataset.positionKey]
    let position = origin.position
    let dragging = false
    let moved = false
    let stopped = false
    let frame = 0
    let holdTimer = 0

    const begin = () => {
      if (dragging || stopped) return
      dragging = true
      if (holdTimer !== 0) { window.clearTimeout(holdTimer); holdTimer = 0 }
      card.classList.add('is-dragging')
      state.dragging = true
    }
    // Coalesce pointermove updates to one DOM pass per animation frame so a
    // high report-rate pointer cannot queue a reflow per event.
    const apply = () => {
      frame = 0
      state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
      for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
      // Keep the virtualized data object in sync so viewport visibility and
      // connector paths track the live drag position.
      const dataCard = state.canvasCardsById?.get(cardId)
      if (dataCard !== undefined) dataCard.position = { x: position.x, y: position.y }
      card.style.left = `${position.x}px`
      card.style.top = `${position.y}px`
      refreshCardConnectors(cardId)
    }
    const move = moveEvent => {
      const dx = moveEvent.clientX - origin.x
      const dy = moveEvent.clientY - origin.y
      if (!dragging && Math.hypot(dx, dy) <= CARD_DRAG_SLOP) return
      if (!dragging) begin()
      moved = true
      position = { x: origin.position.x + dx / state.zoom, y: origin.position.y + dy / state.zoom }
      if (frame === 0) frame = window.requestAnimationFrame(apply)
    }
    const stop = () => {
      if (stopped) return
      stopped = true
      if (holdTimer !== 0) { window.clearTimeout(holdTimer); holdTimer = 0 }
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      if (!dragging) return
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
      card.classList.remove('is-dragging')
      state.dragging = false
      // A hold that never moved is a click, not a drag: releasing must not pin
      // the card to its current coordinates (a pinned card stops taking part in
      // the automatic layout).
      if (!moved) return
      apply()
      rememberCardPosition(cardId, position, aliases)
      deferCanvasRefresh(120)
      // No full render: only the dragged card's inline position and its
      // connectors changed; rebuilding the whole canvas on drop is the jank.
    }
    holdTimer = window.setTimeout(begin, CARD_DRAG_DELAY)
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })
}

function installDragging() {
  for (const card of document.querySelectorAll('.thread-card[data-card-id]:not(.draft-card)')) bindCardDrag(card)
}

function canvasViewport(target) {
  return target instanceof Element ? target.closest('.canvas-viewport') : null
}

/* ── Zoom animation ────────────────────────────────────────────────────────
   A zoom used to be one assignment: the button moved 10% in a single frame and
   the map teleported. Now every gesture only records a *target*, and the live
   zoom chases it across the next frames. Three rules make that read as a push
   rather than as a transition:
   - the anchor (the world point under the cursor, or the viewport centre) is
     frozen when the gesture starts, and every frame keeps that point pinned, so
     the map expands out of the cursor instead of sliding;
   - progress is interpolated in log space, so the perceived speed is constant
     and 20%→400% does not crawl at the top end;
   - the chase is an exponential approach on a ~90ms time constant: no easing
     tail waiting to be sat through, and a second notch re-aims a frame later.
   `will-change: transform` is on for the length of the flight (compositor-only
   scaling, no per-frame re-raster of every card) and off at rest, so the final
   frame is rasterized crisply at the new scale. */
const ZOOM_MIN = .2
const ZOOM_MAX = 4
const ZOOM_TAU = 90
// Log-space distance at which the chase is considered arrived (0.15% of scale).
const ZOOM_SETTLE = .0015
let zoomFrame = 0
let zoomLastAt = 0
let zoomAnchor = null

function zoomContent() {
  const content = document.querySelector('.canvas-content')
  return content instanceof HTMLElement ? content : null
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Keep the header's zoom read-out in step with the chase, frame by frame. */
function syncZoomLabel() {
  const value = document.querySelector('.zoom-meter-value')
  if (value !== null) value.textContent = `${Math.round(state.zoom * 100)}%`
  const fill = document.querySelector('.zoom-meter-fill')
  if (fill instanceof HTMLElement) {
    const ratio = ((Math.log(state.zoom) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))) * 100
    fill.style.width = `${Math.max(0, Math.min(100, Math.round(ratio)))}%`
  }
}

/** Place the camera so the anchor's world point stays under the anchor. */
function applyZoomFrame(zoom, anchor) {
  state.zoom = zoom
  state.canvasCamera = { x: anchor.localX - anchor.worldX * zoom, y: anchor.localY - anchor.worldY * zoom }
  applyCanvasTransform()
  syncCanvasViewport()
  syncZoomLabel()
}

function stopZoomAnimation() {
  if (zoomFrame !== 0) { window.cancelAnimationFrame(zoomFrame); zoomFrame = 0 }
  zoomAnchor = null
  zoomLastAt = 0
}

/** Jump to the target and give the layer its raster back. */
function settleZoom() {
  const anchor = zoomAnchor
  stopZoomAnimation()
  if (anchor === null) state.zoom = state.zoomTarget
  else applyZoomFrame(state.zoomTarget, anchor)
  const content = zoomContent()
  if (content !== null) content.style.willChange = ''
  syncZoomLabel()
}

function zoomTick() {
  zoomFrame = 0
  const anchor = zoomAnchor
  if (anchor === null) return
  const now = performance.now()
  const elapsed = zoomLastAt === 0 ? 16 : Math.min(64, Math.max(1, now - zoomLastAt))
  zoomLastAt = now
  const from = Math.log(state.zoom)
  const delta = Math.log(state.zoomTarget) - from
  if (Math.abs(delta) < ZOOM_SETTLE) {
    settleZoom()
    return
  }
  applyZoomFrame(Math.exp(from + delta * (1 - Math.exp(-elapsed / ZOOM_TAU))), anchor)
  zoomFrame = window.requestAnimationFrame(zoomTick)
}

function zoomCanvas(viewport, nextZoom, clientX, clientY) {
  // 20% keeps a whole map readable as an overview; 400% is the detail ceiling.
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(nextZoom * 100) / 100))
  if (zoom === state.zoomTarget) return
  const bounds = viewport.getBoundingClientRect()
  const localX = clientX - bounds.left
  const localY = clientY - bounds.top
  // Measured against the *live* zoom so a re-aim mid-flight does not shift the
  // map; each new gesture re-anchors on the point the user is pointing at.
  zoomAnchor = {
    localX,
    localY,
    worldX: (localX - state.canvasCamera.x) / state.zoom,
    worldY: (localY - state.canvasCamera.y) / state.zoom,
  }
  state.zoomTarget = zoom
  syncZoomLabel()
  if (prefersReducedMotion()) {
    settleZoom()
    return
  }
  const content = zoomContent()
  if (content !== null) content.style.willChange = 'transform'
  if (zoomFrame === 0) {
    zoomLastAt = 0
    zoomFrame = window.requestAnimationFrame(zoomTick)
  }
}


function focusActiveCard() {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  const cards = state.canvasCards
  if (cards === undefined || cards.length === 0) return
  // Focusing sets the camera outright, so any zoom flight has to be over before
  // its anchor would fight this position on the next frame.
  if (zoomFrame !== 0 || zoomAnchor !== null) settleZoom()
  // Drafts win over the active conversation's latest turn; fall back to the
  // first card. Cards may be unmounted (outside the viewport), so the focus
  // target comes from the data model, never from DOM queries.
  const draft = state.draft === null ? undefined
    : state.draft.kind === 'new' ? { position: { x: 86, y: 82 } } : draftPlacement(cards)
  const activeCards = state.activeId === null || state.activeId === undefined ? [] : cards.filter(card => card.dshThreadId === state.activeId)
  const card = draft ?? activeCards.at(-1) ?? cards[0]
  const { x: left, y: top } = card.position
  const bounds = viewport.getBoundingClientRect()
  state.canvasCamera = {
    x: bounds.width / 2 - (left + CARD_WIDTH / 2) * state.zoom,
    y: bounds.height / 2 - (top + cardHeight(card) / 2) * state.zoom,
  }
  applyCanvasTransform()
  syncCanvasViewport()
}
