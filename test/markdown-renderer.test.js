import assert from 'node:assert/strict'
import vm from 'node:vm'
import test from 'node:test'
import { pickApp } from './source.js'

async function loadRenderer() {
  const source = await pickApp('text', 'markdown')
  const context = { globalThis: {} }
  vm.createContext(context)
  vm.runInContext(`${source};globalThis.renderMarkdown = renderMarkdown`, context)
  return context.globalThis.renderMarkdown
}

test('renders PowerShell marker-only diagnostic lines without stalling', async () => {
  const renderMarkdown = await loadRenderer()
  const input = 'cmd : Access is denied.\nAt line:1 char:1\n+ \n+ ~~~~~\n    + CategoryInfo : PermissionDenied'
  const result = renderMarkdown(input)

  assert.match(result, /cmd : Access is denied/)
  assert.match(result, /CategoryInfo/)
})
