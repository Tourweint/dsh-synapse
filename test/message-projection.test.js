import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { readAppSource } from './source.js'

async function loadMessagesFromEvents() {
  const source = await readAppSource()
  const start = source.indexOf('function messagesFromEvents')
  const end = source.indexOf('async function loadThreadHistory')
  const context = { globalThis: {} }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.messagesFromEvents = messagesFromEvents`, context)
  return context.globalThis.messagesFromEvents
}

test('does not turn DSH runtime context into a question card', async () => {
  const messagesFromEvents = await loadMessagesFromEvents()
  const messages = messagesFromEvents([
    { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\nPolicy details.' }] } },
    { type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: '你是谁' }] } },
  ])

  assert.deepEqual(messages.map(message => message.text), ['你是谁'])
})
