const app = document.querySelector('#app')
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
const LEGACY_CARD_POSITIONS_KEY = 'dsh-synapse:card-positions'
const CARD_POSITIONS_KEY = 'dsh-synapse:card-positions:v3'
const COLLAPSED_CARDS_KEY = 'dsh-synapse:collapsed-cards:v1'
const EXPANDED_CARDS_KEY = 'dsh-synapse:expanded-cards:v1'
const INSPECTOR_WIDTH_KEY = 'dsh-synapse:inspector-width:v1'
// The drawer keeps a readable column: below 380px the code blocks wrap every
// other word, above 760px the line length stops being readable and it would
// cover the map it is describing. It never takes more than 78% of the pane.
const INSPECTOR_WIDTH_DEFAULT = 460
const INSPECTOR_WIDTH_MIN = 380
const INSPECTOR_WIDTH_MAX = 760
const INSPECTOR_WIDTH_MAX_RATIO = .78
const QUICK_PHRASES_KEY = 'dsh-synapse:quick-phrases:v1'
const DEFAULT_QUICK_PHRASES = ['展开说明', '举例', '通俗易懂', '对比解释']
const MAX_QUICK_PHRASES = 12
const MAX_QUICK_PHRASE_LENGTH = 16
function normalizeQuickPhrases(value) {
  if (!Array.isArray(value)) return []
  const phrases = []
  for (const item of value) {
    const phrase = typeof item === 'string' ? item.trim().slice(0, MAX_QUICK_PHRASE_LENGTH) : ''
    if (phrase !== '' && !phrases.includes(phrase)) phrases.push(phrase)
    if (phrases.length === MAX_QUICK_PHRASES) break
  }
  return phrases
}
const savedQuickPhrases = (() => {
  try {
    const stored = localStorage.getItem(QUICK_PHRASES_KEY)
    return stored === null ? DEFAULT_QUICK_PHRASES : normalizeQuickPhrases(JSON.parse(stored))
  } catch { return DEFAULT_QUICK_PHRASES }
})()
const savedBranchAnchors = (() => {
  try {
    const value = JSON.parse(localStorage.getItem('dsh-synapse:branch-anchors') ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') : []
  } catch { return [] }
})()
const savedCardPositions = (() => {
  try {
    // Drop formats that were never persisted; the current key stores drags.
    localStorage.removeItem(LEGACY_CARD_POSITIONS_KEY)
    localStorage.removeItem('dsh-synapse:card-positions:v2')
    const value = JSON.parse(localStorage.getItem(CARD_POSITIONS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => Array.isArray(item) && typeof item[0] === 'string' && item[1] !== null && Number.isFinite(item[1].x) && Number.isFinite(item[1].y)) : []
  } catch { return [] }
})()
const savedCollapsedCards = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_CARDS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch { return [] }
})()
const savedExpandedCards = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(EXPANDED_CARDS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch { return [] }
})()
const savedInspectorWidth = (() => {
  try {
    const value = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY))
    return Number.isFinite(value) ? value : INSPECTOR_WIDTH_DEFAULT
  } catch { return INSPECTOR_WIDTH_DEFAULT }
})()
// Where the question card sits relative to its answer. Named from the
// question's point of view because that is what the picker asks: 问在上/下/左/右.
const QUESTION_POSITION_KEY = 'dsh-synapse:question-position:v1'
const QUESTION_POSITIONS = ['above', 'below', 'left', 'right']
const QUESTION_POSITION_LABELS = { above: '问在上', below: '问在下', left: '问在左', right: '问在右' }
const savedQuestionPosition = (() => {
  try {
    const value = localStorage.getItem(QUESTION_POSITION_KEY)
    return QUESTION_POSITIONS.includes(value) ? value : 'above'
  } catch { return 'above' }
})()
// A turn is TWO cards, stacked: the question (the user's own words, verbatim)
// and the answer (only the model's closing prose). One mixed card put the
// question in the title slot and the answer in a clipped sub-line, which is
// backwards for a map you scan. Both kinds are 252×88 = 16px padding + an 18px
// label row + a 2px gap + 3 lines; unfolded they grow to 8 lines.
const CARD_WIDTH = 252
const CARD_HEIGHT = 92
const CARD_HEIGHT_EXPANDED = 188
// Gap between the question and its answer, and the height of one turn column.
const CARD_PAIR_GAP = 20
const CARD_PAIR_HEIGHT = CARD_HEIGHT * 2 + CARD_PAIR_GAP
const CARD_GAP_Y = 40
// Horizontal distance between a card and its child: one card plus a gutter wide
// enough for the edge controls that ride the connector.
const CARD_STEP_X = CARD_WIDTH + 56
const CAMERA_INSET_X = 56
const CAMERA_INSET_Y = 56
// Cards outside the viewport (plus this world-space margin) are not mounted
// into the DOM; the margin pre-mounts cards just before they scroll into view
// so panning never flashes empty space.
const VIEWPORT_MARGIN = 1400
const state = {
  summaries: [], workspace: null, activeId: null, selectedCardId: null, mode: 'canvas', zoom: 1, zoomTarget: 1, currentDsh: null, sidebarCollapsed: false,
  questionPosition: savedQuestionPosition, arrangementMenuOpen: false, arrangementMenuAnchor: null, workspaceMenuOpen: false,
  dshWorkspaces: [], selectedDshWorkspaceId: null,
  historyBySession: new Map(), historyRequests: new Map(), pendingReplies: new Map(), pendingRpc: new Map(), liveReplies: new Map(),
  // Message bodies are not part of the workspace payload; they are fetched per
  // screenful and cached here (issue #42).
  bodies: new Map(), bodyRequests: new Set(), bodyFailures: new Set(), bodiesLoaded: new Set(),
  archivedSessionIds: new Set(),
  draft: null, error: '', workspaceLoad: 0, branchAnchors: new Map(savedBranchAnchors), cardPositions: new Map(savedCardPositions), collapsedCardIds: new Set(savedCollapsedCards), expandedCardIds: new Set(savedExpandedCards), quickPhrases: savedQuickPhrases, quickPhraseEditorOpen: false,
  dragging: false, canvasGesture: false, canvasRefreshAfter: 0, canvasViewInitialized: false, canvasCamera: { x: 0, y: 0 }, mapCardSessionSwitches: new Set(),
  expandedMessageIds: new Set(),
  canvasCards: undefined, canvasCardsById: undefined, canvasGraph: undefined, mountedCardIds: new Set(), canvasNeedsCenter: false,
  detailScrollByThread: new Map(), detailThreadId: null, detailTargetCardId: null,
  inspectorCardId: null, inspectorOpening: false, inspectorScrollByCard: new Map(), inspectorWidth: savedInspectorWidth,
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
/** Shorten text for a native tooltip, never mid-surrogate. */
const clipText = (value, limit) => {
  const text = String(value ?? '')
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`
}
const currentThread = () => state.workspace?.threads.find(thread => thread.id === state.activeId) ?? state.workspace?.threads[0] ?? null
const threadListTitle = thread => thread.dshSessionTitle ?? thread.title ?? questionFor(thread)

function rememberBranchAnchor(sessionId, cardId) {
  state.branchAnchors.set(sessionId, cardId)
  try { localStorage.setItem('dsh-synapse:branch-anchors', JSON.stringify([...state.branchAnchors])) } catch { /* Private browsing may disable local storage. */ }
}

function persistCardPositions() {
  try { localStorage.setItem(CARD_POSITIONS_KEY, JSON.stringify([...state.cardPositions])) } catch { /* Private browsing may disable local storage. */ }
}

function persistCollapsedCards() {
  try { localStorage.setItem(COLLAPSED_CARDS_KEY, JSON.stringify([...state.collapsedCardIds])) } catch { /* Private browsing may disable local storage. */ }
}

function persistExpandedCards() {
  try { localStorage.setItem(EXPANDED_CARDS_KEY, JSON.stringify([...state.expandedCardIds])) } catch { /* Private browsing may disable local storage. */ }
}

function persistQuickPhrases() {
  try { localStorage.setItem(QUICK_PHRASES_KEY, JSON.stringify(state.quickPhrases)) } catch { /* Private browsing may disable local storage. */ }
}

function persistQuestionPosition() {
  try { localStorage.setItem(QUESTION_POSITION_KEY, state.questionPosition) } catch { /* Private browsing may disable local storage. */ }
}

/**
 * 44×34 diagram of one arrangement. 答 is the dark chip and 问 the outlined one,
 * the same reading as the cards themselves, and the caption spells it out —
 * "问在上" leaves no room for guessing which way round it is.
 */
function arrangementThumb(position) {
  const chips = {
    above: '<rect class="thumb-answer" x="6" y="19" width="32" height="12" rx="2"/><rect class="thumb-question" x="6" y="3" width="32" height="12" rx="2"/>',
    below: '<rect class="thumb-answer" x="6" y="3" width="32" height="12" rx="2"/><rect class="thumb-question" x="6" y="19" width="32" height="12" rx="2"/>',
    left: '<rect class="thumb-answer" x="23" y="3" width="15" height="28" rx="2"/><rect class="thumb-question" x="6" y="3" width="15" height="28" rx="2"/>',
    right: '<rect class="thumb-answer" x="6" y="3" width="15" height="28" rx="2"/><rect class="thumb-question" x="23" y="3" width="15" height="28" rx="2"/>',
  }
  return `<svg class="arrangement-thumb" viewBox="0 0 44 34" aria-hidden="true">${chips[position]}</svg>`
}

/** The picker itself: four clickable diagrams, one of them current. */
function arrangementMenu() {
  const anchor = state.arrangementMenuAnchor
  const style = anchor === null || anchor === undefined ? '' : ` style="left:${anchor.left}px;top:${anchor.top}px"`
  const open = state.arrangementMenuOpen === true
  const options = QUESTION_POSITIONS.map(position => {
    const active = state.questionPosition === position
    return `<button type="button" class="arrangement-option${active ? ' active' : ''}" data-action="set-question-position" data-position="${position}" aria-pressed="${active ? 'true' : 'false'}" title="${QUESTION_POSITION_LABELS[position]}">${arrangementThumb(position)}<span>${QUESTION_POSITION_LABELS[position]}</span></button>`
  }).join('')
  return `<div class="arrangement-menu" role="group" aria-label="问与答的排列方式"${open ? '' : ' hidden'}${style}><p class="arrangement-title">问 放在 答 的哪一边</p><div class="arrangement-grid">${options}</div><p class="arrangement-note">切换后自动重新整理；手工拖过的位置会重置</p></div>`
}

function rememberCardPosition(cardId, position, aliases = []) {
  state.cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
  for (const alias of aliases) state.cardPositions.set(alias, { x: Math.round(position.x), y: Math.round(position.y) })
  persistCardPositions()
}

function resetCardPositions() {
  state.cardPositions.clear()
  persistCardPositions()
  try {
    localStorage.removeItem(LEGACY_CARD_POSITIONS_KEY)
    localStorage.removeItem('dsh-synapse:card-positions:v2')
  } catch { /* Private browsing may disable local storage. */ }
}

function resetCanvasCamera() {
  state.canvasViewInitialized = false
  state.canvasCamera = { x: 0, y: 0 }
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? '请求失败')
  return body
}

function post(type, payload = {}) {
  if (window.parent !== window) window.parent.postMessage({ source: 'dsh-synapse', type, ...payload }, window.location.origin)
}

function dshRpc(type, payload = {}) {
  if (window.parent === window) return Promise.reject(new Error('请从 DSH 页面打开 Synapse 后再操作会话'))
  const requestId = crypto.randomUUID()
  post(type, { requestId, ...payload })
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      state.pendingRpc.delete(requestId)
      reject(new Error('DSH 未在规定时间内响应'))
    }, 20_000)
    state.pendingRpc.set(requestId, { resolve, reject, timer })
  })
}

function settleRpc(requestId, value, error) {
  const pending = state.pendingRpc.get(requestId)
  if (pending === undefined) return
  state.pendingRpc.delete(requestId)
  window.clearTimeout(pending.timer)
  if (error === undefined) pending.resolve(value)
  else pending.reject(error instanceof Error ? error : new Error(String(error)))
}

function setError(error = '') { state.error = error instanceof Error ? error.message : error; render() }

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

// ── Markdown ──────────────────────────────────────────────────────────────
// The answers are model output, so the parser has to survive whatever the model
// emits, not a tidy test fixture. Two rules: every character is escaped before
// any tag is produced (no raw HTML passthrough), and every construct the app
// renders — a `---` rule, a `>` quote, a fence, a table — gets its own element
// instead of falling through to a paragraph. A line that is only `---` used to
// end up as literal dashes, and `>` as a literal angle bracket, because the old
// parser knew paragraphs, headings, lists, fences and tables only.
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)/g

/** Only these schemes may become a real anchor; everything else stays text. */
function safeHref(url) {
  return /^(?:https?:|mailto:)/i.test(url) ? url : null
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(MARKDOWN_LINK, (whole, label, url) => {
      const href = safeHref(url)
      return href === null ? whole : `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
}

const tableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())

