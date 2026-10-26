// Markdown parsing and the tokeniser behind fenced code colouring.

// ── Markdown ──────────────────────────────────────────────────────────────
// The answers are model output, so the parser has to survive whatever the model
// emits, not a tidy test fixture. Two rules: every character is escaped before
// any tag is produced (no raw HTML passthrough), and every construct the app
// renders — a `---` rule, a `>` quote, a fence, a table — gets its own element
// instead of falling through to a paragraph. A line that is only `---` used to
// end up as literal dashes, and `>` as a literal angle bracket, because the old
// parser knew paragraphs, headings, lists, fences and tables only.
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)/g

/** Only these schemes may become a real anchor; everything else stays text. */
function safeHref(url) {
  return /^(?:https?:|mailto:)/i.test(url) ? url : null
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(MARKDOWN_LINK, (whole, label, url) => {
      const href = safeHref(url)
      return href === null ? whole : `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
}

const tableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())

const isTableDelimiter = line => {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell))
}

const THEMATIC_BREAK = /^ {0,3}(?:(?:- *){3,}|(?:\* *){3,}|(?:_ *){3,})$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const QUOTE_LINE = /^ {0,3}> ?(.*)$/
// A quote block may start with `>` and continue with unmarked lines that belong
// to the same paragraph (CommonMark's "lazy continuation").
const BLOCK_START = /^ {0,3}(?:#{1,6}\s|>|\||(?:[-*+]|\d+[.)])\s|(`{3,}|~{3,}))|^ {0,3}(?:(?:- *){3,})\s*$/

/** Nested and flat lists. Returns the HTML plus the line index to resume at. */
function markdownList(lines, index) {
  const first = LIST_ITEM.exec(lines[index])
  const indent = first[1].length
  const ordered = /^\d/.test(first[2])
  const items = []
  while (index < lines.length) {
    const next = LIST_ITEM.exec(lines[index])
    if (next === null || next[1].length < indent) break
    if (next[1].length > indent) {
      // A deeper marker belongs to the item that was just closed.
      if (items.length === 0) break
      const nested = /^\d/.test(next[2]) === ordered
        ? markdownList(lines, index)
        : { html: '', index }
      if (nested.html === '') break
      // The nested list belongs INSIDE the previous <li>, not after it.
      items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, `${nested.html}</li>`)
      index = nested.index
      continue
    }
    if (/^\d/.test(next[2]) !== ordered) break
    let text = next[3]
    index++
    while (index < lines.length) {
      const line = lines[index]
      const marker = LIST_ITEM.exec(line)
      if (line.trim() === '') break
      // A marker at the same or a deeper indent starts another item / a nested
      // list; either way it is not continuation text.
      if (marker !== null) break
      // Continuation text must be visibly indented under the marker.
      if (!/^ {2,}\S/.test(line)) break
      text += ` ${line.trim()}`
      index++
    }
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text)
    items.push(task === null
      ? `<li>${inlineMarkdown(text)}</li>`
      : `<li class="task-item"><span class="task-box${task[1] === ' ' ? '' : ' is-checked'}" aria-hidden="true"></span>${inlineMarkdown(task[2])}</li>`)
  }
  return { html: `<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`, index }
}

