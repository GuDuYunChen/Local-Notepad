import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import CollectionReadingBar from './CollectionReadingBar'
import { collectionFixture } from '../test/collectionFixtures'
import { createCollectionReadingContext } from '../services/collectionReading'

let host, root, fixture, origin, onOpenFile, onMove, onReturn, onEnd
const button = text => [...host.querySelectorAll('button')].find(node => node.textContent === text)
const click = text => act(async () => button(text).click())
const render = (props = {}) => act(async () => root.render(<CollectionReadingBar origin={origin} documentId={origin.documentId}
  store={fixture.store} onOpenFile={onOpenFile} onMove={onMove} onReturn={onReturn} onEnd={onEnd} {...props} />))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); fixture = collectionFixture()
  origin = createCollectionReadingContext(fixture.entry, null, { query: '', status: 'all' }, 'n7')
  onOpenFile = vi.fn().mockResolvedValue(true); onMove = vi.fn(); onReturn = vi.fn(); onEnd = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('shows the position and moves by full-queue identity across a page boundary', async () => {
  await render(); expect(host.textContent).toContain('第 8 / 23 篇'); await click('下一资料')
  expect(onOpenFile).toHaveBeenCalledWith('n8', expect.objectContaining({ shouldSelect: expect.any(Function), signal: expect.anything() }))
  expect(onMove).toHaveBeenCalledWith(origin, expect.objectContaining({ documentId: 'n8', index: 8 }))
})
it('moves back without wrapping or changing the saved collection', async () => {
  await render(); await click('上一资料'); expect(onMove.mock.calls[0][1].documentId).toBe('n6')
  expect(fixture.store.list().entries[0].raw).toBe(fixture.entry.raw)
})
it('cancelled opens keep the index and never skip to another entry', async () => {
  onOpenFile.mockResolvedValue(false); await render({ dirty: true }); await click('下一资料')
  expect(onMove).not.toHaveBeenCalled(); expect(host.textContent).toContain('第 8 / 23 篇'); expect(host.textContent).toContain('不自动跳过')
  await click('下一资料'); expect(onOpenFile.mock.calls.map(call => call[0])).toEqual(['n8', 'n8'])
})
it('rejected transport leaves the queue and gives a retryable error', async () => {
  onOpenFile.mockRejectedValue(new Error('temporary failure')); await render(); await click('下一资料')
  expect(host.textContent).toContain('temporary failure'); expect(onMove).not.toHaveBeenCalled()
})
it('locks navigation during the save dialog without allowing a duplicate open', async () => {
  let finish; onOpenFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render(); await click('下一资料'); expect(button('返回资料集').disabled).toBe(true)
  await click('下一资料'); expect(onOpenFile).toHaveBeenCalledOnce()
  await act(async () => finish(false)); expect(button('下一资料').disabled).toBe(false)
})
it('end and return do not open a note or discard the draft', async () => {
  await render({ dirty: true }); await click('返回资料集'); await click('结束资料集阅读')
  expect(onReturn).toHaveBeenCalledOnce(); expect(onEnd).toHaveBeenCalledOnce(); expect(onOpenFile).not.toHaveBeenCalled()
})
it('hides on unrelated documents and ignores late accepted opens after unmount', async () => {
  let finish; onOpenFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render(); await click('下一资料'); const signal = onOpenFile.mock.calls[0][1].signal
  await render({ documentId: 'unrelated' }); expect(host.textContent).toBe(''); expect(signal.aborted).toBe(true)
  await act(async () => finish(true)); expect(onMove).not.toHaveBeenCalled()
})
it('opening another modal cancels the pending navigation generation', async () => {
  let finish; onOpenFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render(); await click('下一资料'); await render({ paused: true })
  expect(onOpenFile.mock.calls[0][1].signal.aborted).toBe(true)
  await act(async () => finish(true)); expect(onMove).not.toHaveBeenCalled()
})
it('source deletion invalidates the guard before approval and disables navigation', async () => {
  let finish; onOpenFile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render(); await click('下一资料'); const guard = onOpenFile.mock.calls[0][1]
  await act(async () => fixture.store.remove(fixture.entry))
  expect(guard.shouldSelect()).toBe(false); expect(guard.signal.aborted).toBe(true)
  await act(async () => finish(true)); expect(onMove).not.toHaveBeenCalled(); expect(host.textContent).toContain('连续阅读已停用')
})
it('catches source changes even without a native storage event', async () => {
  await render(); fixture.storage.setItem(fixture.key, fixture.entry.raw + ' '); await click('下一资料')
  expect(onOpenFile).not.toHaveBeenCalled(); expect(host.textContent).toContain('更改或删除')
})
it('reacts to window focus and source storage notifications', async () => {
  await render(); fixture.storage.removeItem(fixture.key)
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(button('下一资料').disabled).toBe(true); expect(button('返回资料集').disabled).toBe(false)
})
it('disables exactly the first and last queue boundaries', async () => {
  origin = createCollectionReadingContext(fixture.entry, null, { query: '', status: 'all' }, 'n0')
  await render(); expect(button('上一资料').disabled).toBe(true); expect(button('下一资料').disabled).toBe(false)
  origin = createCollectionReadingContext(fixture.entry, null, { query: '', status: 'all' }, 'n22')
  await render(); expect(button('下一资料').disabled).toBe(true); expect(button('上一资料').disabled).toBe(false)
})
