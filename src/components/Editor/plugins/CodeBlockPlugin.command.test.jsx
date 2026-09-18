import React, { useEffect } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createParagraphNode, $getRoot } from 'lexical'
import CodeBlockPlugin, { INSERT_CODE_BLOCK_COMMAND } from './CodeBlockPlugin'
import { CodeBlockNode } from '../nodes/CodeBlockNode'

function EditorCapture({ onReady }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  return null
}

describe('CodeBlockPlugin command integration', () => {
  let container
  let root

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    container?.remove()
    root = null
    container = null
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })

  it('inserts a block-level code node and trailing paragraph from a collapsed paragraph selection', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    let editor
    const onReady = vi.fn(value => {
      editor = value
    })

    await act(async () => {
      root.render(
        <LexicalComposer
          initialConfig={{
            namespace: 'code-block-command-test',
            nodes: [CodeBlockNode],
            onError(error) {
              throw error
            },
          }}
        >
          <CodeBlockPlugin />
          <EditorCapture onReady={onReady} />
        </LexicalComposer>
      )
      await Promise.resolve()
    })

    expect(editor).toBeDefined()

    await act(async () => {
      editor.update(() => {
        const editorRoot = $getRoot()
        editorRoot.clear()
        const paragraph = $createParagraphNode()
        editorRoot.append(paragraph)
        paragraph.select()
      })
      await Promise.resolve()
    })

    await act(async () => {
      editor.dispatchCommand(INSERT_CODE_BLOCK_COMMAND, undefined)
      await Promise.resolve()
      await Promise.resolve()
    })

    let types = []
    let code = null
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren()
      types = children.map(node => node.getType())
      code = children.find(node => node.getType() === 'code-block')?.getCode() ?? null
    })

    expect(types).toContain('code-block')
    expect(types[types.indexOf('code-block') + 1]).toBe('paragraph')
    expect(code).toBe('')
  })
})
