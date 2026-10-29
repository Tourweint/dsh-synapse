// Numbers, limits and marker strings the Host half shares.

export const MAX_BODY_BYTES = 32 * 1024

export const MAX_TITLE_LENGTH = 120

export const MAX_NOTE_LENGTH = 4_000

// Projected message text cap: longer replies truncate with a marker pointing
// at the detail view instead of silently cutting mid-sentence.
// Projected messages keep only a short preview: the body already lives in the
// DSH session log, and a canvas full of copies is what made one workspace file
// grow to megabytes (issue #42). Bodies are streamed back on demand by
// `/synapse/api/threads/:id/full`.
export const EXCERPT_CHARS = 280

// On-demand bodies are capped so a single enormous tool result cannot stall the
// browser while its card is rendered.
export const MAX_BODY_CHARS = 200_000

export const PROJECTION_TRUNCATED_SUFFIX = '\n——…（详情查看全文）'

export const BODY_TRUNCATED_SUFFIX = '\n——…（正文过长，其余请在 DSH 中查看）'

export const TOPIC_COLORS = ['#0f766e', '#2563eb', '#be123c', '#7c3aed', '#b45309']

// The harness writes `user/message` rows of its own. A canvas card must stand for
// a turn a person actually typed, so an injected row is recognised by its
// structured `source.kind` instead of by guessing at the prose (issue #31 / #23):
// ONLY `kind: 'user'` is a turn. Everything else — `runtime-context`,
// `time-context`, `skill-catalog`, `agent-instructions`, `user-approval`,
// `model-selection`, `goal`, `compact-checkpoint` — is context the harness
// splices in before a request. Projecting those gave cards whose title was a
// harness note, and because they arrive BETWEEN a question and its answer they
// also stole that answer: the real question was left "本轮没有正文" while the
// checkpoint card carried the reply.
export const USER_SOURCE_KIND = 'user'

// Stored projections keep no event to re-read, and events from before the tag
// carry no `source` at all, so the same rows are also recognised by the openers
// only the harness emits for them. Each is an English sentence or a bracket
// marker a person would not type.
export const INJECTED_USER_TEXT_MARKERS = [
  '<goal_round>',                                   // goal rounds
  '[model changed:',                                // model-selection notice
  'This is an automatically generated checkpoint',   // compact-checkpoint
  'The approval policy changed from',                // user-approval notice
  'The following workspace instructions may be relevant', // agent-instructions
]

// A stored skill catalogue is recognised by the `<system-reminder>` opener plus
// the `<available_skills>` index it wraps (the same opener also carries workspace
// instructions, which the marker list above covers).
export const SKILL_CATALOG_OPENER = '<system-reminder>'

export const SKILL_CATALOG_MARKER = '<available_skills>'

export const LOCK_STALE_MS = 60_000

// Deferred (event-projection) writes coalesce into one save per window, so a
// burst of session events costs a single full-state write instead of one per
// event (issue #13: per-event saves pinned the main thread at ~90% CPU).
export const SAVE_DEBOUNCE_MS = 800
