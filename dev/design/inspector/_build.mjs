// Generates the markdown fixture in these pages with the app's real renderer,
// and derives b.html / c.html from a.html so the three stay structurally
// identical. Run after changing `markdownBlock()` in app/markdown.js:
//
//   node dev/design/inspector/_build.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import vm from 'node:vm'

const here = import.meta.dirname
const appRoot = join(here, '..', '..', '..', 'app')
// text.js carries escapeHtml, markdown.js the renderer: both are DOM-free.
const textSource = await readFile(join(appRoot, 'text.js'), 'utf8')
const markdownSource = await readFile(join(appRoot, 'markdown.js'), 'utf8')
const context = {}
vm.createContext(context)
vm.runInContext(`${textSource}\n${markdownSource};globalThis.renderMarkdown = renderMarkdown`, context)

const SAMPLE = [
  '## 结论',
  '',
  '`morphHoldsCaret` 只该冻结光标所有者本身。写成 `contains()` 之后，只要页面上有选区或输入框聚焦，`<main>` 就会被判定成光标宿主，此后所有 `render()` 变成空操作——表现就是「点啥都没用」。',
  '',
  '> 只比较 `node === document.activeElement`，另外额外放行 contenteditable 宿主本身。祖先链一律不参与判断。',
  '',
  '---',
  '',
  '### 为什么会这样',
  '',
  '1. 卡片重渲染走 `morphInto`，不是 `innerHTML`；',
  '2. 每个节点先被匹配再原地打补丁；',
  '3. 匹配之前的「能否动这个节点」判断一旦过宽，整棵子树就被冻结。',
  '   - 冻结是静默的，没有报错',
  '   - 状态其实一直在变，只是没人画出来',
  '',
  '- [x] 把判断收窄到单个节点',
  '- [ ] 补一条点击级测试（`dev/harness`）',
  '',
  '```js',
  'function morphHoldsCaret(node) {',
  '  if (node === document.activeElement) return true',
  '  const active = document.activeElement',
  '  return active instanceof HTMLElement',
  '    && active.isContentEditable === true',
  '    && active.contains(node)',
  '}',
  '```',
  '',
  '| 层 | 位置 | 管什么 |',
  '| --- | --- | --- |',
  '| Host 单测 | `test/*.test.js` | 存储、投影、路由 |',
  '| vm 切片 | `conversation-cards` | 纯函数 |',
  '| 点击级 | `dev/harness` | 真实渲染 + 真实点击 |',
  '',
  '所以结论是：**判断要窄，测试要真**。详见 [开发流程](../../../docs/development.md)。',
].join('\n')

const markdownHtml = context.renderMarkdown(SAMPLE)
const indexHtml = await readFile(join(here, 'index.html'), 'utf8')
await writeFile(join(here, 'index.html'), indexHtml.split('<!--MD-->').join(markdownHtml))

// a.html is both a page and the template the other two are derived from, so it
// is filled in here as well.
const aTemplate = await readFile(join(here, 'a.html'), 'utf8')
const aHtml = aTemplate.split('<!--MD-->').join(markdownHtml)
await writeFile(join(here, 'a.html'), aHtml)
const variants = {
  b: {
    title: 'B · 文档版',
    variant: 'b',
    intro: '更像一份文档：15px / 1.85，行宽限制在 68 个字符；每个标题上方一条分隔线，引用做成内嵌面板，代码块带一条标题栏，表格隔行着色。结构最清楚，代价是一屏看到的字少一些。',
    note: '<b>适用：</b>回答普遍长、含多级标题与对照表，你希望「先看结构再读细节」的时候。',
  },
  c: {
    title: 'C · 紧凑版',
    variant: 'c',
    intro: '密度最高的一版：13px / 1.64，块间距 8px；引用降为弱化文字只留 2px 竖轨，代码与表格压紧。同样高度里塞下更多内容，适合快速扫读长回答。',
    note: '<b>适用：</b>多数回答只有几段加一段代码，你更在意「一屏看完全文」的时候。',
  },
}

for (const [key, config] of Object.entries(variants)) {
  let html = aHtml
    .split('A · 阅读版（已实现）').join(config.title)
    .split('A · 阅读版 <small>已实现</small>').join(config.title)
    .split('data-variant="a"').join(`data-variant="${config.variant}"`)
  // Swap the intro paragraph and the closing note for this variant's copy.
  html = html.replace(/<p>一段一节奏[\s\S]*?<\/p>/, `<p>${config.intro}</p>`)
  html = html.replace(/<p class="note">[\s\S]*?<\/p>/, `<p class="note">${config.note}</p>`)
  html = html.split('<!--MD-->').join(markdownHtml)
  await writeFile(join(here, `${key}.html`), html)
}

console.log(`injected ${markdownHtml.length} bytes of markdown into index/a/b/c`)
