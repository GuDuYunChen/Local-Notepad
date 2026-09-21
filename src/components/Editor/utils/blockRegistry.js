import { $createParagraphNode, $createTextNode, $insertNodes } from 'lexical'
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $createListNode, $createListItemNode, INSERT_CHECK_LIST_COMMAND } from '@lexical/list'
import { $createCodeNode } from '@lexical/code'
import { INSERT_TABLE_COMMAND } from '@lexical/table'
import { $createImageNode } from '../nodes/ImageNode'
import { $createTodoNode } from '../nodes/TodoNode'
import { $createDividerNode } from '../nodes/DividerNode'
import { $createCalloutNode } from '../nodes/CalloutNode'
import { $createToggleNode } from '../nodes/ToggleNode'
import { $createEmbedNode } from '../nodes/EmbedNode'
import { $createAttachmentNode } from '../nodes/AttachmentNode'
import { $createFormulaNode } from '../nodes/FormulaNode'
import { uploadFile } from './fileUpload'

export const BlockType = {
  PARAGRAPH: 'paragraph',
  H1: 'heading-1',
  H2: 'heading-2',
  H3: 'heading-3',
  H4: 'heading-4',
  QUOTE: 'quote',
  BULLET_LIST: 'bullet-list',
  NUMBERED_LIST: 'numbered-list',
  CODE_BLOCK: 'code-block',
  TABLE: 'table',
  IMAGE: 'image',
  DIVIDER: 'divider',
  CALLOUT: 'callout',
  TODO: 'todo',
  TOGGLE: 'toggle',
  EMBED: 'embed',
  ATTACHMENT: 'attachment',
  FORMULA: 'formula',
}

function createListNode(listType) {
  const list = $createListNode(listType)
  const item = $createListItemNode()
  item.append($createTextNode(''))
  list.append(item)
  return list
}

async function insertUploadedAttachment(editor) {
  const input = document.createElement('input')
  input.type = 'file'

  input.onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const result = await uploadFile(file)
      if (!result?.url) return

      editor.update(() => {
        $insertNodes([
          $createAttachmentNode({
            src: result.url,
            name: file.name,
            size: file.size,
            mime: file.type || '',
          }),
        ])
      })
    } catch (error) {
      console.error('附件上传失败', error)
    }
  }

  input.click()
}

async function insertUploadedImage(editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'

  input.onchange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const result = await uploadFile(file)
      if (!result?.url) return

      editor.update(() => {
        $insertNodes([
          $createImageNode({
            src: result.url,
            originalSrc: result.url,
            alt: file.name,
            caption: file.name,
          }),
        ])
      })
    } catch (error) {
      console.error('图片上传失败', error)
    }
  }

  input.click()
}

