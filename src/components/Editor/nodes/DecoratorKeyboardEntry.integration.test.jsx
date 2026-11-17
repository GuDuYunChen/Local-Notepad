// @vitest-environment jsdom
import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin'
import { $getRoot, $createParagraphNode, $createTextNode, $getSelection, $isRangeSelection } from 'lexical'
import UiThemeProvider from '~/components/ui/UiThemeProvider'
import { CalloutNode, $createCalloutNode } from './CalloutNode'
import { ToggleNode, $createToggleNode } from './ToggleNode'

let host, reactRoot, editor, errors
function Capture() {
  const [instance] = useLexicalComposerContext()
  useEffect(() => { editor = instance }, [instance])
  return null
}
const settle = async () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
function key(target, name = 'F6', options = {}) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })
  return act(async () => { target.dispatchEvent(event) }).then(async () => { await settle(); return event })
}
const cases = [
  { name: 'callout', create: () => $createCalloutNode({ icon: '💡', text: '原有提示内容' }),
    selector: '.callout-icon-btn', next: '.callout-textarea' },
  { name: 'toggle', create: () => $createToggleNode({ title: '原有折叠标题', content: '原有折叠正文', collapsed: false }),
    selector: '.toggle-arrow-button', next: '.toggle-title-input' },
]
async function mount(fixture, count = 1, editable = true) {
  await act(async () => reactRoot.render(
    <UiThemeProvider><LexicalComposer initialConfig={{
      namespace: 'decorator-keyboard-native-entry', editable, nodes: [CalloutNode, ToggleNode],
      onError: error => { errors.push(error) },
      editorState: () => {
        const p = $createParagraphNode().append($createTextNode('原有加粗正文').toggleFormat('bold'))
        $getRoot().append(p, ...Array.from({ length: count }, () => fixture.create()))
      },
    }}>
      <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
      <TabIndentationPlugin maxIndent={8} />
      <Capture />
    </LexicalComposer></UiThemeProvider>
  ))
  await settle()
  expect(errors).toEqual([])
}
const root = () => editor.getRootElement()
const model = () => JSON.stringify(editor.getEditorState())
function logical() {
  return editor.getEditorState().read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return selection
    return [selection.anchor.key, selection.anchor.offset, selection.focus.key, selection.focus.offset, selection.format]
  })
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // jsdom has no layout ResizeObserver. Supply only its missing interface;
  // real native focus/Tab acceptance remains reserved for installed Windows.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  host = document.createElement('div')
  document.body.append(host)
  reactRoot = createRoot(host)
  editor = null
  errors = []
})
afterEach(async () => {
  await act(async () => reactRoot.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
describe('real Lexical decorator F6 entry and browser-owned Tab boundary', () => {
  for (const fixture of cases) {
    it(`${fixture.name} enters the first owned action without clicking or altering source content`, async () => {
      await mount(fixture, 2)
      await act(async () => { root().focus(); editor.update(() =>
        $getRoot().getFirstChildOrThrow().getFirstChildOrThrow().select(1, 3), { discrete: true }) })
      await settle()
      const before = model(), selection = logical()
      const action = root().querySelector(fixture.selector)
      const click = vi.fn()
      action.addEventListener('click', click)
      const event = await key(root())
      expect(event.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(action)
      expect(click).not.toHaveBeenCalled()
      expect(model()).toBe(before)
      expect(logical()).toEqual(selection)
      expect(errors).toEqual([])
    })
    it(`${fixture.name} refuses disabled, modified, pre-consumed or foreign F6`, async () => {
      await mount(fixture)
      root().focus()
      const before = model(), action = root().querySelector(fixture.selector)
      for (const options of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }]) {
        expect((await key(root(), 'F6', options)).defaultPrevented).toBe(false)
        expect(document.activeElement).toBe(root())
      }
      const consumed = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true })
      consumed.preventDefault()
      await act(async () => root().dispatchEvent(consumed))
      expect(document.activeElement).toBe(root())
      action.focus()
      expect((await key(root())).defaultPrevented).toBe(false)
      expect(document.activeElement).toBe(action)
      expect(model()).toBe(before)
    })
    it(`${fixture.name} keeps native forward/reverse Tab on controls without editor indentation`, async () => {
      await mount(fixture)
      const bubbled = vi.fn()
      root().addEventListener('keydown', bubbled)
      const before = model(), button = root().querySelector(fixture.selector), next = root().querySelector(fixture.next)
      expect(button).toBeTruthy()
      expect(next).toBeTruthy()
      for (const control of [button, next]) {
        for (const shiftKey of [false, true]) {
          control.focus()
          const event = await key(control, 'Tab', { shiftKey })
          expect(event.defaultPrevented).toBe(false)
          expect(document.activeElement).toBe(control) // jsdom cannot execute actual native Tab traversal
          expect(bubbled).not.toHaveBeenCalled()
        }
      }
      expect(model()).toBe(before)
      root().focus()
      await key(root(), 'Tab')
      expect(bubbled).toHaveBeenCalled()
      expect(errors).toEqual([])
    })
    it(`${fixture.name} does not enter disabled/read-only controls`, async () => {
      await mount(fixture, 1, false)
      root().tabIndex = 0
      root().focus()
      const before = model()
      expect((await key(root())).defaultPrevented).toBe(false)
      expect(model()).toBe(before)
    })
  }
})
