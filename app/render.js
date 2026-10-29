// The render entry point, on-demand body loading, and the canvas transform.

function render() {
  // Remember the departing thread's scroll position per thread id, so
  // switching sessions restores each conversation's own place instead of
  // smearing one session's position onto another.
  if (state.mode === 'thread' && state.detailThreadId !== null) {
    const detail = document.querySelector('.detail-scroll')
    if (detail instanceof HTMLElement) state.detailScrollByThread.set(state.detailThreadId, detail.scrollTop)
  }
  if (state.mode === 'canvas' && state.inspectorCardId !== null) {
    const inspector = document.querySelector('.card-inspector-scroll')
    if (inspector instanceof HTMLElement) state.inspectorScrollByCard.set(state.inspectorCardId, inspector.scrollTop)
  }
  state.detailThreadId = state.mode === 'thread' ? state.activeId : null
  const detailScrollTop = state.detailThreadId === null ? null : state.detailScrollByThread.get(state.detailThreadId) ?? null
  const inspectorScrollTop = state.mode === 'canvas' && state.inspectorCardId !== null ? state.inspectorScrollByCard.get(state.inspectorCardId) ?? null : null
  const workspace = state.workspace
  const threads = visibleThreads(workspace?.threads ?? [])
  const view = state.mode === 'thread' ? renderThread() : renderCanvas()
  const choices = workspaceChoices()
  const selectedWorkspaceId = state.selectedDshWorkspaceId ?? workspace?.id
  const selectedChoice = choices.find(item => item.id === selectedWorkspaceId)
  const workspaceOptions = choices.map(item => `<button class="workspace-option${item.id === selectedWorkspaceId ? ' selected' : ''}" type="button" role="option" aria-selected="${item.id === selectedWorkspaceId}" data-action="select-workspace-option" data-workspace-id="${escapeHtml(item.id)}" title="${escapeHtml(item.path ?? item.title)}"><span class="workspace-option-title">${escapeHtml(item.title)}</span><svg class="workspace-option-check" aria-hidden="true" viewBox="0 0 16 16"><path d="m3.5 8.5 2.8 2.8 6.2-6.6"/></svg></button>`).join('')
  const canvasControls = state.mode === 'canvas' && (threads.length > 0 || state.draft?.kind === 'new') ? `<div class="header-actions"><button class="header-action" type="button" data-action="layout" title="整理节点" aria-label="整理节点"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg><span>整理</span></button><button class="header-action is-icon${state.arrangementMenuOpen === true ? ' active' : ''}" type="button" data-action="toggle-arrangement" title="问与答的排列方式" aria-label="问与答的排列方式" aria-expanded="${state.arrangementMenuOpen === true ? 'true' : 'false'}"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.5" y="2" width="6.5" height="5" rx="1"/><rect x="6.5" y="9" width="7" height="5" rx="1"/></svg></button><button class="header-action" type="button" data-action="focus-active" title="定位到当前会话" aria-label="定位到当前会话"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v2.6M8 11.9v2.6M1.5 8h2.6M11.9 8h2.6"/></svg><span>定位</span></button>${zoomMeter()}</div>` : ''
  // The session's two actions ride the header's first row instead of owning a
  // title block in the transcript: no session name, no extra band above the flow.
  const detailActions = state.mode === 'thread' ? `<div class="header-actions">${detailActionsBar()}</div>` : ''
  const detailAvailable = currentThread() !== null
  // The map's own top row lives INSIDE the conversation surface, so the surface
  // can start at the very top of the frame (no strip above it, the host caption
  // sits directly on it). The rail toggle rides this row instead of owning a
  // 42px header of its own.
  const canvasTabs = `<header class="canvas-header"><button class="rail-toggle" type="button" data-action="toggle-sidebar" aria-expanded="${state.sidebarCollapsed ? 'false' : 'true'}" aria-label="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}" title="${state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.25"/><path d="M6 2v12"/></svg></button><nav class="canvas-tabs" data-active="${state.mode}" aria-label="视图"><button type="button" data-action="show-canvas"${state.mode === 'canvas' ? ' aria-current="page"' : ''}>地图</button><button type="button" data-action="show-thread" data-thread="${state.activeId ?? ''}"${state.mode === 'thread' ? ' aria-current="page"' : ''} ${detailAvailable ? '' : 'disabled'}>详情</button></nav>${detailActions}${canvasControls}</header>`
  morphInto(app, `<main class="synapse-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}"><aside class="sidebar"><div class="sidebar-inner"><div class="sidebar-brand-row"><div class="brand" aria-label="Synapse"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M9 10.5 16 7l7 3.5M9 10.5v8L16 22m0-15v15m7-11.5v8L16 22"/><circle cx="9" cy="10" r="2.5"/><circle cx="23" cy="10" r="2.5"/><circle cx="16" cy="23" r="2.5"/></svg><strong>Synapse</strong></div></div><button class="new-workspace" type="button" data-action="create-session" title="在画布中新建一张卡片，不会离开地图" ${state.draft !== null ? 'disabled' : ''}><svg class="new-session-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v6.5M4.75 8h6.5"/></svg><span>新建卡片</span></button><div class="sidebar-panel"><div class="workspace-label"><span>工作区</span><span class="workspace-select"><button class="workspace-trigger${state.workspaceMenuOpen === true ? ' open' : ''}" type="button" data-action="toggle-workspace-menu" aria-haspopup="listbox" aria-expanded="${state.workspaceMenuOpen === true ? 'true' : 'false'}" title="${escapeHtml(selectedChoice?.path ?? selectedChoice?.title ?? '选择工作区')}" ${state.draft !== null ? 'disabled' : ''}><svg class="workspace-folder" aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 4.75h3l1.2 1.5h6.8v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"/></svg><span class="workspace-trigger-label">${escapeHtml(selectedChoice?.title ?? '选择工作区')}</span><svg class="workspace-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg></button>${state.workspaceMenuOpen === true ? `<div class="workspace-menu" role="listbox" aria-label="选择工作区">${workspaceOptions || '<p class="workspace-empty">暂未发现工作区</p>'}</div>` : ''}</span></div><div class="sidebar-heading"><span>会话</span></div><nav class="thread-tree">${threads.map(thread => `<button class="tree-row ${thread.id === state.activeId ? 'active' : ''}" data-action="select-thread" data-thread="${thread.id}"><span class="tree-title">${escapeHtml(threadListTitle(thread))}</span>${thread.parentId === null ? '' : '<i>分支</i>'}</button>`).join('') || '<p class="tree-empty">暂未同步会话</p>'}</nav></div></div></aside><div class="content-pane"><section class="main-stage">${state.error ? `<div class="status-message" role="alert"><span>${escapeHtml(state.error)}</span><button data-action="dismiss-error" aria-label="关闭" title="关闭">×</button></div>` : ''}${canvasTabs}${arrangementMenu()}${view}${selectionFollowupButton()}</section></div></main>`)
  installDragging()
  cacheCardConnectors()
  // The initial camera from renderCanvas is inset (viewport not laid out yet);
  // center it on the focused card once the canvas DOM is mounted.
  if (state.canvasNeedsCenter) {
    state.canvasNeedsCenter = false
    window.requestAnimationFrame(() => { if (state.mode === 'canvas') focusActiveCard() })
  }
  installInspectorResizer()
  if (detailScrollTop !== null) window.requestAnimationFrame(() => {
    const nextDetail = document.querySelector('.detail-scroll')
    if (nextDetail instanceof HTMLElement) nextDetail.scrollTop = detailScrollTop
  })
  if (inspectorScrollTop !== null) window.requestAnimationFrame(() => {
    const inspector = document.querySelector('.card-inspector-scroll')
    if (inspector instanceof HTMLElement) inspector.scrollTop = inspectorScrollTop
  })
  if (state.inspectorOpening) window.requestAnimationFrame(() => {
    document.querySelector('.card-inspector')?.classList.remove('is-opening')
    state.inspectorOpening = false
  })
  // Jump the detail view to the card the user clicked: card ids carry the
  // source sequence (`<thread>:turn:<seq>`), which matches data-message-seq
  // anchors on the rendered messages.
  const targetCardId = state.detailTargetCardId
  state.detailTargetCardId = null
  if (targetCardId !== null) {
    const match = /:turn:(\d+)$/.exec(targetCardId)
    const seq = match === null ? null : match[1]
    if (seq !== null) window.requestAnimationFrame(() => {
      const target = app.querySelector(`[data-message-seq="${CSS.escape(seq)}"]`)
      if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start' })
    })
  }
  // Card faces and the detail view only hold previews: pull the real bodies for
  // whatever is on screen right now (issue #42).
  void hydrateBodies()
}

