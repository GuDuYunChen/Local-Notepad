import { useCallback, useLayoutEffect, useState } from 'react'
import { useEditorWriteScope } from './useEditorWriteScope'

// Toolbar and paste plugins live in the same Lexical editor. They must share
// one session so a paste cannot race a toolbar batch (or vice versa).
const sessions = new WeakMap()
function getSession(editor) {
  let session = sessions.get(editor)
  if (!session) {
    session = { active: null, listeners: new Set(), busy: false }
    sessions.set(editor, session)
  }
  return session
}
function publish(session, busy) {
  session.busy = busy
  for (const listener of session.listeners) listener(busy)
}
function cancelSession(session) {
  const task = session.active
  if (!task) return
  session.active = null
  task.controller.abort()
  publish(session, false)
}

export function useImageUploadSession(editor, documentId) {
  const captureWrite = useEditorWriteScope(editor, documentId)
  const [busy, setBusy] = useState(() => getSession(editor).busy)
  useLayoutEffect(() => {
    const session = getSession(editor)
    const update = value => setBusy(value)
    session.listeners.add(update)
    update(session.busy)
    const cancel = () => cancelSession(session)
    const unregister = editor.registerEditableListener(cancel)
    return () => {
      session.listeners.delete(update)
      cancelSession(session)
      unregister()
    }
  }, [editor, documentId])
  const cancel = useCallback(() => cancelSession(getSession(editor)), [editor])
  const begin = useCallback(() => {
    const session = getSession(editor)
    if (session.active) return null
    const canWrite = captureWrite()
    if (!canWrite()) return null
    const controller = new AbortController()
    const task = {
      controller, signal: controller.signal,
      current: () => !controller.signal.aborted && canWrite(),
      finish: () => {
        if (session.active === task) {
          session.active = null
          publish(session, false)
        }
      },
    }
    session.active = task
    publish(session, true)
    return task
  }, [editor, captureWrite])
  return { begin, cancel, busy }
}