const isTableDelimiter = line => {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell))
}

const THEMATIC_BREAK = /^ {0,3}(?:(?:- *){3,}|(?:\* *){3,}|(?:_ *){3,})$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const QUOTE_LINE = /^ {0,3}> ?(.*)$/
// A quote block may start with `>` and continue with unmarked lines that belong
// to the same paragraph (CommonMark's "lazy continuation").
const BLOCK_START = /^ {0,3}(?:#{1,6}\s|>|\||(?:[-*+]|\d+[.)])\s|(`{3,}|~{3,}))|^ {0,3}(?:(?:- *){3,})\s*$/

/** Nested and flat lists. Returns the HTML plus the line index to resume at. */
function markdownList(lines, index) {
  const first = LIST_ITEM.exec(lines[index])
  const indent = first[1].length
  const ordered = /^\d/.test(first[2])
  const items = []
  while (index < lines.length) {
    const next = LIST_ITEM.exec(lines[index])
    if (next === null || next[1].length < indent) break
    if (next[1].length > indent) {
      // A deeper marker belongs to the item that was just closed.
      if (items.length === 0) break
      const nested = /^\d/.test(next[2]) === ordered
        ? markdownList(lines, index)
        : { html: '', index }
      if (nested.html === '') break
      // The nested list belongs INSIDE the previous <li>, not after it.
      items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, `${nested.html}</li>`)
      index = nested.index
      continue
    }
    if (/^\d/.test(next[2]) !== ordered) break
    let text = next[3]
    index++
    while (index < lines.length) {
      const line = lines[index]
      const marker = LIST_ITEM.exec(line)
      if (line.trim() === '') break
      // A marker at the same or a deeper indent starts another item / a nested
      // list; either way it is not continuation text.
      if (marker !== null) break
      // Continuation text must be visibly indented under the marker.
      if (!/^ {2,}\S/.test(line)) break
      text += ` ${line.trim()}`
      index++
    }
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text)
    items.push(task === null
      ? `<li>${inlineMarkdown(text)}</li>`
      : `<li class="task-item"><span class="task-box${task[1] === ' ' ? '' : ' is-checked'}" aria-hidden="true"></span>${inlineMarkdown(task[2])}</li>`)
  }
  return { html: `<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`, index }
}

