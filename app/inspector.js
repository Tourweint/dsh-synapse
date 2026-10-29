// The right-hand drawer: resize, open/close, and its contents.

function messagesForCard(card) {
  const thread = state.workspace?.threads.find(item => item.id === card.dshThreadId)
  if (thread === undefined) return { thread: null, messages: [] }
  const messages = messagesFor(thread)
  let turnIndex = -1
  let start = -1
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].kind !== 'user') continue
    turnIndex += 1
    if (turnIndex === card.turnIndex) {
      start = index
      break
    }
  }
  if (start === -1) return { thread, messages: [] }
  const end = messages.findIndex((message, index) => index > start && message.kind === 'user')
  return { thread, messages: messages.slice(start, end === -1 ? undefined : end) }
}

function inspectorProcessEntries(messages) {
  const entries = []
  for (const message of messages) {
    if (Array.isArray(message.process)) {
      entries.push(...message.process.map(entry => ({ ...entry })))
      continue
    }
    if (message.kind === 'tool') {
      entries.push({ name: processSummary(message.text), arguments: message.text, status: 'pending' })
      continue
    }
    if (message.kind === 'tool-result') {
      const previous = entries.at(-1)
      if (previous !== undefined && processState(previous) === 'pending') {
        previous.status = 'done'
        previous.result = message.text
      } else entries.push({ name: '工具结果', arguments: null, status: 'done', result: message.text })
    }
  }
  return entries
}

function inspectorMaxWidth() {
  const pane = document.querySelector('.main-stage')
  const available = pane instanceof HTMLElement && pane.clientWidth > 0 ? pane.clientWidth : window.innerWidth
  return Math.max(INSPECTOR_WIDTH_MIN, Math.min(INSPECTOR_WIDTH_MAX, Math.round(available * INSPECTOR_WIDTH_MAX_RATIO)))
}

function clampInspectorWidth(width) {
  const value = Number.isFinite(width) ? width : INSPECTOR_WIDTH_DEFAULT
  return Math.min(inspectorMaxWidth(), Math.max(INSPECTOR_WIDTH_MIN, Math.round(value)))
}

function persistInspectorWidth() {
  try { localStorage.setItem(INSPECTOR_WIDTH_KEY, String(state.inspectorWidth)) } catch { /* Private browsing may disable local storage. */ }
}

function renderCardInspector(card) {
  if (card === undefined) return ''
  const { thread, messages } = messagesForCard(card)
  if (thread === null) return ''
  const process = inspectorProcessEntries(messages)
  const answer = card.answer === null
    ? card.error !== null ? '' : `<p class="card-inspector-pending">${card.closed === true ? '本轮没有正文' : '等待助手回复'}</p>`
    : card.answer.text.trim() === '' && card.answer.pending !== true
      // A closed turn with no prose: the records below are the whole answer.
      ? '<p class="card-inspector-pending">本轮没有正文</p>'
      : `<article class="card-inspector-answer md">${renderMarkdown(card.answer.text)}${card.answer.pending ? '<p class="card-inspector-pending">正在回复</p>' : ''}</article>`
  const error = card.error === null ? '' : `<section class="card-inspector-error" role="alert"><strong>本轮未完成</strong><p>${escapeHtml(card.error.text)}</p></section>`
  // Tool calls are shown, not hidden behind one more fold: the drawer lists the
  // turn's calls under a 「工具调用」label, each row already open with its
  // arguments and result — the payload is the point, the row header only names it.
  const processRecordsHtml = process.length === 0 ? '' : `<section class="card-inspector-process"><p class="card-inspector-section">工具调用</p>${processEntries(process, `${thread.id}:${card.id}:inspector`, { openByDefault: true })}</section>`
  const continueAction = card.canContinue === true ? `<button type="button" data-action="open-continue" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 3.5h11v7h-6l-3.5 2.5v-2.5h-1.5Z"/><path d="M8 5.5v3M6.5 7h3"/></svg>继续追问</button>` : ''
  const branch = Number.isInteger(card.answer?.sourceSeq)
    ? `<button type="button" data-action="open-branch" data-thread="${thread.id}" data-card="${escapeHtml(card.id)}" data-seq="${card.answer.sourceSeq}"><svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="4" cy="3.5" r="1.5"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><path d="M5.5 3.5h2A2.5 2.5 0 0 1 10 6v5"/></svg>创建分支</button>`
    : ''
  const openDshAction = `<button class="primary" type="button" data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(card.answer?.sourceSeq) ? card.answer.sourceSeq : ''}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 3.5h3v3M12.4 3.6 7.5 8.5"/></svg>在 DSH 中打开</button>`
  const width = clampInspectorWidth(state.inspectorWidth)
  state.inspectorWidth = width
  // The resizer is a real control: it is focusable, reports its range, and
  // answers the arrow keys, so the drawer is not mouse-only.
  return `<aside class="card-inspector${state.inspectorOpening ? ' is-opening' : ''}" aria-label="卡片详情" data-inspector-card="${escapeHtml(card.id)}" style="--inspector-width:${width}px">
    <div class="card-inspector-resizer" role="separator" aria-orientation="vertical" aria-label="拖动调整详情面板宽度" aria-valuemin="${INSPECTOR_WIDTH_MIN}" aria-valuemax="${inspectorMaxWidth()}" aria-valuenow="${width}" tabindex="0" title="拖动调整宽度（双击复位）"></div>
    <header class="card-inspector-head"><div class="card-inspector-headrow"><div class="card-inspector-meta"><span>第 ${card.turnIndex + 1} 轮</span>${process.length > 0 ? `<span>工具 ${process.length}</span>` : ''}${card.error === null ? '' : '<span class="card-inspector-error-status">失败</span>'}</div><button class="card-inspector-close" type="button" data-action="close-card-inspector" aria-label="关闭卡片详情" title="关闭"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></div><h2 title="${escapeHtml(card.question)}">${escapeHtml(card.question)}</h2></header>
    <div class="card-inspector-scroll"><p class="card-inspector-section">回答</p>${error}${answer}${processRecordsHtml}</div>
    <footer class="card-inspector-actions">${continueAction}${branch}${openDshAction}</footer>
  </aside>`
}