export const blockRegistry = [
  {
    type: BlockType.PARAGRAPH,
    label: '正文',
    description: '普通文本段落',
    icon: '¶',
    keywords: ['text', '文本', '正文', 'paragraph'],
    shortcut: '',
    createNode: () => $createParagraphNode(),
  },
  {
    type: BlockType.H1,
    label: '一级标题',
    description: '章节或页面主标题',
    icon: 'H1',
    keywords: ['h1', '标题', 'heading', '一级'],
    shortcut: '# ',
    createNode: () => $createHeadingNode('h1'),
  },
  {
    type: BlockType.H2,
    label: '二级标题',
    description: '主要章节标题',
    icon: 'H2',
    keywords: ['h2', '标题', 'heading', '二级'],
    shortcut: '## ',
    createNode: () => $createHeadingNode('h2'),
  },
  {
    type: BlockType.H3,
    label: '三级标题',
    description: '小节标题',
    icon: 'H3',
    keywords: ['h3', '标题', 'heading', '三级'],
    shortcut: '### ',
    createNode: () => $createHeadingNode('h3'),
  },
  {
    type: BlockType.H4,
    label: '四级标题',
    description: '更细的内容层级',
    icon: 'H4',
    keywords: ['h4', '标题', 'heading', '四级'],
    shortcut: '#### ',
    createNode: () => $createHeadingNode('h4'),
  },
  {
    type: BlockType.QUOTE,
    label: '引用',
    description: '引用或强调一段内容',
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
    createNode: () => createListNode('bullet'),
  },
  {
    type: BlockType.NUMBERED_LIST,
    label: '有序列表',
    description: '编号列表',
    icon: '1.',
    keywords: ['number', 'list', '列表', '有序', 'numbered'],
    shortcut: '1. ',
    createNode: () => createListNode('number'),
  },
  {
    type: BlockType.TODO,
    label: '待办清单',
    description: '可嵌套、可缩进的任务清单',
    icon: '☐',
    keywords: ['todo', 'checkbox', '待办', '任务', 'checklist'],
    shortcut: '- [ ]',
    run: editor => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND),
  },
  {
    type: BlockType.CODE_BLOCK,
    label: '代码块',
    description: '多行代码内容',
    icon: '</>',
    keywords: ['code', '代码', 'block'],
    shortcut: '```',
    createNode: () => $createCodeNode('javascript'),
  },
  {
    type: BlockType.TABLE,
    label: '表格',
    description: '插入 3×3 表格',
    icon: '▦',
    keywords: ['table', '表格'],
    shortcut: '',
    run: (editor) => editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: 3, rows: 3 }),
  },
  {
    type: BlockType.FORMULA,
    label: '数学公式',
    description: '插入 LaTeX 公式',
    icon: '∑',
    keywords: ['formula', 'math', 'latex', '公式', '数学'],
    shortcut: '',
    createNode: () => $createFormulaNode(),
  },
  {
    type: BlockType.ATTACHMENT,
    label: '附件',
    description: '上传 PDF、Word、压缩包或其他文件',
    icon: '📎',
    keywords: ['attachment', 'file', '附件', '文件', 'pdf', 'word'],
    shortcut: '',
    run: insertUploadedAttachment,
  },
  {
    type: BlockType.IMAGE,
    label: '图片',
    description: '上传并插入图片',
    icon: '🖼',
    keywords: ['image', '图片', 'photo'],
    shortcut: '',
    run: insertUploadedImage,
  },
  {
    type: BlockType.DIVIDER,
    label: '分割线',
    description: '分隔不同内容章节',
    icon: '—',
    keywords: ['divider', '分割线', 'hr', 'horizontal'],
    shortcut: '---',
    createNode: () => $createDividerNode(),
  },
  {
    type: BlockType.CALLOUT,
    label: '提示块',
    description: '突出提示、结论或注意事项',
    icon: '💡',
    keywords: ['callout', '提示', 'note', 'info'],
    shortcut: '',
    createNode: () => $createCalloutNode(),
  },
  {
    type: BlockType.TOGGLE,
    label: '折叠块',
    description: '收起暂时不需要看的内容',
    icon: '▶',
    keywords: ['toggle', '折叠', 'collapse', 'expand'],
    shortcut: '',
    createNode: () => $createToggleNode(),
  },
  {
    type: BlockType.EMBED,
    label: '嵌入内容',
    description: '嵌入支持的网站内容',
    icon: '◫',
    keywords: ['embed', '嵌入', 'video', '视频', 'youtube', 'bilibili'],
    shortcut: '',
    createNode: () => $createEmbedNode(),
  },
]

export function getBlockByType(type) {
  return blockRegistry.find(block => block.type === type)
}

export function searchBlocks(query) {
  if (!query) return blockRegistry
  const normalizedQuery = query.toLowerCase()
  return blockRegistry.filter(block =>
    block.keywords.some(keyword => keyword.toLowerCase().includes(normalizedQuery)) ||
    block.label.toLowerCase().includes(normalizedQuery)
  )
}

export function getBlockByShortcut(shortcut) {
  return blockRegistry.find(block => block.shortcut === shortcut)
}