// ── Code colouring ────────────────────────────────────────────────────────
// A fence is the one place in an answer where colour carries meaning, so it
// gets a small single-pass tokenizer instead of a dependency: comments,
// strings, numbers, words, and markup brackets. Nothing is parsed into a tree
// and nothing is ever emitted unescaped — a token is `escapeHtml` of a slice of
// the original text, wrapped in a span. The palette (tokens.css, `--syn-tok-*`)
// copies JetBrains' own default schemes, IntelliJ Light and Darcula, because
// that is the editor most readers already have open next to the answer.
const CODE_FAMILY = {
  // C-like: the braced languages. Adding one here is the whole job — the
  // tokenizer only needs the family, never per-language rules.
  js: 'script', mjs: 'script', cjs: 'script', jsx: 'script', ts: 'script', tsx: 'script',
  javascript: 'script', typescript: 'script',
  java: 'script', kt: 'script', kts: 'script', kotlin: 'script', scala: 'script',
  groovy: 'script', gradle: 'script', cs: 'script', csharp: 'script', 'c#': 'script',
  c: 'script', h: 'script', m: 'script', cc: 'script', cpp: 'script', cxx: 'script',
  hpp: 'script', hh: 'script', 'c++': 'script', objc: 'script', objectivec: 'script',
  go: 'script', golang: 'script', rs: 'script', rust: 'script', swift: 'script',
  dart: 'script', php: 'script', fs: 'script', fsharp: 'script', vb: 'script',
  zig: 'script', nim: 'script', sol: 'script', solidity: 'script',
  json: 'data', jsonc: 'data', json5: 'data', yaml: 'data', yml: 'data', toml: 'data',
  ini: 'data', conf: 'data', properties: 'data',
  py: 'hash', python: 'hash', rb: 'hash', ruby: 'hash', pl: 'hash', perl: 'hash',
  r: 'hash', jl: 'hash', julia: 'hash', ex: 'hash', exs: 'hash', elixir: 'hash',
  sh: 'hash', bash: 'hash', zsh: 'hash', fish: 'hash', shell: 'hash', console: 'hash',
  powershell: 'hash', ps1: 'hash', dockerfile: 'hash', makefile: 'hash', dotenv: 'hash',
  sql: 'dash', lua: 'dash',
  css: 'css', scss: 'css', sass: 'css', less: 'css', stylus: 'css',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
}
// Fences that are output, not source: colouring them would paint ordinary
// words as keywords. Anything else unknown still gets the C-like default,
// because a missing alias must never be the reason a block stays flat.
const CODE_PLAIN = new Set('text txt plain plaintext log logs output diff patch csv tsv md markdown mermaid ascii art'.split(' '))
const CODE_WORDS = {
  script: new Set('abstract as assert async await break case catch class const continue crate debugger declare default delete do else enum export extends final finally fn for from function get if impl implements import in instanceof interface let loop mod mut native new of package private protected pub public readonly return satisfies set static super switch synchronized this throw throws trait transient try type typeof unsafe use var void volatile where while with yield'.split(' ')),
  hash: new Set('and as assert async await break case class continue def del elif else esac eval except exec exit export fi finally for from function global if import in is lambda local nonlocal not or pass raise readonly return select set source then try unless until while with yield fi done do'.split(' ')),
  dash: new Set('add all alter and as asc begin by cascade case check column commit constraint create default delete desc distinct drop else elseif end exists foreign from full function group having if in index inner insert into join key left limit nil not null offset on or order outer primary procedure references right rollback select table then trigger union unique update values view when where'.split(' ')),
  data: new Set('true false null yes no on off'.split(' ')),
  css: new Set(),
  markup: new Set(),
}
// Lowercase primitives read as types, not keywords (IDEA colours them as a
// class reference rather than an orange `const`).
const CODE_PRIMITIVES = new Set('string number boolean object any unknown never bigint symbol int long double float char byte short'.split(' '))
const codeToken = (kind, text) => `<span class="tok-${kind}">${escapeHtml(text)}</span>`

/** ` </name attr="value" > `: only the name, the attributes and their values. */
function markupTag(tag) {
  const match = /^(<\/?)([\w:.-]+)([\s\S]*)$/.exec(tag)
  if (match === null) return escapeHtml(tag)
  let out = `${escapeHtml(match[1])}${codeToken('tag', match[2])}`
  const attributes = /(\s*)([\w:.-]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+))?/g
  let tail = 0
  for (const found of match[3].matchAll(attributes)) {
    out += escapeHtml(match[3].slice(tail, found.index)) + escapeHtml(found[1]) + codeToken('attr', found[2])
    if (found[3] !== undefined) out += escapeHtml(found[3])
    if (found[4] !== undefined) out += codeToken('str', found[4])
    tail = found.index + found[0].length
  }
  return out + escapeHtml(match[3].slice(tail))
}

function highlightMarkup(text) {
  let out = ''
  let index = 0
  while (index < text.length) {
    const open = text.indexOf('<', index)
    if (open === -1) return out + escapeHtml(text.slice(index))
    if (open > index) out += escapeHtml(text.slice(index, open))
    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open + 4)
      const stop = close === -1 ? text.length : close + 3
      out += codeToken('com', text.slice(open, stop))
      index = stop
      continue
    }
    const close = text.indexOf('>', open)
    if (close === -1) return out + escapeHtml(text.slice(open))
    out += markupTag(text.slice(open, close + 1))
    index = close + 1
  }
  return out
}

/**
 * Colours one fenced block. `language` is the fence tag as written. Only the
 * output-shaped tags (`text`, `diff`, `log`, …) are left flat; everything else,
 * including a tag this table has never heard of, gets the C-like default — a
 * missing alias must never be why a block of Java stays monochrome.
 * @param text - the block body, exactly as written.
 * @param language - fence info string.
 * @returns escaped HTML with `tok-*` spans.
 */
function highlightCode(text, language) {
  const label = String(language ?? '').trim().toLowerCase()
  if (CODE_PLAIN.has(label)) return escapeHtml(text)
  const family = CODE_FAMILY[label] ?? 'script'
  if (family === 'markup') return highlightMarkup(text)
  const words = CODE_WORDS[family]
  const lineComment = family === 'css' ? null : family === 'hash' ? '#' : family === 'dash' ? '--' : '//'
  const word = /[A-Za-z_$][\w$]*/y
  const number = /(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z%_]*/y
  const length = text.length
  let out = ''
  let index = 0
  // The next character that is not a space or a tab — enough to tell `name(`
  // (a call) from `name:` (a key) without copying the rest of the block.
  const peek = at => {
    while (at < length && (text[at] === ' ' || text[at] === '\t')) at++
    return text[at]
  }
  while (index < length) {
    const character = text[index]
    if (lineComment !== null && text.startsWith(lineComment, index)) {
      const newline = text.indexOf('\n', index)
      const stop = newline === -1 ? length : newline
      out += codeToken('com', text.slice(index, stop))
      index = stop
      continue
    }
    if (text.startsWith('/*', index)) {
      const close = text.indexOf('*/', index + 2)
      const stop = close === -1 ? length : close + 2
      out += codeToken('com', text.slice(index, stop))
      index = stop
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      const triple = family === 'hash' && text.startsWith(character.repeat(3), index)
      const quote = triple ? character.repeat(3) : character
      let stop = index + quote.length
      while (stop < length) {
        if (text[stop] === '\\') { stop += 2; continue }
        if (text.startsWith(quote, stop)) { stop += quote.length; break }
        // A plain quote ends at the line; a template literal may wrap.
        if (!triple && quote !== '`' && text[stop] === '\n') break
        stop++
      }
      // In JSON/YAML/TOML the string before a colon is a key, not a value.
      const isKey = family === 'data' && peek(stop) === ':'
      out += codeToken(isKey ? 'key' : 'str', text.slice(index, stop))
      index = stop
      continue
    }
    if (family === 'css' && character === '#') {
      const colour = /#[0-9a-fA-F]{3,8}\b/y
      colour.lastIndex = index
      const found = colour.exec(text)
      if (found !== null) {
        out += codeToken('num', found[0])
        index += found[0].length
        continue
      }
    }
    // `@media`, `$brand`, `--custom-property`: CSS names its own things.
    if (family === 'css' && (character === '@' || character === '$')) {
      const directive = /[@$][\w-]*/y
      directive.lastIndex = index
      const found = directive.exec(text)
      if (found !== null) {
        out += codeToken('key', found[0])
        index += found[0].length
        continue
      }
    }
    if (character >= '0' && character <= '9' && (index === 0 || !/[\w$.]/.test(text[index - 1]))) {
      number.lastIndex = index
      const found = number.exec(text)
      if (found !== null) {
        out += codeToken('num', found[0])
        index += found[0].length
        continue
      }
    }
    word.lastIndex = index
    const found = word.exec(text)
    if (found !== null) {
      const value = found[0]
      const after = peek(index + value.length)
      let kind = null
      if (family === 'css' && after === ':') kind = 'key'
      else if (words.has(value)) kind = 'key'
      else if (CODE_PRIMITIVES.has(value) && family === 'script') kind = 'type'
      else if (after === '(') kind = 'fn'
      else if (/^[A-Z]/.test(value)) kind = 'type'
      out += kind === null ? escapeHtml(value) : codeToken(kind, value)
      index += value.length
      continue
    }
    out += escapeHtml(character)
    index++
  }
  return out
}

