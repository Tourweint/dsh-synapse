// DOM listeners, selection follow-up, and workspace switching.

let selectionFollowup = null
let selectionFollowupFrame = 0

function hideSelectionFollowup() {
  if (selectionFollowupFrame !== 0) {
    window.cancelAnimationFrame(selectionFollowupFrame)
    selectionFollowupFrame = 0
  }
  selectionFollowup = null
  const button = app.querySelector('.selection-followup')
  if (button instanceof HTMLButtonElement) button.hidden = true
}

function selectionFollowupTarget(range) {
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  if (!(start instanceof Element) || !(end instanceof Element)) return null
  // Cards no longer hold selectable text (the body is a clipped summary), so
  // "追问所选内容" only exists where the full answer is readable: the inspector.
  const answer = start.closest('.card-inspector-answer')
  if (answer instanceof HTMLElement && answer.contains(end)) {
    const cardId = answer.closest('.card-inspector')?.dataset.inspectorCard
    const card = cardId === undefined ? undefined : state.canvasCardsById?.get(cardId)
    if (card !== undefined) return { threadId: card.dshThreadId }
  }
  const messageBody = start.closest('.message-assistant .message-body')
  const thread = currentThread()
  if (messageBody instanceof HTMLElement && messageBody.contains(end) && thread !== null) return { threadId: thread.id }
  return null
}

function updateSelectionFollowup() {
  selectionFollowupFrame = 0
  const button = app.querySelector('.selection-followup')
  const selection = window.getSelection()
  if (!(button instanceof HTMLButtonElement) || state.draft !== null || selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return hideSelectionFollowup()
  const text = selection.toString().trim()
  const range = selection.getRangeAt(0)
  const target = text === '' || text.length > 4000 ? null : selectionFollowupTarget(range)
  const rect = range.getBoundingClientRect()
  if (target === null || rect.width === 0 || rect.height === 0) return hideSelectionFollowup()
  selectionFollowup = { ...target, text }
  button.dataset.thread = target.threadId
  button.style.left = `${Math.min(window.innerWidth - 12, Math.max(76, rect.right))}px`
  button.style.top = `${Math.min(window.innerHeight - 38, Math.max(8, rect.bottom + 8))}px`
  button.hidden = false
}

function queueSelectionFollowup() {
  if (selectionFollowupFrame !== 0) return
  selectionFollowupFrame = window.requestAnimationFrame(updateSelectionFollowup)
}

app.addEventListener('pointerdown', event => {
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement) || event.target instanceof Element && event.target.closest('.thread-card, button, textarea, select')) return
  event.preventDefault()
  // A pan takes over the camera: land any zoom still in flight first, otherwise
  // the remaining frames would keep writing their own camera over the drag.
  if (zoomFrame !== 0 || zoomAnchor !== null) settleZoom()
  const origin = { x: event.clientX, y: event.clientY, camera: { ...state.canvasCamera } }
  let pendingCamera = null
  let frame = 0
  state.canvasGesture = true
  viewport.classList.add('is-panning')
  viewport.setPointerCapture(event.pointerId)
  const apply = () => {
    frame = 0
    if (pendingCamera === null) return
    state.canvasCamera = pendingCamera
    pendingCamera = null
    applyCanvasTransform()
    syncCanvasViewport()
  }
  const move = moveEvent => {
    pendingCamera = {
      x: origin.camera.x + moveEvent.clientX - origin.x,
      y: origin.camera.y + moveEvent.clientY - origin.y,
    }
    if (frame === 0) frame = window.requestAnimationFrame(apply)
  }
  const stop = () => {
    viewport.classList.remove('is-panning')
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', stop)
    document.removeEventListener('pointercancel', stop)
    if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0 }
    apply()
    state.canvasGesture = false
    deferCanvasRefresh(120)
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', stop)
  document.addEventListener('pointercancel', stop)
})

app.addEventListener('wheel', event => {
  const viewport = canvasViewport(event.target)
  if (!(viewport instanceof HTMLElement)) return
  // Cards carry no scrollable text any more (the inspector has the full
  // answer), so the wheel keeps zooming the map even with the pointer over a
  // card. Only the draft's textarea keeps the browser's native scrolling.
  if (event.target instanceof Element && event.target.closest('textarea, select, input, .draft-card')) return
  event.preventDefault()
  zoomCanvas(viewport, state.zoomTarget + (event.deltaY < 0 ? .05 : -.05), event.clientX, event.clientY)
}, { passive: false })

