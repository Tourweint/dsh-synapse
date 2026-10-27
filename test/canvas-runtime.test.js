import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { pickApp, readAppSource, readStyles } from './source.js'

test('clamps the canvas zoom and chases the target over several frames', async () => {
  const source = await readAppSource()
  const snippet = source.slice(source.indexOf('/* ── Zoom animation'), source.indexOf('function focusActiveCard'))
  let clock = 0
  let queued = null
  const context = {
    state: { zoom: 1, zoomTarget: 1, canvasCamera: { x: 0, y: 0 } },
    applyCanvasTransform() {},
    syncCanvasViewport() {},
    document: { querySelector: () => null },
    window: {
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: callback => {
        queued = callback
        return 1
      },
      cancelAnimationFrame: () => { queued = null },
    },
    performance: { now: () => clock },
    HTMLElement: class {},
  }
  vm.createContext(context)
  vm.runInContext(`${snippet};globalThis.zoomCanvas = zoomCanvas`, context)
  const viewport = { getBoundingClientRect: () => ({ left: 0, top: 0 }) }
  const frames = limit => {
    const seen = []
    while (queued !== null && seen.length < limit) {
      clock += 16
      const tick = queued
      queued = null
      tick()
      seen.push(context.state.zoom)
    }
    return seen
  }

  context.zoomCanvas(viewport, 0.05, 100, 100)
  // Clamped on the target, but the live zoom has not jumped there...
  assert.equal(context.state.zoomTarget, 0.2)
  assert.equal(context.state.zoom, 1)
  // ...it takes several frames, each strictly closer, and lands exactly.
  const shrink = frames(120)
  assert.ok(shrink.length > 3, `expected a multi-frame zoom, got ${shrink.length} frame(s)`)
  assert.equal(context.state.zoom, 0.2)
  for (const [index, value] of shrink.entries()) {
    assert.ok(value <= 1 && value >= 0.2, `frame ${index} left the clamped range: ${value}`)
    if (index > 0) assert.ok(value < shrink[index - 1], `frame ${index} did not approach the target`)
  }

  context.zoomCanvas(viewport, 9, 100, 100)
  assert.equal(context.state.zoomTarget, 4)
  frames(120)
  assert.equal(context.state.zoom, 4)
  // Inside the range the requested step is kept, rounded to whole percent.
  context.zoomCanvas(viewport, 0.5, 100, 100)
  assert.equal(context.state.zoomTarget, 0.5)
  frames(120)
  assert.equal(context.state.zoom, 0.5)
})

test('uses one camera transform without browser scroll coordinates', async () => {
  const source = await readAppSource()

  assert.match(source, /canvasCamera: \{ x: 0, y: 0 \}/)
  assert.match(source, /translate\(\$\{state\.canvasCamera\.x\}px, \$\{state\.canvasCamera\.y\}px\) scale\(\$\{state\.zoom\}\)/)
  assert.doesNotMatch(source, /canvasScroll|canvasPadding|canvasDomShift|canvasMetrics|viewport\.scrollLeft|viewport\.scrollTop/)
})

test('reuses the live map iframe and retries initialization only after iframe load', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const openFlow = source.slice(source.indexOf('let mapOpenFallback'), source.indexOf('const onMessage'))
  const open = openFlow.slice(openFlow.indexOf('const open ='), openFlow.indexOf('const onFrameLoad'))

  assert.doesNotMatch(openFlow, /frame\.src\s*=/)
  assert.match(openFlow, /const onFrameLoad/)
  assert.match(openFlow, /if \(mapOpening\) send\('synapse:map-opened'\)/)
  assert.ok(open.indexOf('overlay.hidden = false') < open.indexOf("send('synapse:map-opened')"))
  assert.match(open, /overlay\.classList\.add\('is-opening'\)/)
})

test('keeps the canvas viewport across dialog/map toggles and recenters on real session switches', async () => {
  const source = await readAppSource()
  const mapOpened = source.slice(source.indexOf("if (data.type === 'synapse:map-opened')"), source.indexOf("if (data.type === 'synapse:workspaces')"))
  const currentSession = source.slice(source.indexOf("if (data.type === 'synapse:current-session')"), source.indexOf("if (data.type === 'synapse:live-reply'"))

  // Reopening the map for the same session must NOT reset the camera: only a
  // real session switch (current-session id change) re-centers the canvas.
  assert.doesNotMatch(mapOpened, /resetCanvasCamera\(\)/)
  assert.match(mapOpened, /state\.mode = 'canvas'\s+render\(\)/)
  assert.match(currentSession, /previousId !== data\.session\?\.id/)
  assert.match(currentSession, /focusActiveCard\(\)/)
})

