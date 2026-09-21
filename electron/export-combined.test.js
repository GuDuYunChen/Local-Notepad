import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportCombinedManuscript } from './export.js'

function response(data) {
  return {
    ok: true,
    statusText: 'OK',
    json: async () => ({
      code: 0,
      message: 'OK',
      data,
    }),
  }
}

function lexical(text) {
  return JSON.stringify({
    root: {
      children: [{
        type: 'paragraph',
        children: [{
          type: 'text',
          text,
          format: 0,
        }],
      }],
    },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('combined manuscript export', () => {
  it('merges ordered chapter ids into one Markdown manuscript', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-project-export-'))

    try {
      const files = {
        'chapter-2': {
          id: 'chapter-2',
          title: '第二章.md',
          is_folder: false,
          content: JSON.stringify({
            root: {
              children: [{
                type: 'paragraph',
                children: [
                  { type: 'text', text: '第二章正文 ', format: 0 },
                  {
                    type: 'wiki-link',
                    id: 'setting',
                    title: '设定集',
                    sectionPath: ['宗门', '青莲剑宗'],
                  },
                ],
              }],
            },
          }),
        },
        'chapter-1': {
          id: 'chapter-1',
          title: '第一章.md',
          is_folder: false,
          content: lexical('第一章正文'),
        },
      }

      vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
        const id = String(url).split('/').pop()
        return response(files[id])
      })

      const outputPath = await exportCombinedManuscript(
        ['chapter-2', 'chapter-1'],
        outputDir,
        'markdown',
        '第一卷',
      )

      expect(path.basename(outputPath)).toBe('第一卷.md')
      const markdown = fs.readFileSync(outputPath, 'utf8')

      expect(markdown).toContain('# 第二章')
      expect(markdown).toContain('第二章正文')
      expect(markdown).toContain('[[设定集#宗门 › 青莲剑宗]]')
      expect(markdown).toContain('# 第一章')
      expect(markdown.indexOf('# 第二章')).toBeLessThan(
        markdown.indexOf('# 第一章')
      )
      expect(markdown).toContain('\n\n---\n\n')
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('rejects empty project exports before touching the filesystem', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-project-empty-'))

    try {
      await expect(
        exportCombinedManuscript([], outputDir, 'markdown', '空项目')
      ).rejects.toThrow('没有可导出的章节')
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })
})
