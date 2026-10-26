// Syntax check every script the plugin ships. There is no bundler, so this is
// the whole "build": a typo has to fail here rather than in the page.
import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const app = (await readdir(join(root, 'app'))).filter(file => file.endsWith('.js')).sort()
const files = ['index.js', 'client.js', ...app.map(file => join('app', file))]

let failed = 0
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' })
  if (result.status !== 0) {
    failed += 1
    console.error(`✖ ${file}`)
  }
}
if (failed > 0) process.exit(1)
console.log(`checked ${files.length} files`)