test('keeps the wheel zooming the map and only yields it to the draft textarea', async () => {
  const source = await readAppSource()
  const wheel = source.slice(source.indexOf("app.addEventListener('wheel'"), source.indexOf("app.addEventListener('click'"))

  // Cards have no scrollable text any more, so a pointer resting on one must
  // not swallow the wheel; only a form control still owns it.
  assert.match(wheel, /closest\('textarea, select, input, \.draft-card'\)/)
  assert.doesNotMatch(wheel, /scrollTop\s*\+=/)
  assert.doesNotMatch(wheel, /\.thread-answer/)
})

test('clips the card text instead of giving the card a scroll area', async () => {
  const styles = await readStyles()
  const card = await readAppSource()

  // No per-card scrollbar: both card kinds clamp their text, and the inspector
  // is the only scroll container anywhere near a card.
  assert.doesNotMatch(styles, /\.thread-answer\b/)
  assert.doesNotMatch(styles, /\.thread-card footer/)
  assert.match(styles, /\.thread-card-text \{[^}]*-webkit-line-clamp: 3/)
  assert.match(styles, /\.thread-card\.expanded \.thread-card-text \{ -webkit-line-clamp: 8/)
  assert.match(card, /class="thread-card-text/)
  assert.doesNotMatch(card, /cardScrollTops/)
})

test('splits a turn into a question card and an answer card', async () => {
  const source = await readAppSource()
  const styles = await readStyles()
  const build = source.slice(source.indexOf('function turnCardNode'), source.indexOf('function conversationGraphView'))
  const card = source.slice(source.indexOf('function conversationCard'), source.indexOf('function draftActions'))

  // Two nodes per turn, roles explicit, and only the answer carries the
  // follow-up / branch / fold controls.
  assert.match(build, /\$\{thread\.id\}:turn:\$\{turn\.seq \?\? 'empty'\}\$\{role === 'answer' \? ':a' : ':q'\}/)
  assert.match(build, /if \(turn\.empty === true\) continue/)
  assert.match(build, /answerNode\.parentId = questionNode\.id/)
  assert.match(build, /nodes\.at\(-1\)\.canContinue = true/)
  assert.match(card, /const isAnswer = card\.role === 'answer'/)
  assert.match(card, /const edgeControls = isAnswer \? \[/)
  assert.match(card, /<span class="thread-card-kind">\$\{isAnswer \? '答' : '问'\}/)
  // The question card must show the user's text and nothing else; the answer
  // card must never render markdown, tool output or the question as its body.
  assert.match(card, /is-question-text/)
  assert.doesNotMatch(card, /renderMarkdown\(card\.answer/)
  // Same height for both kinds keeps the pair aligned.
  assert.match(styles, /\.thread-card \{ position: absolute; display: flex; width: 252px; height: 92px/)
  assert.match(styles, /\.thread-card\.expanded \{ height: 188px; \}/)
  assert.match(source, /const CARD_HEIGHT = 92/)
  assert.match(source, /const CARD_HEIGHT_EXPANDED = 188/)
})

test('keeps the question→answer link vertical by role, not by coordinates', async () => {
  const source = await readAppSource()
  const path = source.slice(source.indexOf('function connectorPath('), source.indexOf('function elementHeight'))

  // Deciding from x coordinates meant a 3px drag flipped the pair link back to
  // the lateral bezier; the role of both endpoints is what must decide.
  assert.doesNotMatch(path, /Math\.abs\(toPosition\.x - fromPosition\.x\)/)
  assert.match(path, /if \(pair\) \{/)
  assert.match(path, /function isPairLink\(fromCard, toCard\)/)
  assert.match(path, /fromCard\?\.role === 'question' && toCard\?\.role === 'answer'/)
  // The dragged-element path reads the roles off the DOM instead.
  assert.match(source, /fromCard\.dataset\.role === 'question' && toCard\.dataset\.role === 'answer'/)
})

test('draws the pair link as a short drop even when one card is nudged', async () => {
  const source = await readAppSource()
  const snippet = source.slice(source.indexOf('function connectorPath('), source.indexOf('function elementHeight'))
  const context = { globalThis: {}, CARD_WIDTH: 252 }
  vm.createContext(context)
  vm.runInContext(`${snippet};globalThis.connectorPath = connectorPath`, context)

  const question = { x: 100, y: 100 }
  const answer = { x: 106, y: 212 } // nudged 6px to the right
  const path = context.globalThis.connectorPath(question, 92, answer, 92, true)
  // Starts under the question's centre (100 + 126) and lands on the answer's
  // centre, so a small drag bends the link instead of reshaping it entirely.
  assert.match(path, /^M 226 192 C /)
  assert.match(path, /, 232 212$/)
  // A non-pair link keeps the lateral bezier off the question's right edge.
  assert.match(context.globalThis.connectorPath(question, 92, answer, 92, false), /^M 352 /)
  // Side-by-side pairs link edge to edge at mid height instead.
  const beside = { x: 358, y: 100 }
  const horizontal = context.globalThis.connectorPath(question, 92, beside, 92, true)
  assert.match(horizontal, /^M 352 146 C /)
  assert.match(horizontal, /, 358 146$/)
})

test('offers an in-map picker for the question/answer arrangement', async () => {
  const source = await readAppSource()
  const styles = await readStyles()
  const start = source.indexOf("button.dataset.action === 'set-question-position'")
  const action = source.slice(start, source.indexOf('} catch (error)', start))

  // Four explicit values, each with a diagram and a caption — "问在左" cannot be
  // mistaken for "答在左".
  assert.match(source, /const QUESTION_POSITIONS = \['above', 'below', 'left', 'right'\]/)
  assert.match(source, /QUESTION_POSITION_LABELS = \{ above: '问在上', below: '问在下', left: '问在左', right: '问在右' \}/)
  assert.match(source, /data-action="toggle-arrangement"/)
  assert.match(source, /data-action="set-question-position"/)
  assert.match(source, /aria-pressed="\$\{active \? 'true' : 'false'\}"/)
  assert.match(source, /function arrangementMenu/)
  assert.match(source, /function arrangementThumb/)
  // The choice persists and re-lays the map out (dragged positions are dropped).
  assert.match(source, /localStorage\.setItem\(QUESTION_POSITION_KEY/)
  assert.match(action, /resetCardPositions\(\)/)
  assert.match(action, /focusActiveCard\(\)/)
  // Geometry is driven by the setting, never by an assumed "answer below".
  assert.match(source, /function answerOffset/)
  assert.match(source, /function turnStepX/)
  assert.match(source, /function laneStepY/)
  assert.match(styles, /\.arrangement-menu \{ position: fixed/)
  assert.match(styles, /\.arrangement-grid \{ display: grid; grid-template-columns: 1fr 1fr/)
  assert.match(styles, /\.arrangement-option\.active/)
})

test('activating a session from the map syncs DSH without closing the map', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const activate = source.slice(source.indexOf("'synapse:activate-session'"), source.indexOf("'synapse:fork-session'"))

  assert.match(activate, /ctx\.uiWorkspace\.openSession\(event\.data\.sessionId\)/)
  assert.doesNotMatch(activate, /close\(\)/)
})

test('selecting a session in the sidebar syncs the DSH current session', async () => {
  const source = await readAppSource()
  const selectThread = source.slice(source.indexOf("button.dataset.action === 'select-thread'"), source.indexOf("button.dataset.action === 'show-thread'"))

  assert.match(selectThread, /synapse:activate-session/)
})

test('clicking a session card syncs the DSH current session', async () => {
  const source = await readAppSource()
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))

  assert.match(cardClick, /post\('synapse:activate-session', \{ sessionId: thread\.dshSessionId \}\)/)
})

test('switching sessions from a map card keeps the current camera position', async () => {
  const source = await readAppSource()
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))
  const currentSession = source.slice(source.indexOf("if (data.type === 'synapse:current-session')"), source.indexOf("if (data.type === 'synapse:live-reply'"))

  assert.match(cardClick, /mapCardSessionSwitches\.add\(thread\.dshSessionId\)/)
  assert.match(currentSession, /mapCardSessionSwitches\.delete\(data\.session\?\.id\)/)
  assert.match(currentSession, /openCurrentWorkspace\(\{ preserveCanvasCamera \}\)/)
  assert.match(currentSession, /if \(!preserveCanvasCamera\) focusActiveCard\(\)/)
})

test('keeps conversation highlighting separate from the exact selected card', async () => {
  const source = await readAppSource()
  const styles = await readStyles()
  const tokens = await readFile(new URL('../tokens.css', import.meta.url), 'utf8')
  const connectors = source.slice(source.indexOf('function canvasConnectors'), source.indexOf('function conversationCard(card, graph)'))
  const card = source.slice(source.indexOf('function conversationCard(card, graph)'), source.indexOf('function draftActions'))
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))
  const selectThread = source.slice(source.indexOf("button.dataset.action === 'select-thread'"), source.indexOf("button.dataset.action === 'show-thread'"))

  assert.match(source, /selectedCardId: null/)
  assert.match(card, /card\.id === state\.selectedCardId/)
  assert.doesNotMatch(card, /dshThreadId === state\.activeId/)
  assert.match(connectors, /card\.dshThreadId === state\.activeId && parent\.dshThreadId === state\.activeId/)
  assert.match(connectors, /active-connector/)
  assert.match(cardClick, /state\.selectedCardId = cardId/)
  assert.match(selectThread, /state\.selectedCardId = null/)
  // The highlight is the brand accent in both themes; the token itself carries
  // the light/dark pair, so there is no separate dark rule to pin any more.
  assert.match(styles, /\.connectors path\.active-connector \{ stroke: var\(--syn-accent\); \}/)
  assert.match(tokens, /--syn-accent: #0f1115/)
  assert.match(styles, /\[data-theme="dark"\] \.connectors path\.active-connector \{ stroke: var\(--syn-accent\); \}/)
  assert.doesNotMatch(styles, /\.thread-card\.active/)
})

test('opens the clicked card in a tool-aware detail inspector', async () => {
  const source = await readAppSource()
  const styles = await readStyles()
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))
  const inspector = await pickApp('inspector')

  assert.match(source, /inspectorCardId: null/)
  assert.match(source, /function openCardInspector/)
  assert.match(cardClick, /openCardInspector\(cardId\)/)
  assert.match(inspector, /function messagesForCard/)
  assert.match(inspector, /function inspectorProcessEntries/)
  // Tool calls are listed, not folded away: the drawer renders the rows under
  // its own 「工具调用」 heading.
  assert.match(inspector, /processEntries\(process/)
  assert.match(inspector, /card-inspector-process/)
  assert.match(inspector, /工具调用/)
  assert.doesNotMatch(inspector, /threadMessage\(thread, message\)/)
  assert.match(inspector, /class="card-inspector/)
  assert.match(inspector, /data-action="open-continue"/)
  assert.doesNotMatch(inspector, /完整对话/)
  assert.match(inspector, /<svg aria-hidden="true" viewBox="0 0 16 16">/)
  assert.match(inspector, /card\.canContinue === true/)
  assert.match(inspector, /card-inspector-error/)
  assert.match(source, /button\.dataset\.action === 'close-card-inspector'/)
  assert.match(source, /event\.key !== 'Escape'/)
  assert.match(source, /processCount/)
  assert.match(styles, /\.card-inspector \{ position: absolute/)
  assert.match(styles, /\.card-inspector\.is-opening, \.card-inspector\.is-closing/)
  assert.match(styles, /\.card-inspector-answer/)
  assert.doesNotMatch(styles, /\.card-inspector \{[^}]*box-shadow/)
  assert.match(styles, /\.card-inspector-actions button svg/)
  assert.doesNotMatch(styles, /\.card-inspector-head \{[^}]*border-bottom/)
  assert.match(styles, /--inspector-width: 100%/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(styles, /\.thread-card-label/)
})

test('resizes the inspector by dragging its left edge within bounds', async () => {
  const source = await readAppSource()
  const styles = await readStyles()
  const resizer = source.slice(source.indexOf('function installInspectorResizer'), source.indexOf("window.addEventListener('resize'"))

  // Bounds are explicit, and MAX also yields to the pane so the map survives.
  assert.match(source, /const INSPECTOR_WIDTH_MIN = 380/)
  assert.match(source, /const INSPECTOR_WIDTH_MAX = 760/)
  assert.match(source, /const INSPECTOR_WIDTH_MAX_RATIO = \.78/)
  assert.match(source, /function clampInspectorWidth/)
  assert.match(source, /Math\.min\(inspectorMaxWidth\(\), Math\.max\(INSPECTOR_WIDTH_MIN/)
  // Dragging the left edge LEFT widens it: width = start - dx.
  assert.match(resizer, /startWidth - \(moveEvent\.clientX - startX\)/)
  assert.match(source, /function persistInspectorWidth/)
  assert.match(source, /localStorage\.setItem\(INSPECTOR_WIDTH_KEY/)
  assert.match(resizer, /persistInspectorWidth\(\)/)
  assert.match(resizer, /addEventListener\('keydown'/)
  // The width travels as a custom property so the narrow layout can override it.
  assert.match(source, /style="--inspector-width:\$\{width\}px"/)
  assert.match(styles, /width: var\(--inspector-width, 460px\)/)
  assert.match(styles, /\.card-inspector-resizer \{[^}]*cursor: col-resize/)
  assert.match(styles, /\.card-inspector-resizer:hover::after/)
})

test('switching the workspace in the map syncs DSH to its first session', async () => {
  const source = await readAppSource()
  // The picker is a custom listbox now; both the trigger and its options call
  // `switchWorkspace`, which owns the DSH hand-off.
  const select = source.slice(source.indexOf('async function switchWorkspace'), source.indexOf("app.addEventListener('input'"))

  assert.match(select, /choice\.sessionIds\[0\]/)
  assert.match(select, /post\('synapse:activate-session'/)
})

test('renders markdown tables and allows higher canvas zoom', async () => {
  const source = await readAppSource()
  const markdown = source.slice(source.indexOf('function markdownBlock'), source.indexOf('function overlapsCard'))

  assert.match(markdown, /<table><thead>/)
  assert.match(markdown, /isTableDelimiter/)
  assert.match(source, /Math\.min\(ZOOM_MAX, Math\.max\(ZOOM_MIN,/)
  // The map zooms out to a 20% overview and in to 400%.
  assert.match(source, /const ZOOM_MIN = \.2/)
  assert.match(source, /const ZOOM_MAX = 4/)
})

test('renders the refactored detail view with role-based messages', async () => {
  const source = await readAppSource()
  // The transcript lives in one module now: assert on the module, not a slice.
  const thread = await pickApp('detail')
  const message = thread

  assert.match(thread, /detail-scroll/)
  assert.match(thread, /detail-flow/)
  // No title block of its own: the transcript starts under the tab row, and the
  // session actions live in the top bar (`detailActionsBar`).
  assert.doesNotMatch(thread, /detail-head/)
  assert.match(source, /function detailActionsBar/)
  // The detail view reads as one column of markdown: no avatar chip, no role
  // label row — the body carries the reading, the process fold carries the rest.
  assert.match(message, /message-body md/)
  assert.match(message, /message-\$\{message\.kind\}/)
  assert.match(message, /processRecords\(process, messageId\)/)
  assert.doesNotMatch(message, /message-avatar/)
  // The question is a bubble on the shared token, the answer is bare prose: no
  // per-message card left to wrap the Q&A in a second container.
  const styles = await readStyles()
  assert.match(styles, /\.detail-flow \{[^}]*max-width: min\(920px/)
  assert.match(styles, /\.message-user \.message-body \{[^}]*var\(--syn-bubble\)/)
  assert.doesNotMatch(styles, /\.message-user headers? \{/)
  // 创建分支 has exactly one home (the header cluster), so an answer carries no
  // chrome of its own and the old pill styles are gone with it.
  const row = message.slice(message.indexOf('function threadMessage'), message.indexOf('function detailActionsBar'))
  assert.doesNotMatch(row, /message-branch|open-branch|message-actions/)
  assert.doesNotMatch(styles, /\.message-branch|\.message-actions/)
  // The active tab keeps one blue bar in both views, one pixel heavier in the
  // transcript where it borders a column of text instead of empty canvas.
  assert.match(styles, /\.canvas-tabs\[data-active="thread"\] button\[data-action="show-thread"\]::after \{ height: 3px; \}/)
})

test('persists dragged card positions and can focus the current session', async () => {
  const source = await readAppSource()

  assert.match(source, /localStorage\.setItem\(CARD_POSITIONS_KEY/)
  assert.match(source, /function focusActiveCard\(\)/)
  assert.match(source, /data-action="focus-active"/)
})

test('switching workspaces syncs DSH to the most recently updated session', async () => {
  const source = await readAppSource()
  const select = source.slice(source.indexOf('async function switchWorkspace'), source.indexOf("app.addEventListener('input'"))

  assert.match(select, /updatedAt/)
  assert.match(select, /post\('synapse:activate-session'/)
})

test('mirrors DSH theme changes into the map', async () => {
  const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const appSource = await readAppSource()

  assert.match(clientSource, /data-ds-dark-theme/)
  assert.match(clientSource, /synapse:theme/)
  assert.match(appSource, /data\.type === 'synapse:theme'/)
  assert.match(appSource, /document\.documentElement\.dataset\.theme/)
})

test('leaves text selections inside cards intact', async () => {
  const source = await readAppSource()
  const cardClick = source.slice(source.indexOf('if (!(button instanceof HTMLElement)) {'), source.indexOf("if (button.dataset.action === 'close')"))

  assert.match(cardClick, /event\.detail > 1/)
  assert.match(cardClick, /Math\.hypot/)
  assert.match(source, /pointerDownPosition = \{ x: event\.clientX/)
})

test('opens a prefilled follow-up draft from selected answer text', async () => {
  const source = await readAppSource()
  const selection = source.slice(source.indexOf('function selectionFollowupTarget'), source.indexOf("app.addEventListener('pointerdown', event => {"))
  const click = source.slice(source.indexOf("if (button.dataset.action === 'follow-selection')"), source.indexOf("if (button.dataset.action === 'close')"))

  assert.match(source, /class="selection-followup"/)
  // The card body is a non-selectable summary now, so the source of a follow-up
  // selection is the inspector's answer (or the detail view) only.
  assert.match(selection, /\.card-inspector-answer/)
  assert.match(selection, /\.message-assistant \.message-body/)
  assert.match(selection, /text === '' \|\| text\.length > 4000/)
  assert.match(selection, /text\.length > 4000/)
  assert.match(click, /openContinue\(thread, undefined, followup\.text\)/)
  assert.match(source, /state\.draft = \{ kind: 'continue', parentId: parent\.id, anchorId, text, sending: false \}/)
})

test('renders editable quick phrases in follow-up and branch drafts', async () => {
  const source = await readAppSource()
  const styles = await readStyles()

  assert.match(source, /DEFAULT_QUICK_PHRASES = \['展开说明', '举例', '通俗易懂', '对比解释'\]/)
  assert.match(source, /QUICK_PHRASES_KEY/)
  assert.match(source, /data-action="insert-quick-phrase"/)
  assert.match(source, /data-action="open-quick-phrase-editor"/)
  assert.match(source, /data-action="remove-quick-phrase"/)
  assert.match(source, /function insertQuickPhrase/)
  assert.match(source, /persistQuickPhrases\(\)/)
  assert.match(styles, /\.draft-quick-phrases/)
  assert.match(styles, /\[data-theme="dark"\] \.draft-quick-phrase/)
})

test('caches markdown rendering and patches the live card without a full render', async () => {
  const source = await readAppSource()
  const live = source.slice(source.indexOf('function scheduleLiveCardUpdate'), source.indexOf('async function pollProjection'))

  assert.match(source, /const markdownCache = new Map\(\)/)
  assert.match(source, /MARKDOWN_CACHE_LIMIT/)
  assert.match(source, /function scheduleLiveCardUpdate/)
  assert.match(live, /function applyLiveReplyToCard/)
  assert.match(live, /requestAnimationFrame/)
})

test('renders a follow-up plus on final cards and fold plus branch controls on non-final cards', async () => {
  const source = await readAppSource()
  const card = source.slice(source.indexOf('function conversationCard'), source.indexOf('function draftActions'))

  assert.match(card, /class="graph-continue-button"/)
  assert.match(card, /data-action="open-continue"/)
  assert.match(card, /aria-label="添加追问"/)
  assert.match(card, /childCount === 0 \|\| card\.canContinue === true\s+\? ''/)
  assert.match(card, /class="graph-fold-button/)
  assert.match(card, /data-action="toggle-card-children"/)
  assert.match(card, /aria-expanded=/)
  assert.match(card, /M3\.5 8h9/)
  assert.match(card, /M8 3\.5v9/)
  assert.match(card, /childCount === 0 \|\| card\.canContinue === true \|\| !Number\.isInteger\(card\.answer\?\.sourceSeq\)/)
  assert.match(card, /class="graph-branch-button"/)
  assert.match(card, /aria-label="在新对话中分支"/)
  assert.match(card, /M13\.0762 1\.37207C14\.0846/)
  assert.doesNotMatch(card, />追问<\/button>/)
  assert.doesNotMatch(card, />分支<\/button>/)
  assert.doesNotMatch(card, /class="branch-button"/)
})

test('positions the latest plus at the connector and the branch icon below the fold control', async () => {
  const styles = await readStyles()

  // The fold control sits on the card's middle line; the branch pill hangs one
  // step below it (20px button + 4px gap), not beside it.
  assert.match(styles, /\.graph-continue-button, \.graph-fold-button \{ top: 50%; transform: translateY\(-50%\); \}/)
  // The edge controls are small on purpose; a full-size button reads as content.
  assert.match(styles, /\.graph-continue-button, \.graph-fold-button, \.graph-branch-button \{[^}]*width: 20px; height: 20px/)
  assert.match(styles, /\.graph-branch-button \{ top: calc\(50% \+ 24px\); transform: translateY\(-50%\); \}/)
  assert.match(styles, /\.graph-continue-button svg, \.graph-fold-button svg, \.graph-branch-button svg/)
  assert.match(styles, /\[data-theme="dark"\] \.graph-continue-button, \[data-theme="dark"\] \.graph-fold-button, \[data-theme="dark"\] \.graph-branch-button/)
})

test('persists graph collapse choices and renders connectors from visible cards only', async () => {
  const source = await readAppSource()
  const canvas = source.slice(source.indexOf('function renderCanvas'), source.indexOf('function isProcessMessage'))
  const toggle = source.slice(source.indexOf("button.dataset.action === 'toggle-card-children'"), source.indexOf("button.dataset.action === 'open-continue'"))

  assert.match(source, /COLLAPSED_CARDS_KEY/)
  assert.match(source, /localStorage\.setItem\(COLLAPSED_CARDS_KEY/)
  assert.match(canvas, /const graph = conversationGraphView\(allCards\)/)
  assert.match(canvas, /const cards = graph\.cards/)
  assert.match(canvas, /canvasConnectors\(cards\)/)
  assert.match(toggle, /state\.collapsedCardIds\.(?:has|delete|add)/)
  assert.match(toggle, /persistCollapsedCards\(\)/)
})

test('identifies when an anchored draft has no visible parent card', async () => {
  const source = await readAppSource()
  const placement = source.slice(source.indexOf('function draftPlacement'), source.indexOf('function draftCard'))

  assert.match(placement, /draft\.anchorId === undefined/)
  assert.match(placement, /cards\.find\(card => card\.id === draft\.anchorId\)/)
  assert.match(placement, /if \(parent === undefined\) return null/)
})

test('prevents collapse from hiding drafts or the active conversation and restores focus', async () => {
  const source = await readAppSource()
  const toggle = source.slice(source.indexOf("button.dataset.action === 'toggle-card-children'"), source.indexOf("button.dataset.action === 'open-continue'"))

  assert.match(toggle, /const visibleCards = conversationGraphView\(allCards, nextCollapsed\)\.cards/)
  assert.match(toggle, /draftPlacement\(allCards\)\?\.parent\.id/)
  assert.match(toggle, /请先完成或取消正在编辑的追问或分支/)
  assert.match(toggle, /当前会话位于这个后续分支中/)
  assert.match(toggle, /window\.setTimeout/)
  assert.match(toggle, /\.focus\(\)/)
})

test('reveals hidden ancestor paths when a conversation becomes current', async () => {
  const source = await readAppSource()
  const reveal = source.slice(source.indexOf('function revealConversationThread'), source.indexOf('function canvasConnectors'))
  const current = source.slice(source.indexOf("data.type === 'synapse:current-session'"), source.indexOf("data.type === 'synapse:live-reply'"))

  assert.match(reveal, /state\.collapsedCardIds\.delete\(parentId\)/)
  assert.match(reveal, /persistCollapsedCards\(\)/)
  assert.match(current, /revealConversationThread\(conversationCards\(state\.workspace\.threads\), thread\.id\)/)
})

test('prunes persisted collapsed state when a conversation is archived', async () => {
  const source = await readAppSource()
  const archive = source.slice(source.indexOf('async function archiveThread'), source.indexOf('function openContinue'))

  assert.match(archive, /state\.collapsedCardIds/)
  assert.match(archive, /key\.startsWith\(`\$\{id\}:`\)/)
  assert.match(archive, /persistCollapsedCards\(\)/)
})
