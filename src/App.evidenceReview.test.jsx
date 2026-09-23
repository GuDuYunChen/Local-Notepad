import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import App from './App'
import { api } from '~/services/api'
import { evidenceReview } from '~/services/evidenceReviewSession'

const mocks = vi.hoisted(() => ({ clear: vi.fn(), selectFile: null }))
vi.mock('~/services/api', () => ({ api: vi.fn(), createFileVersionSnapshot: vi.fn(), listAllFilesWithContent: vi.fn() }))
vi.mock('./components/FileList', () => ({ default: ({ onSelect }) => { mocks.selectFile = onSelect; return null } }))
vi.mock('./components/WorkspaceSidebar', () => ({ default: ({ onChangeWorkspace, children }) => <aside><button onClick={() => onChangeWorkspace('projects')}>进入项目</button>{children}</aside> }))
vi.mock('./components/ProjectWorkspacePanel', () => ({ default: ({ onOpenFile }) => <button onClick={() => onOpenFile('b')}>打开下一章</button> }))
vi.mock('./components/TextEditor', () => ({ default: React.forwardRef(function Draft({ activeId, onLoaded, onChange, onStatusChange }, ref) {
  React.useEffect(() => { if (activeId) { onLoaded?.('已存正文'); onStatusChange?.({ dirty: false }) } }, [activeId])
  React.useImperativeHandle(ref, () => ({ clearCache: mocks.clear, save: () => null }))
  return activeId ? <button onClick={() => { onChange('草稿修改'); onStatusChange?.({ dirty: true }) }}>编辑正文</button> : null
}) }))
let root, container
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers(); api.mockReset(); mocks.clear.mockClear(); localStorage.clear(); evidenceReview.end()
  api.mockResolvedValue({ id: 'b', title: '第二章.md', content: '已存正文' })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await act(async () => { vi.advanceTimersByTime(110) })
  await act(async () => { mocks.selectFile({ id: 'a', title: '第一章.md', content: '已存正文' }) })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); evidenceReview.end(); vi.useRealTimers(); vi.unstubAllGlobals() })
const button = text => [...container.querySelectorAll('button')].find(e => e.textContent === text)
const click = async text => { expect(button(text)).toBeTruthy(); await act(async () => button(text).click()) }

it('discarding before leaving notes clears the old dirty state, so the next open does not prompt again', async () => {
  await click('编辑正文'); await click('进入项目')
  expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  await click('不保存')
  expect(mocks.clear).toHaveBeenCalledOnce()
  await click('打开下一章')
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  expect(container.querySelector('.workspace-title-button').textContent).toBe('第二章.md')
})

it('cancelled evidence return leaves both the draft and the return request unconsumed', async () => {
  let session
  await act(async () => { session = evidenceReview.start({ projectId: 'p', entityId: 'e' }, [{ id: 'a' }], 'a') })
  await click('编辑正文'); await click('返回证据列表'); await click('取消')
  expect(evidenceReview.getSnapshot().id).toBe(session.id)
  expect(evidenceReview.getReturn()).toBeNull()
  expect(container.querySelector('.workspace-save-chip').textContent).toBe('未保存')
  await click('返回证据列表'); await click('不保存')
  expect(evidenceReview.getReturn()?.id).toBe(session.id)
  expect(button('打开下一章')).toBeTruthy()
})
