// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $setSelection } from 'lexical';
import UiThemeProvider from '~/components/ui/UiThemeProvider';
import { CodeBlockNode, $createCodeBlockNode } from './CodeBlockNode';
import CodeBlockPlugin from '../plugins/CodeBlockPlugin';

// These are real Lexical reconciliation checks in jsdom. Synthetic key events
// cannot establish native Windows F6 focus or browser Tab traversal acceptance.
let host, reactRoot, editor, errors;
const code = 'const original = 1;\n\treturn original;';
let rangeRectDescriptor;

beforeAll(() => {
  // jsdom implements selection but not Range layout. Supply only its missing
  // rectangle API so Lexical's ordinary caret scroll path can run; no geometry
  // or native scrolling claim is made, and selection/focus APIs stay genuine.
  rangeRectDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
  if (!rangeRectDescriptor) Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true, value: () => new DOMRect(),
  });
});

afterAll(() => {
  if (!rangeRectDescriptor) delete Range.prototype.getBoundingClientRect;
});

function CaptureEditor() {
  const [instance] = useLexicalComposerContext();
  useEffect(() => { editor = instance; }, [instance]);
  return null;
}

const settle = async () => act(async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
  // Selection change notifications are tasks in jsdom, not just microtasks.
  await new Promise(resolve => setTimeout(resolve, 0));
});

function logicalSelection() {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return selection ? { type: selection.constructor.name } : null;
    return {
      anchor: { key: selection.anchor.key, offset: selection.anchor.offset, type: selection.anchor.type },
      focus: { key: selection.focus.key, offset: selection.focus.offset, type: selection.focus.type },
      format: selection.format, style: selection.style,
    };
  });
}

function domSelection() {
  const selection = window.getSelection();
  return {
    rangeCount: selection.rangeCount,
    anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode, focusOffset: selection.focusOffset,
  };
}

function diagnostic(stage, event) {
  const selection = domSelection();
  const node = value => value && { type: value.nodeType, name: value.nodeName, text: value.textContent };
  return {
    stage, phase: event?.eventPhase, defaultPrevented: event?.defaultPrevented,
    active: document.activeElement === editor.getRootElement() ? 'editor' : document.activeElement?.className,
    logical: logicalSelection(),
    dom: { ...selection, anchorNode: node(selection.anchorNode), focusNode: node(selection.focusNode) },
  };
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  errors = [];
  host = document.createElement('div');
  document.body.append(host);
  reactRoot = createRoot(host);
  await act(async () => reactRoot.render(
    <UiThemeProvider>
      <LexicalComposer initialConfig={{
        namespace: 'code-block-empty-selection',
        theme: { codeBlock: 'code-block-wrapper' }, nodes: [CodeBlockNode],
        editorState: () => {
          const paragraph = $createParagraphNode().setIndent(2);
          paragraph.append($createTextNode('保留原始正文与格式').toggleFormat('bold'));
          $getRoot().append(paragraph, $createCodeBlockNode(code, 'plaintext'));
        },
        onError: error => { errors.push(error); },
      }}>
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <TabIndentationPlugin maxIndent={8} />
        <CodeBlockPlugin />
        <CaptureEditor />
      </LexicalComposer>
    </UiThemeProvider>
  ));
  await settle();
  expect(errors).toEqual([]);
});