// ── Code colouring ────────────────────────────────────────────────────────
// A fence is the one place in an answer where colour carries meaning, so it
// gets a small single-pass tokenizer instead of a dependency: comments,
// strings, numbers, words, and markup brackets. Nothing is parsed into a tree
// and nothing is ever emitted unescaped — a token is `escapeHtml` of a slice of
// the original text, wrapped in a span. The palette (tokens.css, `--syn-tok-*`)
// copies JetBrains' own default schemes, IntelliJ Light and Darcula, because
// that is the editor most readers already have open next to the answer.
const CODE_FAMILY = {
  // C-like: the braced languages. Adding one here is the whole job — the
  // tokenizer only needs the family, never per-language rules.
  js: 'script', mjs: 'script', cjs: 'script', jsx: 'script', ts: 'script', tsx: 'script',
  javascript: 'script', typescript: 'script',
  java: 'script', kt: 'script', kts: 'script', kotlin: 'script', scala: 'script',
  groovy: 'script', gradle: 'script', cs: 'script', csharp: 'script', 'c#': 'script',
  c: 'script', h: 'script', m: 'script', cc: 'script', cpp: 'script', cxx: 'script',
  hpp: 'script', hh: 'script', 'c++': 'script', objc: 'script', objectivec: 'script',
  go: 'script', golang: 'script', rs: 'script', rust: 'script', swift: 'script',
  dart: 'script', php: 'script', fs: 'script', fsharp: 'script', vb: 'script',
  zig: 'script', nim: 'script', sol: 'script', solidity: 'script',
  json: 'data', jsonc: 'data', json5: 'data', yaml: 'data', yml: 'data', toml: 'data',
  ini: 'data', conf: 'data', properties: 'data',
  py: 'hash', python: 'hash', rb: 'hash', ruby: 'hash', pl: 'hash', perl: 'hash',
  r: 'hash', jl: 'hash', julia: 'hash', ex: 'hash', exs: 'hash', elixir: 'hash',
  sh: 'hash', bash: 'hash', zsh: 'hash', fish: 'hash', shell: 'hash', console: 'hash',
  powershell: 'hash', ps1: 'hash', dockerfile: 'hash', makefile: 'hash', dotenv: 'hash',
  sql: 'dash', lua: 'dash',
  css: 'css', scss: 'css', sass: 'css', less: 'css', stylus: 'css',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
}
// Fences that are output, not source: colouring them would paint ordinary
// words as keywords. Anything else unknown still gets the C-like default,
// because a missing alias must never be the reason a block stays flat.
const CODE_PLAIN = new Set('text txt plain plaintext log logs output diff patch csv tsv md markdown mermaid ascii art'.split(' '))
const CODE_WORDS = {
  script: new Set('abstract as assert async await break case catch class const continue crate debugger declare default delete do else enum export extends final finally fn for from function get if impl implements import in instanceof interface let loop mod mut native new of package private protected pub public readonly return satisfies set static super switch synchronized this throw throws trait transient try type typeof unsafe use var void volatile where while with yield'.split(' ')),
  hash: new Set('and as assert async await break case class continue def del elif else esac eval except exec exit export fi finally for from function global if import in is lambda local nonlocal not or pass raise readonly return select set source then try unless until while with yield fi done do'.split(' ')),
  dash: new Set('add all alter and as asc begin by cascade case check column commit constraint create default delete desc distinct drop else elseif end exists foreign from full function group having if in index inner insert into join key left limit nil not null offset on or order outer primary procedure references right rollback select table then trigger union unique update values view when where'.split(' ')),
  data: new Set('true false null yes no on off'.split(' ')),
  css: new Set(),
  markup: new Set(),
}
// Lowercase primitives read as types, not keywords (IDEA colours them as a
// class reference rather than an orange `const`).
const CODE_PRIMITIVES = new Set('string number boolean object any unknown never bigint symbol int long double float char byte short'.split(' '))
const codeToken = (kind, text) => `<span class="tok-${kind}">${escapeHtml(text)}</span>`

/** ` </name attr="value" > `: only the name, the attributes and their values. */
function markupTag(tag) {
  const match = /^(<\/?)([\w:.-]+)([\s\S]*)$/.exec(tag)
  if (match === null) return escapeHtml(tag)
  let out = `${escapeHtml(match[1])}${codeToken('tag', match[2])}`
  const attributes = /(\s*)([\w:.-]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+))?/g
  let tail = 0
  for (const found of match[3].matchAll(attributes)) {
    out += escapeHtml(match[3].slice(tail, found.index)) + escapeHtml(found[1]) + codeToken('attr', found[2])
    if (found[3] !== undefined) out += escapeHtml(found[3])
    if (found[4] !== undefined) out += codeToken('str', found[4])
    tail = found.index + found[0].length
  }
  return out + escapeHtml(match[3].slice(tail))
}

function highlightMarkup(text) {
  let out = ''
  let index = 0
  while (index < text.length) {
    const open = text.indexOf('<', index)
    if (open === -1) return out + escapeHtml(text.slice(index))
    if (open > index) out += escapeHtml(text.slice(index, open))
    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open + 4)
      const stop = close === -1 ? text.length : close + 3
      out += codeToken('com', text.slice(open, stop))
      index = stop
      continue
    }
    const close = text.indexOf('>', open)
    if (close === -1) return out + escapeHtml(text.slice(open))
    out += markupTag(text.slice(open, close + 1))
    index = close + 1
  }
  return out
}

/**
 * Colours one fenced block. `language` is the fence tag as written. Only the
 * output-shaped tags (`text`, `diff`, `log`, …) are left flat; everything else,
 * including a tag this table has never heard of, gets the C-like default — a
 * missing alias must never be why a block of Java stays monochrome.
 * @param text - the block body, exactly as written.
 * @param language - fence info string.
 * @returns escaped HTML with `tok-*` spans.
 */
