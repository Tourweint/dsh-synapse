// Turns DSH session events into the stored workspace graph.

import { randomUUID } from 'node:crypto'
import { BODY_TRUNCATED_SUFFIX, MAX_BODY_CHARS, TOPIC_COLORS } from './constants.js'
import { contentText, errorText, excerptOf, isInjectedUserMessage, isInjectedUserSource, isRuntimeContextText, noteProjection, proseText } from './values.js'

export function normalizeState(value) {
  let migrated = false
  let state
  if ((value?.version === 2 || value?.version === 3 || value?.version === 4 || value?.version === 5 || value?.version === 6) && Array.isArray(value.workspaces)) {
    const hiddenSessionIds = Array.isArray(value.hiddenSessionIds) ? value.hiddenSessionIds.filter(item => typeof item === 'string') : []
    migrated = value.version < 3 || !Array.isArray(value.hiddenSessionIds)
    const workspaces = value.workspaces.map(workspace => ({
      ...workspace,
      threads: Array.isArray(workspace.threads) ? workspace.threads.map(thread => {
        if (Array.isArray(thread.messages)) {
          const messages = thread.messages.filter(message => !isInjectedUserMessage(message))
          if (messages.length !== thread.messages.length) migrated = true
          return { ...thread, messages }
        }
        migrated = true
        const notes = Array.isArray(thread.notes) ? thread.notes : []
        const { notes: _notes, ...rest } = thread
        return { ...rest, messages: notes, pendingProcess: [] }
      }) : [],
    }))
    state = { ...value, version: value.version, hiddenSessionIds, workspaces }
    // Dropping a harness note fuses its replies onto the question above it, so a
    // turn can end up owning two answers. Collapse is idempotent: it returns false
    // when every turn already has one. Older payloads wait for the v6 step, which
    // runs after legacy tool cards are folded — collapsing first would throw those
    // cards away before they become process records.
    if (value.version >= 6 && collapseTurnMessages(state.workspaces)) migrated = true
  } else if (value?.version === 1 && Array.isArray(value.workspaces)) {
    const now = typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
    state = {
      version: 3,
      hiddenSessionIds: [],
      workspaces: value.workspaces.map((workspace, index) => {
        const events = Array.isArray(workspace.events) ? workspace.events : []
        const workspaceNow = typeof workspace.updatedAt === 'string' ? workspace.updatedAt : now
        return {
          id: typeof workspace.id === 'string' ? workspace.id : randomUUID(),
          title: typeof workspace.title === 'string' && workspace.title.trim() ? workspace.title : '未命名工作空间',
          createdAt: typeof workspace.createdAt === 'string' ? workspace.createdAt : workspaceNow,
          updatedAt: workspaceNow,
          threads: events.length === 0 ? [] : [{
            id: randomUUID(), title: workspace.title || '历史记录', parentId: null, dshSessionId: null, dshSessionTitle: null,
            color: TOPIC_COLORS[index % TOPIC_COLORS.length], position: { x: 86, y: 82 }, createdAt: workspaceNow, updatedAt: workspaceNow,
            messages: events.map(event => ({ id: typeof event.id === 'string' ? event.id : randomUUID(), text: String(event.text ?? ''), at: typeof event.at === 'string' ? event.at : workspaceNow })),
          }],
        }
      }),
    }
    migrated = true
  } else {
    throw new Error('expected Synapse data version 1, 2, 3, 4, or 5')
  }
  if (state.version < 4) {
    if (foldLegacyToolCards(state.workspaces)) migrated = true
    state.version = 4
    migrated = true
  }
  // v5 drops message bodies and tool payloads from the workspace file: they are
  // re-read from the DSH session log on demand. Existing bodies become previews.
  if (state.version < 5) {
    for (const workspace of state.workspaces) {
      for (const thread of workspace.threads ?? []) {
        if (Array.isArray(thread.messages)) thread.messages = thread.messages.map(toStoredMessage)
        if (Array.isArray(thread.pendingProcess)) thread.pendingProcess = thread.pendingProcess.map(toStoredProcess)
      }
    }
    state.version = 5
    migrated = true
  }
  // v6 keeps one message per turn. Older projections stored one per model step,
  // so a single question with a long tool loop carried a hundred rows.
  if (state.version < 6) {
    if (collapseTurnMessages(state.workspaces)) migrated = true
    state.version = 6
    migrated = true
  }
  return { state, migrated }
}

/**
 * Collapse the rows a turn used to own into the one that carries its answer.
 * Everything between two user messages belongs to one turn: the closing prose
 * survives, tool-only rows fold into that answer's `process`, and a turn with no
 * prose at all keeps an empty `ended` answer so its call history still has a
 * home. The bodies live in the session log, so nothing here is unrecoverable.
 */