function markdownBlock(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const output = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (line.trim() === '') { index++; continue }

    // ``` / ~~~ fences, including inside a quote. An unclosed fence (a stream
    // still arriving) renders as a code block to the end rather than as prose.
    const fence = FENCE_OPEN.exec(line)
    if (fence !== null) {
      const marker = fence[1]
      const language = fence[2]
      const body = []
      index++
      while (index < lines.length && !lines[index].trim().startsWith(marker)) body.push(lines[index++])
      if (index < lines.length) index++
      const label = language === '' ? '' : ` data-lang="${escapeHtml(language)}"`
      output.push(`<pre class="md-code"${label}><code>${highlightCode(body.join('\n'), language)}</code></pre>`)
      continue
    }

    if (THEMATIC_BREAK.test(line)) {
      output.push('<hr>')
      index++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      index++
      continue
    }

    const quote = QUOTE_LINE.exec(line)
    if (quote !== null) {
      const body = [quote[1]]
      index++
      while (index < lines.length) {
        const next = QUOTE_LINE.exec(lines[index])
        if (next !== null) { body.push(next[1]); index++; continue }
        // Lazy continuation: an unmarked line continues the quote until a
        // blank line or the start of another block.
        if (lines[index].trim() === '' || BLOCK_START.test(lines[index])) break
        body.push(lines[index++])
      }
      output.push(`<blockquote>${markdownBlock(body.join('\n'))}</blockquote>`)
      continue
    }

    if (LIST_ITEM.test(line)) {
      const list = markdownList(lines, index)
      output.push(list.html)
      index = Math.max(list.index, index + 1)
      continue
    }

    // GFM table: a leading-pipe header row followed by a |-delimiter row,
    // then any number of leading-pipe body rows.
    if (/^\s*\|/.test(line) && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const header = line
      const body = []
      index += 2
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        body.push(lines[index])
        index++
      }
      output.push(`<table><thead><tr>${tableCells(header).map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${tableCells(row).map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }

    const paragraph = []
    while (index < lines.length && lines[index].trim() !== '' && !BLOCK_START.test(lines[index])) paragraph.push(lines[index++])
    // A marker-only line such as PowerShell's "+ " diagnostic is neither a
    // list item nor paragraph content under the rules above. Consume it so
    // the parser always makes progress.
    if (paragraph.length === 0) paragraph.push(lines[index++])
    output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`)
  }
  return output.join('')
}

// Markdown parsing is pure CPU and repeats for every card on every canvas
// rebuild; cache the rendered HTML by input text so stable answers are never
// re-parsed. Bounded: streaming partial texts churn keys, so evict oldest.
const markdownCache = new Map()
const MARKDOWN_CACHE_LIMIT = 5000
function renderMarkdown(text) {
  const key = String(text)
  const cached = markdownCache.get(key)
  if (cached !== undefined) return cached
  const rendered = markdownBlock(key)
  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) markdownCache.delete(markdownCache.keys().next().value)
  markdownCache.set(key, rendered)
  return rendered
}

