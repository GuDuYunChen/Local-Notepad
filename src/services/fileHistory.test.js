import { describe, expect, it, vi } from 'vitest'
import { executeFileHistoryAction } from './fileHistory'

describe('executeFileHistoryAction', () => {
  it('undoes and redoes create using delete then restore', async () => {
    const request = vi.fn().mockResolvedValue({})

    await executeFileHistoryAction({ type: 'create', data: { id: 'file-1' } }, 'undo', request)
    await executeFileHistoryAction({ type: 'create', data: { id: 'file-1' } }, 'redo', request)

    expect(request).toHaveBeenNthCalledWith(1, '/api/files/file-1', { method: 'DELETE' })
    expect(request).toHaveBeenNthCalledWith(2, '/api/files/file-1/restore', { method: 'POST' })
  })

  it('undoes and redoes delete using restore then delete', async () => {
    const request = vi.fn().mockResolvedValue({})

    await executeFileHistoryAction({ type: 'delete', data: { id: 'file-2' } }, 'undo', request)
    await executeFileHistoryAction({ type: 'delete', data: { id: 'file-2' } }, 'redo', request)

    expect(request).toHaveBeenNthCalledWith(1, '/api/files/file-2/restore', { method: 'POST' })
    expect(request).toHaveBeenNthCalledWith(2, '/api/files/file-2', { method: 'DELETE' })
  })

  it('uses old and new values for rename and move', async () => {
    const request = vi.fn().mockResolvedValue({})
    const rename = {
      type: 'rename',
      data: { id: 'file-3', oldTitle: 'Old', newTitle: 'New' },
    }
    const move = {
      type: 'move',
      data: {
        id: 'file-4',
        oldParentId: 'a',
        newParentId: 'b',
        oldSortOrder: 1,
        newSortOrder: 9,
      },
    }

    await executeFileHistoryAction(rename, 'undo', request)
    await executeFileHistoryAction(rename, 'redo', request)
    await executeFileHistoryAction(move, 'undo', request)
    await executeFileHistoryAction(move, 'redo', request)

    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ title: 'Old' })
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ title: 'New' })
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ parent_id: 'a', sort_order: 1 })
    expect(JSON.parse(request.mock.calls[3][1].body)).toEqual({ parent_id: 'b', sort_order: 9 })
  })

  it('rejects invalid history actions', async () => {
    await expect(executeFileHistoryAction(null, 'undo', vi.fn())).rejects.toThrow('无效的文件历史操作')
    await expect(executeFileHistoryAction({ type: 'unknown', data: { id: 'x' } }, 'undo', vi.fn()))
      .rejects.toThrow('不支持的文件历史操作')
  })
})
