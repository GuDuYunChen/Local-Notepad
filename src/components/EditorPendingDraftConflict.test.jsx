import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { editorQuit } from '~/services/editorQuit.mjs'
import { readEditorDraft, removeEditorDraft } from '~/services/editorDraftCache'

const fixture = vi.hoisted(() => ({ changeBody: null, changeField: null }))
vi.mock('~/services/api', () => ({ api: vi.fn() }))
// The original TextEditor, conflict dialog, pending registry and hook are real.
// This narrow input fixture models a Decorator whose local field is remounted
// when a different body is loaded, without mocking save/adoption decisions.
vi.mock('./Editor/Editor', async () => {
  const { useEditorPendingDraft } = await import('./Editor/hooks/useEditorPendingDraft')
  function PendingField() {
    const [value, setValue] = React.useState('')
    fixture.changeField = setValue
    useEditorPendingDraft({
      nodeKey: 'formula-conflict-fixture', label: '公式', dirty: value !== '', value,
      discard: () => setValue(''),
    })
    return <input aria-label="未应用公式字段" value={value} onChange={event => setValue(event.target.value)} />
  }
  return { default: ({ initialContent, onChange }) => {
    fixture.changeBody = onChange
    return <div><pre data-loaded-body>{initialContent}</pre><PendingField key={initialContent} /></div>
  } }
})

const id = 'pending-field-conflict'
let host, root, ref, intervalSave, finishAdoption
const settle = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const field = () => host.querySelector('[aria-label="未应用公式字段"]')
const getCalls = () => api.mock.calls.filter(([, init]) => init?.method !== 'PUT')
const putCalls = () => api.mock.calls.filter(([, init]) => init?.method === 'PUT')
const conflictReceipt = request => ({
  id, title: 'A', content: 'database conflict version', updated_at: 101,
  save_receipt: { request_id: request.save_request_id, reference_pending: false, outcome: 'conflict' },
})

async function click(label) {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent === label)
  expect(button, label).toBeTruthy()
  expect(button.disabled).toBe(false)
  await act(async () => button.click())
  await settle()
}

async function editBody() {
  await act(async () => fixture.changeBody('my current body draft'))
  await settle()
}

async function editField(value) {
  await act(async () => {
    const input = field()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
  expect(ref.current.hasUnappliedDrafts()).toBe(true)
}

async function produceConflict() {
  expect(intervalSave).toBeTypeOf('function')
  await act(async () => intervalSave())
  await settle()
  expect(putCalls()).toHaveLength(1)
  expect(ref.current.getReferenceRefactorState().currentContent).toBe('my current body draft')
  expect(host.textContent).toContain('处理保存冲突')
}

function currentDraftState() {
  return {
    body: ref.current.getReferenceRefactorState().currentContent,
    field: field().value,
    unapplied: ref.current.hasUnappliedDrafts(),
    exitDraft: editorQuit.hasDraft(id),
    cachedBody: readEditorDraft(id)?.content,
  }
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await import('./Editor/Editor')
  localStorage.clear()
  removeEditorDraft(id); editorQuit.forget(id)
  intervalSave = null; finishAdoption = null
  const originalInterval = window.setInterval.bind(window)
  vi.spyOn(window, 'setInterval').mockImplementation((callback, ms, ...args) => {
    if (ms === 30000) intervalSave = callback
    return originalInterval(callback, ms, ...args)
  })
  // These tests intentionally create a terminal CAS conflict. Preserve the
  // existing error path without treating its expected log as an unhandled error.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  api.mockReset()
  api.mockImplementation(async (_path, init) => init?.method === 'PUT'
    ? conflictReceipt(JSON.parse(init.body))
    : { id, title: 'A', content: 'database original body', updated_at: 100 })
  host = document.createElement('div'); host.id = 'root'; document.body.append(host)
  root = createRoot(host); ref = React.createRef()
  await act(async () => root.render(<TextEditor ref={ref} activeId={id} deletedIds={new Set()} autoSaveOnSwitch={false} />))
  await settle()
  expect(field()).toBeTruthy()
  expect(ref.current.hasUnappliedDrafts()).toBe(false)
})

afterEach(async () => {
  if (finishAdoption) await act(async () => finishAdoption({ id, title: 'A', content: 'database adopted body', updated_at: 102 }))
  await act(async () => root.unmount())
  host.remove(); removeEditorDraft(id); editorQuit.forget(id)
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('database adoption refuses existing unapplied fields before issuing its refresh read', async () => {
  await editBody()
  await editField('formula draft before adoption')
  await produceConflict()
  // A normal body autosave remains allowed despite the unapplied field.
  expect(JSON.parse(putCalls()[0][1].body).content).toBe('my current body draft')
  await click('处理保存冲突')
  const readsBefore = getCalls().length
  api.mockImplementation(async (_path, init) => init?.method === 'PUT'
    ? conflictReceipt(JSON.parse(init.body))
    : { id, title: 'A', content: 'database adopted body', updated_at: 102 })
  await click('采用数据库正文')
  expect({ reads: getCalls().length, ...currentDraftState() }).toEqual({
    reads: readsBefore,
    body: 'my current body draft', field: 'formula draft before adoption',
    unapplied: true, exitDraft: true, cachedBody: 'my current body draft',
  })
  expect(document.body.textContent).toContain('完成或取消')
})

it('a field that becomes unapplied while adoption waits cannot be lost to the late database response', async () => {
  await editBody()
  await produceConflict()
  await click('处理保存冲突')
  api.mockImplementation((_path, init) => init?.method === 'PUT'
    ? Promise.resolve(conflictReceipt(JSON.parse(init.body)))
    : new Promise(resolve => { finishAdoption = resolve }))
  await click('采用数据库正文')
  expect(finishAdoption).toBeTypeOf('function')
  // Model a deferred component update rather than claiming physical typing
  // can pass through the conflict dialog's inert root while its GET is pending.
  await act(async () => fixture.changeField('formula draft accepted during the read'))
  await settle()
  expect(ref.current.hasUnappliedDrafts()).toBe(true)
  const finish = finishAdoption; finishAdoption = null
  await act(async () => finish({ id, title: 'A', content: 'database adopted body', updated_at: 102 }))
  await settle()
  expect(currentDraftState()).toEqual({
    body: 'my current body draft', field: 'formula draft accepted during the read',
    unapplied: true, exitDraft: true, cachedBody: 'my current body draft',
  })
  expect(putCalls()).toHaveLength(1)
  expect(document.body.textContent).toContain('完成或取消')
})

it('restoring the field to its committed value releases adoption and a deliberate retry reads the database without another PUT', async () => {
  await editBody(); await editField('pending field'); await produceConflict()
  await click('处理保存冲突'); await click('采用数据库正文')
  expect(ref.current.hasUnappliedDrafts()).toBe(true)
  await click('暂不处理')
  await act(async () => {
    const input = field()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
  expect(ref.current.hasUnappliedDrafts()).toBe(false)
  api.mockImplementation(async (_path, init) => init?.method === 'PUT'
    ? conflictReceipt(JSON.parse(init.body))
    : { id, title: 'A', content: 'database adopted body', updated_at: 102 })
  await click('处理保存冲突'); await click('采用数据库正文')
  expect(currentDraftState()).toEqual({
    body: 'database adopted body', field: '', unapplied: false,
    exitDraft: false, cachedBody: undefined,
  })
  expect(putCalls()).toHaveLength(1)
  await expect(editorQuit.flush()).resolves.toBeUndefined()
})
