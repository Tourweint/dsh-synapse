// Workspace / thread / message loading, and the actions that start a turn.

function messagesFromEvents(events) {
  if (!Array.isArray(events)) return []
  return events.flatMap(event => {
    const content = event?.data?.message?.content ?? event?.data?.content
    const text = Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).filter(Boolean).join('\n') : ''
    if (event?.type === 'user/message' && text && !text.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')) return [{ kind: 'user', text, at: event.time, sourceSeq: event.seq }]
    if (event?.type === 'assistant/message' && text) return [{ kind: 'assistant', text, at: event.time, sourceSeq: event.seq }]
    return []
  })
}

async function loadThreadHistory() {}

function canReplaceView() {
  return state.draft === null && !state.dragging && !state.canvasGesture && Date.now() >= state.canvasRefreshAfter && !document.activeElement?.matches('textarea')
}

function deferCanvasRefresh(delay = 700) {
  state.canvasRefreshAfter = Math.max(state.canvasRefreshAfter, Date.now() + delay)
}

function currentDshWorkspace() {
  const id = state.currentDsh?.id
  return typeof id === 'string' ? state.dshWorkspaces.find(workspace => workspace.sessionIds.includes(id)) : undefined
}

function selectedDshWorkspace() {
  return state.dshWorkspaces.find(workspace => workspace.id === state.selectedDshWorkspaceId)
}

function currentDshThread(threads = state.workspace?.threads ?? []) {
  const id = state.currentDsh?.id
  return typeof id === 'string' ? threads.find(thread => thread.dshSessionId === id) : undefined
}

function workspaceChoices() {
  if (state.dshWorkspaces.length > 0) return state.dshWorkspaces.map(workspace => ({ ...workspace, source: 'dsh' }))
  return state.summaries.map(workspace => ({ id: workspace.id, title: workspace.title, path: workspace.cwd, sessionIds: [], source: 'projection' }))
}

async function threadsForDshWorkspace(workspace) {
  if (workspace.sessionIds.length === 0) return []
  const requested = new Set(workspace.sessionIds)
  const projections = await Promise.all(state.summaries.map(summary => api(`/synapse/api/workspaces/${summary.id}`)))
  return projections.flatMap(projection => projection.workspace.threads.filter(thread => requested.has(thread.dshSessionId)))
}

async function openDshWorkspace(id, { renderAfter = true, preserveCanvasCamera = false } = {}) {
  const workspace = state.dshWorkspaces.find(item => item.id === id)
  if (workspace === undefined) return false
  const load = ++state.workspaceLoad
  state.selectedDshWorkspaceId = id
  const threads = await threadsForDshWorkspace(workspace)
  if (load !== state.workspaceLoad) return true
  const nextWorkspaceId = `dsh:${workspace.id}`
  if (state.workspace?.id !== nextWorkspaceId && !preserveCanvasCamera) resetCanvasCamera()
  state.workspace = { id: nextWorkspaceId, title: workspace.title, cwd: workspace.path, threads }
  const currentThread = currentDshThread(state.workspace.threads)
  state.activeId = currentThread?.id ?? (state.workspace.threads.some(thread => thread.id === state.activeId) ? state.activeId : state.workspace.threads[0]?.id ?? null)
  if (currentThread !== undefined) revealConversationThread(conversationCards(state.workspace.threads), currentThread.id)
  if (renderAfter && canReplaceView()) render()
  await Promise.all(state.workspace.threads.map(thread => loadThreadHistory(thread, false)))
  if (renderAfter && load === state.workspaceLoad && canReplaceView()) render()
  return true
}

async function openCurrentWorkspace({ preserveCanvasCamera = false } = {}) {
  const workspace = currentDshWorkspace()
  if (workspace === undefined || workspace.id === state.selectedDshWorkspaceId) return false
  return openDshWorkspace(workspace.id, { preserveCanvasCamera })
}

