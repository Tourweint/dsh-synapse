// Pure text helpers. No DOM, no state — everything else may use them.

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
/** Shorten text for a native tooltip, never mid-surrogate. */
const clipText = (value, limit) => {
  const text = String(value ?? '')
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`
}
