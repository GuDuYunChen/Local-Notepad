import { $createParagraphNode, $createTextNode, COMMAND_PRIORITY_LOW, createCommand } from 'lexical'
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $createListNode, $createListItemNode } from '@lexical/list'
import { $createCodeNode } from '@lexical/code'
import { INSERT_TABLE_COMMAND } from '@lexical/table'
import { $createImageNode } from '../nodes/ImageNode'
import { $createTodoNode } from '../nodes/TodoNode'
import { $createDividerNode } from '../nodes/DividerNode'
import { $createCalloutNode } from '../nodes/CalloutNode'

export const INSERT_IMAGE_BLOCK_COMMAND = createCommand('insertImageBlockCommand')

export const BlockType = {
  PARAGRAPH: 'paragraph',
  H1: 'heading-1',
  H2: 'heading-2',
  H3: 'heading-3',
  QUOTE: 'quote',
  BULLET_LIST: 'bullet-list',
  NUMBERED_LIST: 'numbered-list',
  CODE_BLOCK: 'code-block',
  TABLE: 'table',
  IMAGE: 'image',
  DIVIDER: 'divider',
  CALLOUT: 'callout',
  TODO: 'todo',
}

export const blockRegistry = [
  {
    type: BlockType.PARAGRAPH,
    label: '文本',
    description: '普通文本段落',
    icon: '¶',
    keywords: ['text', '文本', 'paragraph'],
    shortcut: '',
    createNode: (editor) => {
      editor.update(() => {
        const p = $createParagraphNode()
        p.append($createTextNode(''))
        return p
      })
    },
  },
  {
    type: BlockType.H1,
    label: '一级标题',
    description: '大标题',
    icon: 'H1',
    keywords: ['h1', '标题', 'heading'],
    shortcut: '# ',
    createNode: () => $createHeadingNode('h1'),
  },
  {
    type: BlockType.H2,
    label: '二级标题',
    description: '中等标题',
    icon: 'H2',
    keywords: ['h2', '标题', 'heading'],
    shortcut: '## ',
    createNode: () => $createHeadingNode('h2'),
  },
  {
    type: BlockType.H3,
    label: '三级标题',
    description: '小标题',
    icon: 'H3',
    keywords: ['h3', '标题', 'heading'],
    shortcut: '### ',
    createNode: () => $createHeadingNode('h3'),
  },
  {
    type: BlockType.QUOTE,
    label: '引用',
    description: '引用文本',
    icon: '❝',
    keywords: ['quote', '引用', 'blockquote'],
    shortcut: '> ',
    createNode: () => $createQuoteNode(),
  },
  {
    type: BlockType.BULLET_LIST,
    label: '无序列表',
    description: '项目符号列表',
    icon: '•',
    keywords: ['bullet', 'list', '列表', '无序'],
    shortcut: '- ',
    createNode: () => $createListNode('bullet'),
  },
  {
    type: BlockType.NUMBERED_LIST,
    label: '有序列表',
    description: '编号列表',
    icon: '1.',
    keywords: ['number', 'list', '列表', '有序', 'numbered'],
    shortcut: '1. ',
    createNode: () => $createListNode('number'),
  },
  {
    type: BlockType.CODE_BLOCK,
    label: '代码块',
    description: '带语法高亮的代码块',
    icon: '</>',
    keywords: ['code', '代码', 'block'],
    shortcut: '```',
    createNode: () => $createCodeNode('javascript'),
  },
  {
    type: BlockType.TABLE,
    label: '表格',
    description: '插入表格',
    icon: '▦',
    keywords: ['table', '表格'],
    shortcut: '',
    createNode: (editor) => {
      editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: 3, rows: 3 })
    },
  },
  {
    type: BlockType.IMAGE,
    label: '图片',
    description: '上传图片',
    icon: '🖼',
    keywords: ['image', '图片', 'photo'],
    shortcut: '',
    createNode: (editor) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async (e) => {
        const file = e.target.files[0]
        if (file) {
          const reader = new FileReader()
          reader.onload = () => {
            editor.update(() => {
              const imageNode = $createImageNode({
                src: reader.result,
                alt: file.name,
              })
              const paragraph = $createParagraphNode()
              paragraph.append(imageNode)
              const selection = editor.getSelection()
              if (selection) {
                selection.insertNodes([paragraph])
              }
            })
          }
          reader.readAsDataURL(file)
        }
      }
      input.click()
    },
  },
  {
    type: BlockType.DIVIDER,
    label: '分割线',
    description: '水平分割线',
    icon: '—',
    keywords: ['divider', '分割线', 'hr', 'horizontal'],
    shortcut: '---',
    createNode: (editor) => {
      editor.update(() => {
        const dividerNode = $createDividerNode()
        const paragraph = $createParagraphNode()
        paragraph.append(dividerNode)
        const selection = editor.getSelection()
        if (selection) {
          selection.insertNodes([paragraph])
        }
      })
    },
  },
  {
    type: BlockType.CALLOUT,
    label: '提示框',
    description: '带图标的提示块',
    icon: '💡',
    keywords: ['callout', '提示', 'note', 'info'],
    shortcut: '',
    createNode: (editor) => {
      editor.update(() => {
        const calloutNode = $createCalloutNode()
        const paragraph = $createParagraphNode()
        paragraph.append(calloutNode)
        const selection = editor.getSelection()
        if (selection) {
          selection.insertNodes([paragraph])
        }
      })
    },
  },
  {
    type: BlockType.TODO,
    label: '待办事项',
    description: '可勾选的待办列表',
    icon: '☐',
    keywords: ['todo', 'checkbox', '待办', '任务'],
    shortcut: '- [ ]',
    createNode: (editor) => {
      editor.update(() => {
        const todoNode = $createTodoNode()
        const paragraph = $createParagraphNode()
        paragraph.append(todoNode)
        const selection = editor.getSelection()
        if (selection) {
          selection.insertNodes([paragraph])
        }
      })
    },
  },
]

export function getBlockByType(type) {
  return blockRegistry.find((b) => b.type === type)
}

export function searchBlocks(query) {
  if (!query) return blockRegistry
  const lowerQuery = query.toLowerCase()
  return blockRegistry.filter((block) =>
    block.keywords.some(
      (keyword) => keyword.toLowerCase().includes(lowerQuery) || block.label.toLowerCase().includes(lowerQuery)
    )
  )
}

export function getBlockByShortcut(shortcut) {
  return blockRegistry.find((b) => b.shortcut === shortcut)
}
