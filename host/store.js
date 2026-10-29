// The workspace file: load, migrate, lock, and debounced writes.

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { LOCK_STALE_MS, MAX_NOTE_LENGTH, MAX_TITLE_LENGTH, SAVE_DEBOUNCE_MS, TOPIC_COLORS } from './constants.js'
import { normalizeState, projectableEvent } from './projection.js'
import { InputError, NotFoundError, errorText, positionOf, requiredText, sessionCwd, titleFromText, workspaceTitle } from './values.js'

/** JSON persistence for the Synapse workspace graph. */
export class WorkspaceStore {
  constructor(dataFile) {
    if (typeof dataFile !== 'string' || dataFile.length === 0) throw new Error('synapse: config.dataFile must be a non-empty path')
    this.dataFile = dataFile
    this.state = undefined
    this.serial = Promise.resolve()
    this.ready = this.load()
    this.lastKnownMtime = null
    this.externalModWarned = false
    this.lockWarned = false
    this.dirty = false
    this.flushTimer = null
  }

  async list() {
    await this.ready
    return this.state.workspaces.map(workspace => this.summary(workspace))
  }

  async get(workspaceId) {
    await this.ready
    const workspace = this.workspace(workspaceId)
    return structuredClone(workspace)
  }

  /**
   * Read-only lookup used by on-demand body loading: returns the live thread
   * (no clone) together with its workspace, or null when the id is unknown.
   */
  async locateThread(threadId) {
    await this.ready
    for (const workspace of this.state.workspaces) {
      for (const thread of workspace.threads ?? []) {
        if (thread.id === threadId) return { workspace, thread }
      }
    }
    return null
  }

  async create(title) {
    return this.mutate(() => {
      const now = new Date().toISOString()
      const workspace = { id: randomUUID(), title: requiredText(title, MAX_TITLE_LENGTH, 'title'), createdAt: now, updatedAt: now, threads: [] }
      this.state.workspaces.unshift(workspace)
      return this.summary(workspace)
    })
  }

  async createThread(workspaceId, input) {
    return this.mutate(() => {
      const workspace = this.workspace(workspaceId)
      const now = new Date().toISOString()
      const thread = this.thread({
        title: input?.title,
        parentId: input?.parentId,
        dshSessionId: input?.dshSessionId,
        dshSessionTitle: input?.dshSessionTitle,
        position: input?.position,
        color: input?.color,
        now,
        order: workspace.threads.length,
      })
      if (thread.parentId !== null && !workspace.threads.some(item => item.id === thread.parentId)) throw new InputError('分支来源不存在')
      workspace.threads.push(thread)
      workspace.updatedAt = now
      return structuredClone(thread)
    })
  }

  async branch(threadId, input) {
    return this.mutate(() => {
      const { workspace, thread: parent } = this.locateThread(threadId)
      const now = new Date().toISOString()
      const sessionId = typeof input?.dshSessionId === 'string' && input.dshSessionId.length > 0 ? input.dshSessionId : null
      // A DSH fork emits session/created while the browser receives its fork
      // response. Either path may win the race, but both must resolve to one node.
      if (sessionId !== null) {
        const existing = workspace.threads.find(item => item.dshSessionId === sessionId)
        if (existing !== undefined) {
          existing.parentId ??= parent.id
          if (typeof input?.title === 'string' && input.title.trim() !== '') existing.title = requiredText(input.title, MAX_TITLE_LENGTH, 'title')
          if (typeof input?.dshSessionTitle === 'string') existing.dshSessionTitle = input.dshSessionTitle.slice(0, MAX_TITLE_LENGTH)
          existing.updatedAt = now
          workspace.updatedAt = now
          return structuredClone(existing)
        }
      }
      const siblings = workspace.threads.filter(item => item.parentId === parent.id)
      const thread = this.thread({
        title: input?.title,
        parentId: parent.id,
        dshSessionId: input?.dshSessionId,
        dshSessionTitle: input?.dshSessionTitle,
        position: input?.position ?? { x: parent.position.x + 420, y: parent.position.y + siblings.length * 248 },
        color: input?.color ?? parent.color,
        now,
        order: workspace.threads.length,
      })
      workspace.threads.push(thread)
      workspace.updatedAt = now
      return structuredClone(thread)
    })
  }

