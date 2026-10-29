import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { pickApp } from './source.js'

// Geometry mirrored from app/layout.js: one turn is a question card with its answer
// card hanging 20px below it, in the same column.
const CARD_WIDTH = 252
const CARD_HEIGHT = 92
const CARD_PAIR_GAP = 20
const CARD_PAIR_HEIGHT = CARD_HEIGHT * 2 + CARD_PAIR_GAP
const CARD_STEP_X = 308

// Arrays built inside the vm carry the vm's Array.prototype, which
// deepStrictEqual rejects; Array.from hands the assertion a host-realm array.
const questionsOf = cards => Array.from(cards).filter(card => card.role === 'question')
const answersOf = cards => Array.from(cards).filter(card => card.role === 'answer')

async function loadConversationCards() {
  const source = await pickApp('layout')
  const context = {
    globalThis: {},
    CARD_WIDTH: 252,
    CARD_HEIGHT,
    CARD_HEIGHT_EXPANDED: 188,
    CARD_PAIR_GAP,
    CARD_PAIR_HEIGHT,
    CARD_GAP_Y: 40,
    CARD_STEP_X,
    CAMERA_INSET_X: 56,
    CAMERA_INSET_Y: 56,
    messagesFor: thread => thread.messages,
    state: { branchAnchors: new Map(), cardPositions: new Map(), liveReplies: new Map(), collapsedCardIds: new Set(), expandedCardIds: new Set(), questionPosition: 'above' },
  }
  vm.createContext(context)
  vm.runInContext(`${source};globalThis.conversationCards = conversationCards;globalThis.conversationGraphView = conversationGraphView;globalThis.initialCanvasCamera = initialCanvasCamera`, context)
  return { conversationCards: context.globalThis.conversationCards, conversationGraphView: context.globalThis.conversationGraphView, initialCanvasCamera: context.globalThis.initialCanvasCamera, state: context.state }
}

test('splits one turn into a question card and an answer card', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-1', parentId: null, position: { x: 86, y: 82 },
    messages: [
      { kind: 'user', text: '第一个问题', sourceSeq: 1 },
      { kind: 'assistant', text: '第一个回答草稿', sourceSeq: 2 },
      { kind: 'assistant', text: '第一个最终回答', sourceSeq: 3 },
      { kind: 'user', text: '第二个问题', sourceSeq: 4 },
      { kind: 'assistant', text: '第二个最终回答', sourceSeq: 5 },
    ],
  }])

  assert.equal(cards.length, 4, 'two turns = four cards')
  const questions = questionsOf(cards)
  const answers = answersOf(cards)
  assert.deepEqual(questions.map(card => card.question), ['第一个问题', '第二个问题'])
  // The answer card carries the turn's closing prose, not the intermediate one.
  assert.equal(answers[0].answer.text, '第一个最终回答')
  // The pair is linked vertically; the next turn hangs off the previous answer.
  assert.equal(answers[0].parentId, questions[0].id)
  assert.equal(questions[1].parentId, answers[0].id)
  assert.equal(questions[1].position.x, questions[0].position.x + CARD_STEP_X)
  assert.equal(answers[0].position.x, questions[0].position.x)
  assert.equal(answers[0].position.y, questions[0].position.y + CARD_HEIGHT + CARD_PAIR_GAP)
  // Only the newest turn offers a follow-up, on both of its cards (the inspector
  // opens from either), and never on an older one.
  assert.equal(questions[0].canContinue, undefined)
  assert.equal(answers[0].canContinue, undefined)
  assert.equal(questions[1].canContinue, true)
  assert.equal(answers[1].canContinue, true)
})