// ── Answer summary ────────────────────────────────────────────────────────
// Cards show a summary clipped from the answer itself, never a generated one:
// no extra model call, no waiting, and the same text at every zoom level. The
// extraction drops what cannot be read in two lines anyway (fences, tables,
// rules, tool transcripts) and keeps the first sentences of prose.
const summaryCache = new Map()
const SUMMARY_CACHE_LIMIT = 2000
function answerPlainText(text) {
  return String(text)
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')       // code fences
    .replace(/^\s*\|.*\|\s*$/gm, ' ')            // table rows
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ') // rules
    .replace(/^\s{0,3}>\s?/gm, '')               // quote markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')          // heading markers
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')   // list markers
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, '$1') // links / images keep the label
    .replace(/`{1,3}([^`\n]*)`{1,3}/g, '$1')     // inline code
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')
    .replace(/<[^>\n]+>/g, ' ')                  // stray tags / autolinks
    .replace(/\s+/g, ' ')
    .trim()
}

// 8 lines of 12.5px text at the unfolded card width: the whole summary fits
// once the card is open, and the folded card clips it to 3 lines in CSS.
const SUMMARY_LIMIT = 150
function answerSummary(text, limit = SUMMARY_LIMIT) {
  const key = `${limit}\u0000${String(text)}`
  const cached = summaryCache.get(key)
  if (cached !== undefined) return cached
  const plain = answerPlainText(text)
  let summary = plain
  if (plain.length > limit) {
    // Prefer ending on a sentence boundary close to the budget, otherwise cut
    // on a space so the last word is not sliced in half.
    const window = plain.slice(0, limit + 24)
    const sentence = /[^。！？!?;；\n]*[。！？!?;；]/.exec(window)
    if (sentence !== null && sentence[0].trim().length >= limit * 0.5) summary = sentence[0].trim()
    else {
      const space = window.lastIndexOf(' ')
      summary = `${(space > limit * 0.6 ? window.slice(0, space) : plain.slice(0, limit)).trim()}…`
    }
  }
  if (summaryCache.size >= SUMMARY_CACHE_LIMIT) summaryCache.delete(summaryCache.keys().next().value)
  summaryCache.set(key, summary)
  return summary
}

function overlapsCard(position, height, other) {
  return position.x < other.x + CARD_WIDTH && position.x + CARD_WIDTH > other.x
    && position.y < other.y + other.height && position.y + height > other.y
}

/** A card's height in the flow: folded by default, taller while unfolded. */
function cardHeight(card) {
  return card !== null && card !== undefined && card.expanded === true ? CARD_HEIGHT_EXPANDED : CARD_HEIGHT
}

/* ── 问/答相对位置 ─────────────────────────────────────────────────────────
   `state.questionPosition` says where the question card sits relative to its
   answer: above / below / left / right. Everything that depends on geometry
   reads these three helpers instead of assuming "answer under question":
   the offset inside a pair, how far one turn sits from the previous one, and
   how far apart two lanes are. */
const isStackedPosition = () => state.questionPosition === 'above' || state.questionPosition === 'below'

/** The answer's offset from its question, in world pixels. */
function answerOffset(question, answer) {
  switch (state.questionPosition) {
    case 'below': return { x: 0, y: -(cardHeight(answer) + CARD_PAIR_GAP) }
    case 'left': return { x: CARD_WIDTH + CARD_PAIR_GAP, y: 0 }
    case 'right': return { x: -(CARD_WIDTH + CARD_PAIR_GAP), y: 0 }
    default: return { x: 0, y: cardHeight(question) + CARD_PAIR_GAP }
  }
}

/**
 * Distance from one turn's question to the next turn's question. A turn is one
 * card wide when the pair is stacked and two when it is side by side; with the
 * answer on the question's left the next turn starts past the *question*, so the
 * step grows by the answer's width instead.
 */
function turnStepX() {
  return state.questionPosition === 'right' ? CARD_WIDTH * 2 + CARD_PAIR_GAP + 56 : CARD_STEP_X
}

function laneStepY() {
  return isStackedPosition() ? CARD_PAIR_HEIGHT + CARD_GAP_Y : CARD_HEIGHT + CARD_GAP_Y
}

function firstAvailableCardPosition(position, height, occupied) {
  const candidate = { x: Math.round(position.x), y: Math.max(82, Math.round(position.y)) }
  while (true) {
    const collisions = occupied.filter(other => overlapsCard(candidate, height, other))
    if (collisions.length === 0) return candidate
    candidate.y = Math.max(...collisions.map(other => other.y + other.height + CARD_GAP_Y))
  }
}

function connectorPath(fromPosition, fromHeight, toPosition, toHeight, pair = false) {
  // A question→answer link is vertical *by role*, not by coordinates: dragging
  // either card a few pixels must not flip it back to the lateral bezier. The
  // curve's control points sit on the facing edges, so an aligned pair reads as
  // a straight drop and a nudged one as a short S.
  if (pair) {
    const fromCx = fromPosition.x + CARD_WIDTH / 2
    const toCx = toPosition.x + CARD_WIDTH / 2
    const dx = toCx - fromCx
    const dy = (toPosition.y + toHeight / 2) - (fromPosition.y + fromHeight / 2)
    // The layout can put the answer above, below, left or right of its
    // question, and dragging can move it anywhere: the dominant axis decides
    // the link's shape, so it bends instead of flipping between two styles.
    if (Math.abs(dy) >= Math.abs(dx)) {
      const sign = dy >= 0 ? 1 : -1
      const start = fromPosition.y + (sign > 0 ? fromHeight : 0)
      const end = toPosition.y + (sign > 0 ? 0 : toHeight)
      const bend = Math.min(28, Math.max(8, Math.abs(end - start) * .45))
      return `M ${fromCx} ${start} C ${fromCx} ${start + sign * bend}, ${toCx} ${end - sign * bend}, ${toCx} ${end}`
    }
    const sign = dx >= 0 ? 1 : -1
    const start = fromPosition.x + (sign > 0 ? CARD_WIDTH : 0)
    const end = toPosition.x + (sign > 0 ? 0 : CARD_WIDTH)
    const fromMid = fromPosition.y + fromHeight / 2
    const toMid = toPosition.y + toHeight / 2
    const bend = Math.min(28, Math.max(8, Math.abs(end - start) * .45))
    return `M ${start} ${fromMid} C ${start + sign * bend}, ${fromMid}, ${end - sign * bend}, ${toMid}, ${end} ${toMid}`
  }
  const fromX = fromPosition.x + CARD_WIDTH
  const fromY = fromPosition.y + fromHeight / 2
  const toX = toPosition.x
  const toY = toPosition.y + toHeight / 2
  const bend = Math.min(110, Math.max(36, Math.abs(toX - fromX) * .2))
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

/** A pair link is the one from a turn's question to that same turn's answer. */
function isPairLink(fromCard, toCard) {
  return fromCard?.role === 'question' && toCard?.role === 'answer'
    && fromCard.dshThreadId === toCard.dshThreadId
    && fromCard.turnIndex === toCard.turnIndex
}

function elementHeight(element) {
  const measured = element instanceof HTMLElement ? element.offsetHeight : 0
  return measured > 0 ? measured : CARD_HEIGHT
}

function connectorPathFromElements(fromCard, toCard) {
  const fromPosition = { x: Number.parseFloat(fromCard.style.left), y: Number.parseFloat(fromCard.style.top) }
  const toPosition = { x: Number.parseFloat(toCard.style.left), y: Number.parseFloat(toCard.style.top) }
  if (![fromPosition.x, fromPosition.y, toPosition.x, toPosition.y].every(Number.isFinite)) return null
  // Roles come from the element itself, so the pair link keeps its vertical
  // shape while one of the two cards is being dragged.
  const pair = fromCard.dataset.role === 'question' && toCard.dataset.role === 'answer'
  return connectorPath(fromPosition, elementHeight(fromCard), toPosition, elementHeight(toCard), pair)
}

function selectorValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Connector paths are rebuilt together with the canvas DOM; cache the mapping
// from card id to its incident paths so dragging never scans the whole SVG.
let connectorPathsByCard = new Map()
function cacheCardConnectors() {
  connectorPathsByCard = new Map()
  const viewport = document.querySelector('.canvas-viewport')
  if (!(viewport instanceof HTMLElement)) return
  for (const path of viewport.querySelectorAll('.connectors path[data-from]')) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    for (const id of [fromId, toId]) {
      const paths = connectorPathsByCard.get(id)
      if (paths === undefined) connectorPathsByCard.set(id, new Set([path]))
      else paths.add(path)
    }
  }
}

function refreshCardConnectors(cardId) {
  const paths = connectorPathsByCard.get(cardId)
  if (paths === undefined || paths.size === 0) return
  const byId = state.canvasCardsById
  if (byId === undefined) return
  for (const path of paths) {
    const fromId = path.getAttribute('data-from')
    const toId = path.getAttribute('data-to')
    if (fromId === null || toId === null) continue
    const fromCard = byId.get(fromId)
    const toCard = byId.get(toId)
    if (fromCard === undefined || toCard === undefined) continue
    // Data-driven endpoints: the counterpart card may be unmounted (outside
    // the viewport) but its position is still authoritative.
    path.setAttribute('d', connectorPath(fromCard.position, cardHeight(fromCard), toCard.position, cardHeight(toCard), isPairLink(fromCard, toCard)))
  }
}

function initialCanvasCamera(cards) {
  const draft = state.draft?.kind === 'new' ? { id: 'draft:new', position: { x: 86, y: 82 } } : draftPlacement(cards)
  // Focus the active conversation's latest turn, not its first: after many
  // rounds the canvas should open where work is happening, at the newest card.
  const activeCards = state.activeId === null || state.activeId === undefined ? [] : cards.filter(card => card.dshThreadId === state.activeId)
  const active = activeCards.at(-1)
  const focus = draft ?? active ?? cards[0]
  const position = focus?.position
  if (position === undefined) return { x: 0, y: 0 }
  return { x: CAMERA_INSET_X - position.x * state.zoom, y: CAMERA_INSET_Y - position.y * state.zoom }
}

function placeConversationCards(cards) {
  const saved = new Map(cards.flatMap(card => {
    if (card.positionLocked !== true) return []
    const position = state.cardPositions.get(card.id) ?? state.cardPositions.get(card.positionKey)
    return position === undefined ? [] : [[card.id, { x: position.x, y: position.y }]]
  }))
  const occupied = []
  const placedById = new Map()
  for (const card of cards) {
    const height = cardHeight(card)
    const position = saved.get(card.id)
    if (position !== undefined) {
      card.position = position
      placedById.set(card.id, card)
      occupied.push({ x: position.x, y: position.y, height })
      continue
    }
    // An answer follows its question's *final* spot, so dragging the question
    // (which pins it) carries the answer along instead of separating the pair.
    const question = card.role === 'answer' ? placedById.get(card.id.replace(/:a$/, ':q')) : undefined
    const offset = question === undefined ? undefined : answerOffset(question, card)
    const candidate = question === undefined || offset === undefined
      ? card.naturalPosition ?? card.position
      : { x: question.position.x + offset.x, y: question.position.y + offset.y }
    card.position = firstAvailableCardPosition(candidate, height, occupied)
    placedById.set(card.id, card)
    occupied.push({ x: card.position.x, y: card.position.y, height })
  }
  return cards
}

function layoutConversationGraph(cards, threads) {
  const childrenByThread = new Map()
  for (const thread of threads) {
    if (thread.parentId === null) continue
    const children = childrenByThread.get(thread.parentId) ?? []
    children.push(thread.id)
    childrenByThread.set(thread.parentId, children)
  }
  const laneByThread = new Map()
  const visitThread = threadId => {
    if (laneByThread.has(threadId)) return
    laneByThread.set(threadId, laneByThread.size)
    for (const childId of childrenByThread.get(threadId) ?? []) visitThread(childId)
  }
  for (const thread of threads) if (thread.parentId === null) visitThread(thread.id)
  for (const thread of threads) visitThread(thread.id)

  const byId = new Map(cards.map(card => [card.id, card]))
  const laneTop = card => 82 + (laneByThread.get(card.dshThreadId) ?? 0) * laneStepY()
  const positioned = new Map()
  const positionFor = (card, visiting = new Set()) => {
    if (positioned.has(card.id)) return positioned.get(card.id)
    if (visiting.has(card.id)) return { x: 86, y: laneTop(card) }
    visiting.add(card.id)
    let position
    if (card.role === 'answer') {
      // The answer sits where the chosen arrangement puts it. A question that
      // was unfolded pushes its own answer further away, not on top of it.
      const question = byId.get(card.id.replace(/:a$/, ':q'))
      const questionPosition = question === undefined ? undefined : positionFor(question, visiting)
      if (questionPosition === undefined) position = { x: 86, y: laneTop(card) }
      else {
        const offset = answerOffset(question, card)
        position = { x: questionPosition.x + offset.x, y: questionPosition.y + offset.y }
      }
    } else {
      const parent = card.parentId === null ? undefined : byId.get(card.parentId)
      const parentPosition = parent === undefined ? undefined : positionFor(parent, visiting)
      // With the answer on the question's left the turn begins one answer-width
      // before the question, so the step from the parent answer is wider.
      const answer = byId.get(card.id.replace(/:q$/, ':a'))
      position = {
        x: parentPosition === undefined ? 86 : parentPosition.x + turnStepX(),
        // "问在下" hangs the question below its answer inside the same band.
        y: laneTop(card) + (state.questionPosition === 'below' && answer !== undefined ? cardHeight(answer) + CARD_PAIR_GAP : 0),
      }
    }
    visiting.delete(card.id)
    positioned.set(card.id, position)
    return position
  }
  for (const card of cards) {
    card.naturalPosition = positionFor(card)
    if (!card.positionLocked) card.position = card.naturalPosition
  }
  return placeConversationCards(cards)
}

/** One node of a turn. A turn owns two: its question and its answer. */
function turnCardNode(thread, turn, role, previousAnswerId) {
  const id = `${thread.id}:turn:${turn.seq ?? 'empty'}${role === 'answer' ? ':a' : ':q'}`
  // The question reuses the pre-split position key, so an existing layout keeps
  // its left-to-right rhythm and only gains the answer card underneath.
  const positionKey = role === 'answer' ? `${thread.id}:turn-index:${turn.index}:a` : `${thread.id}:turn-index:${turn.index}`
  const saved = state.cardPositions?.get(id) ?? state.cardPositions?.get(positionKey)
  return {
    id,
    positionKey,
    dshThreadId: thread.id,
    sourceParentId: thread.parentId,
    parentId: role === 'answer' ? null : previousAnswerId,
    role,
    turnIndex: turn.index,
    turnSeq: turn.seq,
    sourceSeq: role === 'question' ? turn.questionMessage?.sourceSeq : turn.answer?.sourceSeq,
    expanded: false,
    naturalPosition: { x: 86, y: 82 },
    position: { x: 86, y: 82 },
    positionLocked: saved !== undefined,
    question: turn.question,
    questionMessage: turn.questionMessage,
    answer: turn.answer,
    error: turn.error,
    processCount: turn.processCount,
  }
}

// A turn is TWO cards: the question (the user's own words, nothing else) and
// the answer (only the model's closing prose — tool calls and tool results are
// never part of it). They share a column, the answer hanging just under its
// question, so a lane reads 问 → 答 top to bottom and the conversation runs left
// to right. Splitting them is what stops a card from showing the question in the
// title slot and the answer as a clipped afterthought.
function conversationCards(threads) {
  const cards = []
  const nodesByThread = new Map()
  for (const thread of threads) {
    const messages = messagesFor(thread)
    const turns = []
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const question = messages[messageIndex]
      if (question.kind !== 'user') continue
      const replies = []
      const errors = []
      let processCount = 0
      for (let replyIndex = messageIndex + 1; replyIndex < messages.length; replyIndex++) {
        const reply = messages[replyIndex]
        if (reply.kind === 'user') break
        if (reply.kind === 'assistant') replies.push(reply)
        if (reply.kind === 'error') errors.push(reply)
        if (Array.isArray(reply.process)) processCount += reply.process.length
        else if (reply.kind === 'tool') processCount += 1
      }
      turns.push({
        index: turns.length,
        seq: question.sourceSeq ?? messageIndex,
        question: question.text,
        questionMessage: question,
        // The closing prose of the turn: the last assistant message that has
        // text at all. An intermediate "let me look" line is not the answer.
        answer: replies.at(-1) ?? null,
        error: errors.at(-1) ?? null,
        processCount,
      })
    }
    const liveReply = state.liveReplies.get(thread.dshSessionId)
    const latestTurn = turns.at(-1)
    if (liveReply?.running && latestTurn !== undefined && (latestTurn.answer === null || latestTurn.answer.pending === true)) latestTurn.answer = { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString() }
    if (turns.length === 0) {
      turns.push({ index: 0, seq: undefined, question: thread.dshSessionTitle ?? thread.title, answer: null, error: null, processCount: 0, empty: true })
    }
    const nodes = []
    let previousAnswerId = null
    for (const turn of turns) {
      const questionNode = turnCardNode(thread, turn, 'question', previousAnswerId)
      nodes.push(questionNode)
      if (turn.empty === true) continue
      // An answered-less turn still gets its answer node: the map should show
      // the wait, not hide it.
      const answerNode = turnCardNode(thread, turn, 'answer', null)
      answerNode.parentId = questionNode.id
      nodes.push(answerNode)
      previousAnswerId = answerNode.id
    }
    // The follow-up hangs off the newest answer, but both nodes of that turn are
    // flagged: the inspector opened from either one still offers 继续追问.
    nodes.at(-1).canContinue = true
    const lastQuestion = nodes.findLast(node => node.role === 'question')
    if (lastQuestion !== undefined) lastQuestion.canContinue = true
    nodesByThread.set(thread.id, nodes)
    cards.push(...nodes)
  }
  const byId = new Map(cards.map(card => [card.id, card]))
  for (const card of cards) {
    // Unfolded cards are physically taller, so the layout has to know before it
    // settles positions: a tall card pushes its neighbours down instead of
    // covering them.
    card.expanded = state.expandedCardIds?.has(card.id) === true
    if (card.role !== 'question' || card.parentId !== null) continue
    const parentNodes = nodesByThread.get(card.sourceParentId)
    const sourceThread = threads.find(thread => thread.id === card.dshThreadId)
    const firstQuestion = nodesByThread.get(card.dshThreadId)?.find(node => node.role === 'question')
    const seedLength = sourceThread?.sourceSeedLength ?? firstQuestion?.turnSeq
    // A fork inherits every parent event before DSH's durable seed boundary.
    // The latest parent turn below that boundary is the exact Turn where this
    // child was born. Canvas coordinates never participate in lineage.
    const inheritedTurn = Number.isSafeInteger(seedLength)
      ? parentNodes?.filter(node => Number.isInteger(node.turnSeq) && node.turnSeq < seedLength).at(-1)
      : undefined
    // Anchors persisted before the split name the old single card; map them onto
    // its answer, which is where a follow-up hangs from.
    const anchor = state.branchAnchors.get(card.dshThreadId)
    const anchoredNode = anchor === undefined ? undefined : byId.get(anchor) ?? byId.get(`${anchor}:a`) ?? byId.get(`${anchor}:q`)
    card.parentId = anchoredNode?.id ?? inheritedTurn?.id ?? null
  }
  return layoutConversationGraph(cards, threads)
}

function conversationGraphView(cards, collapsedCardIds = state.collapsedCardIds) {
  const cardIds = new Set(cards.map(card => card.id))
  const childrenByParent = new Map()
  for (const card of cards) {
    if (card.parentId === null || !cardIds.has(card.parentId)) continue
    const children = childrenByParent.get(card.parentId) ?? []
    children.push(card.id)
    childrenByParent.set(card.parentId, children)
  }

  const hiddenIds = new Set()
  for (const rootId of collapsedCardIds) {
    if (!cardIds.has(rootId)) continue
    const visited = new Set([rootId])
    const visit = parentId => {
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (visited.has(childId)) continue
        visited.add(childId)
        hiddenIds.add(childId)
        visit(childId)
      }
    }
    visit(rootId)
  }

  // Persisted collapse roots must remain visible even if malformed metadata
  // contains a cycle where two collapsed nodes otherwise hide each other.
  for (const rootId of collapsedCardIds) hiddenIds.delete(rootId)

  // Post-order accumulation: each card's descendant count is 1 + the sum of
  // its children's subtree sizes, so the whole graph is O(n) instead of a BFS
  // from every card (O(n²) on deep chains). Malformed parent cycles are
  // detected through the DFS path: every member of a cycle reaches every other
  // member plus the union of their off-cycle subtrees, so when the cycle entry
  // pops last, all members are settled to (cycleSize - 1) + off-cycle total,
  // which matches the per-card BFS' unique-descendant count.
  const descendantCounts = new Map()
  const inStack = new Set()
  for (const card of cards) {
    if (descendantCounts.has(card.id)) continue
    const stack = [{ id: card.id, children: childrenByParent.get(card.id) ?? [], index: 0 }]
    const path = [card.id]
    let cycleEntry = null
    let cycleMembers = null
    let cycleOffCycleTotal = 0
    inStack.add(card.id)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top.index < top.children.length) {
        const childId = top.children[top.index++]
        if (descendantCounts.has(childId)) continue
        if (inStack.has(childId)) {
          // Back edge: the nodes from childId up to top.id form a cycle.
          cycleEntry = childId
          cycleMembers = new Set(path.slice(path.indexOf(childId)))
          cycleOffCycleTotal = 0
          continue
        }
        inStack.add(childId)
        path.push(childId)
        stack.push({ id: childId, children: childrenByParent.get(childId) ?? [], index: 0 })
      } else {
        stack.pop()
        path.pop()
        inStack.delete(top.id)
        let count = 0
        for (const childId of top.children) {
          if (cycleMembers !== null && cycleMembers.has(childId)) continue // ring edge; base count added below
          count += 1 + (descendantCounts.get(childId) ?? 0)
        }
        if (cycleMembers !== null && cycleMembers.has(top.id)) cycleOffCycleTotal += count
        if (cycleMembers !== null && top.id === cycleEntry) {
          // All cycle members have popped (the entry pops last in post-order);
          // settle them so ancestors popping next read the final counts.
          const base = cycleMembers.size - 1
          for (const id of cycleMembers) descendantCounts.set(id, base + cycleOffCycleTotal)
          cycleEntry = null
          cycleMembers = null
        } else {
          descendantCounts.set(top.id, count)
        }
      }
    }
  }

  return {
    cards: cards.filter(card => !hiddenIds.has(card.id)),
    childCounts: new Map(cards.map(card => [card.id, childrenByParent.get(card.id)?.length ?? 0])),
    descendantCounts,
  }
}

function revealConversationThread(cards, threadId) {
  const byId = new Map(cards.map(card => [card.id, card]))
  let changed = false
  for (const target of cards.filter(card => card.dshThreadId === threadId)) {
    const visited = new Set([target.id])
    let parentId = target.parentId
    while (parentId !== null && !visited.has(parentId)) {
      visited.add(parentId)
      if (state.collapsedCardIds.delete(parentId)) changed = true
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  if (changed) persistCollapsedCards()
}

function canvasConnectors(cards) {
  const index = new Map(cards.map(card => [card.id, card]))
  const links = cards.map(card => {
    const parent = card.parentId === null ? null : index.get(card.parentId)
    if (parent === undefined || parent === null) return ''
    const active = card.dshThreadId === state.activeId && parent.dshThreadId === state.activeId ? ' active-connector' : ''
    return `<path class="${active.trim()}" data-from="${escapeHtml(parent.id)}" data-to="${escapeHtml(card.id)}" d="${connectorPath(parent.position, cardHeight(parent), card.position, cardHeight(card), isPairLink(parent, card))}"></path>`
  })
  const placement = draftPlacement(cards)
  if (placement !== null) {
    links.push(`<path class="draft-connector" data-from="${escapeHtml(placement.parent.id)}" data-to="draft" d="${connectorPath(placement.parent.position, cardHeight(placement.parent), placement.position, CARD_HEIGHT)}"></path>`)
  }
  return links.join('')
}

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

function isProcessMessage(message) {
  if (message.kind === 'tool' || message.kind === 'tool-result') return true
  return message.kind === 'assistant' && /(?:^|\n)\s*(?:bash|pwsh|powershell|web_search|web_fetch|browser|read_file|write_file)\s*\n\s*\{/.test(message.text)
}

function processSummary(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140) || '工具调用记录'
}

/**
 * One row of the transcript, styled the way the host renders a conversation:
 * the user's turn is a right-aligned bubble, the answer is the page itself
 * (plain prose, no card, no role header), and a tool/process record collapses
 * into a single quiet disclosure row. Everything the old card chrome carried
 * (avatar, "你 / DSH", timestamps, per-message borders) is gone — the reading
 * column and the bubble ARE the structure.
 */
function threadMessage(thread, message) {
  const isUser = message.kind === 'user'
  const messageId = `${thread.id}:${message.sourceSeq ?? `${message.kind}:${message.at}`}`
  const collapsible = isProcessMessage(message)
  const expanded = state.expandedMessageIds.has(messageId)
  const process = Array.isArray(message.process) && message.process.length > 0 ? message.process : null
  const streaming = message.pending ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>' : ''
  const body = message.pending && message.text === ''
    ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>'
    : `${renderMarkdown(message.text)}${streaming}${process === null ? '' : processRecords(process, messageId)}`
  const seq = `data-message-seq="${Number.isInteger(message.sourceSeq) ? message.sourceSeq : ''}"`
  if (collapsible) {
    return `<article class="message message-${message.kind} message-process${expanded ? ' expanded' : ''}" ${seq}><button class="message-fold" type="button" data-action="toggle-message" data-message="${escapeHtml(messageId)}" aria-expanded="${expanded}" aria-label="${expanded ? '收起过程记录' : '展开过程记录'}" title="${expanded ? '收起' : '展开'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg><span class="message-summary">${escapeHtml(processSummary(message.text))}</span></button>${expanded ? `<div class="message-body md">${body}</div>` : ''}</article>`
  }
  // The answer's only chrome is the branch handle under it, the way the host
  // puts message actions below the body instead of in a row of labels.
  const branch = !isUser && Number.isInteger(message.sourceSeq)
    ? `<footer class="message-actions"><button class="message-branch" type="button" data-action="open-branch" data-thread="${thread.id}" data-seq="${message.sourceSeq}" title="从此回答创建分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4.5 3v6a2.5 2.5 0 0 0 2.5 2.5H12"/><circle cx="4.5" cy="3" r="1.5"/><circle cx="11.5" cy="12" r="1.5"/></svg>分支</button></footer>`
    : ''
  return `<article class="message message-${message.kind}${message.pending ? ' message-pending' : ''}" ${seq}><div class="message-body md">${body}</div>${branch}</article>`
}

