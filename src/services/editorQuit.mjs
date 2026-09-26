// Renderer-local ledger. Never bulk-save cached documents or send their text over IPC.
export class EditorQuitError extends Error {
  constructor(code = 'save-failed') { super(code); this.code = code }
}
export function waitForQuit(promise, signal) {
  if (signal?.aborted) return Promise.reject(new EditorQuitError('timeout'))
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new EditorQuitError('timeout')) }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
export function createEditorQuitRegistry() {
  const drafts = new Map(), participants = new Set()
  return {
    remember(id, content) { if (id) drafts.set(id, content) },
    saved(id, content) { if (drafts.get(id) === content) drafts.delete(id) },
    forget(id) { drafts.delete(id) }, // Only for an explicitly deleted document.
    pending() { return drafts.size },
    register(flush) { participants.add(flush); return () => participants.delete(flush) },
    async flush(signal) {
      for (const flush of [...participants]) await waitForQuit(flush(signal), signal)
      if (signal?.aborted) throw new EditorQuitError('timeout')
      if (drafts.size) throw new EditorQuitError('unresolved')
    },
  }
}
export const editorQuit = createEditorQuitRegistry()

// Adapt the existing editor save queue without inventing a parallel write path.
export function createEditorQuitParticipant({ snapshot, cache, save, registry = editorQuit }) {
  return async signal => {
    let state = snapshot()
    cache()
    // Drain old saves first, including a save for a document just switched away.
    // Failed/aborted saves leave the ledger dirty; an unresolved write is never success.
    for (let round = 0; state.pending.length; round++) {
      if (round >= 8) throw new EditorQuitError('changed')
      await waitForQuit(Promise.all(state.pending), signal)
      state = snapshot()
    }
    if (state.id && !state.ready) throw new EditorQuitError('loading')
    if (state.structural) throw new EditorQuitError('structure')
    if (!state.id || state.deleted) return
    const expected = { id: state.id, content: state.content }
    if (state.content !== state.saved) await waitForQuit(save(), signal)
    state = snapshot()
    if (!state.ready || state.id !== expected.id || state.content !== expected.content ||
        state.content !== state.saved || state.pending.length) throw new EditorQuitError('changed')
    registry.saved(state.id, state.content)
  }
}