  /** Keep only the canvas graph in Synapse; DSH remains the source of session truth. */
  async syncSessions(sessions, removedSessionIds = []) {
    return this.mutate(() => {
      if (!Array.isArray(sessions)) throw new InputError('sessions 必须是数组')
      if (!Array.isArray(removedSessionIds) || removedSessionIds.some(item => typeof item !== 'string')) throw new InputError('removedSessionIds 必须是字符串数组')
      const blankIds = new Set(sessions.filter(item => item?.blank === true && typeof item.id === 'string').map(item => item.id))
      const removedIds = new Set(removedSessionIds)
      for (const workspace of this.state.workspaces) {
        if (workspace.kind !== 'dsh') continue
        workspace.threads = workspace.threads.filter(thread => !blankIds.has(thread.dshSessionId) && !removedIds.has(thread.dshSessionId))
      }
      this.state.workspaces = this.state.workspaces.filter(workspace => workspace.kind !== 'dsh' || workspace.threads.length > 0)
      for (const item of sessions) {
        if (typeof item?.id !== 'string' || item.id === '' || typeof item.cwd !== 'string' || item.cwd === '') continue
        if (item.blank === true) continue
        // Canvas archiving is persistent UI state. A normal DSH list refresh
        // must not recreate a session that the user deliberately archived.
        if (this.state.hiddenSessionIds.includes(item.id)) continue
        const workspace = this.dshWorkspace(item.cwd, 'DSH 任务')
        const session = { id: item.id, header: { meta: { cwd: item.cwd }, parentSession: typeof item.parentId === 'string' ? item.parentId : undefined }, title: typeof item.title === 'string' ? item.title : undefined, events: [] }
        const thread = this.dshThread(workspace, session)
        if (typeof item.title === 'string' && item.title.trim() !== '') {
          thread.title = item.title.slice(0, MAX_TITLE_LENGTH)
          thread.dshSessionTitle = thread.title
        }
      }
      return this.list()
    }, { deferred: true })
  }

  async addMessage(threadId, text) {
    return this.mutate(() => {
      const { workspace, thread } = this.locateThread(threadId)
      const at = new Date().toISOString()
      const message = { id: randomUUID(), text: requiredText(text, MAX_NOTE_LENGTH, 'text'), kind: 'user', at }
      thread.messages.push(message)
      thread.updatedAt = at
      workspace.updatedAt = at
      return structuredClone(thread)
    })
  }

  async updateThread(threadId, input) {
    return this.mutate(() => {
      const { workspace, thread } = this.locateThread(threadId)
      if (input?.title !== undefined) thread.title = requiredText(input.title, MAX_TITLE_LENGTH, 'title')
      if (input?.position !== undefined) thread.position = positionOf(input.position)
      thread.updatedAt = new Date().toISOString()
      workspace.updatedAt = thread.updatedAt
      return structuredClone(thread)
    })
  }

  async removeThread(threadId) {
    return this.mutate(() => {
      const { workspace, thread } = this.locateThread(threadId)
      const removal = new Set([thread.id])
      for (let changed = true; changed;) {
        changed = false
        for (const item of workspace.threads) {
          if (item.parentId !== null && removal.has(item.parentId) && !removal.has(item.id)) { removal.add(item.id); changed = true }
        }
      }
      for (const item of workspace.threads) {
        if (removal.has(item.id) && item.dshSessionId !== null && !this.state.hiddenSessionIds.includes(item.dshSessionId)) this.state.hiddenSessionIds.push(item.dshSessionId)
      }
      workspace.threads = workspace.threads.filter(item => !removal.has(item.id))
      workspace.updatedAt = new Date().toISOString()
      if (workspace.threads.length === 0) this.state.workspaces = this.state.workspaces.filter(item => item.id !== workspace.id)
      return { removed: removal.size }
    })
  }

