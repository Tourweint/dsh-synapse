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

// The harness writes `user/message` rows of its own (runtime snapshots, skill
// catalogues). A canvas card must stand for a turn a person actually typed, so
// an injected row is recognised by its structured `source.kind` instead of by
// guessing at the prose (issue #31 / #23).
// Harness-authored user messages. Only `kind: 'user'` is a turn the person took;
// everything else (`runtime-context`, `time-context`, `skill-catalog`) is context
// the harness splices in before a request. Projecting those as turns gave the
// canvas cards whose title was a harness note — and, because they arrived between
// a question and its answer, split real turns in two.
export const INJECTED_USER_SOURCE_KINDS = new Set(['skill-catalog', 'runtime-context', 'time-context'])

// Stored projections keep no raw event to re-read, so the one-time cleanup
// recognises a legacy catalogue card by the markers only that injection emits:
// the `<system-reminder>` opener plus the `<available_skills>` index it wraps.
export const SKILL_CATALOG_OPENER = '<system-reminder>'

export const SKILL_CATALOG_MARKER = '<available_skills>'

export const LOCK_STALE_MS = 60_000

// Deferred (event-projection) writes coalesce into one save per window, so a
// burst of session events costs a single full-state write instead of one per
// event (issue #13: per-event saves pinned the main thread at ~90% CPU).
export const SAVE_DEBOUNCE_MS = 800
