// The plugin entry: which scripts the page loads, and the routes themselves.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MAX_TITLE_LENGTH } from './constants.js'
import { readJson, sendFile, sendJson } from './http.js'
import { bodiesFromEvents } from './projection.js'
import { SessionLogReader } from './sessions.js'
import { WorkspaceStore } from './store.js'
import { InputError, NotFoundError } from './values.js'

export const name = 'synapse'

export const inject = ['webServer', 'sessions']

// The canvas UI is a set of classic scripts, not modules: they share one global
// scope, so the order below is the dependency order (values first, behaviour
// last). Splitting the file this way keeps every chapter readable and every
// stack frame pointing at the file it came from, without a build step.
export const APP_SCRIPTS = ['text', 'dom', 'core', 'data', 'markdown', 'layout', 'cards', 'process', 'detail', 'inspector', 'render', 'morph', 'canvas', 'events', 'live']

// Same idea for the stylesheet, which used to be one 700-line file: cascade
// order, dark theme last. tokens.css is linked first, on its own, because it
// holds nothing but values.
export const STYLE_SHEETS = ['base', 'chrome', 'cards', 'inspector', 'detail', 'markdown', 'dark']

export function page() {
  const scripts = APP_SCRIPTS.map(name => `<script src="/synapse/app/${name}.js"></script>`).join('')
  const sheets = STYLE_SHEETS.map(name => `<link rel="stylesheet" href="/synapse/styles/${name}.css">`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synapse for DSH</title><link rel="stylesheet" href="/synapse/tokens.css">${sheets}</head><body><div id="app"></div>${scripts}</body></html>`
}

/** Mount Synapse routes on the existing DSH Web Server. */
export function apply(ctx, config) {
  const store = new WorkspaceStore(config?.dataFile)
  // A profile can point the plugin at a different home; by default the session
  // logs sit beside the workspace file ($DSH_HOME/sessions).
  const sessionsDirectory = typeof config?.sessionsDir === 'string' && config.sessionsDir !== ''
    ? config.sessionsDir
    : join(dirname(dirname(config?.dataFile ?? '')), 'sessions')
  const sessionLog = new SessionLogReader(sessionsDirectory)
  const autoProjection = config?.autoProjection !== false
  const projectionWorkspaceTitle = typeof config?.projectionWorkspaceTitle === 'string' && config.projectionWorkspaceTitle.trim() !== ''
    ? config.projectionWorkspaceTitle.trim().slice(0, MAX_TITLE_LENGTH)
    : 'DSH 任务'
  const reportProjectionFailure = error => {
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
  }
  const replaySession = session => {
    // Forks inherit their parent's log. The canvas already represents that
    // history through the parent node, so only project the child's live tail:
    // `inheritedEventCount` is 0 without a fork and the durable cut with one.
    const replayFrom = session.inheritedEventCount ?? 0
    void store.projectSession(session, replayFrom, projectionWorkspaceTitle).catch(reportProjectionFailure)
  }
  // Buffer live events per session and flush them in one write per microtask,
  // so a burst of turn events coalesces into a single save instead of N.
  const projectionQueue = []
  let projectionScheduled = false
  const enqueueProjection = (session, event) => {
    projectionQueue.push({ session, event })
    if (projectionScheduled) return
    projectionScheduled = true
    queueMicrotask(() => {
      projectionScheduled = false
      const batch = projectionQueue.splice(0)
      const bySession = new Map()
      for (const item of batch) {
        const entry = bySession.get(item.session.id)
        if (entry === undefined) bySession.set(item.session.id, [item.session, [item.event]])
        else entry[1].push(item.event)
      }
      for (const [sessionId, [session, events]] of bySession) {
        void store.projectEvents(session, events, projectionWorkspaceTitle).catch(reportProjectionFailure)
      }
    })
  }
  if (autoProjection) {
    ctx.on('session/created', replaySession)
    ctx.on('session/event', enqueueProjection)
    for (const session of ctx.sessions.list()) replaySession(session)
  }
  // Bodies live in the session log, not in the workspace file (issue #42). The
  // canvas pulls them for the cards it actually renders; the detail view pulls a
  // whole thread at once. An archived or already-removed session cannot be
  // re-read, so the caller is told instead of receiving silently empty text.
  const threadBodies = async (threadId, seqs) => {
    const located = await store.locateThread(threadId)
    if (located === null) throw new NotFoundError('会话不存在')
    const { thread } = located
    const wanted = seqs === null ? null : new Set(seqs)
    if (thread.dshSessionId === null) {
      const messages = {}
      for (const message of thread.messages ?? []) {
        if (wanted !== null && !wanted.has(message.sourceSeq)) continue
        messages[String(message.sourceSeq)] = { text: message.text, truncated: message.truncated === true, process: message.process ?? [], local: true }
      }
      return { messages }
    }
    const session = ctx.sessions.list().find(candidate => candidate.id === thread.dshSessionId)
    if (session !== undefined) return { messages: bodiesFromEvents(thread, session.snapshotEvents(), seqs) }
    // Closed session: read its log from disk, which is where the body lives.
    const events = await sessionLog.events(thread.dshSessionId)
    if (events === null) return { messages: {}, unavailable: true }
    return { messages: bodiesFromEvents(thread, events, seqs) }
  }
  // The DSH /api browser-trust fence does not cover /synapse routes, so this
  // handler checks the Host header itself: localhost is allowed by default and
  // additional authorities opt in through config.trustedHosts (mirrors the
  // fence's DNS-rebinding defense).
  const trustedHosts = new Set(['localhost', '127.0.0.1', ...[...(config?.trustedHosts ?? [])].map(host => String(host).trim().toLowerCase()).filter(Boolean)])
  const api = async (req, res) => {
    try {
      const hostname = (typeof req.headers.host === 'string' ? req.headers.host : '').replace(/:\d+$/, '').toLowerCase()
      if (!trustedHosts.has(hostname)) return sendJson(res, 403, { error: '不被信任的 Host' })
      const path = new URL(req.url ?? '/', 'http://dsh.local').pathname
      if (path === '/synapse/api/reset' && req.method === 'POST') return sendJson(res, 200, await store.clearLegacy(ctx.sessions.list()))
      if (path === '/synapse/api/workspaces') {
        if (req.method === 'GET') return sendJson(res, 200, { workspaces: await store.list() })
        if (req.method === 'POST') return sendJson(res, 201, { workspace: await store.create((await readJson(req)).title) })
      }
      const workspace = /^\/synapse\/api\/workspaces\/([0-9a-f-]+)$/i.exec(path)
      if (workspace !== null) {
        if (req.method === 'GET') return sendJson(res, 200, { workspace: await store.get(workspace[1]) })
        if (req.method === 'POST') return sendJson(res, 201, { thread: await store.createThread(workspace[1], await readJson(req)) })
      }
      const branch = /^\/synapse\/api\/threads\/([0-9a-f-]+)\/branch$/i.exec(path)
      if (branch !== null && req.method === 'POST') return sendJson(res, 201, { thread: await store.branch(branch[1], await readJson(req)) })
      if (path === '/synapse/api/sessions/sync' && req.method === 'POST') { const body = await readJson(req); return sendJson(res, 200, { workspaces: await store.syncSessions(body.sessions, body.removedSessionIds) }) }
      const messages = /^\/synapse\/api\/threads\/([0-9a-f-]+)\/messages$/i.exec(path)
      if (messages !== null && req.method === 'POST') return sendJson(res, 201, { thread: await store.addMessage(messages[1], (await readJson(req)).text) })
      const full = /^\/synapse\/api\/threads\/([0-9a-f-]+)\/full$/i.exec(path)
      if (full !== null && req.method === 'GET') {
        const raw = new URL(req.url ?? '/', 'http://dsh.local').searchParams.get('seqs')
        const seqs = raw === null || raw.trim() === ''
          ? null
          : raw.split(',').map(value => Number.parseInt(value, 10)).filter(value => Number.isInteger(value) && value >= 0)
        return sendJson(res, 200, await threadBodies(full[1], seqs))
      }
      const thread = /^\/synapse\/api\/threads\/([0-9a-f-]+)$/i.exec(path)
      if (thread !== null && req.method === 'PATCH') return sendJson(res, 200, { thread: await store.updateThread(thread[1], await readJson(req)) })
      if (thread !== null && req.method === 'DELETE') return sendJson(res, 200, await store.removeThread(thread[1]))
      return sendJson(res, 404, { error: '接口不存在' })
    } catch (error) {
      if (error instanceof InputError) return sendJson(res, 400, { error: error.message })
      if (error instanceof NotFoundError) return sendJson(res, 404, { error: error.message })
      ctx.logger.error(error instanceof Error ? error : new Error(String(error)))
      return sendJson(res, 500, { error: 'Synapse 数据暂时不可用' })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse', handler: (_req, res) => { res.writeHead(302, { location: '/synapse/' }); res.end() } }), 'synapse: redirect')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/', handler: (_req, res) => { sendFile(res, 'text/html; charset=utf-8', page()) } }), 'synapse: page')
  // One exact route per script: the list is fixed at startup, so there is no
  // path to sanitise and no directory listing to leak.
  for (const name of APP_SCRIPTS) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: `/synapse/app/${name}.js`,
      handler: async (_req, res) => { sendFile(res, 'text/javascript; charset=utf-8', await readFile(new URL(`../app/${name}.js`, import.meta.url), 'utf8')) },
    }), `synapse: app ${name}`)
  }

  for (const name of STYLE_SHEETS) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: `/synapse/styles/${name}.css`,
      handler: async (_req, res) => { sendFile(res, 'text/css; charset=utf-8', await readFile(new URL(`../styles/${name}.css`, import.meta.url), 'utf8')) },
    }), `synapse: styles ${name}`)
  }

  // Static assets live in the package root, one level above this module.
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/tokens.css', handler: async (_req, res) => { sendFile(res, 'text/css; charset=utf-8', await readFile(new URL('../tokens.css', import.meta.url), 'utf8')) } }), 'synapse: tokens')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/deepseek-mark.svg', handler: async (_req, res) => { sendFile(res, 'image/svg+xml', await readFile(new URL('../deepseek-mark.svg', import.meta.url), 'utf8')) } }), 'synapse: DeepSeek mark')
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/synapse/api', handler: api }), 'synapse: api')
}