  async clearLegacy(sessions) {
    return this.mutate(() => {
      const hidden = new Set(this.state.hiddenSessionIds)
      for (const workspace of this.state.workspaces) for (const thread of workspace.threads) if (thread.dshSessionId !== null) hidden.add(thread.dshSessionId)
      for (const session of sessions) hidden.add(session.id)
      this.state.hiddenSessionIds = [...hidden]
      this.state.workspaces = []
      return { cleared: true }
    })
  }

  /** Replay one live DSH session into the dedicated projection workspace. */
  async projectSession(session, replayFrom = 0, workspaceTitle = 'DSH 任务') {
    return this.mutate(() => {
      if (this.state.hiddenSessionIds.includes(session.id)) return null
      const workspace = this.dshWorkspace(sessionCwd(session), workspaceTitle)
      const thread = this.dshThread(workspace, session)
      // `snapshotEvents()` replaces the removed `session.events` getter. It is
      // marked deprecated because DSH is moving complete logs out of memory, but
      // rebuilding this canvas from history needs the full sequence and the
      // reader is the only complete-log access a plugin still has.
      for (const event of session.snapshotEvents()) {
        if (event.seq >= replayFrom) this.projectEventInto(workspace, thread, event)
      }
      return structuredClone(thread)
    }, { deferred: true })
  }

  /** Project one committed DSH session event. Repeated sequence numbers are ignored. */
  async projectEvent(session, event, workspaceTitle = 'DSH 任务') {
    return this.mutate(() => {
      if (this.state.hiddenSessionIds.includes(session.id)) return null
      const workspace = this.dshWorkspace(sessionCwd(session), workspaceTitle)
      const thread = this.dshThread(workspace, session)
      this.projectEventInto(workspace, thread, event)
      return structuredClone(thread)
    }, { deferred: true })
  }

  /** Project a batch of committed events for one session in a single write. */
  async projectEvents(session, events, workspaceTitle = 'DSH 任务') {
    if (events.length === 0) return null
    return this.mutate(() => {
      if (this.state.hiddenSessionIds.includes(session.id)) return null
      const workspace = this.dshWorkspace(sessionCwd(session), workspaceTitle)
      const thread = this.dshThread(workspace, session)
      for (const event of events) this.projectEventInto(workspace, thread, event)
      return structuredClone(thread)
    }, { deferred: true })
  }

