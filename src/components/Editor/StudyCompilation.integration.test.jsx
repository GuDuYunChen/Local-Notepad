import { it, expect } from 'vitest'
import { createEditor, $getRoot } from 'lexical'
import { HeadingNode } from '@lexical/rich-text'
import { WikiLinkNode } from './nodes/WikiLinkNode'
import { buildStudyCompilation } from '../../services/studyCompilation'

it('loads generated research content into the actual Lexical node registry', () => {
  const rows = [{ collectionKey: 'one', collectionId: 'c1', collectionName: '原资料', id: 'original-note', title: '来源.md', folderPath: '旧目录', ordinal: 23, status: 'revisit', note: '  原批注\n\n中文😀𠮷', updatedAt: '2026-09-24T00:00:00.000Z' }]
  const preview = buildStudyCompilation(rows, { title: '研究', goal: '<b>目标</b>', parentId: '', group: 'collection' }, 'now', 'before')
  const editor = createEditor({ namespace: 'research-document', nodes: [HeadingNode, WikiLinkNode], onError: error => { throw error } })
  const state = editor.parseEditorState(preview.content); editor.setEditorState(state)
  const text = editor.getEditorState().read(() => $getRoot().getTextContent())
  expect(text).toContain('  原批注\n\n中文😀𠮷'); expect(text).toContain('<b>目标</b>')
  const nodes = editor.getEditorState().toJSON().root.children.flatMap(n => n.children)
  expect(nodes.find(n => n.type === 'wiki-link')).toMatchObject({ id: 'original-note', title: '来源.md', sectionPath: [] })
})
