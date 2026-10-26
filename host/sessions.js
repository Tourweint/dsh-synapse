// Reading DSH session logs from disk, including zstd-compressed ones.

// ---------------------------------------------------------------------------
// Session logs on disk
//
// `ctx.sessions` only exposes sessions this process currently holds, which is
// one or two out of a workspace's history. Everything else is read from the DSH
// session log: a run of concatenated zstd frames holding JSONL events.
// ---------------------------------------------------------------------------

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
export const SESSION_LOG_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

export const SESSION_LOG_PATTERN = /^session(?:\.[\w-]+)*\.jsonl\.zstd$/

/** Decode the concatenated zstd frames of one session log into JSONL text. */
export function decodeSessionLog(buffer) {
  if (typeof zstdDecompressSync !== 'function') return null
  const offsets = []
  let index = buffer.indexOf(SESSION_LOG_MAGIC, 0)
  while (index !== -1) {
    offsets.push(index)
    index = buffer.indexOf(SESSION_LOG_MAGIC, index + 4)
  }
  if (offsets.length === 0) return null
  const parts = []
  for (let i = 0; i < offsets.length; i += 1) {
    const end = i + 1 < offsets.length ? offsets[i + 1] : buffer.length
    try {
      parts.push(zstdDecompressSync(buffer.subarray(offsets[i], end)))
    } catch {
      // A log that is being appended to can end mid-frame; decode what is whole.
      break
    }
  }
  if (parts.length === 0) return null
  return Buffer.concat(parts).toString('utf8')
}

/** Reads session events from `$DSH_HOME/sessions`, caching by file mtime. */
export class SessionLogReader {
  constructor(directory) {
    this.directory = directory
    this.cache = new Map()
  }

  /** Events of one session, or null when its log is missing or unreadable. */
  async events(sessionId) {
    if (typeof this.directory !== 'string' || this.directory === '' || typeof sessionId !== 'string' || sessionId === '') return null
    const file = await this.findLog(sessionId)
    if (file === null) {
      this.cache.delete(sessionId)
      return null
    }
    const info = await stat(file).catch(() => null)
    if (info === null) return null
    const cached = this.cache.get(sessionId)
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.events
    const text = decodeSessionLog(await readFile(file))
    if (text === null) return null
    const events = []
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      try {
        const event = JSON.parse(line)
        if (typeof event?.seq === 'number') events.push(event)
      } catch {
        // Trailing partial line while the session is still being written.
      }
    }
    // Keep a few decoded logs; one screenful of cards touches few threads.
    if (this.cache.size >= 4) this.cache.delete(this.cache.keys().next().value)
    this.cache.set(sessionId, { mtimeMs: info.mtimeMs, size: info.size, events })
    return events
  }

  async findLog(sessionId) {
    let workspaces
    try {
      workspaces = await readdir(this.directory, { withFileTypes: true })
    } catch {
      return null
    }
    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue
      const sessionDirectory = join(this.directory, workspace.name, sessionId)
      let files
      try {
        files = await readdir(sessionDirectory)
      } catch {
        continue
      }
      const log = files.find(name => SESSION_LOG_PATTERN.test(name))
      if (log !== undefined) return join(sessionDirectory, log)
    }
    return null
  }
}