async function refreshSummaries({ renderAfter = true } = {}) {
  const before = JSON.stringify(state.summaries)
  const body = await api('/synapse/api/workspaces')
  state.summaries = body.workspaces
  const changed = before !== JSON.stringify(state.summaries)
  const current = state.workspace?.id
  if (state.selectedDshWorkspaceId === null && current !== null && !state.summaries.some(item => item.id === current)) state.workspace = null
  const selected = selectedDshWorkspace()
  if (selected !== undefined && (changed || state.workspace === null)) await openDshWorkspace(selected.id, { renderAfter })
  else if (state.workspace === null && state.summaries.length > 0) await openWorkspace(state.summaries[0].id)
  else if (renderAfter && changed && canReplaceView()) render()
  return changed
}

async function openWorkspace(id, { renderAfter = true } = {}) {
  const load = ++state.workspaceLoad
  const body = await api(`/synapse/api/workspaces/${id}`)
  if (load !== state.workspaceLoad) return
  if (state.workspace?.id !== body.workspace.id) resetCanvasCamera()
  state.workspace = body.workspace
  state.activeId = state.workspace.threads.some(thread => thread.id === state.activeId) ? state.activeId : state.workspace.threads[0]?.id ?? null
  if (renderAfter && canReplaceView()) render()
  await Promise.all(state.workspace.threads.map(thread => loadThreadHistory(thread, false)))
  if (renderAfter && load === state.workspaceLoad && canReplaceView()) render()
}

async function refreshProjection() {
  const summariesChanged = await refreshSummaries({ renderAfter: false })
  if (!summariesChanged || state.workspace === null || !canReplaceView()) return summariesChanged
  if (state.selectedDshWorkspaceId !== null) await openDshWorkspace(state.selectedDshWorkspaceId)
  else await openWorkspace(state.workspace.id)
  return true
}

function openNewSession() {
  if (state.draft !== null) return
  state.mode = 'canvas'
  state.activeId = null
  state.selectedCardId = null
  state.inspectorCardId = null
  state.inspectorOpening = false
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'new', text: '', sending: false }
  state.error = ''
  resetCanvasCamera()
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

async function archiveThread(thread) {
  // A DSH-backed thread is archived in DSH itself, so the sidebar and this map
  // share one archive set (issue #21 / #19). Keeping a second local delete is
  // what made the map claim "archived" while DSH still listed the session.
  if (thread.dshSessionId !== null) {
    if (!window.confirm(`在 DSH 中归档「${thread.title}」及其分支？DSH 侧会话也会被归档。`)) return
    try {
      await dshRpc('synapse:archive-session', { sessionId: thread.dshSessionId })
    } catch (error) {
      setError(error instanceof Error ? error.message : '归档失败')
      return
    }
    state.archivedSessionIds.add(thread.dshSessionId)
    state.activeId = state.activeId === thread.id ? (state.workspace?.threads.find(item => item.id !== thread.id)?.id ?? null) : state.activeId
    if (state.inspectorCardId !== null && state.canvasCardsById?.get(state.inspectorCardId)?.dshThreadId === thread.id) state.inspectorCardId = null
    render()
    await refreshSummaries()
    return
  }
  if (!window.confirm(`归档画布中的「${thread.title}」及其分支？DSH 原会话会保留，可在 DSH 内继续查看。`)) return
  await api(`/synapse/api/threads/${thread.id}`, { method: 'DELETE' })
  state.historyBySession.delete(thread.dshSessionId)
  state.detailScrollByThread.delete(thread.id)
  state.detailTargetCardId = state.detailThreadId === thread.id ? null : state.detailTargetCardId
  if (state.workspace !== null) {
    const removed = new Set([thread.id])
    for (let changed = true; changed;) {
      changed = false
      for (const item of state.workspace.threads) {
        if (item.parentId !== null && removed.has(item.parentId) && !removed.has(item.id)) {
          removed.add(item.id)
          changed = true
        }
      }
    }
    state.workspace.threads = state.workspace.threads.filter(item => !removed.has(item.id))
    for (const key of [...state.cardPositions.keys()]) {
      if ([...removed].some(id => key.startsWith(`${id}:`))) state.cardPositions.delete(key)
    }
    let collapsedChanged = false
    for (const key of [...state.collapsedCardIds]) {
      if ([...removed].some(id => key.startsWith(`${id}:`))) {
        state.collapsedCardIds.delete(key)
        collapsedChanged = true
      }
    }
    if (collapsedChanged) persistCollapsedCards()
    let expandedChanged = false
    for (const key of [...state.expandedCardIds]) {
      if ([...removed].some(id => key.startsWith(`${id}:`))) {
        state.expandedCardIds.delete(key)
        expandedChanged = true
      }
    }
    if (expandedChanged) persistExpandedCards()
    state.activeId = state.activeId !== null && state.workspace.threads.some(item => item.id === state.activeId)
      ? state.activeId
      : state.workspace.threads[0]?.id ?? null
    render()
  } else {
    state.activeId = null
  }
  await refreshSummaries()
}

