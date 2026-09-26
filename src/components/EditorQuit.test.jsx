import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { installDocumentQuitBridge } from '~/services/editorQuitBridge.mjs'

vi.mock('~/services/api', () => ({ api: vi.fn() }))
vi.mock('./Editor/utils/referenceUtils', () => ({
  hasHeadingStructureChanged: (_before, after) => String(after).startsWith('heading:'),
}))
vi.mock('~/services/editorDraftCache', () => ({
  isFreshEditorDraft: () => false,
  readEditorDraft: () => null,
  removeEditorDraft: vi.fn(),
  writeEditorDraft: vi.fn(),
}))
// This suite exercises the real TextEditor save queue and document quit bridge.
// Keep its input fixture separate from the Markdown/Lexical context mock.
vi.mock('./Editor/Editor', () => ({
  default: function InputFixture({ initialContent, onChange }) {
    const [value, setValue] = React.useState(initialContent || '')
    React.useEffect(() => setValue(initialContent || ''), [initialContent])
    return <textarea aria-label="test-editor" value={value} onChange={event => {
      setValue(event.target.value)
      onChange(event.target.value)
    }} />
  },
}))

const noteId = 'quit-1'
const challengeId = '1'.repeat(32)
const nextChallengeId = '2'.repeat(32)
let root, host, prepare, release, results, dispose, ref, requests, replies
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const until = assertion => vi.waitFor(async () => {
  await act(tick)
  assertion()
}, { timeout: 1500, interval: 10 })

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // TextEditor uses React.lazy. Resolve the mocked module before expecting DOM.
  await import('./Editor/Editor')
  ref = React.createRef()
  results = []; requests = []; replies = []
  for (const id of [noteId, 'prior']) editorQuit.forget(id)
  host = document.createElement('div')
  host.id = 'root'
  document.body.appendChild(host)
  root = createRoot(host)
  api.mockReset()
  api.mockImplementation(async (path, init) => {
    if (init?.method !== 'PUT') return { id: noteId, content: 'old', updated_at: 100 }
    // Capture the request NOW. A reply must describe this write, not the textarea
    // after the user has typed again, changed documents or closed an overlay.
    const receipt = Object.freeze({
      id: path.split('/').pop(),
      content: JSON.parse(init.body).content,
      updated_at: 101,
    })
    const reply = replies.shift()
    requests.push({ receipt, reply })
    return reply ? await reply.promise : receipt
  })
  dispose = installDocumentQuitBridge({ bridge: {
    onQuitPrepare(fn) { prepare = fn; return () => { prepare = null } },
    onQuitRelease(fn) { release = fn; return () => { release = null } },
    reportQuitResult(value) { results.push(value) },
  } })
})

afterEach(async () => {
  dispose?.()
  // Settle owned fixtures before unmount: do not leave writes running in the
  // following test. Dispose first so a late response cannot approve an exit.
  await act(async () => {
    for (const request of requests) request.reply?.resolve(request.receipt)
    await tick()
  })
  await act(async () => { root.unmount(); await tick() })
  host.remove()
  for (const id of [noteId, 'prior']) editorQuit.forget(id)
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => {
    root.render(<TextEditor ref={ref} activeId={noteId} deletedIds={new Set()} />)
  })
  await until(() => {
    expect(host.querySelector('[aria-label="test-editor"]')).not.toBeNull()
    expect(ref.current.getReferenceRefactorState().currentContent).toBe('old')
  })
}

async function draft(text) {
  const field = host.querySelector('[aria-label="test-editor"]')
  expect(field).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(ref.current.getReferenceRefactorState().currentContent).toBe(text)
}

async function quit(id = challengeId) {
  await act(async () => { prepare({ id }); await tick() })
}
const puts = () => api.mock.calls.filter(([, init]) => init?.method === 'PUT')
const expectReceipt = receipt => until(() => expect(results.at(-1)).toEqual(receipt))

