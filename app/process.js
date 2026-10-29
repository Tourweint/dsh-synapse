// Tool-call records: the folded 过程记录 row and the inspector's tool blocks.

function isProcessMessage(message) {
  if (message.kind === 'tool' || message.kind === 'tool-result') return true
  return message.kind === 'assistant' && /(?:^|\n)\s*(?:bash|pwsh|powershell|web_search|web_fetch|browser|read_file|write_file)\s*\n\s*\{/.test(message.text)
}

function processSummary(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140) || '工具调用记录'
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

/**
 * One row per tool call: a state dot, the tool name and its status, plus the
 * arguments and result once the row is opened.
 *
 * Rows start folded everywhere — the same thing the host does with its own tool
 * rows (`ui-tool/ToolRow` uses an opt-in disclosure) — because a turn can hold
 * a hundred of them and an opened payload is taller than the answer. What tells
 * the reader what happened without opening anything is the state colour: a 4px
 * dot plus the status word, green / amber / red, copied from the host's
 * `StateDot` tokens rather than from a tinted block, so the row still reads as
 * a quiet line of text and not as a second card.
 */
function processEntries(process, key) {
  return process.map((entry, index) => {
    const entryKey = `${key}:${index}`
    const open = state.expandedMessageIds.has(entryKey)
    const state_ = processState(entry)
    const status = state_ === 'failed' ? '失败' : state_ === 'pending' ? '等待结果' : '完成'
    const statusClass = state_ === 'failed' ? ' process-status-error' : state_ === 'pending' ? ' process-status-pending' : ' process-status-done'
    // A tool name can be missing on a v3-era record; an empty row reads like a
    // rendering bug, so fall back to the generic label.
    const name = typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name : '工具调用'
    const argumentsHtml = typeof entry.arguments === 'string' && entry.arguments.trim() !== ''
      ? `<p class="process-entry-label">参数</p><pre class="process-args">${escapeHtml(entry.arguments)}</pre>`
      : ''
    const outcome = state_ === 'failed' && typeof entry.error === 'string' && entry.error !== ''
      ? `<p class="process-entry-label">错误</p><pre class="process-error">${escapeHtml(entry.error)}</pre>`
      : typeof entry.result === 'string' && entry.result.trim() !== ''
        ? `<p class="process-entry-label">结果</p><pre class="process-result">${escapeHtml(entry.result)}</pre>`
        : ''
    // Nothing to show yet (a stored record whose body has not hydrated): say so
    // instead of leaving the row looking truncated.
    const body = argumentsHtml === '' && outcome === ''
      ? '<p class="process-entry-empty">暂无参数与结果</p>'
      : argumentsHtml + outcome
    return `<div class="process-entry process-entry-${state_}${open ? ' expanded' : ''}"><button class="process-entry-fold" type="button" data-action="toggle-message" data-message="${escapeHtml(entryKey)}" aria-expanded="${open}"><svg class="process-entry-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg><span class="process-entry-name">${escapeHtml(name)}</span><span class="process-entry-state"><span class="process-entry-dot" aria-hidden="true"></span><span class="process-status${statusClass}">${status}</span></span></button>${open ? `<div class="process-entry-body">${body}</div>` : ''}</div>`
  }).join('')
}

function processRecords(process, messageId) {
  const key = `${messageId}:process`
  const expanded = state.expandedMessageIds.has(key)
  return `<section class="process-records${expanded ? ' expanded' : ''}"><button class="process-records-fold" data-action="toggle-message" data-message="${escapeHtml(key)}"><span>${expanded ? '收起过程记录' : '过程记录'}</span><span class="process-count">${process.length}</span></button>${expanded ? processEntries(process, key) : ''}</section>`
}
