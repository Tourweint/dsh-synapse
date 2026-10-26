// Click-level smoke test for the map page.
//
// `pnpm test` exercises the Host half and slices of app/*.js, but it never
// renders the canvas: `test/morph-render.test.js` only matches the source text,
// so a regression in the DOM patching (controls collapsing, renders freezing,
// the view switch losing its cards) stays green there. This script closes that
// gap: it boots the real Host half on a real HTTP server, loads the real page
// in jsdom, and clicks the way a person does.
//
//   cd dev/harness && npm install && npm test
//   node click.mjs ../..            # test another checkout
//
// The iframe's own page is used, so `window.parent` is the same window and the
// postMessage bridge in client.js is not involved.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'

const pluginDir = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..'))
const workDir = await mkdtemp(join(tmpdir(), 'synapse-harness-'))
const dataFile = join(workDir, 'workspaces.json')

const { apply, WorkspaceStore } = await import(pathToFileURL(join(pluginDir, 'index.js')).href)

// A markdown answer that exercises every block the renderer has to produce:
// a rule (`---`) and a quote (`>`) used to come out as literal text, which is
// exactly what "有些内容没有渲染出来" meant.
const RICH_ANSWER = [
  '## 结论',
  '',
  '第一段说明，用来测试摘要与正文的截取。**加粗** 与 `行内代码` 都在这里。',
  '',
  '> 引用一段：这里应当出现一条左侧竖线。',
  '',
  '---',
  '',
  '- 列表一',
  '- 列表二',
  '  - 嵌套项',
  '',
  '- [x] 已完成的事项',
  '- [ ] 未完成的事项',
  '',
  '```js',
  'const answer = 42',
  '```',
  '',
  '| 名称 | 值 |',
  '| --- | --- |',
  '| 一 | 1 |',
].join('\n')

/** Seed one workspace with two turns so the canvas has cards to click. */
async function seed() {
  const store = new WorkspaceStore(dataFile)
  const workspace = await store.create('复现用工作区')
  const thread = await store.createThread(workspace.id, { title: '演示会话', dshSessionId: null })
  await store.addMessage(thread.id, '第一个问题')
  await store.addMessage(thread.id, '第二个问题')
  // `addMessage` only writes user turns; splice the assistant reply in after the
  // FIRST question so the first card is the one with an answer to render. The
  // reply carries two tool calls so the drawer's 「工具调用」 list has rows to
  // show without any extra click.
  const data = JSON.parse(await readFile(dataFile, 'utf8'))
  const target = data.workspaces[0].threads[0]
  const [firstQuestion, ...rest] = target.messages
  // The payloads are seeded too: the drawer is supposed to show them without a
  // click, so a row that only carries a name would hide exactly the regression
  // this fixture exists to catch.
  target.messages = [firstQuestion, {
    id: 'seeded-answer',
    kind: 'assistant',
    text: RICH_ANSWER,
    at: new Date().toISOString(),
    process: [
      { callId: 'call-1', name: 'read_file', status: 'done', arguments: '{"path":"README.md"}', result: 'readme body line one\nreadme body line two' },
      { callId: 'call-2', name: 'bash', status: 'pending', arguments: '{"command":"pnpm test"}', result: null },
    ],
  }, ...rest]
  await writeFile(dataFile, JSON.stringify(data, null, 2))
}

await seed()

