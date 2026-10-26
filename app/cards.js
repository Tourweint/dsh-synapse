// The card and draft markup on the canvas, and the canvas viewport.

/* Card glyphs, kept as constants so both card kinds use one definition. */
const CARD_ICON_DETAIL = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2 8.5 8 2.5l6 6V13.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5Z"/><path d="M6.2 14v-3.6a1.8 1.8 0 0 1 3.6 0V14"/></svg>'
const CARD_ICON_DSH = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 3.5h3v3M12.4 3.6 7.5 8.5"/></svg>'
const CARD_ICON_ARCHIVE = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5h11M5.5 7v5.5a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V7"/><path d="M4 5 5 2.8a.7.7 0 0 1 .6-.4h4.8a.7.7 0 0 1 .6.4L12 5M6 9.5h4"/></svg>'

/* Header action glyphs. The header cluster is the same component in both views
   (map toolbar / session actions), so every action carries one of these. */
const HEADER_ICON_LAYOUT = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>'
const HEADER_ICON_FOCUS = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v2.6M8 11.9v2.6M1.5 8h2.6M11.9 8h2.6"/></svg>'
const HEADER_ICON_ARRANGE = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.5" y="2" width="6.5" height="5" rx="1"/><rect x="6.5" y="9" width="7" height="5" rx="1"/></svg>'
const HEADER_ICON_BRANCH = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4.5 3v6a2.5 2.5 0 0 0 2.5 2.5H12"/><circle cx="4.5" cy="3" r="1.5"/><circle cx="11.5" cy="12" r="1.5"/></svg>'

/**
 * One card. `card.role` decides which half of the turn it carries and nothing
 * else crosses over: a question card holds the user's own words, an answer card
 * holds only the model's closing prose. No tool call, tool result or harness
 * context can reach either.
 */
function conversationCard(card, graph) {
  const selected = card.id === state.selectedCardId ? 'selected' : ''
  const expanded = card.expanded === true
  const isAnswer = card.role === 'answer'
  const expandLabel = expanded ? '收起卡片' : '展开卡片'
  const expandButton = `<button class="thread-card-expand" type="button" data-action="toggle-card-expanded" data-card="${escapeHtml(card.id)}" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="${expandLabel}" title="${expandLabel}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4 6.5 8 10.5 12 6.5"/></svg></button>`
  const childCount = graph.childCounts.get(card.id) ?? 0
  const collapsed = state.collapsedCardIds.has(card.id)
  const foldLabel = collapsed ? '展开后续对话' : '折叠后续对话'
  // The edge controls belong to the answer: a follow-up or a branch hangs off
  // what the model said, never off the question alone.
  const edgeControls = isAnswer ? [
    card.canContinue === true
      ? `<button class="graph-continue-button" data-action="open-continue" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" aria-label="添加追问" title="添加追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg></button>`
      : '',
    childCount === 0 || card.canContinue === true
      ? ''
      : `<button class="graph-fold-button${collapsed ? ' collapsed' : ''}" data-action="toggle-card-children" data-card="${escapeHtml(card.id)}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${foldLabel}" title="${foldLabel}"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 8h9"/>${collapsed ? '<path d="M8 3.5v9"/>' : ''}</svg></button>`,
    childCount === 0 || card.canContinue === true || !Number.isInteger(card.answer?.sourceSeq)
      ? ''
      : `<button class="graph-branch-button" data-action="open-branch" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" data-seq="${card.answer.sourceSeq}" aria-label="在新对话中分支" title="在新对话中分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z" fill="currentColor"/></svg></button>`,
  ].join('') : ''
  const meta = [`第 ${card.turnIndex + 1} 轮`, isAnswer && card.processCount > 0 ? `工具 ${card.processCount}` : '', card.error === null ? '' : '失败']
    .filter(item => item !== '')
    .map(item => `<span>${item}</span>`)
    .join('')
  let body
  if (!isAnswer) {
    // A native tooltip is the only hint a clamped question gets; keep it short,
    // otherwise a pasted log turns the hover into a wall of text.
    body = `<p class="thread-card-text is-question-text" title="${escapeHtml(clipText(card.question ?? '', 120))}">${escapeHtml(card.question ?? '等待用户提问')}</p>`
  } else if (card.error !== null) {
    body = `<p class="thread-card-text is-error">本轮失败：${escapeHtml(card.error.text)}</p>`
  } else if (card.answer === null) {
    body = '<p class="thread-card-text is-empty">等待助手回复</p>'
  } else if (card.answer.pending && card.answer.text === '') {
    body = '<p class="thread-card-text is-pending">正在回复…</p>'
  } else {
    const summary = answerSummary(card.answer.text)
    // No `title` here: the whole answer as a native tooltip was a giant
    // unrendered box. Clicking the card opens the inspector for the full text.
    body = `<p class="thread-card-text">${escapeHtml(summary === '' ? '（本轮没有文字回答）' : summary)}${card.answer.pending ? '<span class="thread-card-streaming">正在回复…</span>' : ''}</p>`
  }
  // 详情 / DSH on both kinds; archive is a thread action and lives on the answer
  // card only, so a session never offers two identical archive buttons.
  const actions = `<div class="thread-card-actions"><button data-action="show-thread" data-thread="${card.dshThreadId}" data-card="${escapeHtml(card.id)}" title="查看这一轮的完整记录" aria-label="查看这一轮的完整记录">${CARD_ICON_DETAIL}</button><button data-action="open-dsh" data-thread="${card.dshThreadId}" data-seq="${Number.isInteger(card.sourceSeq) ? card.sourceSeq : ''}" title="在 DSH 中打开" aria-label="在 DSH 中打开">${CARD_ICON_DSH}</button>${isAnswer ? `<button data-action="archive-thread" data-thread="${card.dshThreadId}" title="归档此会话" aria-label="归档此会话">${CARD_ICON_ARCHIVE}</button>` : ''}</div>`
  return `<article class="thread-card is-${isAnswer ? 'answer' : 'question'}${selected === '' ? '' : ` ${selected}`}${expanded ? ' expanded' : ''}" data-card-id="${escapeHtml(card.id)}" data-position-key="${escapeHtml(card.positionKey)}" data-thread="${card.dshThreadId}" data-role="${isAnswer ? 'answer' : 'question'}" style="left:${card.position.x}px;top:${card.position.y}px;--thread-color:var(--syn-accent)">
    ${edgeControls}
    <header class="thread-card-label"><span class="thread-card-kind">${isAnswer ? '答' : '问'}</span>${meta}${actions}${expandButton}</header>
    ${body}
  </article>`
}

