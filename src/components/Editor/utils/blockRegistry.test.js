import { describe, expect, it } from 'vitest'
import { createEditor, $getRoot } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { CodeNode } from '@lexical/code'

import { getBlockByType, BlockType } from './blockRegistry'
import { TodoNode, $createTodoNode } from '../nodes/TodoNode'
import { CalloutNode, $createCalloutNode } from '../nodes/CalloutNode'
import { ToggleNode, $createToggleNode } from '../nodes/ToggleNode'
import { DividerNode } from '../nodes/DividerNode'
import { EmbedNode, $createEmbedNode } from '../nodes/EmbedNode'
import { AttachmentNode, $createAttachmentNode } from '../nodes/AttachmentNode'
import { ImageNode, $createImageNode } from '../nodes/ImageNode'
import { ImageGridNode, $createImageGridNode } from '../nodes/ImageGridNode'
import { FormulaNode, $createFormulaNode } from '../nodes/FormulaNode'

function createTestEditor() {
  return createEditor({
    namespace: 'BlockRegistryTest',
    nodes: [
      HeadingNode,
      QuoteNode,
      ListItemNode,
      ListNode,
      CodeNode,
      TodoNode,
      CalloutNode,
      ToggleNode,
      DividerNode,
      EmbedNode,
      AttachmentNode,
      ImageNode,
      ImageGridNode,
      FormulaNode,
    ],
    onError(error) {
      throw error
    },
  })
}