const routes = []
apply({
  logger: { warn: () => {}, error: error => console.error('[host]', error) },
  webServer: { register: route => { routes.push(route); return () => {} } },
  sessions: { list: () => [] },
  on: () => () => {},
  effect: effect => effect(),
}, { dataFile, autoProjection: false })

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  const route = routes.find(item => item.kind === 'exact' ? item.path === path : path.startsWith(item.path))
  if (route === undefined) {
    response.writeHead(404)
    response.end()
    return
  }
  await route.handler(request, response)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`

const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', error => console.error('[page]', error.stack ?? error.message))

const dom = await JSDOM.fromURL(`${origin}/synapse/`, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    // jsdom ships no fetch; forward to Node's, resolved against the page origin.
    window.fetch = (input, init) => fetch(new URL(input, origin), init)
    if (window.CSS === undefined) window.CSS = {}
    if (typeof window.CSS.escape !== 'function') window.CSS.escape = value => String(value).replace(/["\\]/g, '\\$&')
    window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
    // jsdom implements no pointer capture; the app guards the calls, but the
    // resizer and the drag both expect to keep receiving moves.
    if (typeof window.Element.prototype.setPointerCapture !== 'function') {
      window.Element.prototype.setPointerCapture = function setPointerCapture() {}
      window.Element.prototype.releasePointerCapture = function releasePointerCapture() {}
    }
    window.confirm = () => true
    // jsdom implements Range without layout; the selection pill asks for a box.
    const emptyBox = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    window.Range.prototype.getBoundingClientRect = () => emptyBox
    window.Range.prototype.getClientRects = () => []
  },
})

const { window } = dom
const document = window.document
const wait = ms => new Promise(done => setTimeout(done, ms))

/** Wait for a DOM condition, the way a person waits for the page to settle. */
async function until(check, label, timeout = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = check()
    if (value) return value
    await wait(50)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const failures = []
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail === '' ? '' : ` — ${detail}`}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

/** Pointerdown, then click, on the same element. A missing target is a failure, not a crash. */
async function click(element, label) {
  if (element === null || element === undefined) {
    check(label, false, 'no such element')
    return
  }
  element.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }))
  await wait(150)
}
const cardActions = card => [...card.querySelectorAll('button[data-action]')].map(button => button.dataset.action)
const cards = () => [...document.querySelectorAll('.thread-card[data-card-id]')]

await until(() => cards().length > 0, 'the canvas to render')

// 1. A turn is two cards now: 问 holds only the user's message, 答 only the
//    model's closing prose. Tool calls and tool results belong to neither.
const questions = () => cards().filter(card => card.dataset.role === 'question')
const answers = () => cards().filter(card => card.dataset.role === 'answer')
check('一个 turn 拆成问卡与答卡', questions().length === 2 && answers().length === 2, `问 ${questions().length} / 答 ${answers().length}`)
const questionText = questions()[0].querySelector('.thread-card-text')?.textContent ?? ''
check('问卡只放用户原话', questionText.includes('第一个问题'), questionText.slice(0, 30))
const answerText = answers()[0].querySelector('.thread-card-text')?.textContent ?? ''
check('答卡只放 AI 收尾答案', answerText.startsWith('结论') && !answerText.includes('const answer'), answerText.slice(0, 30))
check('答卡不混入问题原文', !answerText.includes('第一个问题'))
check('卡内没有滚动区', cards().every(card => card.querySelector('.thread-answer') === null))
// Stacked in one column: the answer sits under its question.
const pairTop = Number.parseFloat(questions()[0].style.top)
const answerTop = Number.parseFloat(answers()[0].style.top)
check('答卡在问卡正下方同列', answers()[0].style.left === questions()[0].style.left && answerTop > pairTop, `${pairTop} → ${answerTop}`)
// 详情 / DSH live on both kinds; archive only on the answer (one per thread).
const actions = [...answers()[0].querySelectorAll('.thread-card-actions button')].map(button => button.dataset.action)
check('card actions keep 详情 / DSH / 归档', actions.join(',') === 'show-thread,open-dsh,archive-thread', actions.join(','))

// 2. With a text selection on the page (the 追问 flow starts with one) the
//    shell used to stop patching, which looked like dead clicks everywhere.
const body = questions()[0].querySelector('.thread-card-text') ?? questions()[0]
window.getSelection()?.selectAllChildren?.(body)
await click(body, 'card body')
check('card click opens the inspector with a selection on the page', document.querySelector('.card-inspector') !== null)

// 2b. The inspector must actually render the block constructs the model emits:
//     the rule and the quote used to fall through as literal `---` / `>` text.
check('详情把 --- 渲染成分割线', document.querySelector('.card-inspector-answer hr') !== null)
check('详情把 > 渲染成引用块', document.querySelector('.card-inspector-answer blockquote') !== null)
check('详情渲染列表 / 代码 / 表格', document.querySelector('.card-inspector-answer ul li') !== null
  && document.querySelector('.card-inspector-answer pre.md-code') !== null
  && document.querySelector('.card-inspector-answer table th') !== null)
check('详情没有残留的原始标记', !/\n?\|\s*名称/.test(document.querySelector('.card-inspector-answer')?.textContent ?? ''))
// 2b1. The fence is tokenised in the real page, and the text still reads as
//      the code that was written (spans must not lose or duplicate characters).
const codeBlock = document.querySelector('.card-inspector-answer pre.md-code')
check('代码块按语法着色', codeBlock?.querySelector('.tok-key') !== null
  && codeBlock?.querySelector('.tok-num') !== null, codeBlock?.innerHTML ?? '')
check('着色后原文不变', codeBlock?.querySelector('code')?.textContent === 'const answer = 42', codeBlock?.textContent ?? '')

// 2b2. The turn's tool calls are part of the drawer, and their payloads are on
//      screen without a click: name + status + arguments + result, nothing cut.
const toolRows = () => document.querySelectorAll('.card-inspector-process .process-entry')
check('详情底部列出「工具调用」', document.querySelector('.card-inspector-process') !== null)
check('工具条目默认就显示出来', toolRows().length === 2, `${toolRows().length} rows`)
const toolFold = document.querySelector('.card-inspector-process .process-entry-fold')
check('工具行带名字与状态', toolFold !== null && toolFold.textContent.includes('read_file'), toolFold?.textContent ?? '')
check('工具参数默认可见', document.querySelector('.card-inspector-process .process-args')?.textContent === '{"path":"README.md"}',
  document.querySelector('.card-inspector-process .process-args')?.textContent ?? 'missing')
check('工具结果默认可见且完整', document.querySelector('.card-inspector-process .process-result')?.textContent === 'readme body line one\nreadme body line two',
  document.querySelector('.card-inspector-process .process-result')?.textContent ?? 'missing')
check('参数与结果都带标签', toolRows()[0]?.textContent.includes('参数') === true && toolRows()[0]?.textContent.includes('结果') === true,
  toolRows()[0]?.textContent ?? '')
if (toolFold instanceof window.HTMLElement) {
  toolFold.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }))
  await wait(120)
  // Scope to the first row: the second tool has a payload of its own and would
  // answer this query no matter what the first row did.
  check('点行头可以收起', toolRows()[0]?.classList.contains('expanded') === false
    && toolRows()[0]?.querySelector('.process-args') === null, toolRows()[0]?.className ?? '')
  toolRows()[0]?.querySelector('.process-entry-fold')
    ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }))
  await wait(120)
  check('再点又展开', toolRows()[0]?.querySelector('.process-args') !== null)
}

// 2c. The drawer's left edge resizes it: drag LEFT widens, and the width stops
//     at the declared bounds instead of eating the map.
const inspector = document.querySelector('.card-inspector')
const resizer = inspector?.querySelector('.card-inspector-resizer')
const widthOf = () => Number.parseFloat(inspector.style.getPropertyValue('--inspector-width')) || 0
const startWidth = widthOf()
const dragResizer = async dx => {
  const box = resizer.getBoundingClientRect()
  const x = box.left + box.width / 2
  resizer.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: 200, button: 0 }))
  resizer.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: x + dx, clientY: 200 }))
  resizer.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: x + dx, clientY: 200 }))
  await wait(120)
}
await dragResizer(-120)
check('向左拖调宽把抽屉拉大', widthOf() > startWidth, `${startWidth} → ${widthOf()}`)
await dragResizer(600)
check('向右拖有最小宽度', widthOf() === 380, String(widthOf()))
await dragResizer(-2000)
check('向左拖有最大宽度上限', widthOf() > 700, String(widthOf()))
await resizer.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
await wait(80)
check('双击复位到默认宽度', widthOf() === 460, String(widthOf()))

// 2c2. Clicking the canvas background dismisses the drawer; the drawer itself,
//      a card (which retargets it) and the controls are left alone.
const background = document.querySelector('.canvas-viewport')
background.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 600, clientY: 600 }))
background.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 600, clientY: 600 }))
background.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1, clientX: 600, clientY: 600 }))
await wait(260)
check('点击画布空白处关闭右侧栏', document.querySelector('.card-inspector') === null)

// 2d. Cards move by pressing and holding anywhere on them — the "..." handle is
//     gone, and the body is no longer selectable text.
const firstCard = cards()[0]
const originLeft = Number.parseFloat(firstCard.style.left)
const originTop = Number.parseFloat(firstCard.style.top)
const grip = firstCard.querySelector('.thread-card-text') ?? firstCard
grip.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, button: 0 }))
await wait(220)
document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 160, clientY: 140 }))
await wait(60)
document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 160, clientY: 140 }))
await wait(80)
const movedLeft = Number.parseFloat(cards()[0].style.left)
const movedTop = Number.parseFloat(cards()[0].style.top)
check('长按卡片可以拖动', movedLeft > originLeft + 20 && movedTop > originTop + 20, `${originLeft},${originTop} → ${movedLeft},${movedTop}`)
const storedPositions = window.localStorage.getItem('dsh-synapse:card-positions:v3') ?? '(empty)'
check('拖动位置写进 localStorage', storedPositions.includes(`"x":${Math.round(movedLeft)}`), storedPositions.slice(0, 120))

// 2e. Unfolding is a real state, not a CSS hover: the class sticks across the
//     patch that follows, and the neighbouring cards make room for it.
const targetCard = cards()[1] ?? cards()[0]
await click(targetCard.querySelector('[data-action="toggle-card-expanded"]'), 'expand card')
check('展开按钮让卡片进入 expanded', document.querySelector('.thread-card.expanded') !== null)
await click(document.querySelector('.thread-card.expanded [data-action="toggle-card-expanded"]'), 'collapse card')
check('再点一次折叠回去', document.querySelector('.thread-card.expanded') === null)

// 2f. The header keeps the plugin's own two view words, and the workspace picker
//     is a custom listbox (a native <select> cannot animate or round its popup).
const tabLabels = [...document.querySelectorAll('.canvas-tabs button')].map(tab => tab.textContent.trim())
check('视图标签是「地图 / 详情」', tabLabels[0] === '地图' && tabLabels[1] === '详情', tabLabels.join(' / '))
await click(document.querySelector('[data-action="toggle-workspace-menu"]'), 'workspace trigger')
check('工作区选择器展开成悬浮列表', document.querySelector('.workspace-menu') !== null
  && document.querySelectorAll('.workspace-menu .workspace-option').length >= 1)
await click(document.querySelector('[data-action="toggle-workspace-menu"]'), 'workspace trigger again')
check('再点一次收起工作区列表', document.querySelector('.workspace-menu') === null)
await click(document.querySelector('[data-action="toggle-workspace-menu"]'), 'workspace trigger third')
await click(document.querySelector('.workspace-menu .workspace-option'), 'workspace option')
check('点选项后列表收起（不再被 label 二次触发）', document.querySelector('.workspace-menu') === null)

// 3. A draft must be removable, otherwise `canReplaceView()` keeps refusing
//    every later render and the canvas looks frozen.
await click(document.querySelector('[data-action="create-session"]'), 'new card')
const draftOpened = document.querySelector('.draft-card') !== null
check('新建卡片 opens a draft', draftOpened)
await click(document.querySelector('[data-action="cancel-draft"]'), 'cancel draft')
check('取消 closes the draft', draftOpened && document.querySelector('.draft-card') === null)

// 4. Map and detail are two different views; switching must not eat the cards.
await click(document.querySelector('.thread-card[data-card-id] [data-action="show-thread"]'), 'detail button')
check('详情 opens the conversation', document.querySelector('.detail-scroll') !== null)

// 4b. The detail page is one transcript, not a wall of message cards: messages
//     sit directly in the flow column, the question is a bubble and the answer
//     has no chrome of its own. A `header`/avatar row would mean the old card
//     layout leaked back in.
const detailFlow = document.querySelector('.detail-flow')
const detailMessages = detailFlow?.querySelectorAll(':scope > .message').length ?? 0
check('详情是一条对话流 — 消息直接放进 detail-flow', detailMessages >= 3, `${detailMessages} messages`)
check('问是气泡、答是正文', document.querySelector('.detail-flow .message-user .message-body') !== null
  && document.querySelector('.detail-flow .message-assistant .message-body') !== null)
check('详情页没有角色标题行 / 头像', document.querySelector('.detail-flow .message > header') === null
  && document.querySelector('.detail-flow .message-avatar') === null)
// No title block of its own any more: the transcript starts right under the tab
// row, and the two session actions ride the header's top row instead.
check('详情页没有自己的标题块', document.querySelector('.detail-head') === null
  && document.querySelector('.detail-flow h1') === null)
const threadActions = [...document.querySelectorAll('.header-actions .header-action')]
check('会话操作移到顶栏 — 在 DSH 中打开 / 创建分支', threadActions.length === 2
  && document.querySelector('.header-actions').closest('.canvas-header') !== null,
  threadActions.map(action => action.dataset.action).join(' / ') || '(none)')
// The reported bug: clicking 对话 dropped BOTH highlights, because the clicked
// button was the focused node and the patcher froze it. The state now lives on
// the nav (`data-active`), which never holds focus.
const tabs = document.querySelector('.canvas-tabs')
check('切到详情后激活态跟着走', tabs.dataset.active === 'thread'
  && tabs.querySelector('[data-action="show-thread"]').getAttribute('aria-current') === 'page'
  && tabs.querySelector('[data-action="show-canvas"]').getAttribute('aria-current') === null,
  tabs.outerHTML.slice(0, 120))
check('底部是单行输入条 — 继续当前对话 + 圆形发送', document.querySelector('.message-composer textarea')?.getAttribute('placeholder') === '继续当前对话'
  && document.querySelector('.message-composer .composer-send') !== null
  && document.querySelectorAll('.message-composer button').length === 1)
await click(document.querySelector('[data-action="show-canvas"]'), 'back to canvas')
check('返回画布 restores the cards', document.querySelector('.canvas-view') !== null && cards().length > 0, `${cards().length} cards`)
check('切回地图后激活态又回来了', document.querySelector('.canvas-tabs').dataset.active === 'canvas'
  && document.querySelector('.canvas-tabs [data-action="show-canvas"]').getAttribute('aria-current') === 'page')

// 5. The toolbar must still act on the canvas it just restored.
await click(document.querySelector('[data-action="layout"]'), 'layout')
check('整理 keeps the cards mounted', cards().length > 0)

// 5a. 排列 is the map's own setting: four diagrams, the current one marked, and
//     picking one re-lays the cards out (问在左 = answer to the right).
await click(document.querySelector('[data-action="toggle-arrangement"]'), '排列')
const options = [...document.querySelectorAll('.arrangement-option')]
check('排列按钮打开四个示意图', options.length === 4 && options.filter(option => option.getAttribute('aria-pressed') === 'true').length === 1,
  options.map(option => `${option.dataset.position}:${option.getAttribute('aria-pressed')}`).join(' '))
await click(document.querySelector('.arrangement-option[data-position="left"]'), '问在左')
const leftQ = questions()[0]
const leftA = answers()[0]
check('选「问在左」后答卡落在问卡右边',
  Number.parseFloat(leftA.style.left) === Number.parseFloat(leftQ.style.left) + 272
  && Number.parseFloat(leftA.style.top) === Number.parseFloat(leftQ.style.top),
  `${leftQ.style.left},${leftQ.style.top} vs ${leftA.style.left},${leftA.style.top}`)
check('排列选择写进 localStorage', window.localStorage.getItem('dsh-synapse:question-position:v1') === 'left')
check('选完菜单自动收起', document.querySelector('.arrangement-menu')?.hidden === true)
await click(document.querySelector('[data-action="toggle-arrangement"]'), '排列 again')
await click(document.querySelector('.arrangement-option[data-position="above"]'), '问在上')
const backQ = questions()[0]
const backA = answers()[0]
check('切回「问在上」恢复纵向',
  Number.parseFloat(backA.style.left) === Number.parseFloat(backQ.style.left)
  && Number.parseFloat(backA.style.top) > Number.parseFloat(backQ.style.top),
  `${backQ.style.left},${backQ.style.top} vs ${backA.style.left},${backA.style.top}`)

// 5b. Zoom is a short chase, not a jump, and the header no longer carries ±
//     buttons: the wheel is the input, the meter is the read-out.
const scale = () => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.canvas-content')?.style.transform ?? '')?.[1] ?? 'NaN')
const viewport = document.querySelector('.canvas-viewport')
const meterValue = () => document.querySelector('.zoom-meter-value')?.textContent ?? ''
const meterFill = () => Number.parseFloat(document.querySelector('.zoom-meter-fill')?.style.width ?? '0')
check('顶栏没有 ± 缩放按钮', document.querySelector('[data-action="zoom-in"]') === null && document.querySelector('[data-action="zoom-out"]') === null)
check('顶栏有缩放读数', meterValue() === '100%', meterValue())
viewport.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: 620, clientY: 420 }))
check('滚轮缩放不在同一帧跳到目标', scale() === 1, `scale=${scale()}`)
await until(() => scale() === 1.05, 'the zoom to settle')
check('滚轮缩放落在 105%', scale() === 1.05, `scale=${scale()}`)
await until(() => meterValue() === '105%', 'the meter to follow')
check('进度条与读数跟着走', meterValue() === '105%' && meterFill() > 40, `${meterValue()} / ${meterFill()}%`)

// 6. The rail collapse control rides the map's own header row (inside the
//    conversation surface, level with the view tabs). The desktop title bar
//    already shows DSH's toggle, so a second one in the sidebar brand row read
//    as the same button twice.
const railToggle = document.querySelector('.canvas-header [data-action="toggle-sidebar"]')
check('折叠按钮在地图 header 行内', railToggle !== null && document.querySelector('.sidebar-brand-row [data-action="toggle-sidebar"]') === null)
await click(railToggle, 'rail toggle')
const shell = document.querySelector('.synapse-shell')
const collapsed = shell.classList.contains('sidebar-collapsed')
check('折叠按钮折叠地图侧边栏', collapsed)
await click(document.querySelector('.canvas-header [data-action="toggle-sidebar"]'), 'rail toggle back')
check('再点一次能展开', !document.querySelector('.synapse-shell').classList.contains('sidebar-collapsed'))

// 7. The canvas entry point says what it does: it adds a card, it does not
//    start a native conversation or leave the map.
const newCard = document.querySelector('.sidebar .new-workspace')
check('画布新建入口叫「新建卡片」', newCard !== null && newCard.textContent.trim() === '新建卡片', newCard?.textContent.trim())

server.close()
dom.window.close()
await rm(workDir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
