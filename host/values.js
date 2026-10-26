// Small value helpers: validation, titles, and what counts as prose.

import { EXCERPT_CHARS, INJECTED_USER_SOURCE_KINDS, SKILL_CATALOG_MARKER, SKILL_CATALOG_OPENER } from './constants.js'

export class InputError extends Error {}

export class NotFoundError extends Error {}

export function positionOf(value) {
  const x = Number(value?.x)
  const y = Number(value?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new InputError('position 必须包含有效坐标')
  return { x: Math.round(Math.max(-2000, Math.min(5000, x))), y: Math.round(Math.max(-2000, Math.min(5000, y))) }
}

export function requiredText(value, maxLength, field) {
  if (typeof value !== 'string') throw new InputError(`${field} 必须是文本`)
  const text = value.trim()
  if (text.length === 0) throw new InputError(`${field} 不能为空`)
  if (text.length > maxLength) throw new InputError(`${field} 超过长度限制`)
  return text
}

export function errorText(value) {
  if (typeof value === 'string') return value.trim() || null
  if (value === null || value === undefined || typeof value !== 'object') return null
  const name = typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim() : ''
  const code = typeof value.code === 'string' && value.code.trim() !== '' ? value.code.trim() : ''
  const message = typeof value.message === 'string' && value.message.trim() !== '' ? value.message.trim() : ''
  if (message !== '') return [name, code].filter(Boolean).concat(message).join(': ')
  return [name, code].filter(Boolean).join(': ') || null
}

export function noteProjection(kind, text) {
  const normalized = text.trim()
  if (normalized === '') return null
  const excerpt = excerptOf(normalized)
  return { kind, text: excerpt, length: normalized.length, truncated: excerpt.length < normalized.length }
}

/** Short preview kept in the workspace file, with an ellipsis when cut. */
export function excerptOf(text) {
  if (text.length <= EXCERPT_CHARS) return text
  return `${text.slice(0, EXCERPT_CHARS).trimEnd()}…`
}

export function isRuntimeContextText(text) {
  return typeof text === 'string' && text.trimStart().startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')
}

export function isRuntimeContextMessage(message) {
  return message?.kind === 'user' && isRuntimeContextText(message.text)
}

/**
 * The clock note the harness splices in before a request ("Time sampled while
 * preparing turn 2, step 1: …"). It arrives as a `user/message`, so without this
 * it became a canvas card whose title was that English sentence.
 */
export function isTimeContextText(text) {
  return typeof text === 'string' && text.trimStart().startsWith('Time sampled while preparing')
}

/** A harness-authored turn, identified by its structured provenance. */
export function isInjectedUserSource(source) {
  return typeof source?.kind === 'string' && INJECTED_USER_SOURCE_KINDS.has(source.kind)
}

/**
 * Recognises a stored skill catalogue. Only the harness emits both markers
 * together, so a person quoting one of them is still kept as a real turn.
 */
export function isSkillCatalogText(text) {
  if (typeof text !== 'string') return false
  const head = text.trimStart()
  return head.startsWith(SKILL_CATALOG_OPENER) && head.includes(SKILL_CATALOG_MARKER)
}

/**
 * Whether a stored message must stay out of the canvas graph: runtime
 * snapshots and skill catalogues were never a turn the user took.
 */
export function isInjectedUserMessage(message) {
  return message?.kind === 'user' && (isRuntimeContextMessage(message) || isTimeContextText(message.text) || isSkillCatalogText(message.text))
}

export function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => {
    if (block?.type === 'text') return [block.text]
    if (block?.type === 'tool-call') return [block.name, block.arguments]
    if (block?.type === 'tool-result') return contentText(block.content)
    return []
  }).filter(value => typeof value === 'string' && value.trim() !== '').join('\n')
}

/** The model's own words: text blocks only, never tool names or their output. */
export function proseText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text')
    .map(block => block.text)
    .filter(value => typeof value === 'string' && value.trim() !== '')
    .join('\n')
}

export function titleFromText(text) {
  const line = text.replaceAll(/\s+/g, ' ').trim()
  return (line.length > 42 ? `${line.slice(0, 42)}...` : line) || 'DSH 会话'
}

export function sessionCwd(session) {
  // The Session header defines `cwd` as its only working-directory carrier; the
  // old `header.meta.cwd` fallback never matched a real header field.
  const cwd = session.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : '未指定工作目录'
}

export function workspaceTitle(cwd, fallbackTitle) {
  if (cwd === '未指定工作目录') return fallbackTitle
  const segment = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1)
  return segment && segment.trim() !== '' ? segment : fallbackTitle
}
