// The canvas UI ships as fifteen classic scripts that share one global scope.
// Tests read them from disk either one at a time (when they evaluate a module)
// or joined in load order (when they only grep for patterns).
import { readFile } from 'node:fs/promises'
import { APP_SCRIPTS } from '../index.js'

/** Load order, owned by the Host half: the page's script tags come from here. */
export const APP_FILES = APP_SCRIPTS

const cache = new Map()
async function read(relative) {
  const cached = cache.get(relative)
  if (cached !== undefined) return cached
  const text = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8')
  cache.set(relative, text)
  return text
}

/** One module, exactly as it ships. */
export function readAppFile(name) {
  return read(`app/${name}.js`)
}

/** Every module joined in load order — for tests that assert on patterns. */
export async function readAppSource() {
  const parts = await Promise.all(APP_FILES.map(name => readAppFile(name)))
  return parts.join('\n')
}

/** The modules a test needs, joined: `pickApp('text', 'markdown')`. */
export async function pickApp(...names) {
  const parts = await Promise.all(names.map(name => readAppFile(name)))
  return parts.join('\n')
}