/**
 * Stored process entries carry a `status` (`pending` / `done` / `failed`);
 * records folded in from a v3-era message still carry `error` / `result`. Read
 * both shapes, otherwise a finished tool renders as a failure only because the
 * newer shape has no `error` key at all (`undefined !== null`).
 */
function processState(entry) {
  if (entry.status === 'failed') return 'failed'
  if (entry.status === 'pending') return 'pending'
  if (entry.status === 'done') return 'done'
  if (typeof entry.error === 'string') return entry.error === '' ? (entry.result === null || entry.result === undefined ? 'pending' : 'done') : 'failed'
  if (entry.error !== null && entry.error !== undefined) return 'failed'
  return entry.result === null || entry.result === undefined ? 'pending' : 'done'
}

/** One row per tool call: name + status, expandable to its arguments/result. */
function processEntries(process, key) {
  return process.map((entry, index) => {
    const entryKey = `${key}:${index}`
    const entryExpanded = state.expandedMessageIds.has(entryKey)
    const state_ = processState(entry)
    const status = state_ === 'failed' ? '失败' : state_ === 'pending' ? '等待结果' : '完成'
    const statusClass = state_ === 'failed' ? ' process-status-error' : state_ === 'pending' ? ' process-status-pending' : ' process-status-done'
    const argumentsHtml = typeof entry.arguments === 'string' && entry.arguments !== '' ? `<pre class="process-args">${escapeHtml(entry.arguments)}</pre>` : ''
    const outcomeHtml = state_ === 'failed' && typeof entry.error === 'string' && entry.error !== ''
      ? `<pre class="process-error">${escapeHtml(entry.error)}</pre>`
      : typeof entry.result === 'string' && entry.result !== '' ? `<pre class="process-result">${escapeHtml(entry.result)}</pre>` : ''
    return `<div class="process-entry${entryExpanded ? ' expanded' : ''}"><button class="process-entry-fold" data-action="toggle-message" data-message="${escapeHtml(entryKey)}"><span class="process-entry-name">${escapeHtml(entry.name)}</span><span class="process-status${statusClass}">${status}</span></button>${entryExpanded ? `<div class="process-entry-body">${argumentsHtml}${outcomeHtml}</div>` : ''}</div>`
  }).join('')
}