  async load() {
    await mkdir(dirname(this.dataFile), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.dataFile, 'utf8'))
      const { state, migrated } = normalizeState(parsed)
      this.state = state
      if (migrated) {
        // Migrations drop what re-projection alone cannot rebuild: v5 the stored
        // bodies, v6 the per-step transcript rows. Keep the previous file next to
        // the new one, tagged with the schema it was written in.
        const from = Number(parsed?.version)
        if (Number.isSafeInteger(from) && from < 6) await copyFile(this.dataFile, `${this.dataFile}.v${from}-backup`).catch(() => {})
        await this.save()
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`synapse: cannot read ${this.dataFile}: ${error.message}`)
      this.state = { version: 6, hiddenSessionIds: [], workspaces: [] }
      await this.save()
    }
  }

  async mutate(action, { deferred = false } = {}) {
    await this.ready
    const task = this.serial.then(async () => {
      const result = action()
      if (deferred) this.markDirty()
      else await this.save()
      return result
    })
    this.serial = task.catch(() => undefined)
    return task
  }

  /** Mark the state dirty and schedule one trailing flush for the window. */
  markDirty() {
    this.dirty = true
    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, SAVE_DEBOUNCE_MS)
  }

  /** Persist the current state when dirty, ordered after in-flight mutations. */
  flush() {
    if (!this.dirty) return Promise.resolve()
    this.dirty = false
    const task = this.serial.then(() => this.save())
    this.serial = task.catch(() => undefined)
    return task
  }

  async save() {
    // Two dsh web instances sharing one profile clobber each other's canvas
    // state. Warn loudly instead of silently losing work; a live lock held by
    // another process or a file mtime that moved since our last write both
    // indicate a second writer.
    const before = await this.fileMtime()
    if (this.lastKnownMtime !== null && before !== null && before !== this.lastKnownMtime) {
      this.lastKnownMtime = before
      if (!this.externalModWarned) {
        this.externalModWarned = true
        process.stderr.write('synapse: workspaces.json 已被另一个 dsh web 实例修改，本实例的写入可能覆盖其更改——请只运行一个实例\n')
      }
    }
    await this.acquireLock()
    try {
      const temporaryFile = `${this.dataFile}.${process.pid}.tmp`
      await writeFile(temporaryFile, `${JSON.stringify(this.state)}\n`, 'utf8')
      await rename(temporaryFile, this.dataFile)
      this.lastKnownMtime = (await stat(this.dataFile)).mtimeMs
    } finally {
      await this.releaseLock()
    }
  }

  async fileMtime() {
    try { return (await stat(this.dataFile)).mtimeMs } catch { return null }
  }

  /** Take an exclusive cross-process lock, breaking a stale one; warn when a live process holds it. */
  async acquireLock() {
    const lockFile = `${this.dataFile}.lock`
    if (await this.tryAcquire(lockFile)) return
    if (await this.lockIsStale(lockFile)) {
      await unlink(lockFile).catch(() => {})
      if (await this.tryAcquire(lockFile)) return
    }
    if (!this.lockWarned) {
      this.lockWarned = true
      process.stderr.write('synapse: 另一个 dsh web 实例正在写入 workspaces.json——请只运行一个实例，否则画布数据可能互相覆盖\n')
    }
  }

  async tryAcquire(lockFile) {
    try {
      await writeFile(lockFile, `${process.pid}\n`, { flag: 'wx' })
      return true
    } catch {
      return false
    }
  }

  /** A lock is stale when its owner PID is gone or the lock file is older than the stale window. */
  async lockIsStale(lockFile) {
    try {
      const [content, stats] = await Promise.all([readFile(lockFile, 'utf8'), stat(lockFile)])
      const tooOld = Date.now() - stats.mtimeMs > LOCK_STALE_MS
      const pid = Number.parseInt(content, 10)
      if (!Number.isInteger(pid)) return tooOld
      if (pid === process.pid) return false
      try {
        process.kill(pid, 0)
        return tooOld
      } catch {
        return true
      }
    } catch {
      return false
    }
  }

  async releaseLock() {
    await unlink(`${this.dataFile}.lock`).catch(() => {})
  }

  workspace(workspaceId) {
    const workspace = this.state.workspaces.find(item => item.id === workspaceId)
    if (workspace === undefined) throw new NotFoundError('工作空间不存在')
    return workspace
  }

  locateThread(threadId) {
    for (const workspace of this.state.workspaces) {
      const thread = workspace.threads.find(item => item.id === threadId)
      if (thread !== undefined) return { workspace, thread }
    }
    throw new NotFoundError('节点不存在')
  }

  dshWorkspace(cwd, fallbackTitle) {
    let workspace = this.state.workspaces.find(item => item.kind === 'dsh' && item.cwd === cwd)
    if (workspace !== undefined) return workspace
    const now = new Date().toISOString()
    workspace = { id: randomUUID(), kind: 'dsh', cwd, title: workspaceTitle(cwd, fallbackTitle), createdAt: now, updatedAt: now, threads: [] }
    this.state.workspaces.unshift(workspace)
    return workspace
  }

  dshThread(workspace, session) {
    let thread = workspace.threads.find(item => item.dshSessionId === session.id)
    if (thread !== undefined) {
      if (typeof session.title === 'string' && session.title.trim() !== '') {
        const title = session.title.slice(0, MAX_TITLE_LENGTH)
        thread.title = title
        thread.dshSessionTitle = title
      }
      // `inheritedEventCount` is DSH's durable fork cut, the successor of the
      // removed `header.seedLength`. It survives restore, unlike `firstLiveSeq`.
      const seedLength = session.inheritedEventCount
      if (Number.isSafeInteger(seedLength) && seedLength >= 0) thread.sourceSeedLength = seedLength
      return thread
    }
    const parentSessionId = typeof session.header?.parentSession === 'string' ? session.header.parentSession : null
    const parent = parentSessionId === null ? undefined : workspace.threads.find(item => item.dshSessionId === parentSessionId)
    const siblings = workspace.threads.filter(item => item.sourceParentSessionId === parentSessionId)
    const now = new Date().toISOString()
    thread = {
      id: randomUUID(),
      title: typeof session.title === 'string' && session.title.trim() !== '' ? session.title.slice(0, MAX_TITLE_LENGTH) : (parent === undefined ? 'DSH 会话' : `${parent.title} 分支`),
      parentId: parent?.id ?? null,
      sourceParentSessionId: parentSessionId,
      sourceSeedLength: Number.isSafeInteger(session.inheritedEventCount) && session.inheritedEventCount >= 0 ? session.inheritedEventCount : null,
      dshSessionId: session.id,
      dshSessionTitle: typeof session.title === 'string' ? session.title.slice(0, MAX_TITLE_LENGTH) : null,
      color: TOPIC_COLORS[workspace.threads.length % TOPIC_COLORS.length],
      // DSH projection stores only a neutral semantic anchor. The visual map
      // lays out visible cards from the current conversation graph each render,
      // so old/archived session counts must never leak into future coordinates.
      position: parent === undefined ? { x: 86, y: 82 } : { x: parent.position.x + 400, y: parent.position.y },
      createdAt: now,
      updatedAt: now,
      messages: [],
      pendingProcess: [],
    }
    workspace.threads.push(thread)
    // A child may arrive before its parent during startup replay. Repair that
    // relation when the missing parent later reaches the projection.
    for (const child of workspace.threads) {
      if (child.sourceParentSessionId === session.id && child.parentId === null) child.parentId = thread.id
    }
    workspace.updatedAt = now
    return thread
  }

  projectEventInto(workspace, thread, event) {
    if (event.type === 'session/title' && typeof event.data?.title === 'string') {
      thread.title = event.data.title.slice(0, MAX_TITLE_LENGTH)
      thread.dshSessionTitle = thread.title
      thread.updatedAt = new Date(event.time).toISOString()
      workspace.updatedAt = thread.updatedAt
      return
    }
    if (event.type === 'tool/call' || event.type === 'tool/result') {
      this.foldToolProcess(thread, event)
      workspace.updatedAt = thread.updatedAt
      return
    }
    // A turn owns exactly one answer message: the steps in between are tool calls
    // wrapped in narration, not messages of their own.
    if (event.type === 'assistant/message') {
      this.foldAssistantStep(workspace, thread, event)
      return
    }
    if (event.type === 'turn/end') {
      this.closeTurn(workspace, thread, event)
      return
    }
    const projection = projectableEvent(event)
    const existing = thread.messages.find(message => message.sourceSeq === event.seq)
    if (existing !== undefined) {
      // A stored preview can predate a projection fix: user and todo rows are
      // refreshed in place (the assistant half is handled by
      // `foldAssistantStep`) instead of keeping the old preview for the life of
      // the file.
      if (projection === null) return
      if (existing.text !== projection.text) {
        existing.text = projection.text
        existing.length = projection.length
        existing.truncated = projection.truncated
        thread.updatedAt = new Date(event.time).toISOString()
        workspace.updatedAt = thread.updatedAt
      }
      return
    }
    if (projection === null) return
    const at = new Date(event.time).toISOString()
    const message = {
      id: randomUUID(),
      text: projection.text,
      length: projection.length,
      truncated: projection.truncated,
      kind: projection.kind,
      sourceSeq: event.seq,
      at,
      ...(projection.kind === 'assistant' || projection.kind === 'error'
        ? { turn: event.data?.turn, step: event.data?.step, process: [] }
        : {}),
    }
    this.attachPendingProcess(thread, message)
    thread.messages.push(message)
    thread.updatedAt = at
    workspace.updatedAt = at
    if (thread.dshSessionTitle === null && projection.kind === 'user') {
      thread.title = titleFromText(projection.text)
      thread.dshSessionTitle = thread.title
    }
  }

  /** The one answer message a turn owns, if the turn has spoken yet. */
  turnAnswer(thread, turn) {
    return [...thread.messages].reverse().find(message => message.kind === 'assistant' && message.turn === turn)
  }

  /**
   * Fold one assistant step into its turn's answer. A turn is a run of steps and
   * only the last step that carries prose is the answer; the earlier steps are
   * narration around tool calls. Storing one message per step made a long tool
   * loop add a row per call and buried the closing prose, so a later step
   * overwrites the preview in place and `turn/end` decides when it is final.
   */
  foldAssistantStep(workspace, thread, event) {
    const turn = event.data?.turn
    const projection = projectableEvent(event)
    // A step that only invokes tools has no prose: it contributes its calls to
    // the turn's process records and nothing to the answer.
    if (projection === null) return
    const answer = turn === undefined ? undefined : this.turnAnswer(thread, turn)
    // A row already stored for this seq is refreshed in place (an older
    // projection wrote tool arguments as the text, and a replay must be able to
    // repair it). Adopting the turn is what lets later steps fold into it.
    const target = answer ?? thread.messages.find(message => message.sourceSeq === event.seq && message.kind !== 'user' && message.kind !== 'error')
    const at = new Date(event.time).toISOString()
    if (target === undefined) {
      const message = {
        id: randomUUID(),
        text: projection.text,
        length: projection.length,
        truncated: projection.truncated,
        kind: 'assistant',
        sourceSeq: event.seq,
        at,
        turn,
        step: event.data?.step,
        process: [],
      }
      this.attachPendingProcess(thread, message)
      thread.messages.push(message)
    } else {
      // The body and its seq move to the newest prose step, so the on-demand
      // loader reads the closing text rather than the first narration line.
      target.text = projection.text
      target.length = projection.length
      target.truncated = projection.truncated
      target.kind = 'assistant'
      target.sourceSeq = event.seq
      target.turn = turn
      target.step = event.data?.step
      target.at = at
      target.ended = false
    }
    thread.updatedAt = at
    workspace.updatedAt = at
  }

  /**
   * `turn/end` is the only authoritative "this turn is over" signal: a step that
   * stopped calling tools cannot be told apart from one that is about to call
   * another, so the turn stays open until the harness says so. A turn that ends
   * without prose still gets an answer record (empty, `ended`) — that is what
   * lets the map say "run over, no text" instead of waiting forever, and gives
   * the turn's tool calls somewhere to fold into.
   */
  closeTurn(workspace, thread, event) {
    const turn = event.data?.turn
    const at = new Date(event.time).toISOString()
    const failure = projectableEvent(event)
    if (failure !== null) {
      const message = {
        id: randomUUID(),
        text: failure.text,
        length: failure.length,
        truncated: failure.truncated,
        kind: failure.kind,
        sourceSeq: event.seq,
        at,
        turn,
        step: event.data?.step,
        process: [],
        ended: true,
      }
      this.attachPendingProcess(thread, message)
      thread.messages.push(message)
      const answer = turn === undefined ? undefined : this.turnAnswer(thread, turn)
      if (answer !== undefined) answer.ended = true
    } else {
      const answer = turn === undefined ? undefined : this.turnAnswer(thread, turn)
      if (answer !== undefined) {
        answer.ended = true
      } else if ((thread.pendingProcess ?? []).some(entry => entry.turn === turn)) {
        // Only worth recording when the turn left something behind (a tool run
        // with no closing prose). A turn with nothing at all — a filtered
        // harness note, an immediate cancel — gets no row, so it cannot leave a
        // blank answer behind on the canvas.
        const message = {
          id: randomUUID(),
          text: '',
          length: 0,
          truncated: false,
          kind: 'assistant',
          sourceSeq: event.seq,
          at,
          turn,
          step: event.data?.step,
          process: [],
          ended: true,
        }
        this.attachPendingProcess(thread, message)
        thread.messages.push(message)
      }
    }
    thread.updatedAt = at
    workspace.updatedAt = at
  }

  /**
   * Fold one tool call or result into the answer of its turn, keyed by `callId`,
   * so a tool invocation never becomes a separate canvas card. Matching on the
   * turn (not turn+step) is what lets a call from step 5 land on an answer that
   * step 3 already wrote. If the turn has not spoken yet, the record waits in
   * `pendingProcess` until it does.
   */
  foldToolProcess(thread, event) {
    const at = new Date(event.time).toISOString()
    const data = event.data ?? {}
    const target = [...thread.messages].reverse().find(message =>
      (message.kind === 'assistant' || message.kind === 'error')
      && (message.turn === data.turn || message.turn === undefined && data.turn === undefined))
    const process = target === undefined ? (thread.pendingProcess ??= []) : (target.process ??= [])
    const callId = String(event.type === 'tool/call' ? data.callId : data.message?.source?.callId ?? '')
    const entry = process.find(item => item.callId === callId)
    // Process records keep only identity and status: tool arguments and results
    // are the bulk of the old file (issue #42) and are reloaded on demand.
    if (event.type === 'tool/call') {
      if (entry === undefined) {
        process.push({ callId, turn: data.turn, step: data.step, name: data.name, status: 'pending' })
      } else {
        entry.name = data.name
      }
    } else {
      const failed = errorText(data.error) !== null
      if (entry === undefined) {
        process.push({ callId, turn: data.turn, step: data.step, name: '工具调用', status: failed ? 'failed' : 'done' })
      } else {
        entry.status = failed ? 'failed' : 'done'
        if (typeof entry.name !== 'string' || entry.name === '') entry.name = '工具调用'
      }
    }
    thread.updatedAt = at
  }

  attachPendingProcess(thread, message) {
    if (!Array.isArray(thread.pendingProcess) || thread.pendingProcess.length === 0 || !Array.isArray(message.process)) return
    const matching = thread.pendingProcess.filter(entry => entry.turn === message.turn)
    if (matching.length === 0) return
    message.process.push(...matching.map(({ turn: _turn, ...entry }) => entry))
    thread.pendingProcess = thread.pendingProcess.filter(entry => entry.turn !== message.turn)
  }

  thread({ title, parentId, dshSessionId, dshSessionTitle, position, color, now, order }) {
    return {
      id: randomUUID(),
      title: requiredText(title, MAX_TITLE_LENGTH, 'title'),
      parentId: typeof parentId === 'string' && parentId.length > 0 ? parentId : null,
      dshSessionId: typeof dshSessionId === 'string' && dshSessionId.length > 0 ? dshSessionId : null,
      dshSessionTitle: typeof dshSessionTitle === 'string' ? dshSessionTitle.slice(0, MAX_TITLE_LENGTH) : null,
      color: TOPIC_COLORS.includes(color) ? color : TOPIC_COLORS[order % TOPIC_COLORS.length],
      position: positionOf(position ?? { x: 86 + (order % 3) * 410, y: 82 + Math.floor(order / 3) * 260 }),
      createdAt: now,
      updatedAt: now,
      messages: [],
      pendingProcess: [],
    }
  }

  summary(workspace) {
    return { id: workspace.id, kind: workspace.kind ?? 'manual', cwd: workspace.cwd ?? null, title: workspace.title, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt, threadCount: workspace.threads.length }
  }
}
