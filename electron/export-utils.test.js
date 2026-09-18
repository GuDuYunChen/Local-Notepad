import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  codeBlockText,
  embedLocalImagesInLexical,
  fetchAllFileMetadata,
  headingLevel,
  indexChildrenByParent,
  isLocalUploadUrl,
  listItemText,
  localUploadToDataUri,
  materializeLocalAssetsInLexical,
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

  it('identifies only local app upload URLs as embeddable assets', () => {
    expect(isLocalUploadUrl('http://127.0.0.1:27121/uploads/a.png')).toBe(true)
    expect(isLocalUploadUrl('http://localhost:27121/uploads/a.png')).toBe(true)
    expect(isLocalUploadUrl('https://example.com/uploads/a.png')).toBe(false)
    expect(isLocalUploadUrl('data:image/png;base64,AA==')).toBe(false)
  })

  it('embeds local images as data URIs without fetching external images', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    })

    const dataUri = await localUploadToDataUri(
      'http://127.0.0.1:27121/uploads/a.png',
      fetchImpl
    )
    expect(dataUri).toBe('data:image/png;base64,AQID')

    const external = await localUploadToDataUri('https://example.com/a.png', fetchImpl)
    expect(external).toBe('https://example.com/a.png')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rewrites image and image-grid sources inside Lexical content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => Uint8Array.from([255, 216, 255]).buffer,
    })
    const content = JSON.stringify({
      root: {
        children: [
          { type: 'image', src: 'http://127.0.0.1:27121/uploads/a.jpg' },
          {
            type: 'image-grid',
            items: [
              { src: 'http://127.0.0.1:27121/uploads/b.jpg' },
              { src: 'https://example.com/c.jpg' },
            ],
          },
        ],
      },
    })

    const rewritten = JSON.parse(await embedLocalImagesInLexical(content, fetchImpl))
    expect(rewritten.root.children[0].src).toMatch(/^data:image\/jpeg;base64,/)
    expect(rewritten.root.children[1].items[0].src).toMatch(/^data:image\/jpeg;base64,/)
    expect(rewritten.root.children[1].items[1].src).toBe('https://example.com/c.jpg')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('copies local Markdown assets and rewrites them to relative paths', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-md-export-'))
    try {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Uint8Array.from([7, 8, 9]).buffer,
      })
      const content = JSON.stringify({
        root: {
          children: [
            { type: 'image', src: 'http://127.0.0.1:27121/uploads/photo.png' },
            { type: 'video', src: 'http://127.0.0.1:27121/uploads/movie.mp4' },
            { type: 'image', src: 'https://example.com/external.png' },
          ],
        },
      })

      const rewritten = JSON.parse(await materializeLocalAssetsInLexical(
        content,
        outputDir,
        'Note_assets',
        fetchImpl
      ))

      expect(rewritten.root.children[0].src).toBe('./Note_assets/photo.png')
      expect(rewritten.root.children[1].src).toBe('./Note_assets/movie.mp4')
      expect(rewritten.root.children[2].src).toBe('https://example.com/external.png')
      expect(fs.readFileSync(path.join(outputDir, 'Note_assets', 'photo.png'))).toEqual(Buffer.from([7, 8, 9]))
      expect(fs.readFileSync(path.join(outputDir, 'Note_assets', 'movie.mp4'))).toEqual(Buffer.from([7, 8, 9]))
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('keeps WikiLink labels in recursive text extraction', () => {
    expect(plainTextFromNode({
      type: 'paragraph',
      children: [
        { type: 'text', text: 'See ' },
        { type: 'wiki-link', id: 'target', title: 'Target note' },
      ],
    })).toBe('See [[Target note]]')
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