/**
 * Ask the Host for the bodies of the messages currently on screen. The
 * workspace payload carries previews only, so each newly mounted card and each
 * opened detail view hydrates from the DSH session log.
 */
async function hydrateBodies() {
  const wanted = new Map()
  const add = (threadId, message) => {
    if (threadId === undefined || message === null || message === undefined) return
    if (!Number.isInteger(message.sourceSeq)) return
    if (state.bodies.get(threadId)?.has(message.sourceSeq) === true) return
    const key = `${threadId}:${message.sourceSeq}`
    if (state.bodyRequests.has(key) || state.bodyFailures.has(key)) return
    const seqs = wanted.get(threadId) ?? new Set()
    seqs.add(message.sourceSeq)
    wanted.set(threadId, seqs)
  }
  const addCard = card => {
    if (card === undefined) return
    add(card.dshThreadId, card.questionMessage)
    add(card.dshThreadId, card.answer)
    add(card.dshThreadId, card.error)
  }
  if (state.mode === 'thread' && state.activeId !== null) {
    const thread = currentThread()
    if (thread !== null && !state.bodiesLoaded.has(thread.id)) {
      for (const message of persistedMessagesFor(thread)) add(thread.id, message)
    }
  } else if (state.mode === 'canvas') {
    for (const cardId of state.mountedCardIds) addCard(state.canvasCardsById?.get(cardId))
  }
  if (state.inspectorCardId !== null) addCard(state.canvasCardsById?.get(state.inspectorCardId))
  for (const [threadId, seqs] of wanted) void fetchBodies(threadId, [...seqs])
}