describe('editor exit save integration', () => {
  it('flushes an unsent draft, confirms it, and stays frozen until release', async () => {
    await render(); await draft('new body')
    expect(puts()).toHaveLength(0)
    await quit()
    await expectReceipt({ id: challengeId, ready: true })
    expect(requests.map(item => item.receipt.content)).toEqual(['new body'])
    expect(host.inert).toBe(true)
    expect(editorQuit.pending()).toBe(0)
    await act(async () => release({ id: challengeId }))
    expect(host.inert).not.toBe(true)
  })

  it('returns to the editor and keeps the dirty ledger when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await render(); await draft('new body')
    const reply = deferred(); replies.push(reply)
    await quit(); await until(() => expect(requests).toHaveLength(1))
    await act(async () => { reply.reject(new Error('offline')); await tick() })
    await expectReceipt({ id: challengeId, ready: false, code: 'save-failed' })
    expect(host.inert).not.toBe(true)
    expect(editorQuit.pending()).toBe(1)
    expect(host.querySelector('[aria-label="test-editor"]').value).toBe('new body')
  })

  it('does not bypass an unconfirmed heading/refactor change', async () => {
    await render(); await draft('heading:new section'); await quit()
    await expectReceipt({ id: challengeId, ready: false, code: 'structure' })
    expect(puts()).toHaveLength(0)
  })

  it('does not approve while a real TextEditor save is still pending', async () => {
    await render(); await draft('new body')
    const reply = deferred(); replies.push(reply)
    await quit(); await until(() => expect(requests).toHaveLength(1))
    expect(results).toHaveLength(0)
    expect(host.inert).toBe(true)
    await act(async () => { reply.resolve(requests[0].receipt); await tick() })
    await expectReceipt({ id: challengeId, ready: true })
  })

  it('preserves a previous unresolved document even when the current one is clean', async () => {
    await render(); editorQuit.remember('prior', 'previous body'); await quit()
    await expectReceipt({ id: challengeId, ready: false, code: 'unresolved' })
    expect(puts()).toHaveLength(0)
  })

  it('a clean document acknowledges without a redundant PUT', async () => {
    await render(); await quit()
    await expectReceipt({ id: challengeId, ready: true })
    expect(puts()).toHaveLength(0)
  })

  it('active IME composition refuses before freezing or saving', async () => {
    await render(); await draft('new body')
    const field = host.querySelector('[aria-label="test-editor"]')
    field.focus()
    const onBlur = vi.fn()
    field.addEventListener('blur', onBlur)
    await act(async () => field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await quit()
    await expectReceipt({ id: challengeId, ready: false, code: 'composition' })
    expect(puts()).toHaveLength(0)
    expect(host.inert).not.toBe(true)
    expect(document.activeElement).toBe(field)
    expect(onBlur).not.toHaveBeenCalled()
    field.removeEventListener('blur', onBlur)
    await act(async () => field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    await quit(nextChallengeId)
    await expectReceipt({ id: nextChallengeId, ready: true })
    expect(requests.map(item => item.receipt.content)).toEqual(['new body'])
  })

  it('drains a manual save and saves newer text before approving exit', async () => {
    await render(); await draft('first write')
    const first = deferred(); replies.push(first)
    let manual
    await act(async () => { manual = ref.current.save(); await tick() })
    await until(() => expect(requests).toHaveLength(1))
    await draft('newer text')
    const second = deferred(); replies.push(second)
    await quit()
    expect(results).toHaveLength(0)
    expect(requests).toHaveLength(1)
    // A later editor value must not be used to construct the older receipt.
    expect(requests[0].receipt.content).toBe('first write')
    await act(async () => { first.resolve(requests[0].receipt); await manual })
    await until(() => expect(requests).toHaveLength(2))
    expect(results).toHaveLength(0)
    expect(requests[1].receipt.content).toBe('newer text')
    await act(async () => { second.resolve(requests[1].receipt); await tick() })
    await expectReceipt({ id: challengeId, ready: true })
    expect(editorQuit.pending()).toBe(0)
    expect(ref.current.getReferenceRefactorState().savedContent).toBe('newer text')
  })

  it.each([
    ['missing receipt', null],
    ['wrong document', { id: 'other', content: 'new body' }],
    ['wrong content', { id: noteId, content: 'old' }],
    ['missing content', { id: noteId }],
  ])('rejects %s without authorizing exit', async (_label, receipt) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await render(); await draft('new body')
    const reply = deferred(); replies.push(reply)
    await quit(); await until(() => expect(requests).toHaveLength(1))
    await act(async () => { reply.resolve(receipt); await tick() })
    await expectReceipt({ id: challengeId, ready: false, code: 'save-failed' })
    expect(ref.current.getReferenceRefactorState().savedContent).toBe('old')
    expect(editorQuit.pending()).toBe(1)
    expect(host.inert).not.toBe(true)
  })

  it('disposal releases input and ignores a late save acknowledgement', async () => {
    await render(); await draft('pending body')
    const reply = deferred(); replies.push(reply)
    await quit(); await until(() => expect(requests).toHaveLength(1))
    expect(host.inert).toBe(true)
    await act(async () => { dispose(); await tick() })
    expect(prepare).toBeNull(); expect(release).toBeNull()
    expect(host.inert).not.toBe(true)
    await act(async () => { reply.resolve(requests[0].receipt); await tick() })
    await until(() => expect(editorQuit.pending()).toBe(0))
    expect(results).toHaveLength(0)
  })
})
