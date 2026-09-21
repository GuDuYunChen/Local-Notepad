import { describe, expect, it } from 'vitest'
import {
  buildLibraryTree,
  compareLibraryItems,
  findFirstFileInFolder,
  findFirstFileInTree,
  getFolderPathLabel,
} from './fileTreeUtils'

describe('file tree utilities', () => {
  it('builds a stable sorted tree with pinned and newest-first siblings', () => {
    const items = [
      { id: 'old', title: '旧笔记', parent_id: '', is_folder: false, sort_order: 0, created_at: 1 },
      { id: 'folder', title: '资料', parent_id: '', is_folder: true, sort_order: 5, created_at: 2 },
      { id: 'new', title: '新笔记', parent_id: '', is_folder: false, sort_order: 0, created_at: 9 },
      { id: 'child-old', title: '子旧', parent_id: 'folder', is_folder: false, sort_order: 0, created_at: 3 },
      { id: 'child-new', title: '子新', parent_id: 'folder', is_folder: false, sort_order: 0, created_at: 8 },
      { id: 'pinned', title: '置顶', parent_id: '', is_folder: false, sort_order: 1, created_at: 1, is_pinned: true },
    ]

    const tree = buildLibraryTree(items)
    expect(tree.map(item => item.id)).toEqual(['pinned', 'folder', 'new', 'old'])
    expect(tree.find(item => item.id === 'folder').children.map(item => item.id)).toEqual([
      'child-new',
      'child-old',
    ])
    expect(findFirstFileInTree(tree)?.id).toBe('pinned')
    expect(findFirstFileInFolder(tree, 'folder')?.id).toBe('child-new')
  })

  it('builds a human-readable folder path and tolerates malformed parent cycles', () => {
    const items = [
      { id: 'a', title: 'A', parent_id: 'b' },
      { id: 'b', title: 'B', parent_id: 'a' },
      { id: 'c', title: 'C', parent_id: '' },
    ]

    expect(getFolderPathLabel(items, 'c')).toBe('C')
    expect(getFolderPathLabel(items, 'a')).toMatch(/A/)
    expect(compareLibraryItems(
      { id: 'new', created_at: 2 },
      { id: 'old', created_at: 1 },
    )).toBeLessThan(0)
  })
})
