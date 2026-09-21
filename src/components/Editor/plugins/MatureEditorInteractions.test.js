import { describe, expect, it } from 'vitest'

import { findOutlineHeadingForKey, getCollapsedOutlineKeys } from './DocumentOutlinePlugin'
import { clampTableColumnWidth } from './TableColumnResizePlugin'
import { countSelectedTableCells, parseTableTSV, tableMatrixToTSV } from './TableSelectionPlugin'
import { getEditorShortcut } from './EditorShortcutPlugin'
import { matchFormulaShortcut } from './FormulaShortcutPlugin'
import { getChecklistEnterAction } from './ChecklistKeyboardPlugin'
import { reorderImageGridItems } from '../nodes/ImageGridNode'
import { getAttachmentPreviewType } from '../nodes/AttachmentNode'

describe('mature editor interactions', () => {
  it('collapses only the section under the selected heading', () => {
    const nodes = [
      { key: 'h1', isHeading: true, level: 1 },
      { key: 'p1', isHeading: false, level: null },
      { key: 'h2a', isHeading: true, level: 2 },
      { key: 'p2', isHeading: false, level: null },
      { key: 'h3', isHeading: true, level: 3 },
      { key: 'p3', isHeading: false, level: null },
      { key: 'h2b', isHeading: true, level: 2 },
      { key: 'p4', isHeading: false, level: null },
      { key: 'h1b', isHeading: true, level: 1 },
    ]

    expect([...getCollapsedOutlineKeys(nodes, new Set(['h2a']))]).toEqual([
      'p2',
      'h3',
      'p3',
    ])

    expect([...getCollapsedOutlineKeys(nodes, new Set(['h1']))]).toEqual([
      'p1',
      'h2a',
      'p2',
      'h3',
      'p3',
      'h2b',
      'p4',
    ])
  })

  it('reorders image grid items without mutating the original list', () => {
    const original = [
      { src: 'a.jpg' },
      { src: 'b.jpg' },
      { src: 'c.jpg' },
    ]

    const reordered = reorderImageGridItems(original, 0, 2)

    expect(reordered.map(item => item.src)).toEqual(['b.jpg', 'c.jpg', 'a.jpg'])
    expect(original.map(item => item.src)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })

  it('recognizes previewable image PDF and text attachments', () => {
    expect(getAttachmentPreviewType('photo.jpg', '')).toBe('image')
    expect(getAttachmentPreviewType('scan.bin', 'image/png')).toBe('image')
    expect(getAttachmentPreviewType('manual.pdf', '')).toBe('pdf')
    expect(getAttachmentPreviewType('manual.bin', 'application/pdf')).toBe('pdf')
    expect(getAttachmentPreviewType('notes.md', '')).toBe('text')
    expect(getAttachmentPreviewType('trace.bin', 'text/plain')).toBe('text')
    expect(getAttachmentPreviewType('report.docx', '')).toBe('word')
    expect(getAttachmentPreviewType('report.bin', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('word')
    expect(getAttachmentPreviewType('budget.xlsx', '')).toBe('sheet')
    expect(getAttachmentPreviewType('legacy.xls', 'application/vnd.ms-excel')).toBe('sheet')
    expect(getAttachmentPreviewType('archive.zip', 'application/zip')).toBeNull()
  })

  it('keeps table column widths within usable bounds', () => {
    expect(clampTableColumnWidth(20)).toBe(70)
    expect(clampTableColumnWidth(180.4)).toBe(180)
    expect(clampTableColumnWidth(900)).toBe(600)
  })

  it('counts selected table rectangles for the visible multi-select mode', () => {
    expect(countSelectedTableCells([
      { r1: 0, c1: 0, r2: 1, c2: 2 },
      { r1: 3, c1: 1, r2: 3, c2: 1 },
    ])).toBe(7)
  })

  it('maps editor productivity shortcuts without hijacking unrelated keys', () => {
    expect(getEditorShortcut({ ctrlKey: true, metaKey: false, altKey: true, key: 'e' })).toBe('formula')
    expect(getEditorShortcut({ ctrlKey: true, metaKey: false, altKey: true, key: 'T' })).toBe('checklist')
    expect(getEditorShortcut({ ctrlKey: true, metaKey: false, altKey: false, key: 'e' })).toBeNull()
  })

  it('round-trips table clipboard content through TSV helpers', () => {
    const matrix = [
      ['姓名', '备注'],
      ['关关', '含\t制表符'],
      ['阿茂', '多\n行内容'],
    ]

    const tsv = tableMatrixToTSV(matrix)
    expect(tsv).toBe('姓名\t备注\n关关\t含 制表符\n阿茂\t多 行内容')
    expect(parseTableTSV(tsv)).toEqual([
      ['姓名', '备注'],
      ['关关', '含 制表符'],
      ['阿茂', '多 行内容'],
    ])
  })

  it('recognizes safe formula typing shortcuts', () => {
    expect(matchFormulaShortcut('$')).toMatchObject({
      type: 'block',
      expression: '',
    })
    expect(matchFormulaShortcut('前文 $E = mc^2
    const nodes = [
      { key: 'h1', isHeading: true, level: 1, text: '第一章' },
      { key: 'p1', isHeading: false, level: null, text: '' },
      { key: 'h2', isHeading: true, level: 2, text: '细节' },
      { key: 'p2', isHeading: false, level: null, text: '' },
    ]

    expect(findOutlineHeadingForKey(nodes, 'p2')).toMatchObject({ key: 'h2', text: '细节' })
    expect(findOutlineHeadingForKey(nodes, 'p1')).toMatchObject({ key: 'h1', text: '第一章' })
    expect(findOutlineHeadingForKey(nodes, 'missing')).toBeNull()
  })

})
)).toMatchObject({
      type: 'inline',
      expression: 'E = mc^2',
      start: 3,
    })
    expect(matchFormulaShortcut('$12')).toBeNull()
    expect(matchFormulaShortcut('price $12 and more')).toBeNull()
  })

  it('maps checklist Enter behavior for productive task entry', () => {
    expect(getChecklistEnterAction({ ctrlKey: true }, false, '任务')).toBe('toggle')
    expect(getChecklistEnterAction({ metaKey: true }, true, '任务')).toBe('toggle')
    expect(getChecklistEnterAction({}, true, '已完成任务')).toBe('continue')
    expect(getChecklistEnterAction({}, false, '未完成任务')).toBeNull()
    expect(getChecklistEnterAction({}, true, '   ')).toBeNull()
  })

  it('resolves a search hit to its nearest preceding outline heading', () => {
    const nodes = [
      { key: 'h1', isHeading: true, level: 1, text: '第一章' },
      { key: 'p1', isHeading: false, level: null, text: '' },
      { key: 'h2', isHeading: true, level: 2, text: '细节' },
      { key: 'p2', isHeading: false, level: null, text: '' },
    ]

    expect(findOutlineHeadingForKey(nodes, 'p2')).toMatchObject({ key: 'h2', text: '细节' })
    expect(findOutlineHeadingForKey(nodes, 'p1')).toMatchObject({ key: 'h1', text: '第一章' })
    expect(findOutlineHeadingForKey(nodes, 'missing')).toBeNull()
  })

})