test('stacks the pair in either direction and steps turns past it', async () => {
  const { conversationCards, state } = await loadConversationCards()
  const thread = messages => [{
    id: 'session-1', parentId: null, position: { x: 86, y: 82 },
    messages: [
      { kind: 'user', text: '第一个问题', sourceSeq: 1 },
      { kind: 'assistant', text: '第一个回答', sourceSeq: 2 },
      { kind: 'user', text: '第二个问题', sourceSeq: 3 },
      { kind: 'assistant', text: '第二个回答', sourceSeq: 4 },
    ],
    ...messages,
  }]

  state.questionPosition = 'below'
  let cards = conversationCards(thread())
  let questions = questionsOf(cards)
  let answers = answersOf(cards)
  // 问在下：answer on top, question hanging under it inside the same band.
  assert.equal(answers[0].position.y, 82)
  assert.equal(questions[0].position.y, 82 + CARD_HEIGHT + CARD_PAIR_GAP)
  assert.equal(answers[0].position.x, questions[0].position.x)
  assert.equal(questions[1].position.x, questions[0].position.x + CARD_STEP_X)

  state.questionPosition = 'left'
  cards = conversationCards(thread())
  questions = questionsOf(cards)
  answers = answersOf(cards)
  // 问在左：same row, answer to the right, next turn starts past the answer.
  assert.equal(answers[0].position.y, questions[0].position.y)
  assert.equal(answers[0].position.x, questions[0].position.x + CARD_WIDTH + CARD_PAIR_GAP)
  assert.equal(questions[1].position.x, answers[0].position.x + CARD_STEP_X)

  state.questionPosition = 'right'
  cards = conversationCards(thread())
  questions = questionsOf(cards)
  answers = answersOf(cards)
  // 问在右：answer to the left, so the next turn starts one card past the
  // question instead of past the answer.
  assert.equal(answers[0].position.x, questions[0].position.x - (CARD_WIDTH + CARD_PAIR_GAP))
  assert.equal(questions[1].position.x, questions[0].position.x + CARD_STEP_X)
})

test('keeps a failed turn visible when Harness produces no assistant message', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-error', parentId: null, position: { x: 86, y: 82 },
    messages: [
      { kind: 'user', text: '调用搜索', sourceSeq: 1 },
      { kind: 'error', text: 'QuotaExceeded: INSUFFICIENT_BALANCE: 余额不足', sourceSeq: 2 },
    ],
  }])

  const answer = answersOf(cards)[0]
  assert.equal(answer.answer, null)
  assert.equal(answer.error.text, 'QuotaExceeded: INSUFFICIENT_BALANCE: 余额不足')
  assert.equal(answer.canContinue, true)
})

test('marks a turn closed once a later question exists, so no reply is still coming', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-closed', parentId: null, position: { x: 86, y: 82 },
    messages: [
      { kind: 'user', text: '调用搜索', sourceSeq: 1 },
      { kind: 'user', text: '换个问法', sourceSeq: 3 },
      { kind: 'assistant', text: '这次有回答', sourceSeq: 4 },
    ],
  }])

  const answers = answersOf(cards)
  // The first turn never answered, but the user already asked again: waiting is
  // a promise that cannot be kept.
  assert.equal(answers[0].answer, null)
  assert.equal(answers[0].closed, true)
  assert.equal(answers[1].closed, false)
})

test('a closed turn with an empty answer is a record, not a wait', async () => {
  const { conversationCards, state } = await loadConversationCards()
  state.liveReplies.set('session-quiet', { running: false, text: '' })
  const cards = conversationCards([{
    id: 'session-quiet', dshSessionId: 'session-quiet', parentId: null, position: { x: 86, y: 82 },
    messages: [
      { kind: 'user', text: '整理一下', sourceSeq: 1 },
      { kind: 'assistant', text: '', ended: true, process: [{ callId: 'c1', name: 'grep', status: 'done' }], sourceSeq: 4 },
    ],
  }])

  const answer = answersOf(cards)[0]
  assert.equal(answer.answer.ended, true)
  assert.equal(answer.answer.pending, undefined)
  assert.equal(answer.processCount, 1)
  assert.equal(answer.closed, false)
})