afterEach(async () => {
  await act(async () => reactRoot.unmount());
  host.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('CodeBlock F6 with a genuinely empty DOM selection', () => {
  for (const selectionKind of ['text', 'root', 'null']) {
    it(`retains empty DOM endpoints with ${selectionKind} logical selection`, async () => {
      const root = editor.getRootElement();
      const target = root.querySelector('.code-block-wrapper > .code-block-header .language-selector-button');
      await act(async () => root.focus());
      await settle();
      await act(async () => {
        editor.update(() => {
          if (selectionKind === 'text') $getRoot().getFirstChildOrThrow().getFirstChildOrThrow().select(1, 5);
          else if (selectionKind === 'root') $getRoot().select(0, 0);
          else $setSelection(null);
        }, { discrete: true });
      });
      await settle();
      expect(document.activeElement).toBe(root);
      window.getSelection().removeAllRanges();
      const before = { document: editor.getEditorState().toJSON(), logical: logicalSelection(), dom: domSelection() };
      expect(before.dom).toEqual({ rangeCount: 0, anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
      if (selectionKind === 'null') expect(before.logical).toBeNull();
      else expect(before.logical.anchor.type).toBe(selectionKind === 'text' ? 'text' : 'element');

      const trace = [diagnostic('before')];
      const capture = event => trace.push(diagnostic('root-capture', event));
      const bubble = event => trace.push(diagnostic('root-bubble-after-entry', event));
      const focused = event => trace.push(diagnostic('language-focus', event));
      root.addEventListener('keydown', capture, true);
      root.addEventListener('keydown', bubble);
      target.addEventListener('focus', focused);
      const committedDocuments = [];
      const unregister = editor.registerUpdateListener(({ editorState, tags }) => {
        committedDocuments.push(editorState.toJSON());
        trace.push({ ...diagnostic('lexical-commit'), tags: [...tags] });
      });
      const event = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true });
      try {
        let synchronousDOM;
        await act(async () => {
          root.dispatchEvent(event);
          synchronousDOM = domSelection();
          trace.push(diagnostic('after-dispatch'));
        });
        await settle();
        trace.push(diagnostic('after-settle'));
        console.info('EMPTY_SELECTION_TRACE', JSON.stringify({ selectionKind, trace }));
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(target);
        expect(synchronousDOM).toEqual(before.dom);
        expect(editor.getEditorState().toJSON()).toEqual(before.document);
        expect(logicalSelection()).toEqual(before.logical);
        expect(domSelection()).toEqual(before.dom);
        expect(root.querySelector('.language-selector-dropdown')).toBeNull();
        expect(errors).toEqual([]);

        const rootKeyEvents = trace.filter(item => item.stage === 'root-bubble-after-entry').length;
        for (const shiftKey of [false, true]) {
          const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
          await act(async () => target.dispatchEvent(tab));
          await settle();
          expect(tab.defaultPrevented).toBe(false);
          expect(trace.filter(item => item.stage === 'root-bubble-after-entry')).toHaveLength(rootKeyEvents);
          expect(domSelection()).toEqual(before.dom);
          expect(logicalSelection()).toEqual(before.logical);
          expect(editor.getEditorState().toJSON()).toEqual(before.document);
        }

        // A subsequent real Lexical edit must commit and serialize normally.
        // This does not claim the jsdom fixture exercised application disk save.
        await act(async () => {
          root.focus();
          editor.update(() => {
            const text = $getRoot().getFirstChildOrThrow().getFirstChildOrThrow();
            text.setTextContent('保留原始正文与格式后续编辑');
            // A real text range verifies the edit's normal DOM reconciliation.
            text.select(1, 5);
          }, { discrete: true });
        });
        await settle();
        const afterEdit = editor.getEditorState().toJSON();
        expect(afterEdit.root.children[0].children[0].text).toBe('保留原始正文与格式后续编辑');
        expect(afterEdit.root.children[0].children[0].format).toBe(before.document.root.children[0].children[0].format);
        expect(afterEdit.root.children[0].indent).toBe(2);
        expect(afterEdit.root.children[1]).toEqual(before.document.root.children[1]);
        expect(committedDocuments).toContainEqual(afterEdit);
        expect(editor.parseEditorState(JSON.stringify(afterEdit)).toJSON()).toEqual(afterEdit);
        expect(logicalSelection().anchor.type).toBe('text');
        expect(domSelection().rangeCount).toBe(1);
        expect(domSelection().anchorOffset).toBe(1);
        expect(domSelection().focusOffset).toBe(5);
        expect(root.contains(domSelection().anchorNode)).toBe(true);
        expect(document.activeElement).toBe(root);
        expect(errors).toEqual([]);
      } finally {
        unregister();
        root.removeEventListener('keydown', capture, true);
        root.removeEventListener('keydown', bubble);
        target.removeEventListener('focus', focused);
      }
    });
  }
});