function draftActions(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  return `<div class="draft-actions"><button type="button" data-action="cancel-draft" ${disabled} aria-label="取消" title="取消"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button><button class="primary" type="submit" ${disabled} aria-label="发送" title="发送"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/></svg></button></div>`
}

function quickPhraseEditor(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  const phrases = state.quickPhrases.map((phrase, index) => `<div class="draft-quick-phrase-editor-row"><input data-quick-phrase-index="${index}" maxlength="${MAX_QUICK_PHRASE_LENGTH}" value="${escapeHtml(phrase)}" aria-label="快捷词 ${index + 1}" ${disabled}><button type="button" data-action="remove-quick-phrase" data-quick-phrase-index="${index}" aria-label="删除 ${escapeHtml(phrase)}" title="删除" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button></div>`).join('')
  return `<section class="draft-quick-editor" aria-label="编辑快捷词"><div class="draft-quick-editor-list">${phrases}</div><div class="draft-quick-phrase-add"><input maxlength="${MAX_QUICK_PHRASE_LENGTH}" placeholder="添加快捷词" aria-label="添加快捷词" ${disabled}><button class="primary" type="button" data-action="add-quick-phrase" aria-label="添加快捷词" title="添加快捷词" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div><button class="draft-quick-editor-close" type="button" data-action="close-quick-phrase-editor" ${disabled}>完成</button></section>`
}

function draftQuickPhrases(draft) {
  const disabled = draft.sending ? 'disabled' : ''
  if (state.quickPhraseEditorOpen) return quickPhraseEditor(draft)
  const phrases = state.quickPhrases.map(phrase => `<button class="draft-quick-phrase" type="button" data-action="insert-quick-phrase" data-quick-phrase="${escapeHtml(phrase)}" ${disabled}>${escapeHtml(phrase)}</button>`).join('')
  return `<div class="draft-quick-phrases" aria-label="常用补充词">${phrases}<button class="draft-quick-phrase-add-button" type="button" data-action="open-quick-phrase-editor" aria-label="管理快捷词" title="管理快捷词" ${disabled}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg></button></div>`
}