test('a trailing empty answer does not hide the prose above it', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-merged', parentId: null, position: { x: 86, y: 82 },
    messages: [
      { kind: 'user', text: '咋还能改上下文呢', sourceSeq: 1 },
      { kind: 'assistant', text: '可以改，但要分清两个上下文。', sourceSeq: 7 },
      // A harness turn that was filtered out left its record behind: an empty
      // answer with the calls of that run. It belongs to the question above, but
      // it must never win the answer slot.
      { kind: 'assistant', text: '', ended: true, sourceSeq: 9, process: [{ callId: 'c1', name: 'grep', status: 'done' }] },
    ],
  }])

  const answer = answersOf(cards)[0]
  assert.equal(answer.answer.text, '可以改，但要分清两个上下文。')
  assert.equal(answer.processCount, 1)
})

test('connects a restored fork to its DSH seed boundary, not its canvas position', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'parent', parentId: null, position: { x: 86, y: 82 },
      messages: [
        { kind: 'user', text: '第一轮', sourceSeq: 1 },
        { kind: 'assistant', text: '第一轮回答', sourceSeq: 2 },
        { kind: 'user', text: '第二轮', sourceSeq: 5 },
        { kind: 'assistant', text: '第二轮回答', sourceSeq: 6 },
        { kind: 'user', text: '第三轮', sourceSeq: 9 },
        { kind: 'assistant', text: '第三轮回答', sourceSeq: 10 },
      ],
    },
    {
      id: 'child', parentId: 'parent', sourceSeedLength: 8, position: { x: 9999, y: -9999 },
      messages: [
        { kind: 'user', text: '分支问题', sourceSeq: 9 },
        { kind: 'assistant', text: '分支回答', sourceSeq: 10 },
      ],
    },
  ])

  const parentAnswers = answersOf(cards.filter(card => card.dshThreadId === 'parent'))
  const childQuestion = questionsOf(cards.filter(card => card.dshThreadId === 'child'))[0]
  // Seed boundary 8 covers turns 1 and 2; the fork hangs off turn 2's answer.
  assert.equal(childQuestion.parentId, parentAnswers[1].id)
})

test('uses a restored child message sequence to reconnect a legacy fork at its user turn', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'parent', parentId: null, position: { x: 86, y: 82 },
      messages: [
        { kind: 'user', text: '你好', sourceSeq: 7 },
        { kind: 'assistant', text: '你好，我是助手。', sourceSeq: 111 },
        { kind: 'user', text: '你是谁', sourceSeq: 118 },
        { kind: 'assistant', text: '我是 DSH。', sourceSeq: 278 },
      ],
    },
    {
      id: 'child', parentId: 'parent', sourceSeedLength: null, position: { x: 1200, y: 900 },
      messages: [
        { kind: 'user', text: '代码是什么', sourceSeq: 121 },
        { kind: 'assistant', text: '代码是指令。', sourceSeq: 569 },
      ],
    },
  ])

  const parentAnswers = answersOf(cards.filter(card => card.dshThreadId === 'parent'))
  const childQuestion = questionsOf(cards.filter(card => card.dshThreadId === 'child'))[0]
  assert.equal(childQuestion.parentId, parentAnswers[1].id)
})

test('places a fork beside the exact parent turn while avoiding overlap', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'parent', parentId: null, position: { x: 86, y: 82 },
      messages: [
        { kind: 'user', text: '第一轮', sourceSeq: 1 },
        { kind: 'assistant', text: '第一轮回答', sourceSeq: 2 },
        { kind: 'user', text: '第二轮', sourceSeq: 5 },
        { kind: 'assistant', text: '第二轮回答', sourceSeq: 6 },
        { kind: 'user', text: '第三轮', sourceSeq: 9 },
        { kind: 'assistant', text: '第三轮回答', sourceSeq: 10 },
      ],
    },
    {
      id: 'child', parentId: 'parent', sourceSeedLength: 8, position: { x: 86, y: 900 },
      messages: [
        { kind: 'user', text: '第二轮分支', sourceSeq: 9 },
        { kind: 'assistant', text: '分支回答', sourceSeq: 10 },
      ],
    },
  ])

  const parentAnswers = answersOf(cards.filter(card => card.dshThreadId === 'parent'))
  const childQuestion = questionsOf(cards.filter(card => card.dshThreadId === 'child'))[0]
  assert.equal(childQuestion.parentId, parentAnswers[1].id)
  assert.equal(childQuestion.position.x, parentAnswers[1].position.x + CARD_STEP_X)
  assert.ok(childQuestion.position.y > parentAnswers[1].position.y)
})