function processRecords(process, messageId) {
  const key = `${messageId}:process`
  const expanded = state.expandedMessageIds.has(key)
  return `<section class="process-records${expanded ? ' expanded' : ''}"><button class="process-records-fold" data-action="toggle-message" data-message="${escapeHtml(key)}"><span>${expanded ? '收起过程记录' : '过程记录'}</span><span class="process-count">${process.length}</span></button>${expanded ? processEntries(process, key) : ''}</section>`
}

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
    ? card.error === null ? '<p class="card-inspector-pending">等待助手回复</p>' : ''
    : `<article class="card-inspector-answer md">${renderMarkdown(card.answer.text)}${card.answer.pending ? '<p class="card-inspector-pending">正在回复</p>' : ''}</article>`
  const error = card.error === null ? '' : `<section class="card-inspector-error" role="alert"><strong>本轮未完成</strong><p>${escapeHtml(card.error.text)}</p></section>`
  // Tool calls are shown, not hidden behind one more fold: the drawer lists the
  // turn's calls as rows under a 「工具调用」label, each row opening its payload.
  const processRecordsHtml = process.length === 0 ? '' : `<section class="card-inspector-process"><p class="card-inspector-section">工具调用</p>${processEntries(process, `${thread.id}:${card.id}:inspector`)}</section>`
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

