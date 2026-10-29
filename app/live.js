// Bridge messages, live reply polling, and boot.

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.data?.source !== 'dsh-synapse') return
  const data = event.data
  if (data.type === 'synapse:map-opened') {
    // Do NOT reset the camera here: toggling dialog<->map for the same
    // session must keep the user's viewport. A fresh canvas (canvasView
    // not initialized) still centers via renderCanvas; a real session switch
    // re-centers in the current-session handler below.
    state.mode = 'canvas'
    render()
    window.requestAnimationFrame(() => post('synapse:map-ready'))
  }
  if (data.type === 'synapse:theme') {
    document.documentElement.dataset.theme = data.dark === true ? 'dark' : 'light'
  }
  if (data.type === 'synapse:workspaces') {
    state.dshWorkspaces = Array.isArray(data.workspaces) ? data.workspaces.filter(workspace => typeof workspace?.id === 'string' && typeof workspace.title === 'string' && Array.isArray(workspace.sessionIds)) : []
    // DSH owns the archive set; mirror it so an archived session stops drawing
    // cards here too (issue #21 / #19).
    state.archivedSessionIds = new Set(Array.isArray(data.archivedSessionIds) ? data.archivedSessionIds.filter(id => typeof id === 'string') : [])
    const current = currentDshWorkspace()
    if (current !== undefined && current.id !== state.selectedDshWorkspaceId) void openDshWorkspace(current.id).catch(setError)
    else if (state.selectedDshWorkspaceId !== null) void openDshWorkspace(state.selectedDshWorkspaceId).catch(setError)
    else if (canReplaceView()) render()
  }
  if (data.type === 'synapse:current-session') {
    const previousId = state.currentDsh?.id
    state.currentDsh = data.session
    const preserveCanvasCamera = previousId !== data.session?.id && state.mapCardSessionSwitches.delete(data.session?.id)
    const thread = currentDshThread()
    if (thread !== undefined) {
      const preserveSelectedCard = state.activeId === thread.id
      state.activeId = thread.id
      if (!preserveSelectedCard) {
        state.selectedCardId = null
        state.inspectorCardId = null
        state.inspectorOpening = false
      }
      if (state.workspace !== null) revealConversationThread(conversationCards(state.workspace.threads), thread.id)
    }
    if (previousId !== data.session?.id) {
      // A real session switch: re-center on the new session's latest turn,
      // whether it lives in the same workspace (openCurrentWorkspace returns
      // false) or a different one (it resets the camera itself).
      void openCurrentWorkspace({ preserveCanvasCamera }).then(opened => {
        if (!opened && canReplaceView()) {
          render()
          if (!preserveCanvasCamera) focusActiveCard()
        }
      }).catch(setError)
    }
    else if (canReplaceView()) render()
  }
  if (data.type === 'synapse:live-reply' && typeof data.sessionId === 'string') {
    const thread = state.workspace?.threads.find(item => item.dshSessionId === data.sessionId)
    if (thread !== undefined) {
      if (data.running === true) {
        state.liveReplies.set(data.sessionId, { running: true, text: typeof data.text === 'string' ? data.text : '' })
        // Streaming: patch the live card's answer in place instead of
        // rebuilding the whole canvas on every chunk; a full render reconciles
        // at stream end. The detail view is single-thread, so keep its cheap
        // throttled full render.
        if (state.mode === 'canvas') scheduleLiveCardUpdate(data.sessionId)
        else if (canReplaceView()) scheduleLiveRender()
      } else {
        state.liveReplies.delete(data.sessionId)
        if (canReplaceView() || state.pendingReplies.has(data.sessionId)) renderPreservingDetailScroll()
      }
    }
  }
  if (data.type === 'synapse:forked-session' || data.type === 'synapse:created-session' || data.type === 'synapse:message-sent') settleRpc(data.requestId, data.session ?? data)
  if (data.type === 'synapse:archived-session') settleRpc(data.requestId, data)
  if (data.type === 'synapse:bridge-error') { settleRpc(data.requestId, undefined, new Error(data.message)); if (data.requestId === undefined) setError(data.message) }
})

post('synapse:request-current')
refreshSummaries().catch(setError)
let polling = false
let liveRenderTimer = 0
let liveCardFrame = 0
let liveCardSessionId = null
function scheduleLiveCardUpdate(sessionId) {
  // Coalesce streaming chunks to one DOM patch per animation frame.
  liveCardSessionId = sessionId
  if (liveCardFrame !== 0) return
  liveCardFrame = window.requestAnimationFrame(() => {
    liveCardFrame = 0
    if (liveCardSessionId === null) return
    const id = liveCardSessionId
    liveCardSessionId = null
    applyLiveReplyToCard(id)
  })
}
function applyLiveReplyToCard(sessionId) {
  if (state.mode !== 'canvas') return
  // Never patch cards mid-gesture: the reflow would compete with the drag or
  // pan frame; the next live-reply chunk re-applies after the gesture ends.
  if (state.dragging || state.canvasGesture) return
  const thread = state.workspace?.threads.find(item => item.dshSessionId === sessionId)
  if (thread === undefined) return
  const live = state.liveReplies.get(sessionId)
  if (live?.running !== true) return
  // The answer card of the newest turn is the only place an unfinished reply may
  // appear: the question above it never carries model text.
  const cards = app.querySelectorAll(`.thread-card.is-answer[data-thread="${CSS.escape(thread.id)}"]`)
  const card = cards[cards.length - 1]
  if (!(card instanceof HTMLElement)) return
  const body = card.querySelector('.thread-card-text')
  if (!(body instanceof HTMLElement)) return
  const text = live.text
  // Morph the paragraph's children instead of replacing the subtree: the body
  // keeps its node, so a pointer that went down inside it still resolves to a
  // click on release. The class describes the same state the full render does.
  body.className = text.trim() === '' ? 'thread-card-text is-pending' : 'thread-card-text'
  morphInto(body, text.trim() === ''
    ? '正在回复…'
    : `${escapeHtml(answerSummary(text))}<span class="thread-card-streaming">正在回复…</span>`)
}
function scheduleLiveRender() {
  if (liveRenderTimer !== 0 || !canReplaceView()) return
  liveRenderTimer = window.setTimeout(() => {
    liveRenderTimer = 0
    if (canReplaceView()) renderPreservingDetailScroll()
  }, 120)
}
async function pollProjection() {
  if (polling || document.hidden || !canReplaceView()) return
  polling = true
  try {
    await refreshProjection()
  } finally { polling = false }
}
window.setInterval(() => { void pollProjection() }, 1_000)
