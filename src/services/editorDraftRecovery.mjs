// Recovery provenance belongs to the unconfirmed draft, not to a wall-clock
// ordering heuristic. A newer database body never authorizes overwriting it.
const VERSION = 1
const record = value => value && typeof value === 'object' && !Array.isArray(value)

function restoreAttempt(value, id) {
  if (!record(value) || value.id !== id || typeof value.content !== 'string' ||
      typeof value.expected !== 'string' || typeof value.requestID !== 'string' || !/^[a-f0-9]{32}$/.test(value.requestID) ||
      typeof value.mappings !== 'string' || value.mappings.length > 65536) return null
  try { const mappings = JSON.parse(value.mappings); if (!Array.isArray(mappings) || mappings.length > 500) return null } catch { return null }
  return Object.freeze({ id, content: value.content, expected: value.expected,
    requestID: value.requestID, mappings: value.mappings })
}

export function captureEditorDraftRecovery(id, expectedContent, attempt, conflicted = false) {
  if (typeof id !== 'string' || !id || typeof expectedContent !== 'string') return null
  return Object.freeze({ version: VERSION, id, expectedContent, conflicted: conflicted === true,
    attempt: attempt ? restoreAttempt(attempt, id) : null })
}

export function recoverEditorDraft(id, draft, databaseContent) {
  const none = { content: databaseContent, expectedContent: databaseContent, attempt: null,
    review: false, recovered: false }
  if (!record(draft) || typeof draft.content !== 'string') return none
  const stored = draft.recovery
  const owned = record(stored) && stored.version === VERSION && stored.id === id &&
    typeof stored.expectedContent === 'string' && typeof stored.conflicted === 'boolean'
  // Missing/legacy provenance is not a proof of freshness and must not grant
  // a write. Preserve its text for review instead of expiring unconfirmed work.
  const attempt = owned && stored.attempt != null ? restoreAttempt(stored.attempt, id) : null
  const malformedAttempt = record(stored) && stored.attempt != null && !attempt
  if (draft.content === databaseContent && !attempt && !malformedAttempt) return none
  return { content: draft.content,
    expectedContent: owned ? stored.expectedContent : databaseContent,
    attempt, recovered: true,
    review: !attempt && (malformedAttempt || !owned || stored.conflicted || stored.expectedContent !== databaseContent),
  }
}