export function collapseTurnMessages(workspaces) {
  let changed = false
  for (const workspace of workspaces) {
    for (const thread of workspace.threads ?? []) {
      if (!Array.isArray(thread.messages) || thread.messages.length === 0) continue
      const messages = []
      let group = []
      let threadChanged = false
      const flush = () => {
        if (group.length === 0) return
        const merged = mergeTurnGroup(group)
        if (merged.length !== group.length) threadChanged = true
        messages.push(...merged)
        group = []
      }
      for (const message of thread.messages) {
        // Only a question starts a new turn. A todo list is part of the run it
        // belongs to, so it must not split its answers in two.
        if (message?.kind === 'user') {
          flush()
          messages.push(message)
          continue
        }
        group.push(message)
      }
      flush()
      if (threadChanged) {
        thread.messages = messages
        changed = true
      }
    }
  }
  return changed
}

function mergeTurnGroup(group) {
  const toolOnly = group.every(message => message?.kind === 'tool' || message?.kind === 'tool-result')
  if (group.length === 1 && !toolOnly) return group
  const process = []
  for (const message of group) {
    for (const entry of Array.isArray(message.process) ? message.process : []) {
      if (entry?.callId !== undefined && process.some(item => item?.callId === entry.callId)) continue
      process.push(entry)
    }
  }
  const answers = group.filter(message => message.kind === 'assistant' && typeof message.text === 'string' && message.text.trim() !== '')
  // One answer: keep it. Several (a harness note used to split one long run into
  // turns) and the last may be a one-line lead-in before a tool call, so take the
  // fullest prose — that is the round summary a reader would call the answer.
  const answer = answers.length <= 1
    ? answers[0]
    : answers.reduce((best, message) => ((message.length ?? message.text.length) >= (best.length ?? best.text.length) ? message : best))
  const error = group.findLast(message => message.kind === 'error')
  // A todo list is the run's own state, not an answer: it keeps its row and
  // moves after the merged answer.
  const extras = group.filter(message => message?.kind === 'todo')
  const merged = []
  if (answer !== undefined) merged.push({ ...answer, process })
  else if (error === undefined && process.length > 0) {
    // Tool rows only (an old projection of a tool loop): keep the calls, anchored
    // to an empty answer so the fold still renders and nothing reads as a reply.
    const last = group.at(-1)
    merged.push({
      id: typeof last?.id === 'string' ? last.id : randomUUID(),
      kind: 'assistant',
      text: '',
      length: 0,
      truncated: false,
      at: last?.at,
      sourceSeq: last?.sourceSeq,
      process,
      ended: true,
    })
  }
  if (error !== undefined) merged.push({ ...error, process: Array.isArray(error.process) ? error.process : [] })
  merged.push(...extras)
  return merged
}

/** v4 message → v5 message: keep identity and a preview, drop the body. */
export function toStoredMessage(message) {
  const normalized = typeof message?.text === 'string' ? message.text.trim() : ''
  const text = normalized === '' ? '' : excerptOf(normalized)
  const process = Array.isArray(message?.process) ? message.process.map(toStoredProcess) : message?.process
  return {
    ...message,
    text,
    length: normalized.length,
    truncated: text.length < normalized.length,
    ...(process === undefined ? {} : { process }),
  }
}

/** v4 process record → v5 record: keep identity and status, drop the payload. */
export function toStoredProcess(entry) {
  if (entry === null || typeof entry !== 'object') return entry
  const { arguments: _arguments, result, error, ...rest } = entry
  const status = error !== null && error !== undefined && error !== ''
    ? 'failed'
    : result === null || result === undefined
      ? 'pending'
      : 'done'
  return { ...rest, status: typeof entry.status === 'string' ? entry.status : status }
}

/**
 * Fold v3-era standalone tool cards (kinds `tool` / `tool-result`) into the
 * preceding assistant message's `process` list, pairing each call with the
 * result that follows it in order, so every tool invocation lives in one
 * home: the assistant turn card.
 */
export function foldLegacyToolCards(workspaces) {
  let changed = false
  for (const workspace of workspaces) {
    for (const thread of workspace.threads ?? []) {
      if (!Array.isArray(thread.messages)) continue
      const folded = []
      let assistant = null
      let pending = []
      for (const message of thread.messages) {
        if (message.kind === 'assistant') {
          assistant = message
          assistant.process ??= []
          pending = []
          folded.push(message)
          continue
        }
        if (message.kind !== 'tool' && message.kind !== 'tool-result') {
          folded.push(message)
          continue
        }
        if (assistant === null) {
          folded.push(message)
          continue
        }
        changed = true
        if (message.kind === 'tool') {
          const [name = '工具调用', ...argumentLines] = message.text.split('\n')
          const entry = { callId: `legacy-${assistant.process.length}`, name, arguments: argumentLines.join('\n'), result: null, error: null }
          pending.push(entry)
          assistant.process.push(entry)
        } else {
          const entry = pending.shift() ?? (() => {
            const orphan = { callId: `legacy-orphan-${assistant.process.length}`, name: '工具调用', arguments: null, result: null, error: null }
            assistant.process.push(orphan)
            return orphan
          })()
          entry.result = message.text
        }
      }
      thread.messages = folded
    }
  }
  return changed
}

