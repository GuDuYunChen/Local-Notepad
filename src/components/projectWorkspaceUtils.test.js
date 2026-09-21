import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildProjectWorkspace,
  calculateProjectCardMove,
  getProjectCandidates,
  getProjectExportIds,
  getVolumeExportIds,
  nextProjectStatus,
  readProjectWorkspaceMeta,
  writeProjectWorkspaceMeta,
} from './projectWorkspaceUtils'

function lexical(text) {
  return JSON.stringify({
    root: {
      children: [{
        type: 'paragraph',
        children: [{ type: 'text', text }],
      }],
    },
  })
}

const files = [
  { id: 'project', title: '长篇小说', is_folder: true, parent_id: '', sort_order: 100 },
  { id: 'volume-1', title: '第一卷', is_folder: true, parent_id: 'project', sort_order: 100 },
  { id: 'volume-2', title: '第二卷', is_folder: true, parent_id: 'project', sort_order: 200 },
  { id: 'chapter-1', title: '第一章.md', is_folder: false, parent_id: 'volume-1', sort_order: 100, content: lexical('一二三'), updated_at: 10 },
  { id: 'chapter-2', title: '第二章.md', is_folder: false, parent_id: 'volume-1', sort_order: 200, is_pinned: true, content: lexical('四五'), updated_at: 20 },
  { id: 'chapter-3', title: '第三章.md', is_folder: false, parent_id: 'volume-2', sort_order: 100, content: lexical('六'), updated_at: 30 },
  { id: 'loose', title: '序章.md', is_folder: false, parent_id: 'project', sort_order: 50, content: lexical('序章'), updated_at: 5 },
  { id: 'other', title: '其他项目', is_folder: true, parent_id: '', sort_order: 50 },
]

describe('project workspace utilities', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('discovers root folders as compatible projects', () => {
    const projects = getProjectCandidates(files)

    expect(projects.map(project => project.id)).toEqual(['project', 'other'])
    expect(projects[0]).toMatchObject({
      noteCount: 4,
      volumeCount: 2,
    })
  })

  it('builds project volumes cards word counts and update stats', () => {
    const workspace = buildProjectWorkspace(files, 'project', {
      type: 'novel',
      statuses: {
        'chapter-2': 'done',
      },
    })

    expect(workspace.project).toMatchObject({
      id: 'project',
      type: 'novel',
    })
    expect(workspace.chapterCount).toBe(4)
    expect(workspace.volumeCount).toBe(2)
    expect(workspace.volumes.map(volume => volume.title)).toEqual([
      '未分卷',
      '第一卷',
      '第二卷',
    ])
    expect(workspace.volumes[1].notes.map(note => note.id)).toEqual([
      'chapter-1',
      'chapter-2',
    ])
    expect(workspace.volumes[1].notes[1].status).toBe('done')
    expect(workspace.totalWords).toBe(8)
    expect(workspace.volumes[1].updatedAt).toBe(20)
  })

  it('keeps pinned notes in manuscript order instead of sidebar order', () => {
    const workspace = buildProjectWorkspace(files, 'project', {})
    expect(workspace.volumes[1].notes.map(note => note.id)).toEqual([
      'chapter-1',
      'chapter-2',
    ])
  })

  it('persists project type and per-note status without schema changes', () => {
    writeProjectWorkspaceMeta('project', {
      type: 'script',
      statuses: {
        'chapter-1': 'review',
      },
    })

    expect(readProjectWorkspaceMeta('project')).toEqual({
      type: 'script',
      statuses: {
        'chapter-1': 'review',
      },
    })
    expect(nextProjectStatus('draft')).toBe('review')
    expect(nextProjectStatus('review')).toBe('done')
    expect(nextProjectStatus('done')).toBe('draft')
  })

  it('calculates a chapter move across volume folders', () => {
    const patch = calculateProjectCardMove(
      files,
      'chapter-2',
      'volume-2',
      1,
    )

    expect(patch).toMatchObject({
      id: 'chapter-2',
      parent_id: 'volume-2',
    })
    expect(Number.isFinite(patch.sort_order)).toBe(true)
    expect(patch.sort_order).toBeGreaterThan(100)
  })

  it('adjusts same-volume downward moves after removing the dragged card', () => {
    const sameVolume = [
      ...files,
      {
        id: 'chapter-4',
        title: '第四章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 300,
        content: lexical('七'),
      },
    ]

    const patch = calculateProjectCardMove(
      sameVolume,
      'chapter-1',
      'volume-1',
      2,
    )

    expect(patch.sort_order).toBeGreaterThan(200)
    expect(patch.sort_order).toBeLessThan(300)
  })

  it('returns a deterministic rebalance plan when adjacent sort orders have no gap', () => {
    const tight = [
      { id: 'project', title: '项目', is_folder: true, parent_id: '', sort_order: 1 },
      { id: 'volume', title: '第一卷', is_folder: true, parent_id: 'project', sort_order: 1 },
      { id: 'a', title: 'A.md', is_folder: false, parent_id: 'volume', sort_order: 100, content: lexical('A') },
      { id: 'b', title: 'B.md', is_folder: false, parent_id: 'volume', sort_order: 101, content: lexical('B') },
      { id: 'c', title: 'C.md', is_folder: false, parent_id: 'volume', sort_order: 300, content: lexical('C') },
    ]

    const patch = calculateProjectCardMove(
      tight,
      'c',
      'volume',
      1,
    )

    expect(patch.rebalance).toEqual([
      expect.objectContaining({ id: 'a', sort_order: 1000 }),
      expect.objectContaining({ id: 'c', sort_order: 2000 }),
      expect.objectContaining({ id: 'b', sort_order: 3000 }),
    ])
  })

  it('returns export ids in project reading order', () => {
    const workspace = buildProjectWorkspace(files, 'project', {})

    expect(getVolumeExportIds(workspace.volumes[1])).toEqual([
      'chapter-1',
      'chapter-2',
    ])
    expect(getProjectExportIds(workspace)).toEqual([
      'loose',
      'chapter-1',
      'chapter-2',
      'chapter-3',
    ])
  })
})