function focusDraftInput() {
  const input = document.querySelector('[data-draft] textarea')
  if (!(input instanceof HTMLTextAreaElement)) return
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
}

function openContinue(parent, anchorId = undefined, text = '') {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  state.activeId = parent.id
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'continue', parentId: parent.id, anchorId, text, sending: false }
  render()
  window.setTimeout(focusDraftInput, 0)
}

function openBranch(parent, atSeq = undefined, anchorId = undefined) {
  if (parent.dshSessionId === null) return setError('该节点没有关联的 DSH 会话')
  state.activeId = parent.id
  state.quickPhraseEditorOpen = false
  state.draft = { kind: 'branch', parentId: parent.id, atSeq, anchorId, text: '', sending: false }
  render()
  window.setTimeout(() => document.querySelector('[data-draft] textarea')?.focus(), 0)
}

async function sendMessage(thread, text) {
  if (thread.dshSessionId === null) throw new Error('该节点没有关联的 DSH 会话')
  if (state.pendingReplies.has(thread.dshSessionId)) throw new Error('该会话正在回复，请稍后再发送')
  state.pendingReplies.set(thread.dshSessionId, { text, at: Date.now() })
  state.error = ''
  render()
  try {
    await dshRpc('synapse:send-message', { sessionId: thread.dshSessionId, text })
    void loadThreadHistory(thread)
  } catch (error) {
    state.pendingReplies.delete(thread.dshSessionId)
    render()
    throw error
  }
}

async function submitDraft() {
  const draft = state.draft
  const text = draft?.text.trim()
  if (draft === null || !text) return
  const branchPosition = draft.kind === 'branch' && state.workspace !== null ? draftPlacement(conversationCards(state.workspace.threads))?.position : undefined
  draft.sending = true
  state.error = ''
  render()
  try {
    if (draft.kind === 'new') {
      const session = await dshRpc('synapse:create-session', { workspaceId: state.selectedDshWorkspaceId, cwd: state.currentDsh?.cwd })
      await dshRpc('synapse:send-message', { sessionId: session.id, text })
      state.draft = null
      render()
      window.setTimeout(() => {
        void refreshProjection().catch(() => {})
      }, 150)
      return
    }
    const parent = state.workspace?.threads.find(thread => thread.id === draft.parentId)
    if (parent === undefined) throw new Error('来源会话不存在')
    if (draft.kind === 'continue') {
      state.draft = null
      await sendMessage(parent, text)
      return
    }
    const session = await dshRpc('synapse:fork-session', { sessionId: parent.dshSessionId, atSeq: draft.atSeq })
    if (draft.anchorId !== undefined) rememberBranchAnchor(session.id, draft.anchorId)
    const result = await api(`/synapse/api/threads/${parent.id}/branch`, { method: 'POST', body: JSON.stringify({ title: text.slice(0, 42), dshSessionId: session.id, dshSessionTitle: session.title, position: branchPosition }) })
    if (state.workspace !== null && !state.workspace.threads.some(thread => thread.id === result.thread.id || thread.dshSessionId === result.thread.dshSessionId)) state.workspace.threads.push(result.thread)
    state.activeId = result.thread.id
    state.draft = null
    state.pendingReplies.set(result.thread.dshSessionId, { text, at: Date.now() })
    render()
    await dshRpc('synapse:send-message', { sessionId: result.thread.dshSessionId, text })
    void loadThreadHistory(result.thread)
    await refreshProjection()
  } catch (error) {
    if (draft.kind === 'branch') {
      state.pendingReplies.delete(state.workspace?.threads.find(thread => thread.id === state.activeId)?.dshSessionId)
      if (state.draft !== null) state.draft = { ...draft, sending: false }
    } else {
      state.draft = { ...draft, sending: false }
    }
    setError(error)
  }
}

