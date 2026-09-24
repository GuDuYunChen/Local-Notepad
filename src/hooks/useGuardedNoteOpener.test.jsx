import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import useGuardedNoteOpener from './useGuardedNoteOpener'
import { api } from '~/services/api'
import { toast } from '~/services/toast'
vi.mock('~/services/api', () => ({ api: vi.fn() }))
let host, root, open, epoch
function Harness(props) { open = useGuardedNoteOpener({ currentId: 'c1', workspace: 'notes', navigationEpoch: epoch, ...props }); return null }
const render = props => act(async () => root.render(<Harness {...props} />))
const drain = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); api.mockReset()
  vi.spyOn(toast, 'error').mockImplementation(() => {})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); epoch = { current: 0 }
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('guarded chapter opens', () => {
  it('resolves only after the save/discard guard confirms or cancels', async () => {
    api.mockResolvedValue({ id: 'c2' }); let guard
    await render({ onSelectFile: (_file, options) => { guard = options } })
    const result = open('c2'); await drain()
    let settled = false; result.then(() => { settled = true }); await drain(); expect(settled).toBe(false)
    guard.onCancel(); expect(await result).toBe(false)
  })
  it('passes headings through only after accepted selection', async () => {
    api.mockResolvedValue({ id: 'c2' }); const onHeading = vi.fn()
    await render({ onSelectFile: (_file, options) => options.afterSelect(), onHeading })
    expect(await open('c2', { headingPath: ['身世'] })).toBe(true)
    expect(onHeading).toHaveBeenCalledWith('c2', ['身世'], false)
  })
  it('uses the newest draft guard when typing happens during file retrieval', async () => {
    let resolve; api.mockImplementation(() => new Promise(yes => { resolve = yes }))
    const oldGuard = vi.fn(); let newest
    await render({ onSelectFile: oldGuard }); const result = open('c2'); await drain()
    await render({ onSelectFile: (_file, options) => { newest = options } })
    await act(async () => { resolve({ id: 'c2' }); await Promise.resolve() })
    expect(oldGuard).not.toHaveBeenCalled(); newest.onCancel(); expect(await result).toBe(false)
  })
  it('older fetch completion cannot reopen a chapter after a later request', async () => {
    const resolvers = []; api.mockImplementation(() => new Promise(yes => resolvers.push(yes)))
    const selected = vi.fn((_file, options) => options.afterSelect())
    await render({ onSelectFile: selected }); const first = open('c2'); await drain(); const second = open('c3'); await drain()
    resolvers[0]({ id: 'c2' }); resolvers[1]({ id: 'c3' }); await drain()
    expect(await first).toBe(false); expect(await second).toBe(true)
    expect(selected).toHaveBeenCalledTimes(1); expect(selected.mock.calls[0][0].id).toBe('c3')
  })
  it('unrelated navigation invalidates an outstanding response and dialog action', async () => {
    api.mockResolvedValue({ id: 'c2' }); let guard
    await render({ onSelectFile: (_file, options) => { guard = options } })
    const result = open('c2'); await drain(); epoch.current++
    await render({ currentId: 'other', onSelectFile: vi.fn() })
    expect(await result).toBe(false); expect(guard.shouldSelect()).toBe(false)
  })
  it('handles deleted wrong-identity and folder targets without selecting', async () => {
    const selected = vi.fn(); await render({ onSelectFile: selected })
    for (const file of [{ id: 'c2', is_deleted: true }, { id: 'other' }, { id: 'c2', is_folder: true }, null]) {
      api.mockResolvedValue(file); expect(await open('c2')).toBe(false)
    }
    expect(selected).not.toHaveBeenCalled()
  })
  it('reports active errors but never stale abort errors', async () => {
    api.mockRejectedValue(new Error('offline')); await render({ onSelectFile: vi.fn() })
    expect(await open('c2')).toBe(false); expect(toast.error).toHaveBeenCalledTimes(1)
  })
  it('unmounting resolves the pending decision and aborts its request', async () => {
    let signal; api.mockImplementation((_path, options) => { signal = options.signal; return new Promise(() => {}) })
    await render({ onSelectFile: vi.fn() }); const result = open('c2'); await drain()
    await act(async () => root.render(null))
    expect(await result).toBe(false); expect(signal.aborted).toBe(true)
  })
})

 it('encodes imported note IDs as a single URL path segment before the existing identity guard', async () => {
    const id = 'note/with?query#fragment'
    api.mockResolvedValue({ id }); await render({ onSelectFile: (_file, options) => options.afterSelect() })
    expect(await open(id)).toBe(true)
    expect(api.mock.calls[0][0]).toBe('/api/files/' + encodeURIComponent(id))
  })
