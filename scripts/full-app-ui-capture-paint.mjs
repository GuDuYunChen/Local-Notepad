import assert from 'node:assert/strict'

// The original two renderer frames may run while their caller only writes
// host evidence. A ticket never bypasses them, belongs to this capture
// instance and exact filename, and can be joined only once.
export function createFullAppCapturePaint(waitForPaint) {
  const pending = new WeakMap()
  return {
    prepare(filename) {
      const ticket = Object.freeze({})
      let outcome
      try {
        // Call now: deferring this invocation to a microtask would serialize
        // the renderer request behind the synchronous evidence writes again.
        outcome = Promise.resolve(waitForPaint()).then(
          value => ({ ok: true, value }), error => ({ ok: false, error }))
      } catch (error) { outcome = Promise.resolve({ ok: false, error }) }
      // Rejections are handled immediately, even if a prior host assertion
      // subsequently fails and the caller never reaches the capture boundary.
      pending.set(ticket, { filename, outcome })
      return ticket
    },
    async wait(filename, ticket) {
      if (ticket === undefined) return await waitForPaint()
      const entry = pending.get(ticket)
      assert.ok(entry, 'Actual capture paint ticket is foreign or already consumed')
      assert.equal(entry.filename, filename, 'Actual capture paint ticket filename changed')
      pending.delete(ticket) // Consume before awaiting, including rejected frames.
      const outcome = await entry.outcome
      if (!outcome.ok) throw outcome.error
      return outcome.value
    },
  }
}
