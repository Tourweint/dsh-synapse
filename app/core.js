// Constants, the client-side state, local storage, and the transport to the Host half.

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
  // Folds the reader opened: process records, tool rows, the drawer's entries.
  // Everything starts closed, so this only ever records what was opened.
  expandedMessageIds: new Set(),
  canvasCards: undefined, canvasCardsById: undefined, canvasGraph: undefined, mountedCardIds: new Set(), canvasNeedsCenter: false,
  detailScrollByThread: new Map(), detailThreadId: null, detailTargetCardId: null,
  inspectorCardId: null, inspectorOpening: false, inspectorScrollByCard: new Map(), inspectorWidth: savedInspectorWidth,
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