function insertQuickPhrase(phrase) {
  const input = document.querySelector('[data-draft] textarea')
  if (!(input instanceof HTMLTextAreaElement) || state.draft === null) return
  const start = input.selectionStart
  const end = input.selectionEnd
  const prefix = input.value.slice(0, start)
  const suffix = input.value.slice(end)
  const separator = prefix !== '' && !prefix.endsWith('\n') ? '\n' : ''
  const text = `${prefix}${separator}${phrase}${suffix}`
  if (text.length > input.maxLength) return setError('追问内容不能超过 4000 个字符')
  const caret = prefix.length + separator.length + phrase.length
  input.value = text
  state.draft.text = text
  input.focus()
  input.setSelectionRange(caret, caret)
}

function addQuickPhrase(value) {
  const phrase = value.trim().slice(0, MAX_QUICK_PHRASE_LENGTH)
  if (phrase === '') return false
  if (state.quickPhrases.includes(phrase)) return setError('这个快捷词已经存在')
  if (state.quickPhrases.length >= MAX_QUICK_PHRASES) return setError(`最多保留 ${MAX_QUICK_PHRASES} 个快捷词`)
  state.quickPhrases.push(phrase)
  persistQuickPhrases()
  return true
}

function updateQuickPhrase(index, value) {
  if (!Number.isInteger(index) || index < 0 || index >= state.quickPhrases.length) return
  const phrase = value.trim().slice(0, MAX_QUICK_PHRASE_LENGTH)
  if (phrase === '') {
    state.quickPhrases.splice(index, 1)
  } else if (state.quickPhrases.some((item, itemIndex) => itemIndex !== index && item === phrase)) {
    return setError('这个快捷词已经存在')
  } else {
    state.quickPhrases[index] = phrase
  }
  persistQuickPhrases()
  render()
}

function draftPlacement(cards) {
  const draft = state.draft
  if (draft === null || draft.kind === 'new') return null
  const parent = draft.anchorId === undefined
    ? cards.filter(card => card.dshThreadId === draft.parentId).at(-1)
    : cards.find(card => card.id === draft.anchorId)
  if (parent === undefined) return null
  // The next turn starts one step past the parent, aligned with the parent
  // turn's question row — whatever the chosen arrangement is.
  const parentQuestion = cards.find(card => card.id === parent.id.replace(/:a$/, ':q')) ?? parent
  return {
    parent,
    position: firstAvailableCardPosition(
      { x: parent.position.x + turnStepX(), y: parentQuestion.position.y },
      CARD_HEIGHT,
      cards.map(card => ({ x: card.position.x, y: card.position.y, height: cardHeight(card) })),
    ),
  }
}

function draftCard(cards) {
  const draft = state.draft
  if (draft?.kind === 'new') return `<article class="thread-card draft-card first-session-card" data-card-id="draft" style="left:86px;top:82px;--thread-color:var(--syn-accent)">
    <header class="thread-card-label"><span class="thread-card-kind">问</span><span>新卡片</span></header>
    <form class="draft-branch-form" data-draft><textarea maxlength="4000" placeholder="输入第一条消息" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
  const placement = draftPlacement(cards)
  if (draft === null || placement === null) return ''
  const continuing = draft.kind === 'continue'
  return `<article class="thread-card draft-card" data-card-id="draft" style="left:${placement.position.x}px;top:${placement.position.y}px;--thread-color:var(--syn-accent)">
    <header class="thread-card-label"><span class="thread-card-kind">问</span><span>${continuing ? '新的追问' : '新的分支'}</span></header>
    <form class="draft-branch-form" data-draft>${draftQuickPhrases(draft)}<textarea maxlength="4000" placeholder="${continuing ? '输入追问' : '输入这个分支的新问题'}" ${draft.sending ? 'disabled' : ''}>${escapeHtml(draft.text)}</textarea>${draftActions(draft)}</form>
  </article>`
}

function selectionFollowupButton() {
  return `<button class="selection-followup" type="button" data-action="follow-selection" hidden aria-label="基于所选内容创建追问" title="基于所选内容追问"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 3.5h10v6.25H7.2L4 12.5V9.75H3Z"/><path d="M8 4.9v3.4M6.3 6.6h3.4"/></svg><span>追问</span></button>`
}

