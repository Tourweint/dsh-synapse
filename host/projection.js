// Turns DSH session events into the stored workspace graph.

import { randomUUID } from 'node:crypto'
import { BODY_TRUNCATED_SUFFIX, MAX_BODY_CHARS, TOPIC_COLORS } from './constants.js'
import { contentText, errorText, excerptOf, isInjectedUserMessage, isInjectedUserSource, isRuntimeContextText, noteProjection, proseText } from './values.js'

export function normalizeState(value) {
  let migrated = false
  let state
  if ((value?.version === 2 || value?.version === 3 || value?.version === 4 || value?.version === 5) && Array.isArray(value.workspaces)) {
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
  return { state, migrated }
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
  for (const message of thread.messages ?? []) {
    if (wanted !== null && !wanted.has(message.sourceSeq)) continue
    const event = eventsBySeq.get(message.sourceSeq)
    if (event === undefined) continue
    const body = eventBody(event).trim()
    const capped = body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}${BODY_TRUNCATED_SUFFIX}` : body
    const process = Array.isArray(message.process)
      ? message.process.map(entry => ({ ...entry, ...(calls.get(String(entry.callId)) ?? {}) }))
      : []
    messages[String(message.sourceSeq)] = { text: capped, truncated: capped.length < body.length, process }
  }
  return messages
}
