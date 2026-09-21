import { describe, expect, it } from 'vitest'

import { getCollapsedOutlineKeys } from './DocumentOutlinePlugin'
import { clampTableColumnWidth } from './TableColumnResizePlugin'
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
})
