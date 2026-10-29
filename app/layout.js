// Card geometry, auto-layout, and the connector paths between cards.

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
    closed: turn.closed === true,
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
      // The closing prose of the turn: the LAST assistant message that actually
      // says something. A trailing empty answer (a tool-only turn whose record
      // was kept for its calls) must not hide the prose above it — merging a
      // harness note into the turn above is exactly how one lands there.
      const spoken = replies.findLast(reply => typeof reply.text === 'string' && reply.text.trim() !== '')
      turns.push({
        index: turns.length,
        seq: question.sourceSeq ?? messageIndex,
        question: question.text,
        questionMessage: question,
        answer: spoken ?? replies.at(-1) ?? null,
        error: errors.at(-1) ?? null,
        processCount,
      })
    }
    const liveReply = state.liveReplies.get(thread.dshSessionId)
    const latestTurn = turns.at(-1)
    if (liveReply?.running && latestTurn !== undefined && (latestTurn.answer === null || latestTurn.answer.pending === true)) latestTurn.answer = { kind: 'assistant', text: liveReply.text, pending: true, at: new Date().toISOString() }
    // A turn with a later question can no longer be waiting: the run that would
    // answer it is over, otherwise the user could not have asked again. Saying
    // "等待助手回复" there is a promise that will never be kept.
    for (const turn of turns.slice(0, -1)) if (turn.answer === null) turn.closed = true
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