async function fetchBodies(threadId, seqs) {
  if (seqs.length === 0) return
  const keys = seqs.map(seq => `${threadId}:${seq}`)
  for (const key of keys) state.bodyRequests.add(key)
  try {
    const body = await api(`/synapse/api/threads/${threadId}/full?seqs=${seqs.join(',')}`)
    const cached = state.bodies.get(threadId) ?? new Map()
    for (const [seq, payload] of Object.entries(body.messages ?? {})) {
      if (payload === null || typeof payload !== 'object') continue
      cached.set(Number(seq), payload)
    }
    state.bodies.set(threadId, cached)
    if (state.mode === 'thread' && state.activeId === threadId) state.bodiesLoaded.add(threadId)
    if (body.unavailable === true) {
      // Archived or already removed from DSH: keep the previews, stop asking.
      for (const message of persistedMessagesFor(currentThread() ?? { messages: [] })) {
        if (Number.isInteger(message.sourceSeq)) state.bodyFailures.add(`${threadId}:${message.sourceSeq}`)
      }
      state.bodiesLoaded.add(threadId)
    }
    if (state.mode === 'thread' || state.inspectorCardId !== null) render()
    else if (canReplaceView()) render()
    else deferCanvasRefresh(400)
  } catch {
    for (const key of keys) state.bodyFailures.add(key)
  } finally {
    for (const key of keys) state.bodyRequests.delete(key)
  }
}

function renderPreservingDetailScroll() {
  render()
}

function applyCanvasTransform() {
  const content = document.querySelector('.canvas-content')
  if (content instanceof HTMLElement) content.style.transform = `translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})`
}