test('keeps every turn of one branch on the same horizontal lane', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'parent', parentId: null, position: { x: 86, y: 82 },
      messages: [
        { kind: 'user', text: '第一轮', sourceSeq: 1 },
        { kind: 'assistant', text: '第一轮回答', sourceSeq: 2 },
        { kind: 'user', text: '第二轮', sourceSeq: 5 },
        { kind: 'assistant', text: '第二轮回答', sourceSeq: 6 },
      ],
    },
    {
      id: 'child', parentId: 'parent', sourceSeedLength: 7, position: { x: 999, y: 999 },
      messages: [
        { kind: 'user', text: '分支第一轮', sourceSeq: 7 },
        { kind: 'assistant', text: '分支第一轮回答', sourceSeq: 8 },
        { kind: 'user', text: '分支第二轮', sourceSeq: 9 },
        { kind: 'assistant', text: '分支第二轮回答', sourceSeq: 10 },
        { kind: 'user', text: '分支第三轮', sourceSeq: 11 },
        { kind: 'assistant', text: '分支第三轮回答', sourceSeq: 12 },
      ],
    },
  ])

  const childQuestions = questionsOf(cards.filter(card => card.dshThreadId === 'child'))
  const childAnswers = answersOf(cards.filter(card => card.dshThreadId === 'child'))
  assert.equal(new Set(childQuestions.map(card => card.position.y)).size, 1)
  // Answers share their question's lane height, one row lower.
  assert.equal(new Set(childAnswers.map(card => card.position.y)).size, 1)
  assert.equal(childQuestions[1].position.x, childQuestions[0].position.x + CARD_STEP_X)
  assert.equal(childQuestions[2].position.x, childQuestions[1].position.x + CARD_STEP_X)
})

test('gives each root conversation its own lane instead of overlapping it', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    { id: 'first', parentId: null, position: { x: 86, y: 82 }, messages: [{ kind: 'user', text: '第一条', sourceSeq: 1 }] },
    { id: 'second', parentId: null, position: { x: 86, y: 190 }, messages: [{ kind: 'user', text: '第二条', sourceSeq: 1 }] },
  ])

  const questions = questionsOf(cards)
  assert.equal(questions[0].position.y, 82)
  assert.ok(questions[1].position.y >= 82 + CARD_PAIR_HEIGHT)
})

test('honors an in-memory dragged card position even far from the natural layout', async () => {
  const { conversationCards, state } = await loadConversationCards()
  state.cardPositions.set('session-1:turn:1:q', { x: 1280, y: 1280 })
  const cards = conversationCards([{
    id: 'session-1', parentId: null, position: { x: 86, y: 82 },
    messages: [
      { kind: 'user', text: '第一个问题', sourceSeq: 1 },
      { kind: 'assistant', text: '第一个回答', sourceSeq: 2 },
    ],
  }])

  const questions = questionsOf(cards)
  assert.equal(questions[0].position.x, 1280)
  assert.equal(questions[0].position.y, 1280)
})

test('does not move later turns when an earlier card is dragged', async () => {
  const { conversationCards, state } = await loadConversationCards()
  state.cardPositions.set('session-1:turn:1:q', { x: 1280, y: 1280 })
  const cards = conversationCards([{
    id: 'session-1', parentId: null, position: { x: 86, y: 82 },
    messages: [
      { kind: 'user', text: '第一个问题', sourceSeq: 1 },
      { kind: 'assistant', text: '第一个回答', sourceSeq: 2 },
      { kind: 'user', text: '第二个问题', sourceSeq: 3 },
      { kind: 'assistant', text: '第二个回答', sourceSeq: 4 },
    ],
  }])

  const questions = questionsOf(cards)
  assert.equal(questions[0].position.x, 1280)
  // A dragged card is pinned; the natural chain still starts at 86, so the next
  // turn does not follow the dragged card around.
  assert.equal(questions[1].position.x, 86 + CARD_STEP_X)
  assert.equal(questions[1].position.y, 82)
})