// Cards are mounted into the DOM only when they intersect the viewport
// (inflated by VIEWPORT_MARGIN) in world coordinates. The camera transform is
// translate(camera) scale(zoom), so screen = world * zoom + camera.
function visibleCardIds(cards) {
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return new Set(cards.map(card => card.id))
  const bounds = viewport.getBoundingClientRect()
  const left = (-state.canvasCamera.x - VIEWPORT_MARGIN) / state.zoom
  const right = (bounds.width - state.canvasCamera.x + VIEWPORT_MARGIN) / state.zoom
  const top = (-state.canvasCamera.y - VIEWPORT_MARGIN) / state.zoom
  const bottom = (bounds.height - state.canvasCamera.y + VIEWPORT_MARGIN) / state.zoom
  const visible = new Set()
  for (const card of cards) {
    const { x, y } = card.position
    if (x + CARD_WIDTH < left || x > right || y + cardHeight(card) < top || y > bottom) continue
    visible.add(card.id)
  }
  return visible
}

// Incrementally mount cards entering the viewport and unmount cards leaving
// it, without rebuilding the canvas. Called after pan/zoom/focus camera moves.
function syncCanvasViewport() {
  if (state.mode !== 'canvas' || state.canvasCards === undefined) return
  const layer = document.querySelector('.cards-layer')
  if (!(layer instanceof HTMLElement)) return
  const visible = visibleCardIds(state.canvasCards)
  for (const cardId of [...state.mountedCardIds]) {
    if (visible.has(cardId)) continue
    const element = layer.querySelector(`[data-card-id="${selectorValue(cardId)}"]`)
    if (element instanceof HTMLElement) element.remove()
    state.mountedCardIds.delete(cardId)
  }
  for (const card of state.canvasCards) {
    if (!visible.has(card.id) || state.mountedCardIds.has(card.id)) continue
    const wrapper = document.createElement('div')
    wrapper.innerHTML = conversationCard(card, state.canvasGraph)
    const element = wrapper.firstElementChild
    if (element instanceof HTMLElement) {
      layer.appendChild(element)
      bindCardDrag(element)
    }
    state.mountedCardIds.add(card.id)
  }
}

function renderCanvas() {
  const threads = visibleThreads(state.workspace?.threads ?? [])
  if (threads.length === 0 && state.draft?.kind !== 'new') return `<section class="empty-canvas" data-morph-key="empty-canvas"><strong>当前工作目录还没有 DSH 对话。</strong><p>点击「新建卡片」，在画布中输入第一条消息。</p><div><button class="primary" type="button" data-action="create-session">新建卡片</button></div></section>`
  const allCards = conversationCards(threads)
  const graph = conversationGraphView(allCards)
  const cards = graph.cards
  state.canvasCards = cards
  state.canvasCardsById = new Map(cards.map(card => [card.id, card]))
  state.canvasGraph = graph
  if (state.inspectorCardId !== null && !state.canvasCardsById.has(state.inspectorCardId)) {
    state.inspectorCardId = null
    state.inspectorOpening = false
  }
  if (!state.canvasViewInitialized) {
    state.canvasCamera = initialCanvasCamera(cards)
    state.canvasViewInitialized = true
    // The viewport is not laid out yet while renderCanvas builds its HTML;
    // center the focused card once the DOM is mounted (render tail).
    state.canvasNeedsCenter = true
  }
  const visible = visibleCardIds(cards)
  state.mountedCardIds = new Set(visible)
  const mounted = cards.filter(card => visible.has(card.id))
  const inspector = state.inspectorCardId === null ? '' : renderCardInspector(state.canvasCardsById.get(state.inspectorCardId))
  return `<section class="canvas-view" data-morph-key="canvas-view"><div class="canvas-viewport"><div class="canvas-content" style="transform:translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})"><svg class="connectors">${canvasConnectors(cards)}</svg><div class="cards-layer">${mounted.map(card => conversationCard(card, graph)).join('')}${draftCard(cards)}</div></div></div>${inspector}</section>`
}

/** Zoom in whole percents, the number the meter prints. */
function zoomPercent() {
  return Math.round(state.zoomTarget * 100)
}

/**
 * The zoom meter is a read-out, not a control: 20%..400% on the same log axis
 * the chase interpolates in, so 100% sits a little past the middle. The ± pair
 * is gone — the wheel (over the map) and pinch already own zooming.
 */
function zoomMeter() {
  const ratio = Math.round(((Math.log(state.zoomTarget) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))) * 100)
  return `<span class="zoom-meter" title="滚轮缩放画布" aria-label="缩放 ${zoomPercent()}%"><span class="zoom-meter-track"><span class="zoom-meter-fill" style="width:${ratio}%"></span></span><span class="zoom-meter-value">${zoomPercent()}%</span></span>`
}