function highlightCode(text, language) {
  const label = String(language ?? '').trim().toLowerCase()
  if (CODE_PLAIN.has(label)) return escapeHtml(text)
  const family = CODE_FAMILY[label] ?? 'script'
  if (family === 'markup') return highlightMarkup(text)
  const words = CODE_WORDS[family]
  const lineComment = family === 'css' ? null : family === 'hash' ? '#' : family === 'dash' ? '--' : '//'
  const word = /[A-Za-z_$][\w$]*/y
  const number = /(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z%_]*/y
  const length = text.length
  let out = ''
  let index = 0
  // The next character that is not a space or a tab — enough to tell `name(`
  // (a call) from `name:` (a key) without copying the rest of the block.
  const peek = at => {
    while (at < length && (text[at] === ' ' || text[at] === '\t')) at++
    return text[at]
  }
  while (index < length) {
    const character = text[index]
    if (lineComment !== null && text.startsWith(lineComment, index)) {
      const newline = text.indexOf('\n', index)
      const stop = newline === -1 ? length : newline
      out += codeToken('com', text.slice(index, stop))
      index = stop
      continue
    }
    if (text.startsWith('/*', index)) {
      const close = text.indexOf('*/', index + 2)
      const stop = close === -1 ? length : close + 2
      out += codeToken('com', text.slice(index, stop))
      index = stop
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      const triple = family === 'hash' && text.startsWith(character.repeat(3), index)
      const quote = triple ? character.repeat(3) : character
      let stop = index + quote.length
      while (stop < length) {
        if (text[stop] === '\\') { stop += 2; continue }
        if (text.startsWith(quote, stop)) { stop += quote.length; break }
        // A plain quote ends at the line; a template literal may wrap.
        if (!triple && quote !== '`' && text[stop] === '\n') break
        stop++
      }
      // In JSON/YAML/TOML the string before a colon is a key, not a value.
      const isKey = family === 'data' && peek(stop) === ':'
      out += codeToken(isKey ? 'key' : 'str', text.slice(index, stop))
      index = stop
      continue
    }
    if (family === 'css' && character === '#') {
      const colour = /#[0-9a-fA-F]{3,8}\b/y
      colour.lastIndex = index
      const found = colour.exec(text)
      if (found !== null) {
        out += codeToken('num', found[0])
        index += found[0].length
        continue
      }
    }
    // `@media`, `$brand`, `--custom-property`: CSS names its own things.
    if (family === 'css' && (character === '@' || character === '$')) {
      const directive = /[@$][\w-]*/y
      directive.lastIndex = index
      const found = directive.exec(text)
      if (found !== null) {
        out += codeToken('key', found[0])
        index += found[0].length
        continue
      }
    }
    if (character >= '0' && character <= '9' && (index === 0 || !/[\w$.]/.test(text[index - 1]))) {
      number.lastIndex = index
      const found = number.exec(text)
      if (found !== null) {
        out += codeToken('num', found[0])
        index += found[0].length
        continue
      }
    }
    word.lastIndex = index
    const found = word.exec(text)
    if (found !== null) {
      const value = found[0]
      const after = peek(index + value.length)
      let kind = null
      if (family === 'css' && after === ':') kind = 'key'
      else if (words.has(value)) kind = 'key'
      else if (CODE_PRIMITIVES.has(value) && family === 'script') kind = 'type'
      else if (after === '(') kind = 'fn'
      else if (/^[A-Z]/.test(value)) kind = 'type'
      out += kind === null ? escapeHtml(value) : codeToken(kind, value)
      index += value.length
      continue
    }
    out += escapeHtml(character)
    index++
  }
  return out
}