test('keeps a dragged pending turn position after DSH assigns a source sequence', async () => {
  const { conversationCards, state } = await loadConversationCards()
  state.cardPositions.set('session-1:turn-index:0', { x: 740, y: 360 })
  const cards = conversationCards([{
    id: 'session-1', parentId: null, position: { x: 86, y: 82 },
    messages: [
      { kind: 'user', text: '第一个问题', sourceSeq: 21 },
      { kind: 'assistant', text: '第一个回答', sourceSeq: 22 },
    ],
  }])

  const question = questionsOf(cards)[0]
  assert.equal(question.position.x, 740)
  assert.equal(question.position.y, 360)
})

test('derives root card positions from the visible graph instead of stale persisted thread pixels', async () => {
  const { conversationCards } = await loadConversationCards()
  const cards = conversationCards([
    { id: 'dirty-root', parentId: null, position: { x: 86, y: 3200 }, messages: [{ kind: 'user', text: '脏坐标会话', sourceSeq: 1 }] },
  ])

  const question = questionsOf(cards)[0]
  assert.equal(question.position.x, 86)
  assert.equal(question.position.y, 82)
})

test('focuses a new-session draft before existing cards when initializing the canvas', async () => {
  const { initialCanvasCamera, state } = await loadConversationCards()
  state.draft = { kind: 'new', text: '', sending: false }
  state.zoom = 1
  const camera = initialCanvasCamera([{ id: 'old-card', position: { x: 86, y: 1600 } }])

  assert.equal(camera.x, -30)
  assert.equal(camera.y, -26)
})

test('collapsing a question hides its answer and everything after it', async () => {
  const { conversationCards, conversationGraphView } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-1', parentId: null,
    messages: [
      { kind: 'user', text: '第一轮', sourceSeq: 1 },
      { kind: 'assistant', text: '回答一', sourceSeq: 2 },
      { kind: 'user', text: '第二轮', sourceSeq: 3 },
      { kind: 'assistant', text: '回答二', sourceSeq: 4 },
      { kind: 'user', text: '第三轮', sourceSeq: 5 },
      { kind: 'assistant', text: '回答三', sourceSeq: 6 },
    ],
  }])

  const graph = conversationGraphView(cards, new Set([cards[0].id]))
  assert.deepEqual(Array.from(graph.cards, card => card.id), [cards[0].id])
  assert.equal(graph.childCounts.get(cards[0].id), 1)
  assert.equal(graph.descendantCounts.get(cards[0].id), 5)
})

test('collapsing a fork point hides all branch descendants without hiding another root', async () => {
  const { conversationCards, conversationGraphView } = await loadConversationCards()
  const cards = conversationCards([
    {
      id: 'parent', parentId: null,
      messages: [
        { kind: 'user', text: '父问题', sourceSeq: 1 },
        { kind: 'assistant', text: '父回答', sourceSeq: 2 },
        { kind: 'user', text: '父追问', sourceSeq: 5 },
        { kind: 'assistant', text: '父追问回答', sourceSeq: 6 },
      ],
    },
    {
      id: 'child', parentId: 'parent', sourceSeedLength: 4,
      messages: [
        { kind: 'user', text: '分支问题', sourceSeq: 4 },
        { kind: 'assistant', text: '分支回答', sourceSeq: 5 },
        { kind: 'user', text: '分支追问', sourceSeq: 6 },
      ],
    },
    { id: 'other-root', parentId: null, messages: [{ kind: 'user', text: '独立会话', sourceSeq: 1 }] },
  ])
  const forkPoint = cards.find(card => card.dshThreadId === 'parent' && card.turnIndex === 0 && card.role === 'question')
  const graph = conversationGraphView(cards, new Set([forkPoint.id]))

  assert.deepEqual(questionsOf(graph.cards).map(card => card.question).sort(), ['父问题', '独立会话'].sort())
  assert.equal(graph.childCounts.get(forkPoint.id), 1)
  // 10 cards in total, 3 left visible (the collapsed root + the unrelated pair).
  assert.equal(graph.descendantCounts.get(forkPoint.id), 7)
})