describe('editor block registry', () => {
  it('creates real nodes for common slash commands', () => {
    const editor = createTestEditor()

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const types = [
        BlockType.H1,
        BlockType.H2,
        BlockType.H3,
        BlockType.H4,
        BlockType.QUOTE,
        BlockType.BULLET_LIST,
        BlockType.NUMBERED_LIST,
        BlockType.CODE_BLOCK,
        BlockType.CALLOUT,
        BlockType.TOGGLE,
        BlockType.DIVIDER,
        BlockType.EMBED,
        BlockType.FORMULA,
      ]

      for (const type of types) {
        const block = getBlockByType(type)
        expect(block).toBeTruthy()
        expect(typeof block.createNode).toBe('function')
        root.append(block.createNode())
      }
    }, { discrete: true })

    const state = editor.getEditorState().toJSON()
    const nodeTypes = state.root.children.map(node => node.type)

    expect(nodeTypes).toContain('heading')
    expect(nodeTypes).toContain('quote')
    expect(nodeTypes).toContain('list')
    expect(nodeTypes).toContain('code')
    expect(nodeTypes).toContain('callout')
    expect(nodeTypes).toContain('toggle')
    expect(nodeTypes).toContain('divider')
    expect(nodeTypes).toContain('embed')
    expect(nodeTypes).toContain('formula')
    expect(typeof getBlockByType(BlockType.TODO).run).toBe('function')
  })

  it('serializes editable formula content and display mode', () => {
    const editor = createTestEditor()

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const formula = $createFormulaNode({
        expression: 'E = mc^2',
        displayMode: true,
      })
      formula.setExpression('\\int_0^1 x^2 \\, dx')
      formula.setDisplayMode(false)
      root.append(formula)
    }, { discrete: true })

    const formula = editor.getEditorState().toJSON().root.children[0]
    expect(formula).toMatchObject({
      type: 'formula',
      version: 1,
      expression: '\\int_0^1 x^2 \\, dx',
      displayMode: false,
    })
  })

  it('serializes editable image layout metadata', () => {
    const editor = createTestEditor()

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const image = $createImageNode({
        src: 'http://127.0.0.1:27121/uploads/image.jpg',
        originalSrc: 'http://127.0.0.1:27121/uploads/image-original.jpg',
        alt: '风景',
        width: 520,
        caption: '旧说明',
        align: 'left',
      })

      image.setWidth('100%')
      image.setCaption('新的图片说明')
      image.setAlign('right')
      image.setSource({
        src: 'http://127.0.0.1:27121/uploads/replaced.jpg',
        originalSrc: 'http://127.0.0.1:27121/uploads/replaced-original.jpg',
        alt: '替换后的图片',
      })
      root.append(image)
    }, { discrete: true })

    const image = editor.getEditorState().toJSON().root.children[0]
    expect(image).toMatchObject({
      type: 'image',
      version: 2,
      width: '100%',
      caption: '新的图片说明',
      align: 'right',
      src: 'http://127.0.0.1:27121/uploads/replaced.jpg',
      originalSrc: 'http://127.0.0.1:27121/uploads/replaced-original.jpg',
      alt: '替换后的图片',
    })
  })

  it('serializes editable image grid layout and captions', () => {
    const editor = createTestEditor()

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const grid = $createImageGridNode({
        items: [
          { src: 'http://127.0.0.1:27121/uploads/a.jpg', alt: 'A' },
          { src: 'http://127.0.0.1:27121/uploads/b.jpg', alt: 'B' },
        ],
        columns: 2,
        gap: 8,
      })

      grid.setColumns(4)
      grid.setGap(16)
      grid.setItems([
        { src: 'http://127.0.0.1:27121/uploads/a.jpg', alt: 'A', caption: '第一张' },
        { src: 'http://127.0.0.1:27121/uploads/b.jpg', alt: 'B', caption: '第二张' },
      ])

      root.append(grid)
    }, { discrete: true })

    const grid = editor.getEditorState().toJSON().root.children[0]
    expect(grid).toMatchObject({
      type: 'image-grid',
      version: 2,
      columns: 4,
      gap: 16,
    })
    expect(grid.items).toHaveLength(2)
    expect(grid.items[0].caption).toBe('第一张')
    expect(grid.items[1].caption).toBe('第二张')
  })

  it('serializes generic file attachments', () => {
    const editor = createTestEditor()

    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const attachment = $createAttachmentNode({
        src: 'http://127.0.0.1:27121/uploads/report.pdf',
        name: 'report.pdf',
        size: 2048,
        mime: 'application/pdf',
      })
      attachment.setFile({
        src: 'http://127.0.0.1:27121/uploads/report-v2.docx',
        name: 'report-v2.docx',
        size: 4096,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      root.append(attachment)
    }, { discrete: true })

    const attachment = editor.getEditorState().toJSON().root.children[0]
    expect(attachment).toMatchObject({
      type: 'attachment',
      src: 'http://127.0.0.1:27121/uploads/report-v2.docx',
      name: 'report-v2.docx',
      size: 4096,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
  })

  it('serializes interactive block edits instead of keeping them only in React state', () => {
    const editor = createTestEditor()

    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const todo = $createTodoNode({ checked: false, text: '旧任务' })
      todo.setChecked(true)
      todo.setText('完成任务')

      const callout = $createCalloutNode({ icon: '💡', text: '旧提示' })
      callout.setIcon('✅')
      callout.setText('新的提示内容')

      const toggle = $createToggleNode({ title: '旧标题', content: '', collapsed: false })
      toggle.setTitle('更多信息')
      toggle.setContent('折叠正文')
      toggle.setCollapsed(true)

      const embed = $createEmbedNode()
      embed.setUrl('https://www.youtube.com/watch?v=abc123')
      embed.setTitle('演示视频')

      root.append(todo, callout, toggle, embed)
    }, { discrete: true })

    const children = editor.getEditorState().toJSON().root.children
    const todo = children.find(node => node.type === 'todo')
    const callout = children.find(node => node.type === 'callout')
    const toggle = children.find(node => node.type === 'toggle')
    const embed = children.find(node => node.type === 'embed')

    expect(todo).toMatchObject({ checked: true, text: '完成任务' })
    expect(callout).toMatchObject({ icon: '✅', text: '新的提示内容' })
    expect(toggle).toMatchObject({
      title: '更多信息',
      content: '折叠正文',
      collapsed: true,
      version: 2,
    })
    expect(embed).toMatchObject({
      url: 'https://www.youtube.com/watch?v=abc123',
      title: '演示视频',
    })
  })
})