// Track pointer-down so the card click handler can tell a plain click from a
// text-selection or drag gesture; acting on the latter would re-render and
// wipe the user's selection.
let pointerDownPosition = null
app.addEventListener('pointerdown', event => { pointerDownPosition = { x: event.clientX, y: event.clientY } })
app.addEventListener('pointerdown', event => {
  const button = event.target instanceof Element ? event.target.closest('.selection-followup') : null
  if (button instanceof HTMLButtonElement) event.preventDefault()
  else hideSelectionFollowup()
})
app.addEventListener('pointerup', queueSelectionFollowup)
app.addEventListener('scroll', hideSelectionFollowup, true)
document.addEventListener('selectionchange', queueSelectionFollowup)
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  if (state.arrangementMenuOpen === true) {
    event.preventDefault()
    state.arrangementMenuOpen = false
    state.arrangementMenuAnchor = null
    render()
    return
  }
  if (state.workspaceMenuOpen === true) {
    event.preventDefault()
    state.workspaceMenuOpen = false
    render()
    return
  }
  if (state.mode !== 'canvas' || state.inspectorCardId === null) return
  event.preventDefault()
  closeCardInspector({ animate: false })
})

// Clicking away dismisses the arrangement picker and the drawer. Clicks on
// either panel, on a card (which retargets the drawer) and on any control are
// left to their own handlers.
app.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return
  const target = event.target
  if (state.arrangementMenuOpen === true && !target.closest('.arrangement-menu, [data-action="toggle-arrangement"]')) {
    state.arrangementMenuOpen = false
    state.arrangementMenuAnchor = null
    render()
  }
  // The workspace picker is a popup like the arrangement menu: any click outside
  // its trigger + list dismisses it, so the drawer never stays open behind you.
  if (state.workspaceMenuOpen === true && !target.closest('.workspace-select')) {
    state.workspaceMenuOpen = false
    render()
  }
  if (state.inspectorCardId === null) return
  if (target.closest('.card-inspector, .thread-card, [data-action]')) return
  closeCardInspector()
})

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]')
  if (!(button instanceof HTMLElement)) {
    const card = event.target instanceof Element ? event.target.closest('.thread-card[data-thread]:not(.draft-card)') : null
    if (!(card instanceof HTMLElement) || event.target instanceof Element && event.target.closest('textarea, select, form')) return
    // A double-click selects a word and a drag selects a range; neither is a
    // select-click, so leave the selection intact instead of re-rendering.
    if (event.detail > 1) return
    if (pointerDownPosition !== null
      && Math.hypot(event.clientX - pointerDownPosition.x, event.clientY - pointerDownPosition.y) > 4) return
    const thread = state.workspace?.threads.find(item => item.id === card.dataset.thread)
    if (thread === undefined) return
    const cardId = card.dataset.cardId
    if (cardId === undefined) return
    state.activeId = thread.id
    state.selectedCardId = cardId
    openCardInspector(cardId)
    state.error = ''
    render()
    void loadThreadHistory(thread)
    // Bidirectional current-session sync: switch DSH's current session
    // without closing the map; the client confirms via synapse:current-session.
    if (thread.dshSessionId !== null) {
      if (thread.dshSessionId !== state.currentDsh?.id) state.mapCardSessionSwitches.add(thread.dshSessionId)
      post('synapse:activate-session', { sessionId: thread.dshSessionId })
    }
    return
  }
  const thread = state.workspace?.threads.find(item => item.id === button.dataset.thread)
  try {
    if (button.dataset.action === 'follow-selection') {
      const followup = selectionFollowup
      hideSelectionFollowup()
      if (followup !== null && thread !== undefined && thread.id === followup.threadId && state.draft === null) openContinue(thread, undefined, followup.text)
      return
    }
    if (button.dataset.action === 'insert-quick-phrase' && button.dataset.quickPhrase !== undefined) insertQuickPhrase(button.dataset.quickPhrase)
    if (button.dataset.action === 'open-quick-phrase-editor') { state.quickPhraseEditorOpen = true; render() }
    if (button.dataset.action === 'close-quick-phrase-editor') { state.quickPhraseEditorOpen = false; render() }
    if (button.dataset.action === 'add-quick-phrase') {
      const editor = button.closest('.draft-quick-phrase-add')
      const input = editor?.querySelector('input')
      if (input instanceof HTMLInputElement && addQuickPhrase(input.value)) {
        render()
        window.setTimeout(() => document.querySelector('.draft-quick-phrase-add input')?.focus(), 0)
      }
    }
    if (button.dataset.action === 'remove-quick-phrase') {
      const index = Number(button.dataset.quickPhraseIndex)
      if (Number.isInteger(index) && index >= 0 && index < state.quickPhrases.length) {
        state.quickPhrases.splice(index, 1)
        persistQuickPhrases()
        render()
      }
    }
    if (button.dataset.action === 'close') post('synapse:close')
    if (button.dataset.action === 'close-card-inspector') { closeCardInspector(); return }
    if (button.dataset.action === 'toggle-sidebar') { state.sidebarCollapsed = !state.sidebarCollapsed; render() }
    if (button.dataset.action === 'create-session') openNewSession()
    if (button.dataset.action === 'open-current' && state.currentDsh !== null) post('synapse:open-session', { sessionId: state.currentDsh.id })
    if (button.dataset.action === 'select-thread' && thread !== undefined) {
      state.mapCardSessionSwitches.clear()
      state.activeId = thread.id
      state.selectedCardId = null
      state.inspectorCardId = null
      state.inspectorOpening = false
      state.error = ''
      if (state.workspace !== null) revealConversationThread(conversationCards(state.workspace.threads), thread.id)
      render()
      // The state switch is instant, so the map has to show it: without this the
      // camera stayed on the previous conversation's cards (often thousands of
      // pixels away), and a click that worked looked like a dead button.
      window.requestAnimationFrame(() => { if (state.mode === 'canvas') focusActiveCard() })
      void loadThreadHistory(thread)
      // Bidirectional current-session sync: switch DSH's current session
      // without closing the map; the client confirms via synapse:current-session.
      if (thread.dshSessionId !== null) post('synapse:activate-session', { sessionId: thread.dshSessionId })
    }
    if (button.dataset.action === 'show-thread' && thread !== undefined) { state.activeId = thread.id; state.mode = 'thread'; state.arrangementMenuOpen = false; state.detailTargetCardId = button.dataset.card ?? null; render(); void loadThreadHistory(thread) }
    if (button.dataset.action === 'show-canvas') { state.mode = 'canvas'; state.arrangementMenuOpen = false; render() }
    if (button.dataset.action === 'toggle-card-expanded' && button.dataset.card !== undefined) {
      const cardId = button.dataset.card
      if (state.expandedCardIds.has(cardId)) state.expandedCardIds.delete(cardId)
      else state.expandedCardIds.add(cardId)
      persistExpandedCards()
      // Unfolding changes the card's height, so the whole layout re-settles;
      // the camera is deliberately left where the user put it.
      render()
    }
    if (button.dataset.action === 'toggle-card-children' && button.dataset.card !== undefined) {
      const cardId = button.dataset.card
      const collapsing = !state.collapsedCardIds.has(cardId)
      if (collapsing && state.workspace !== null) {
        const allCards = conversationCards(state.workspace.threads)
        const nextCollapsed = new Set(state.collapsedCardIds).add(cardId)
        const visibleCards = conversationGraphView(allCards, nextCollapsed).cards
        const visibleIds = new Set(visibleCards.map(card => card.id))
        const draftParentId = draftPlacement(allCards)?.parent.id
        if (draftParentId !== undefined && !visibleIds.has(draftParentId)) return setError('请先完成或取消正在编辑的追问或分支')
        // Collapsing is a view operation, so it is never refused: it used to be
        // blocked whenever the active conversation would be hidden, which made
        // "−" look dead on exactly the newest card people press it on.
      }
      collapsing ? state.collapsedCardIds.add(cardId) : state.collapsedCardIds.delete(cardId)
      persistCollapsedCards()
      // Keep the viewport exactly where it is: folding is about hiding a
      // subtree, not about re-framing the canvas. Focus the handle without
      // scrolling for a11y.
      render()
      window.setTimeout(() => document.querySelector(`[data-action="toggle-card-children"][data-card="${selectorValue(cardId)}"]`)?.focus({ preventScroll: true }), 0)
    }
    if (button.dataset.action === 'open-continue' && thread !== undefined) openContinue(thread, button.dataset.card)
    if (button.dataset.action === 'open-branch' && thread !== undefined) {
      const requestedSeq = Number(button.dataset.seq)
      if (button.dataset.card !== undefined && !Number.isInteger(requestedSeq)) return setError('请等待这张卡片的最终回答后再创建分支')
      const fallbackSeq = latestMessage(thread, 'assistant')?.sourceSeq
      openBranch(thread, Number.isInteger(requestedSeq) ? requestedSeq : fallbackSeq, button.dataset.card)
    }
    if (button.dataset.action === 'cancel-draft') { state.draft = null; state.quickPhraseEditorOpen = false; render() }
    if (button.dataset.action === 'toggle-message' && button.dataset.message !== undefined) { state.expandedMessageIds.has(button.dataset.message) ? state.expandedMessageIds.delete(button.dataset.message) : state.expandedMessageIds.add(button.dataset.message); renderPreservingDetailScroll() }
    if (button.dataset.action === 'open-dsh' && thread?.dshSessionId !== null) post('synapse:open-session', { sessionId: thread.dshSessionId, seq: Number.isInteger(Number(button.dataset.seq)) ? Number(button.dataset.seq) : undefined })
    if (button.dataset.action === 'archive-thread' && thread !== undefined) await archiveThread(thread)
    if (button.dataset.action === 'focus-active') focusActiveCard()
    if (button.dataset.action === 'dismiss-error') { state.error = ''; render() }
    if (button.dataset.action === 'layout' && state.workspace !== null) {
      // 整理 is also a fresh look at the Host's projection: harness notes that
      // used to occupy a card are dropped there, and a click should pick that up
      // instead of waiting for the 1s poll.
      void refreshProjection().catch(setError)
      resetCardPositions()
      resetCanvasCamera()
      render()
    }
    if (button.dataset.action === 'toggle-arrangement') {
      state.arrangementMenuOpen = !state.arrangementMenuOpen
      const rect = button.getBoundingClientRect()
      // Fixed positioning, so it escapes the pane's `overflow: hidden` the same
      // way the selection pill does; the anchor is stored because every render
      // rebuilds the markup.
      state.arrangementMenuAnchor = state.arrangementMenuOpen
        ? { left: Math.max(8, Math.min(window.innerWidth - 216, rect.right - 208)), top: rect.bottom + 6 }
        : null
      render()
    }
    if (button.dataset.action === 'toggle-workspace-menu') {
      state.workspaceMenuOpen = !state.workspaceMenuOpen
      render()
    }
    if (button.dataset.action === 'select-workspace-option') {
      const choice = workspaceChoices().find(item => item.id === button.dataset.workspaceId)
      state.workspaceMenuOpen = false
      if (choice !== undefined) await switchWorkspace(choice)
    }
    if (button.dataset.action === 'set-question-position') {
      const position = button.dataset.position
      if (QUESTION_POSITIONS.includes(position)) {
        state.questionPosition = position
        state.arrangementMenuOpen = false
        state.arrangementMenuAnchor = null
        // A different arrangement means different geometry: keeping hand-dragged
        // cards would leave half the map in the old shape.
        resetCardPositions()
        persistQuestionPosition()
        render()
        focusActiveCard()
      }
    }
  } catch (error) { setError(error) }
})