test('expanding a card restores descendants at their original coordinates', async () => {
  const { conversationCards, conversationGraphView } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-1', parentId: null,
    messages: [
      { kind: 'user', text: '第一轮', sourceSeq: 1 },
      { kind: 'assistant', text: '回答一', sourceSeq: 2 },
      { kind: 'user', text: '第二轮', sourceSeq: 3 },
    ],
  }])
  const originalPositions = cards.map(card => ({ ...card.position }))

  assert.equal(conversationGraphView(cards, new Set([cards[0].id])).cards.length, 1)
  const expanded = conversationGraphView(cards, new Set()).cards
  assert.equal(expanded.length, 4)
  assert.deepEqual(expanded.map(card => ({ ...card.position })), originalPositions)
})

test('a new descendant remains hidden while its ancestor is collapsed', async () => {
  const { conversationCards, conversationGraphView } = await loadConversationCards()
  const initialCards = conversationCards([{
    id: 'session-1', parentId: null,
    messages: [
      { kind: 'user', text: '第一轮', sourceSeq: 1 },
      { kind: 'assistant', text: '回答一', sourceSeq: 2 },
      { kind: 'user', text: '第二轮', sourceSeq: 3 },
    ],
  }])
  const collapsedId = initialCards[0].id
  const updatedCards = conversationCards([{
    id: 'session-1', parentId: null,
    messages: [
      { kind: 'user', text: '第一轮', sourceSeq: 1 },
      { kind: 'assistant', text: '回答一', sourceSeq: 2 },
      { kind: 'user', text: '第二轮', sourceSeq: 3 },
      { kind: 'assistant', text: '回答二', sourceSeq: 4 },
      { kind: 'user', text: '后来新增的第三轮', sourceSeq: 5 },
    ],
  }])

  const graph = conversationGraphView(updatedCards, new Set([collapsedId]))
  assert.deepEqual(questionsOf(graph.cards).map(card => card.question), ['第一轮'])
  assert.equal(graph.descendantCounts.get(collapsedId), 5)
})

test('nested collapsed nodes remain visible when their ancestor is expanded', async () => {
  const { conversationCards, conversationGraphView } = await loadConversationCards()
  const cards = conversationCards([{
    id: 'session-1', parentId: null,
    messages: [
      { kind: 'user', text: '第一轮', sourceSeq: 1 },
      { kind: 'assistant', text: '回答一', sourceSeq: 2 },
      { kind: 'user', text: '第二轮', sourceSeq: 3 },
      { kind: 'assistant', text: '回答二', sourceSeq: 4 },
      { kind: 'user', text: '第三轮', sourceSeq: 5 },
    ],
  }])
  const questionIds = questionsOf(cards).map(card => card.id)

  const nested = conversationGraphView(cards, new Set([questionIds[0], questionIds[1]]))
  assert.deepEqual(questionsOf(nested.cards).map(card => card.question), ['第一轮', '第二轮'])
  const childOnly = conversationGraphView(cards, new Set([questionIds[1]]))
  assert.deepEqual(questionsOf(childOnly.cards).map(card => card.question), ['第一轮', '第二轮'])
})

test('cyclic collapsed roots stay visible and count unique descendants', async () => {
  const { conversationGraphView } = await loadConversationCards()
  const cards = [
    { id: 'a', parentId: 'b', dshThreadId: 'a' },
    { id: 'b', parentId: 'a', dshThreadId: 'b' },
  ]
  const graph = conversationGraphView(cards, new Set(['a', 'b']))

  assert.deepEqual(Array.from(graph.cards, card => card.id), ['a', 'b'])
  assert.equal(graph.descendantCounts.get('a'), 1)
  assert.equal(graph.descendantCounts.get('b'), 1)
})

async function loadProcessRecords() {
  const source = await pickApp('process')
  const context = {
    globalThis: {},
    state: { expandedMessageIds: new Set(['m:process']) },
    escapeHtml: value => String(value).replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]),
  }
  vm.createContext(context)
  vm.runInContext(`${source};globalThis.processRecords = processRecords;globalThis.processEntries = processEntries;globalThis.state = state`, context)
  return context.globalThis
}

