// The canvas must never replace the whole tree: a rebuild between mousedown and
// mouseup destroys the click target, and the browser then dispatches no click at
// all (W3C uievents #141). Patching in place keeps the node under the pointer.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { readAppSource } from './source.js'

const source = await readAppSource()

test('patches renders into the live tree instead of replacing the page', () => {
  assert.match(source, /function morphInto\(container, html\)/)
  assert.match(source, /function morphChildren\(from, to\)/)
  // The render entry point and the streaming answer both morph.
  assert.match(source, /morphInto\(app, `/)
  // The live chunk patches the body paragraph's children, not the paragraph:
  // morphing a node into markup that repeats that node would nest it.
  assert.match(source, /morphInto\(body, /)
  assert.match(source, /\.thread-card\.is-answer\[data-thread=/)
  // No wholesale assignment may come back.
  assert.doesNotMatch(source, /app\.innerHTML\s*=/)
  assert.doesNotMatch(source, /body\.innerHTML\s*=/)
})

test('keys morph matching on the card and thread identities', () => {
  // A card keeps its node across renders because `data-card-id` identifies it;
  // sidebar rows and the detail view are matched by `data-thread`.
  const keys = /const MORPH_KEY_ATTRIBUTES = \[([^\]]+)\]/.exec(source)
  assert.ok(keys !== null, 'key attribute list is declared')
  for (const attribute of ['data-card-id', 'data-thread', 'id']) {
    assert.ok(keys[1].includes(`'${attribute}'`), `${attribute} participates in matching`)
  }
})

test("keeps the caret owner's children but still patches its attributes", () => {
  // Typing in the composer (or a drag handle) must survive a projection tick.
  assert.match(source, /function morphHoldsCaret\(node\)/)
  assert.match(source, /if \(!morphHoldsCaret\(from\)\) morphChildren\(from, to\)/)
  // Only text holders own a caret: a focused button must keep being patched, or
  // the control the user just clicked keeps its previous class/aria state.
  assert.match(source, /const ownsText = active\.isContentEditable === true/)
  assert.match(source, /if \(node === active\) return true/)
  // A frozen subtree still needs its own attributes reconciled, or the caret
  // holder keeps the previous render's class/aria while everything else moves.
  assert.doesNotMatch(source, /if \(morphHoldsCaret\(from\)\) return from/)
  const patchIndex = source.indexOf("if (from.getAttribute(attribute.name) !== attribute.value)")
  const guardIndex = source.indexOf('if (!morphHoldsCaret(from)) morphChildren(from, to)')
  assert.ok(patchIndex > 0, 'attributes are still patched')
  assert.ok(guardIndex > patchIndex, 'attributes are patched before children are touched')
})