app.addEventListener('change', event => {
  const quickPhrase = event.target instanceof Element ? event.target.closest('[data-quick-phrase-index]') : null
  if (quickPhrase instanceof HTMLInputElement) {
    updateQuickPhrase(Number(quickPhrase.dataset.quickPhraseIndex), quickPhrase.value)
  }
})

/**
 * Switch the canvas to another workspace. Shared by the sidebar's picker
 * (a custom listbox now, not a native `<select>`, so it can animate and round
 * its corners) — the rules themselves are unchanged.
 */
async function switchWorkspace(choice) {
  state.inspectorCardId = null
  state.inspectorOpening = false
  if (choice.source === 'dsh') {
    // Map → native sync: switching workspaces moves DSH's current session to
    // the workspace's most recently updated session, keeping both sides in step.
    const opened = await openDshWorkspace(choice.id, { userInitiated: true })
    if (!opened) return
    const threads = state.workspace?.threads ?? []
    const latest = threads
      .filter(thread => thread.dshSessionId !== null)
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0]
    const sessionId = latest?.dshSessionId ?? choice.sessionIds[0]
    if (sessionId !== undefined) post('synapse:activate-session', { sessionId })
    return
  }
  state.selectedDshWorkspaceId = null
  await openWorkspace(choice.id)
}
app.addEventListener('input', event => { const input = event.target; if (input instanceof HTMLTextAreaElement && input.closest('[data-draft]') && state.draft !== null) state.draft.text = input.value })
app.addEventListener('submit', event => {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return
  if (form.matches('[data-draft]')) { event.preventDefault(); void submitDraft(); return }
  const thread = state.workspace?.threads.find(item => item.id === form.dataset.compose)
  const input = form.querySelector('textarea')
  if (thread === undefined || !(input instanceof HTMLTextAreaElement) || input.value.trim() === '') return
  event.preventDefault()
  const text = input.value.trim()
  input.value = ''
  void sendMessage(thread, text).catch(setError)
})
