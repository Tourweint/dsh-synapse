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
 * One row per tool call: name + status, plus its arguments and result.
 * `options.openByDefault` is what the inspector uses: the drawer is where a
 * turn's tool work is read, so a row arrives open and the reader folds what they
 * are done with. The detail view keeps the opt-in behaviour, because there the
 * rows sit inside the 过程记录 fold and would otherwise open twice.
 */
function processEntries(process, key, options = {}) {
  const openByDefault = options.openByDefault === true
  return process.map((entry, index) => {
    const entryKey = `${key}:${index}`
    const open = openByDefault ? !state.collapsedProcessIds.has(entryKey) : state.expandedMessageIds.has(entryKey)
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
    const action = openByDefault ? 'toggle-process' : 'toggle-message'
    return `<div class="process-entry${open ? ' expanded' : ''}"><button class="process-entry-fold" type="button" data-action="${action}" data-message="${escapeHtml(entryKey)}"><span class="process-entry-name">${escapeHtml(name)}</span><span class="process-status${statusClass}">${status}</span></button>${open ? `<div class="process-entry-body">${body}</div>` : ''}</div>`
  }).join('')
}

function processRecords(process, messageId) {
  const key = `${messageId}:process`
  const expanded = state.expandedMessageIds.has(key)
  return `<section class="process-records${expanded ? ' expanded' : ''}"><button class="process-records-fold" data-action="toggle-message" data-message="${escapeHtml(key)}"><span>${expanded ? '收起过程记录' : '过程记录'}</span><span class="process-count">${process.length}</span></button>${expanded ? processEntries(process, key) : ''}</section>`
}