test('renders a stored process entry by its status instead of failing every tool', async () => {
  const { processRecords } = await loadProcessRecords()

  const html = processRecords([
    { name: 'pws', status: 'done' },
    { name: 'read', status: 'pending' },
    { name: 'edit', status: 'failed' },
  ], 'm')

  assert.match(html, /pws<\/span><span class="process-entry-state"><span class="process-entry-dot" aria-hidden="true"><\/span><span class="process-status process-status-done">完成/)
  assert.match(html, /read<\/span><span class="process-entry-state">.*?process-status-pending">等待结果/)
  assert.match(html, /edit<\/span><span class="process-entry-state">.*?process-status-error">失败/)
  assert.doesNotMatch(html, /undefined/)
})

test('the folded row says what happened through its colour, not only its words', async () => {
  const { processRecords } = await loadProcessRecords()

  const html = processRecords([
    { name: 'a', status: 'done' },
    { name: 'b', status: 'pending' },
    { name: 'c', status: 'failed' },
  ], 'm')

  // The state rides on the entry (so the dot can be tinted by CSS) and on the
  // status word; no state ever reaches the row as a missing class.
  assert.match(html, /class="process-entry process-entry-done(?: expanded)?">/)
  assert.match(html, /class="process-entry process-entry-pending(?: expanded)?">/)
  assert.match(html, /class="process-entry process-entry-failed(?: expanded)?">/)
})

test('still reads a v3-era process entry that only carries error and result', async () => {
  const { processRecords } = await loadProcessRecords()

  const html = processRecords([
    { name: 'a', arguments: 'x', result: 'ok', error: null },
    { name: 'b', result: null, error: 'boom' },
    { name: 'c', result: null, error: null },
  ], 'm')

  assert.match(html, /a<\/span><span class="process-entry-state">.*?process-status-done">完成/)
  assert.match(html, /b<\/span><span class="process-entry-state">.*?process-status-error">失败/)
  assert.match(html, /c<\/span><span class="process-entry-state">.*?process-status-pending">等待结果/)
})

test('the drawer lists its tool rows folded, and opens one on demand', async () => {
  const { processEntries, state } = await loadProcessRecords()

  // Folded first: a long turn's payloads would otherwise bury the answer.
  const folded = processEntries([
    { name: 'read_file', status: 'done', arguments: '{"path":"a"}', result: 'body' },
  ], 'k')
  assert.doesNotMatch(folded, /process-entry-body/)
  assert.match(folded, /aria-expanded="false"/)
  assert.match(folded, /data-action="toggle-message"/)

  state.expandedMessageIds.add('k:0')
  const opened = processEntries([
    { name: 'read_file', status: 'done', arguments: '{"path":"a"}', result: 'body' },
  ], 'k')
  assert.match(opened, /class="process-entry process-entry-done expanded"/)
  assert.match(opened, /aria-expanded="true"/)
  assert.match(opened, /<p class="process-entry-label">参数<\/p><pre class="process-args">\{&quot;path&quot;:&quot;a&quot;\}<\/pre>/)
  assert.match(opened, /<p class="process-entry-label">结果<\/p><pre class="process-result">body<\/pre>/)
})

test('a row with no payload says so instead of looking truncated', async () => {
  const { processEntries, state } = await loadProcessRecords()
  state.expandedMessageIds.add('k:0')

  const html = processEntries([{ status: 'done' }], 'k')

  assert.match(html, /class="process-entry-name">工具调用<\/span>/)
  assert.match(html, /<p class="process-entry-empty">暂无参数与结果<\/p>/)
})

test('the detail view keeps its tool rows folded until they are opened', async () => {
  const { processEntries } = await loadProcessRecords()

  const html = processEntries([{ name: 'bash', status: 'done', arguments: 'x' }], 'k')

  assert.doesNotMatch(html, /process-entry-body/)
  assert.match(html, /data-action="toggle-message"/)
})
