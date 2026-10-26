// The answer body is model output, so the renderer has to cover the blocks the
// model actually emits. The regressions that prompted these tests: a `---` rule
// rendered as three literal dashes, and `>` rendered as a literal angle bracket,
// because the parser only knew paragraphs, headings, lists, fences and tables.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadMarkdown() {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const start = source.indexOf('const MARKDOWN_LINK')
  const end = source.indexOf('/** A card\'s height in the flow')
  const context = {
    globalThis: {},
    escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])),
  }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.renderMarkdown = renderMarkdown;globalThis.answerSummary = answerSummary;globalThis.answerPlainText = answerPlainText`, context)
  return context.globalThis
}

test('renders a thematic break instead of literal dashes', async () => {
  const { renderMarkdown } = await loadMarkdown()

  assert.equal(renderMarkdown('---'), '<hr>')
  assert.equal(renderMarkdown('***'), '<hr>')
  assert.equal(renderMarkdown('before\n\n---\n\nafter'), '<p>before</p><hr><p>after</p>')
  // A `- ` list item is not a rule.
  assert.match(renderMarkdown('- one\n- two'), /^<ul>/)
})

test('renders block quotes, including lazy continuation and nesting', async () => {
  const { renderMarkdown } = await loadMarkdown()

  assert.match(renderMarkdown('> quoted line'), /^<blockquote><p>quoted line<\/p><\/blockquote>$/)
  // An unmarked line right after a quote belongs to the same quote.
  assert.match(renderMarkdown('> first\nsecond'), /<blockquote><p>first<br>second<\/p><\/blockquote>/)
  // A blank line ends it.
  assert.equal(renderMarkdown('> first\n\nsecond'), '<blockquote><p>first</p></blockquote><p>second</p>')
  // Nested quote, and a list inside a quote.
  assert.match(renderMarkdown('> > inner'), /<blockquote><blockquote><p>inner<\/p><\/blockquote><\/blockquote>/)
  assert.match(renderMarkdown('> - a\n> - b'), /<blockquote><ul><li>a<\/li><li>b<\/li><\/ul><\/blockquote>/)
})

test('renders headings up to level six and fenced code with its language', async () => {
  const { renderMarkdown } = await loadMarkdown()

  assert.equal(renderMarkdown('###### depth'), '<h6>depth</h6>')
  // A fence is tokenised, not just escaped: one span per coloured run, and
  // everything outside a token stays plain text.
  assert.equal(
    renderMarkdown('```ts\nconst a = 1\n```'),
    '<pre class="md-code" data-lang="ts"><code><span class="tok-key">const</span> a = <span class="tok-num">1</span></code></pre>',
  )
  assert.match(renderMarkdown('```js\n// c\nconst s = "x"\n```'), /<span class="tok-com">\/\/ c<\/span>[\s\S]*<span class="tok-str">&quot;x&quot;<\/span>/)
  // Output-shaped fences stay flat: `text` is a transcript, not source.
  assert.equal(
    renderMarkdown('```text\nsay "hi" if you like\n```'),
    '<pre class="md-code" data-lang="text"><code>say &quot;hi&quot; if you like</code></pre>',
  )
  // The language tag is matched case-insensitively, and a tag this table has
  // never heard of still gets the C-like default: a missing alias must not be
  // why a block of code stays monochrome.
  assert.match(
    renderMarkdown('```Java\npublic class A { final int n = 1; }\n```'),
    /data-lang="Java"><code><span class="tok-key">public<\/span> <span class="tok-key">class<\/span> <span class="tok-type">A<\/span> \{ <span class="tok-key">final<\/span> <span class="tok-type">int<\/span> n = <span class="tok-num">1<\/span>; \}<\/code>/,
  )
  assert.match(renderMarkdown('```nope\nif (a) return "b"\n```'), /<span class="tok-key">if<\/span> \(a\) <span class="tok-key">return<\/span> <span class="tok-str">&quot;b&quot;<\/span>/)
  // Tagged markup is coloured, and still escaped: no raw tag survives.
  assert.equal(
    renderMarkdown('```html\n<script>x</script>\n```'),
    '<pre class="md-code" data-lang="html"><code>&lt;<span class="tok-tag">script</span>&gt;x&lt;/<span class="tok-tag">script</span>&gt;</code></pre>',
  )
  // An unclosed fence (a reply still streaming) still renders as code.
  assert.match(renderMarkdown('```\nhalf a block'), /<pre class="md-code"><code>half a block<\/code><\/pre>/)
  // A fence inside a quote keeps working.
  assert.match(renderMarkdown('> ```\n> x\n> ```'), /<blockquote><pre class="md-code"><code>x<\/code><\/pre><\/blockquote>/)
})

test('renders nested lists, task items and GFM tables', async () => {
  const { renderMarkdown } = await loadMarkdown()

  assert.match(renderMarkdown('- a\n  - b\n- c'), /<ul><li>a<ul><li>b<\/li><\/ul><\/li><li>c<\/li><\/ul>/)
  assert.match(renderMarkdown('- [x] done\n- [ ] todo'), /<li class="task-item"><span class="task-box is-checked"[^>]*><\/span>done<\/li>/)
  assert.match(renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |'), /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/)
})

test('keeps only safe link targets and escapes everything else', async () => {
  const { renderMarkdown } = await loadMarkdown()

  assert.match(renderMarkdown('[docs](https://example.com/a?b=1)'), /<a href="https:\/\/example.com\/a\?b=1" target="_blank" rel="noreferrer noopener">docs<\/a>/)
  // javascript: stays inert text.
  assert.doesNotMatch(renderMarkdown('[x](javascript:alert(1))'), /<a /)
  assert.match(renderMarkdown('<img src=x onerror=alert(1)>'), /&lt;img/)
  assert.doesNotMatch(renderMarkdown('<script>alert(1)</script>'), /<script>/)
})

test('gathers a card summary from the answer text without code or table noise', async () => {
  const { answerSummary } = await loadMarkdown()

  const summary = answerSummary([
    '## 结论',
    '',
    '第一句是结论。第二句补充。',
    '',
    '```js',
    'const hidden = true',
    '```',
    '',
    '| a | b |',
    '| --- | --- |',
  ].join('\n'))

  assert.match(summary, /^结论 第一句是结论。/)
  assert.doesNotMatch(summary, /hidden|\|/)
  // Long prose is clipped on a sentence boundary and marked as clipped.
  const long = answerSummary('很长的第一句。'.repeat(20), 40)
  assert.ok(long.length <= 41, String(long.length))
  assert.match(long, /…$|。$/)
})