/* ── Inspector width: drag the left edge ───────────────────────────────────
   The drawer is docked to the right, so dragging its edge left makes it wider
   (the width is `start - dx`). Widths are clamped between MIN and MAX, and MAX
   itself shrinks with the pane so the drawer can never swallow the map. */
function installInspectorResizer() {
  const aside = document.querySelector('.card-inspector')
  const resizer = aside instanceof HTMLElement ? aside.querySelector('.card-inspector-resizer') : null
  if (!(aside instanceof HTMLElement) || !(resizer instanceof HTMLElement) || resizer.dataset.bound === '1') return
  resizer.dataset.bound = '1'
  const apply = width => {
    state.inspectorWidth = width
    // A custom property, not `width`: the narrow-viewport rules turn the drawer
    // into a bottom sheet by re-declaring the same variable.
    aside.style.setProperty('--inspector-width', `${width}px`)
    resizer.setAttribute('aria-valuenow', String(width))
  }
  resizer.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = aside.getBoundingClientRect().width || state.inspectorWidth
    // Pointer capture keeps the drag alive when the cursor leaves the 11px
    // strip; environments without it (jsdom) still resize on the captured
    // element's own events.
    if (typeof resizer.setPointerCapture === 'function') resizer.setPointerCapture(event.pointerId)
    aside.classList.add('is-resizing')
    state.canvasGesture = true
    let frame = 0
    let pending = null
    const paint = () => {
      frame = 0
      if (pending === null) return
      apply(pending)
      pending = null
    }
    const move = moveEvent => {
      pending = clampInspectorWidth(startWidth - (moveEvent.clientX - startX))
      if (frame === 0) frame = window.requestAnimationFrame(paint)
    }
    const stop = () => {
      resizer.removeEventListener('pointermove', move)
      resizer.removeEventListener('pointerup', stop)
      resizer.removeEventListener('pointercancel', stop)
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
      paint()
      aside.classList.remove('is-resizing')
      state.canvasGesture = false
      persistInspectorWidth()
      deferCanvasRefresh(120)
    }
    resizer.addEventListener('pointermove', move)
    resizer.addEventListener('pointerup', stop)
    resizer.addEventListener('pointercancel', stop)
  })
  // Losing the pointer or the window mid-drag must not leave the class behind.
  resizer.addEventListener('lostpointercapture', () => aside.classList.remove('is-resizing'))
  resizer.addEventListener('dblclick', () => {
    apply(clampInspectorWidth(INSPECTOR_WIDTH_DEFAULT))
    persistInspectorWidth()
  })
  resizer.addEventListener('keydown', keyEvent => {
    const step = keyEvent.shiftKey ? 60 : 20
    if (keyEvent.key !== 'ArrowLeft' && keyEvent.key !== 'ArrowRight') return
    keyEvent.preventDefault()
    // Left widens the drawer, mirroring the drag direction.
    apply(clampInspectorWidth(state.inspectorWidth + (keyEvent.key === 'ArrowLeft' ? step : -step)))
    persistInspectorWidth()
  })
}

window.addEventListener('resize', () => {
  const aside = document.querySelector('.card-inspector')
  if (!(aside instanceof HTMLElement)) return
  const width = clampInspectorWidth(state.inspectorWidth)
  state.inspectorWidth = width
  aside.style.setProperty('--inspector-width', `${width}px`)
})

let inspectorCloseTimer = 0
function openCardInspector(cardId) {
  if (inspectorCloseTimer !== 0) {
    window.clearTimeout(inspectorCloseTimer)
    inspectorCloseTimer = 0
  }
  state.inspectorOpening = state.inspectorCardId === null
  state.inspectorCardId = cardId
}

function closeCardInspector({ animate = true } = {}) {
  if (state.inspectorCardId === null) return
  if (inspectorCloseTimer !== 0) window.clearTimeout(inspectorCloseTimer)
  const cardId = state.inspectorCardId
  const inspector = document.querySelector('.card-inspector')
  if (!animate || !(inspector instanceof HTMLElement)) {
    state.inspectorCardId = null
    state.inspectorOpening = false
    render()
    return
  }
  inspector.classList.add('is-closing')
  inspectorCloseTimer = window.setTimeout(() => {
    inspectorCloseTimer = 0
    if (state.inspectorCardId !== cardId) return
    state.inspectorCardId = null
    state.inspectorOpening = false
    render()
  }, 180)
}