function markdownBlock(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const output = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (line.trim() === '') { index++; continue }

    // ``` / ~~~ fences, including inside a quote. An unclosed fence (a stream
    // still arriving) renders as a code block to the end rather than as prose.
    const fence = FENCE_OPEN.exec(line)
    if (fence !== null) {
      const marker = fence[1]
      const language = fence[2]
      const body = []
      index++
      while (index < lines.length && !lines[index].trim().startsWith(marker)) body.push(lines[index++])
      if (index < lines.length) index++
      const label = language === '' ? '' : ` data-lang="${escapeHtml(language)}"`
      output.push(`<pre class="md-code"${label}><code>${highlightCode(body.join('\n'), language)}</code></pre>`)
      continue
    }

    if (THEMATIC_BREAK.test(line)) {
      output.push('<hr>')
      index++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      index++
      continue
    }

    const quote = QUOTE_LINE.exec(line)
    if (quote !== null) {
      const body = [quote[1]]
      index++
      while (index < lines.length) {
        const next = QUOTE_LINE.exec(lines[index])
        if (next !== null) { body.push(next[1]); index++; continue }
        // Lazy continuation: an unmarked line continues the quote until a
        // blank line or the start of another block.
        if (lines[index].trim() === '' || BLOCK_START.test(lines[index])) break
        body.push(lines[index++])
      }
      output.push(`<blockquote>${markdownBlock(body.join('\n'))}</blockquote>`)
      continue
    }

    if (LIST_ITEM.test(line)) {
      const list = markdownList(lines, index)
      output.push(list.html)
      index = Math.max(list.index, index + 1)
      continue
    }

    // GFM table: a leading-pipe header row followed by a |-delimiter row,
    // then any number of leading-pipe body rows.
    if (/^\s*\|/.test(line) && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const header = line
      const body = []
      index += 2
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        body.push(lines[index])
        index++
      }
      output.push(`<table><thead><tr>${tableCells(header).map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${tableCells(row).map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }

    const paragraph = []
    while (index < lines.length && lines[index].trim() !== '' && !BLOCK_START.test(lines[index])) paragraph.push(lines[index++])
    // A marker-only line such as PowerShell's "+ " diagnostic is neither a
    // list item nor paragraph content under the rules above. Consume it so
    // the parser always makes progress.
    if (paragraph.length === 0) paragraph.push(lines[index++])
    output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`)
  }
  return output.join('')
}

// Markdown parsing is pure CPU and repeats for every card on every canvas
// rebuild; cache the rendered HTML by input text so stable answers are never
// re-parsed. Bounded: streaming partial texts churn keys, so evict oldest.
const markdownCache = new Map()
const MARKDOWN_CACHE_LIMIT = 5000
function renderMarkdown(text) {
  const key = String(text)
  const cached = markdownCache.get(key)
  if (cached !== undefined) return cached
  const rendered = markdownBlock(key)
  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) markdownCache.delete(markdownCache.keys().next().value)
  markdownCache.set(key, rendered)
  return rendered
}

// ── Answer summary ────────────────────────────────────────────────────────
// Cards show a summary clipped from the answer itself, never a generated one:
// no extra model call, no waiting, and the same text at every zoom level. The
// extraction drops what cannot be read in two lines anyway (fences, tables,
// rules, tool transcripts) and keeps the first sentences of prose.
const summaryCache = new Map()
const SUMMARY_CACHE_LIMIT = 2000
function answerPlainText(text) {
  return String(text)
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')       // code fences
    .replace(/^\s*\|.*\|\s*$/gm, ' ')            // table rows
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ') // rules
    .replace(/^\s{0,3}>\s?/gm, '')               // quote markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')          // heading markers
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')   // list markers
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, '$1') // links / images keep the label
    .replace(/`{1,3}([^`\n]*)`{1,3}/g, '$1')     // inline code
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')
    .replace(/<[^>\n]+>/g, ' ')                  // stray tags / autolinks
    .replace(/\s+/g, ' ')
    .trim()
}

// 8 lines of 12.5px text at the unfolded card width: the whole summary fits
// once the card is open, and the folded card clips it to 3 lines in CSS.
const SUMMARY_LIMIT = 150
function answerSummary(text, limit = SUMMARY_LIMIT) {
  const key = `${limit}\u0000${String(text)}`
  const cached = summaryCache.get(key)
  if (cached !== undefined) return cached
  const plain = answerPlainText(text)
  let summary = plain
  if (plain.length > limit) {
    // Prefer ending on a sentence boundary close to the budget, otherwise cut
    // on a space so the last word is not sliced in half.
    const window = plain.slice(0, limit + 24)
    const sentence = /[^。！？!?;；\n]*[。！？!?;；]/.exec(window)
    if (sentence !== null && sentence[0].trim().length >= limit * 0.5) summary = sentence[0].trim()
    else {
      const space = window.lastIndexOf(' ')
      summary = `${(space > limit * 0.6 ? window.slice(0, space) : plain.slice(0, limit)).trim()}…`
    }
  }
  if (summaryCache.size >= SUMMARY_CACHE_LIMIT) summaryCache.delete(summaryCache.keys().next().value)
  summaryCache.set(key, summary)
  return summary
}