/**
 * The session's only chrome: 在 DSH 中打开 / 创建分支 as two controls in the same
 * `.header-actions` cluster the map uses. They used to sit next to a session
 * title line inside the transcript, which is exactly the band that made the
 * detail page read as a second header.
 */
function detailActionsBar() {
  const thread = currentThread()
  if (thread === null) return ''
  const latestAssistantSeq = [...messagesFor(thread)].reverse().find(message => Number.isInteger(message.sourceSeq))?.sourceSeq
  return `<button class="header-action" type="button" data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(latestAssistantSeq) ? latestAssistantSeq : ''}" title="在原生对话中打开此会话" aria-label="在原生对话中打开此会话">${CARD_ICON_DSH}<span>在 DSH 中打开</span></button><button class="header-action" type="button" data-action="open-branch" data-thread="${thread.id}" title="基于最新回答创建分支" aria-label="基于最新回答创建分支">${HEADER_ICON_BRANCH}<span>创建分支</span></button>`
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

/**
 * The conversation, and nothing else: no title row of its own (the 地图 / 详情
 * tabs above already say where you are), no session name, no per-message cards.
 * The two session actions live in the top bar's first row (see `detailActions`).
 */
function renderThread() {
  const thread = currentThread()
  if (thread === null) return renderCanvas()
  const messages = messagesFor(thread)
  const waiting = state.pendingReplies.has(thread.dshSessionId)
  return `<section class="detail-view" data-morph-key="detail-view"><div class="detail-scroll"><div class="detail-flow">${messages.map(message => threadMessage(thread, message)).join('') || '<div class="note-empty">等待这条会话的第一条消息。</div>'}</div></div><form class="message-composer" data-compose="${thread.id}"><textarea maxlength="4000" rows="1" placeholder="继续当前对话" ${waiting ? 'disabled' : ''}></textarea><button class="composer-send" type="submit" aria-label="${waiting ? '等待回复' : '发送'}" title="${waiting ? '等待回复' : '发送'}" ${waiting ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 12.5V3.5m0 0L4 7.5m4-4L12 7.5"/></svg></button></form></section>`
}


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
  morphInto(app, `<main class="synapse-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}"><aside class="sidebar"><div class="sidebar-inner"><div class="sidebar-brand-row"><div class="brand" aria-label="Synapse"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M9 10.5 16 7l7 3.5M9 10.5v8L16 22m0-15v15m7-11.5v8L16 22"/><circle cx="9" cy="10" r="2.5"/><circle cx="23" cy="10" r="2.5"/><circle cx="16" cy="23" r="2.5"/></svg><strong>Synapse</strong></div></div><button class="new-workspace" type="button" data-action="create-session" title="在画布中新建一张卡片，不会离开地图" ${state.draft !== null ? 'disabled' : ''}><svg class="new-session-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v6.5M4.75 8h6.5"/></svg><span>新建卡片</span></button><div class="sidebar-panel"><div class="workspace-label"><span>工作区</span><span class="workspace-select"><button class="workspace-trigger${state.workspaceMenuOpen === true ? ' open' : ''}" type="button" data-action="toggle-workspace-menu" aria-haspopup="listbox" aria-expanded="${state.workspaceMenuOpen === true ? 'true' : 'false'}" title="${escapeHtml(selectedChoice?.path ?? selectedChoice?.title ?? '选择工作区')}" ${state.draft !== null ? 'disabled' : ''}><svg class="workspace-folder" aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 4.75h3l1.2 1.5h6.8v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"/></svg><span class="workspace-trigger-label">${escapeHtml(selectedChoice?.title ?? '选择工作区')}</span><svg class="workspace-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg></button>${state.workspaceMenuOpen === true ? `<div class="workspace-menu" role="listbox" aria-label="选择工作区">${workspaceOptions || '<p class="workspace-empty">暂未发现工作区</p>'}</div>` : ''}</span></div><div class="sidebar-heading"><span>会话</span></div><nav class="thread-tree">${threads.map(thread => `<button class="tree-row ${thread.id === state.activeId ? 'active' : ''}" data-action="select-thread" data-thread="${thread.id}" style="--thread-color:#374151"><span class="tree-dot"></span><span>${escapeHtml(threadListTitle(thread))}</span>${thread.parentId === null ? '' : '<i>分支</i>'}</button>`).join('') || '<p class="tree-empty">暂未同步会话</p>'}</nav></div></div></aside><div class="content-pane"><section class="main-stage">${state.error ? `<div class="status-message" role="alert"><span>${escapeHtml(state.error)}</span><button data-action="dismiss-error" aria-label="关闭" title="关闭">×</button></div>` : ''}${canvasTabs}${arrangementMenu()}${view}${selectionFollowupButton()}</section></div></main>`)
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

function applyCanvasTransform() {
  const content = document.querySelector('.canvas-content')
  if (content instanceof HTMLElement) content.style.transform = `translate(${state.canvasCamera.x}px, ${state.canvasCamera.y}px) scale(${state.zoom})`
}

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
        if (state.activeId !== null && !visibleCards.some(card => card.dshThreadId === state.activeId)) return setError('当前会话位于这个后续分支中，请先切换会话')
      }
      collapsing ? state.collapsedCardIds.add(cardId) : state.collapsedCardIds.delete(cardId)
      persistCollapsedCards()
      render()
      window.setTimeout(() => document.querySelector(`[data-action="toggle-card-children"][data-card="${selectorValue(cardId)}"]`)?.focus(), 0)
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
    const opened = await openDshWorkspace(choice.id)
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
  const cards = app.querySelectorAll(`.thread-card[data-thread="${CSS.escape(thread.id)}"]`)
  const card = cards[cards.length - 1]
  if (!(card instanceof HTMLElement)) return
  const summary = card.querySelector('.thread-card-body .thread-summary')
  if (!(summary instanceof HTMLElement)) return
  const text = live.text
  // Morph instead of replacing the subtree: the summary keeps its node, so a
  // pointer that went down inside it still resolves to a click on release.
  morphInto(summary, text.trim() === ''
    ? '<p class="thread-summary is-pending">正在回复…</p>'
    : `<p class="thread-summary">${escapeHtml(answerSummary(text))}<span class="thread-summary-streaming"> 正在回复…</span></p>`)
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