/** Event → canvas message kind, or null when the event is not a message. */
export function eventKind(event) {
  switch (event?.type) {
    case 'user/message': return 'user'
    case 'assistant/message': return 'assistant'
    case 'todo/write': return 'todo'
    case 'turn/end': {
      const reason = event.data?.reason
      if (reason?.kind === 'error') return 'error'
      if (reason?.kind === 'cancelled' || reason?.kind === 'canceled' || reason?.kind === 'aborted') return 'error'
      return null
    }
    default:
      return /(?:error|failed|failure|cancel(?:led)?|abort)/i.test(event?.type ?? '') ? 'error' : null
  }
}

/**
 * Full body of one event. Shared by the projection (which stores a preview) and
 * the on-demand loader (which returns the whole text), so both read the same
 * fields instead of keeping two parsers in step.
 */
export function eventBody(event) {
  switch (event?.type) {
    case 'user/message': return contentText(event.data?.content)
    // Only prose. A model message also carries `tool-call` / `tool-result`
    // blocks, and merging those into the body is what made a card show a tool
    // name followed by its JSON arguments as if it were the answer.
    case 'assistant/message': return proseText(event.data?.message?.content)
    case 'todo/write': return Array.isArray(event.data?.todos) ? event.data.todos.map(todo => `[${todo.status}] ${todo.content}`).join('\n') : ''
    case 'turn/end': {
      const reason = event.data?.reason
      if (reason?.kind === 'error') return errorText(reason.error) ?? '本轮执行失败'
      return '本轮已取消'
    }
    default:
      return eventKind(event) === 'error' ? errorText(event.data?.error ?? event.data?.reason ?? event.data) ?? 'Harness 运行失败' : ''
  }
}

export function projectableEvent(event) {
  const kind = eventKind(event)
  if (kind === null) return null
  const text = eventBody(event)
  if (kind === 'user' && (isInjectedUserSource(event.data?.source) || isRuntimeContextText(text))) return null
  return noteProjection(kind, text)
}

/**
 * Full bodies for the requested stored messages, assembled from one session's
 * event log. Exported so the on-demand loader is testable without a Host.
 * `seqs === null` returns every projected message of the thread.
 */
export function bodiesFromEvents(thread, events, seqs) {
  const wanted = seqs === null ? null : new Set(seqs)
  const messages = {}
  const eventsBySeq = new Map(events.map(event => [event?.seq, event]))
  const calls = new Map()
  for (const event of events) {
    if (event?.type !== 'tool/call' && event?.type !== 'tool/result') continue
    const callId = String(event.type === 'tool/call' ? event.data?.callId : event.data?.message?.source?.callId ?? '')
    if (callId === '') continue
    const record = calls.get(callId) ?? {}
    if (event.type === 'tool/call') {
      record.arguments = typeof event.data?.arguments === 'string' ? event.data.arguments : null
    } else {
      record.result = contentText(event.data?.message?.content) || null
      record.error = errorText(event.data?.error)
    }
    calls.set(callId, record)
  }
  // The closing prose of each turn, latest step last. A preview written by an
  // older projection (or by a step that only carried tool calls) can point at an
  // event with no prose at all; the turn's own closing text is the right answer
  // there, and the stored preview is a better last resort than an empty body.
  const closingProse = new Map()
  for (const event of events) {
    if (event?.type !== 'assistant/message') continue
    const turn = event.data?.turn
    if (turn === undefined) continue
    const prose = proseText(event.data?.message?.content).trim()
    if (prose === '') continue
    closingProse.set(turn, prose)
  }
  for (const message of thread.messages ?? []) {
    if (wanted !== null && !wanted.has(message.sourceSeq)) continue
    const event = eventsBySeq.get(message.sourceSeq)
    if (event === undefined) continue
    const direct = eventBody(event).trim()
    const body = direct !== ''
      ? direct
      : (message.kind === 'assistant' ? closingProse.get(message.turn) ?? '' : '') || (typeof message.text === 'string' ? message.text.trim() : '')
    const capped = body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}${BODY_TRUNCATED_SUFFIX}` : body
    const process = Array.isArray(message.process)
      ? message.process.map(entry => ({ ...entry, ...(calls.get(String(entry.callId)) ?? {}) }))
      : []
    messages[String(message.sourceSeq)] = { text: capped, truncated: capped.length < body.length, process }
  }
  return messages
}
