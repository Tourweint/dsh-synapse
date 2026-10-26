// The conversation transcript view.

/**
 * One row of the transcript, styled the way the host renders a conversation:
 * the user's turn is a right-aligned bubble, the answer is the page itself
 * (plain prose, no card, no role header), and a tool/process record collapses
 * into a single quiet disclosure row. Everything the old card chrome carried
 * (avatar, "你 / DSH", timestamps, per-message borders) is gone — the reading
 * column and the bubble ARE the structure.
 */
function threadMessage(thread, message) {
  const isUser = message.kind === 'user'
  const messageId = `${thread.id}:${message.sourceSeq ?? `${message.kind}:${message.at}`}`
  const collapsible = isProcessMessage(message)
  const expanded = state.expandedMessageIds.has(messageId)
  const process = Array.isArray(message.process) && message.process.length > 0 ? message.process : null
  const streaming = message.pending ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>' : ''
  const body = message.pending && message.text === ''
    ? '<p class="message-streaming"><span class="streaming-dot"></span>正在回复</p>'
    : `${renderMarkdown(message.text)}${streaming}${process === null ? '' : processRecords(process, messageId)}`
  const seq = `data-message-seq="${Number.isInteger(message.sourceSeq) ? message.sourceSeq : ''}"`
  if (collapsible) {
    return `<article class="message message-${message.kind} message-process${expanded ? ' expanded' : ''}" ${seq}><button class="message-fold" type="button" data-action="toggle-message" data-message="${escapeHtml(messageId)}" aria-expanded="${expanded}" aria-label="${expanded ? '收起过程记录' : '展开过程记录'}" title="${expanded ? '收起' : '展开'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg><span class="message-summary">${escapeHtml(processSummary(message.text))}</span></button>${expanded ? `<div class="message-body md">${body}</div>` : ''}</article>`
  }
  // The answer's only chrome is the branch handle under it, the way the host
  // puts message actions below the body instead of in a row of labels.
  const branch = !isUser && Number.isInteger(message.sourceSeq)
    ? `<footer class="message-actions"><button class="message-branch" type="button" data-action="open-branch" data-thread="${thread.id}" data-seq="${message.sourceSeq}" title="从此回答创建分支"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4.5 3v6a2.5 2.5 0 0 0 2.5 2.5H12"/><circle cx="4.5" cy="3" r="1.5"/><circle cx="11.5" cy="12" r="1.5"/></svg>分支</button></footer>`
    : ''
  return `<article class="message message-${message.kind}${message.pending ? ' message-pending' : ''}" ${seq}><div class="message-body md">${body}</div>${branch}</article>`
}

/**
 * The session's only chrome: 在 DSH 中打开 / 创建分支 as two controls in the same
 * `.header-actions` cluster the map uses. They used to sit next to a session
 * title line inside the transcript, which is exactly the band that made the
 * detail page read as a second header.
 */
function detailActionsBar() {
  const thread = currentThread()
  if (thread === null) return ''
  const latestAssistantSeq = [...messagesFor(thread)].reverse().find(message => Number.isInteger(message.sourceSeq))?.sourceSeq
  return `<button class="header-action" type="button" data-action="open-dsh" data-thread="${thread.id}" data-seq="${Number.isInteger(latestAssistantSeq) ? latestAssistantSeq : ''}" title="在原生对话中打开此会话" aria-label="在原生对话中打开此会话">${CARD_ICON_DSH}<span>在 DSH 中打开</span></button><button class="header-action" type="button" data-action="open-branch" data-thread="${thread.id}" title="基于最新回答创建分支" aria-label="基于最新回答创建分支">${HEADER_ICON_BRANCH}<span>创建分支</span></button>`
}

/**
 * The conversation, and nothing else: no title row of its own (the 地图 / 详情
 * tabs above already say where you are), no session name, no per-message cards.
 * The two session actions live in the top bar's first row (see `detailActions`).
 */
function renderThread() {
  const thread = currentThread()
  if (thread === null) return renderCanvas()
  const messages = messagesFor(thread)
  const waiting = state.pendingReplies.has(thread.dshSessionId)
  return `<section class="detail-view" data-morph-key="detail-view"><div class="detail-scroll"><div class="detail-flow">${messages.map(message => threadMessage(thread, message)).join('') || '<div class="note-empty">等待这条会话的第一条消息。</div>'}</div></div><form class="message-composer" data-compose="${thread.id}"><textarea maxlength="4000" rows="1" placeholder="继续当前对话" ${waiting ? 'disabled' : ''}></textarea><button class="composer-send" type="submit" aria-label="${waiting ? '等待回复' : '发送'}" title="${waiting ? '等待回复' : '发送'}" ${waiting ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 12.5V3.5m0 0L4 7.5m4-4L12 7.5"/></svg></button></form></section>`
}
