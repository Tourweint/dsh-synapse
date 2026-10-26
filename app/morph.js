// The in-place DOM patcher that makes `render()` cheap.

// --- DOM morphing ---------------------------------------------------------
// The canvas re-renders on every projection tick and on every streamed chunk.
// Assigning `app.innerHTML` destroys the exact node the user is pressing, and a
// click is only dispatched when mousedown and mouseup share a target, so a
// rebuild in between silently swallows the click (W3C uievents #141). Morph the
// new markup into the live tree instead: matching nodes are patched in place and
// whatever sits under the pointer stays alive.

const MORPH_KEY_ATTRIBUTES = ['data-morph-key', 'data-card-id', 'data-thread', 'id']
// `data-thread` labels every control inside a card: the footer's 详情 / DSH /
// 归档 buttons and the card's 追问 / 分支 buttons all carry the same thread id.
// Used alone it is not a key — two siblings would match one live node, the
// second patch would overwrite the first, and the losing buttons would be
// dropped as unmatched. The action they trigger is what tells them apart.
const MORPH_KEY_DISCRIMINATORS = ['data-action', 'data-card', 'data-seq']

function morphKeyOf(node) {
  if (!(node instanceof Element)) return null
  for (const attribute of MORPH_KEY_ATTRIBUTES) {
    const value = node.getAttribute(attribute)
    if (value === null || value === '') continue
    const parts = [`${node.tagName}|${attribute}|${value}`]
    if (attribute === 'data-thread') {
      for (const extra of MORPH_KEY_DISCRIMINATORS) parts.push(node.getAttribute(extra) ?? '')
    }
    return parts.join('|')
  }
  return null
}

/** An element that owns the caret keeps its children untouched. */
function morphHoldsCaret(node) {
  if (!(node instanceof Element)) return false
  // Freeze exactly the element that holds the caret. Anything wider is fatal:
  // `node.contains(activeElement)` made `<main>` a caret owner as soon as the
  // composer or a draft textarea took focus, so every render skipped the whole
  // shell and the page stopped updating while the state kept changing — clicks
  // looked dead. A plain text selection must not freeze the canvas either.
  //
  // Only a text holder counts as a caret owner. A focused <button> holds no
  // caret, and freezing it stranded its attributes at the previous render's
  // values: clicking 对话 moved focus onto that tab, the tab was skipped, and
  // both tabs lost their highlight (same for any `active` toggle).
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  const tag = active.tagName
  const ownsText = active.isContentEditable === true || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  if (!ownsText) return false
  if (node === active) return true
  return active.isContentEditable === true && active.contains(node)
}

function morphNode(from, to) {
  if (from.nodeType !== to.nodeType) return replaceMorphed(from, to)
  if (from.nodeType === Node.TEXT_NODE || from.nodeType === Node.COMMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue
    return from
  }
  if (!(from instanceof Element) || !(to instanceof Element) || from.tagName !== to.tagName) {
    return replaceMorphed(from, to)
  }
  if (morphHoldsCaret(from)) return from
  for (const attribute of [...from.attributes]) {
    if (!to.hasAttribute(attribute.name)) from.removeAttribute(attribute.name)
  }
  for (const attribute of [...to.attributes]) {
    if (from.getAttribute(attribute.name) !== attribute.value) from.setAttribute(attribute.name, attribute.value)
  }
  morphChildren(from, to)
  return from
}

/** Swap one node for a copy of another and hand back the node now in the tree. */
function replaceMorphed(from, to) {
  const next = to.cloneNode(true)
  from.replaceWith(next)
  return next
}

function morphChildren(from, to) {
  const keyed = new Map()
  for (const child of [...from.childNodes]) {
    const key = morphKeyOf(child)
    if (key !== null && !keyed.has(key)) keyed.set(key, child)
  }
  const matched = new Set()
  let cursor = from.firstChild
  for (const next of [...to.childNodes]) {
    const key = morphKeyOf(next)
    let match = key === null ? null : keyed.get(key) ?? null
    // One live node may serve one slot only. Without this a duplicated key
    // would patch the same node twice and delete the leftovers.
    if (match !== null) keyed.delete(key)
    if (match === null && cursor !== null && morphKeyOf(cursor) === null) match = cursor
    if (match === null) {
      const inserted = next.cloneNode(true)
      from.insertBefore(inserted, cursor)
      matched.add(inserted)
      continue
    }
    if (match !== cursor) from.insertBefore(match, cursor)
    matched.add(morphNode(match, next))
    cursor = match.nextSibling
  }
  for (const child of [...from.childNodes]) {
    if (!matched.has(child)) from.removeChild(child)
  }
}

/** Patch `container`'s children to match `html` without discarding live nodes. */
function morphInto(container, html) {
  const template = document.createElement('template')
  template.innerHTML = html
  morphChildren(container, template.content)
}

/* ── Card drag: press-and-hold anywhere ────────────────────────────────────
   The card body is a summary, not text to read (the inspector has the real
   thing), so it no longer needs to be selectable — and a dedicated "..." handle
   above the card only added chrome. The whole card is the grip instead:
   - a held press (CARD_DRAG_DELAY) turns the gesture into a drag;
   - moving further than CARD_DRAG_SLOP before that also starts the drag, so it
     never feels stuck when the pointer is already travelling;
   - a plain click never reaches the drag path, so tapping a card still opens
     the inspector.
   `user-select: none` on `.thread-card` is what makes the hold usable: without
   it every drag attempt starts by selecting the summary text. */