function threadsById() { return new Map((state.workspace?.threads ?? []).map(thread => [thread.id, thread])) }

/**
 * A session archived in DSH must not keep drawing cards here: the canvas and
 * the sidebar both read this filtered list (issue #21 / #19). Threads without a
 * DSH session (canvas-only notes) are never hidden by DSH's state.
 */
function visibleThreads(threads) {
  if (state.archivedSessionIds.size === 0) return threads
  return threads.filter(thread => thread.dshSessionId === null || !state.archivedSessionIds.has(thread.dshSessionId))
}
function persistedMessagesFor(thread) { return state.historyBySession.get(thread.dshSessionId) ?? thread.messages ?? [] }

function pendingUserIndex(messages, pending) {
  // The stored copy may be a preview, so match by full length and by the
  // preview prefix instead of by exact text equality.
  return messages.findLastIndex(message => message.kind === 'user'
    && new Date(message.at).getTime() >= pending.at - 2_000
    && (message.text === pending.text
      || (typeof message.text === 'string' && pending.text.startsWith(message.text.replace(/…$/, '')))))
}

function settlePendingReply(thread, messages) {
  const pending = state.pendingReplies.get(thread.dshSessionId)
  if (pending === undefined) return false
  const userIndex = pendingUserIndex(messages, pending)
  if (userIndex === -1 || !messages.slice(userIndex + 1).some(message => message.kind === 'assistant')) return false
  state.pendingReplies.delete(thread.dshSessionId)
  return true
}

function messagesFor(thread) {
  // A runtime-context snapshot is internal DSH state, never a user turn.
  // Filter here as well as during persistence so existing saved workspaces
  // immediately render one question and its answer as one card.
  const stored = persistedMessagesFor(thread).filter(message => !(message.kind === 'user' && typeof message.text === 'string' && message.text.trimStart().startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')))
  // Swap in hydrated bodies where present: the stored text is only a preview.
  const bodies = state.bodies.get(thread.id)
  const messages = bodies === undefined || bodies.size === 0
    ? stored
    : stored.map(message => {
      const body = bodies.get(message.sourceSeq)
      return body === undefined ? message : { ...message, text: body.text, process: Array.isArray(body.process) ? body.process : message.process, truncated: body.truncated === true, hydrated: true }
    })
  const pending = state.pendingReplies.get(thread.dshSessionId)
  if (pending === undefined) return messages
  if (settlePendingReply(thread, messages)) {
    state.liveReplies.delete(thread.dshSessionId)
    return messages
  }
  const liveReply = state.liveReplies.get(thread.dshSessionId)
  const liveAssistant = liveReply?.running ? { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString() } : { kind: 'assistant', text: '', pending: true, at: new Date().toISOString() }
  const userIndex = pendingUserIndex(messages, pending)
  if (userIndex !== -1) return [...messages, liveAssistant]
  return [...messages, { kind: 'user', text: pending.text, pending: true, at: new Date(pending.at).toISOString() }, liveAssistant]
}

function latestMessage(thread, kind) { return [...messagesFor(thread)].reverse().find(message => message.kind === kind) }
function questionFor(thread) { return latestMessage(thread, 'user')?.text ?? thread.dshSessionTitle ?? '等待用户提问' }
function answerFor(thread) { return latestMessage(thread, 'assistant') ?? null }
