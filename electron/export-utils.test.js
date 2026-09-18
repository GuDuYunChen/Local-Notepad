import { describe, expect, it, vi } from 'vitest'
import {
  codeBlockText,
  fetchAllFileMetadata,
  headingLevel,
  indexChildrenByParent,
  listItemText,
  plainTextFromNode,
  safeExportStem,
} from './export-utils.js'

function response(data) {
  return {
    ok: true,
    statusText: 'OK',
    json: async () => ({ code: 0, message: 'OK', data }),
  }
}

describe('export helpers', () => {
  it('removes the original extension before adding an export format', () => {
    expect(safeExportStem('notes.md')).toBe('notes')
    expect(safeExportStem('report.txt')).toBe('report')
    expect(safeExportStem('bad:name?.md')).toBe('bad_name_')
    expect(safeExportStem('README')).toBe('README')
  })

  it('reads custom code block text from the serialized code field', () => {
    expect(codeBlockText({ type: 'code-block', code: 'const x = 1;' })).toBe('const x = 1;')
    expect(codeBlockText({
      type: 'code-block',
      children: [{ type: 'text', text: 'legacy' }],
    })).toBe('legacy')
  })

  it('derives heading levels from Lexical heading tags', () => {
    expect(headingLevel({ tag: 'h1' })).toBe(1)
    expect(headingLevel({ tag: 'h4' })).toBe(4)
    expect(headingLevel({ level: 3 })).toBe(3)
  })

  it('extracts text recursively from table and list containers', () => {
    const node = {
      type: 'tablecell',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Cell ' },
            { type: 'text', text: 'value' },
          ],
        },
      ],
    }
    expect(plainTextFromNode(node)).toBe('Cell value')
  })

  it('extracts list item text without duplicating nested lists', () => {
    const item = {
      type: 'listitem',
      children: [
        { type: 'paragraph', children: [{ type: 'text', text: 'Parent item' }] },
        {
          type: 'list',
          children: [
            { type: 'listitem', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Nested' }] }] },
          ],
        },
      ],
    }
    expect(listItemText(item)).toBe('Parent item')
  })

  it('loads every metadata page once with compact responses', async () => {
    const first = Array.from({ length: 200 }, (_, index) => ({
      id: `file-${index}`,
      parent_id: '',
    }))
    const second = [
      { id: 'file-199', parent_id: '' },
      { id: 'file-200', parent_id: 'folder-1' },
    ]
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(first))
      .mockResolvedValueOnce(response(second))

    const files = await fetchAllFileMetadata(fetchImpl, 'http://127.0.0.1:27121')

    expect(files).toHaveLength(201)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toContain('page=1')
    expect(fetchImpl.mock.calls[0][0]).toContain('size=200')
    expect(fetchImpl.mock.calls[0][0]).toContain('compact=1')
    expect(fetchImpl.mock.calls[1][0]).toContain('page=2')
  })

  it('indexes folder children without losing root files', () => {
    const index = indexChildrenByParent([
      { id: 'root-note', parent_id: '' },
      { id: 'child-a', parent_id: 'folder' },
      { id: 'child-b', parent_id: 'folder' },
    ])

    expect(index.get('').map(file => file.id)).toEqual(['root-note'])
    expect(index.get('folder').map(file => file.id)).toEqual(['child-a', 'child-b'])
  })
})
