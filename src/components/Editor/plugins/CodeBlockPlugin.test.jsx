import { beforeEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
} from 'lexical'
import { CodeBlockNode, $isCodeBlockNode } from '../nodes/CodeBlockNode'
import { $insertCodeBlockAtSelection } from './CodeBlockPlugin'

function findCodeBlock(root) {
  return root.getChildren().find(node => $isCodeBlockNode(node))
}

describe('CodeBlockPlugin insertion properties', () => {
  let editor

  beforeEach(() => {
    editor = createEditor({
      nodes: [CodeBlockNode],
      onError(error) {
        throw error
      },
    })
  })

  it('inserts an empty code block at a collapsed paragraph selection while preserving surrounding blocks', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 40 }), { maxLength: 4 }),
        fc.array(fc.string({ maxLength: 40 }), { maxLength: 4 }),
        (beforeTexts, afterTexts) => {
          editor.update(() => {
            const root = $getRoot()
            root.clear()

            beforeTexts.forEach(text => {
              const paragraph = $createParagraphNode()
              paragraph.append($createTextNode(text))
              root.append(paragraph)
            })

            const cursorParagraph = $createParagraphNode()
            root.append(cursorParagraph)

            afterTexts.forEach(text => {
              const paragraph = $createParagraphNode()
              paragraph.append($createTextNode(text))
              root.append(paragraph)
            })

            cursorParagraph.select()
            const inserted = $insertCodeBlockAtSelection()

            expect($isCodeBlockNode(inserted)).toBe(true)
            expect(inserted.getCode()).toBe('')
            expect(inserted.getLanguage()).toBe('plaintext')

            const children = root.getChildren()
            const codeIndex = children.findIndex(node => node.getKey() === inserted.getKey())
            expect(codeIndex).toBe(beforeTexts.length)
            expect(children[codeIndex + 1]?.getType()).toBe('paragraph')

            beforeTexts.forEach(text => {
              if (text) expect(root.getTextContent()).toContain(text)
            })
            afterTexts.forEach(text => {
              if (text) expect(root.getTextContent()).toContain(text)
            })
          })
        }
      ),
      { numRuns: 80 }
    )
  })

  it('converts selected text into a code block without changing its content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        text => {
          editor.update(() => {
            const root = $getRoot()
            root.clear()

            const paragraph = $createParagraphNode()
            const textNode = $createTextNode(text)
            paragraph.append(textNode)
            root.append(paragraph)

            textNode.select(0, text.length)
            const inserted = $insertCodeBlockAtSelection()

            expect(inserted.getCode()).toBe(text)
            expect(findCodeBlock(root)?.getCode()).toBe(text)
          })
        }
      ),
      { numRuns: 80 }
    )
  })

  it('preserves multiline text selected inside one paragraph', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 2, maxLength: 5 }),
        lines => {
          const text = lines.join('\n')

          editor.update(() => {
            const root = $getRoot()
            root.clear()

            const paragraph = $createParagraphNode()
            const textNode = $createTextNode(text)
            paragraph.append(textNode)
            root.append(paragraph)

            textNode.select(0, text.length)
            const inserted = $insertCodeBlockAtSelection()

            expect(inserted.getCode()).toBe(text)
            expect(inserted.getCode().split('\n')).toEqual(lines)
          })
        }
      ),
      { numRuns: 60 }
    )
  })

  it('merges a selection spanning multiple paragraphs into one code block', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 35 }), { minLength: 2, maxLength: 5 }),
        paragraphTexts => {
          editor.update(() => {
            const root = $getRoot()
            root.clear()

            const textNodes = paragraphTexts.map(text => {
              const paragraph = $createParagraphNode()
              const textNode = $createTextNode(text)
              paragraph.append(textNode)
              root.append(paragraph)
              return textNode
            })

            const first = textNodes[0]
            const last = textNodes[textNodes.length - 1]
            first.select(0, 0)
            const selection = $getSelection()
            selection.anchor.set(first.getKey(), 0, 'text')
            selection.focus.set(last.getKey(), last.getTextContentSize(), 'text')

            const selectedText = selection.getTextContent()
            const inserted = $insertCodeBlockAtSelection()

            expect(inserted.getCode()).toBe(selectedText)
            paragraphTexts.forEach(text => expect(inserted.getCode()).toContain(text))

            const codeBlocks = root.getChildren().filter(node => $isCodeBlockNode(node))
            expect(codeBlocks).toHaveLength(1)
          })
        }
      ),
      { numRuns: 60 }
    )
  })

  it('adds exactly one editable paragraph immediately after the inserted code block', () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      root.append(paragraph)
      paragraph.select()

      const inserted = $insertCodeBlockAtSelection()
      const children = root.getChildren()
      const codeIndex = children.findIndex(node => node.getKey() === inserted.getKey())

      expect(codeIndex).toBeGreaterThanOrEqual(0)
      expect(children[codeIndex + 1]?.getType()).toBe('paragraph')
    })
  })

  it('replaces an empty host paragraph instead of leaving a duplicate empty block before the code block', () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      root.append(paragraph)
      paragraph.select()

      $insertCodeBlockAtSelection()

      expect(root.getChildren().map(node => node.getType())).toEqual([
        'code-block',
        'paragraph',
      ])
    })
  })
})
