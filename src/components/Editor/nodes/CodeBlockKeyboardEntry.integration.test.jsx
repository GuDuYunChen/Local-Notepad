import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection } from 'lexical';
import UiThemeProvider from '~/components/ui/UiThemeProvider';
import { api } from '~/services/api';
import { CodeBlockNode, $createCodeBlockNode } from './CodeBlockNode';
import { AttachmentNode, $createAttachmentNode } from './AttachmentNode';
import { TodoNode, $createTodoNode } from './TodoNode';
import { WikiLinkNode, $createBlockReferenceNode } from './WikiLinkNode';
import CodeBlockPlugin from '../plugins/CodeBlockPlugin';

vi.mock('~/services/api', () => ({ api: vi.fn() }));

const originalCode = 'const original = 1;\n\treturn original;';
const blockId = 'b-' + 'a'.repeat(32);
const ownerSelector = '.code-block-wrapper:has(> .code-block-header)';
const previousEntries = {
  attachment: {
    create: () => $createAttachmentNode({ src: 'data:text/plain,original', name: 'original.txt', size: 8, mime: 'text/plain' }),
    action: '.attachment-actions button:not(:disabled)',
  },
  todo: {
    create: () => $createTodoNode({ text: '原始待办正文', checked: false }),
    action: '.todo-checkbox:not(:disabled)',
  },
  embed: {
    create: () => $createBlockReferenceNode('source-id', '来源', blockId, true),
    action: '.block-reference-embed footer button:first-child',
  },
};
let host, reactRoot, editor, errors;

function CaptureEditor() {
  const [instance] = useLexicalComposerContext();
  useEffect(() => { editor = instance; }, [instance]);
  return null;
}

const settle = async () => act(async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
});

async function mount({ editable = true, count = 1, previous = null, previousFirst = false } = {}) {
  await act(async () => reactRoot.render(
    <UiThemeProvider>
      <LexicalComposer initialConfig={{
        namespace: 'code-block-keyboard-entry', editable,
        theme: { codeBlock: 'code-block-wrapper' },
        nodes: [CodeBlockNode, AttachmentNode, TodoNode, WikiLinkNode],
        editorState: () => {
          const paragraph = $createParagraphNode().setIndent(2);
          paragraph.append($createTextNode('保留原始正文与格式').toggleFormat('bold'));
          const children = Array.from({ length: count }, () => $createCodeBlockNode(originalCode, 'plaintext'));
          if (previous) children[previousFirst ? 'unshift' : 'push'](previousEntries[previous].create());
          $getRoot().append(paragraph, ...children);
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
  expect(editor.getRootElement()).toBe(host.querySelector('.editor-input'));
  expect(host.querySelectorAll(ownerSelector)).toHaveLength(count);
  // Keep the actual outer Lexical theme shell: it is not a second action owner.
  expect(host.querySelectorAll('.code-block-wrapper')).toHaveLength(count * 2);
}

const owned = () => host.querySelector(ownerSelector);
const language = () => owned().querySelector('.language-selector-button');
const model = () => editor.getEditorState().toJSON();

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
    anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode, focusOffset: selection.focusOffset,
    rangeCount: selection.rangeCount,
  };
}

function snapshot() { return { document: model(), logical: logicalSelection(), dom: domSelection() }; }

function expectUnchanged(before) {
  expect(model()).toEqual(before.document);
  expect(logicalSelection()).toEqual(before.logical);
  const after = domSelection();
  expect(after.anchorNode).toBe(before.dom.anchorNode);
  expect(after.focusNode).toBe(before.dom.focusNode);
  expect(after.anchorOffset).toBe(before.dom.anchorOffset);
  expect(after.focusOffset).toBe(before.dom.focusOffset);
  expect(after.rangeCount).toBe(before.dom.rangeCount);
  expect(errors).toEqual([]);
}

async function focusText({ rootSelection = false } = {}) {
  await act(async () => {
    editor.getRootElement().focus();
    editor.update(() => {
      if (rootSelection) $getRoot().select(0, 0);
      else $getRoot().getFirstChildOrThrow().getFirstChildOrThrow().select(1, 5);
    }, { discrete: true });
  });
  await settle();
  expect(document.activeElement).toBe(editor.getRootElement());
  expect(logicalSelection().anchor.type).toBe(rootSelection ? 'element' : 'text');
  expect(domSelection().rangeCount).toBe(1);
}

function keyboard(key, init = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  for (const name of ['keyCode', 'which']) {
    if (Object.hasOwn(init, name)) Object.defineProperty(event, name, { value: init[name] });
  }
  return event;
}

async function press(target, key = 'F6', init = {}) {
  const event = keyboard(key, init);
  await act(async () => target.dispatchEvent(event));
  await settle();
  return event;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  errors = [];
  api.mockReset();
  api.mockResolvedValue({
    id: 'source-id', title: '来源', is_folder: false, is_deleted: false, updated_at: 1,
    content: JSON.stringify({ root: { type: 'root', children: [{ type: 'paragraph', $: { localBlockId: blockId }, children: [{ type: 'text', text: '来源已保存正文' }] }] } }),
  });
  host = document.createElement('div');
  document.body.append(host);
  reactRoot = createRoot(host);
});

afterEach(async () => {
  if (reactRoot) await act(async () => reactRoot.unmount());
  host.remove();
  vi.restoreAllMocks();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('CodeBlock actual Lexical F6 entry and local header Tab boundary', () => {
  for (const rootSelection of [false, true]) {
    it(`enters the actual language action without changing ${rootSelection ? 'root' : 'text'} selection, code, format or indent`, async () => {
      await mount();
      await focusText({ rootSelection });
      const before = snapshot();
      const target = language();
      const clicked = vi.fn();
      target.addEventListener('click', clicked);
      const event = await press(editor.getRootElement());
      expect(document.activeElement).toBe(target);
      expect(event.defaultPrevented).toBe(true);
      expect(clicked).not.toHaveBeenCalled();
      expect(owned().querySelector('.language-selector-dropdown')).toBeNull();
      expectUnchanged(before);
    });
  }

  it('supports reading-first false→true→false→true on the same root, component and language button', async () => {
    await mount({ editable: false });
    const root = editor.getRootElement(), block = owned(), target = language(), before = model();
    expect(target.disabled).toBe(true);
    expect((await press(root)).defaultPrevented).toBe(false);
    for (const editable of [true, false, true]) {
      await act(async () => editor.setEditable(editable));
      await settle();
      expect(editor.getRootElement()).toBe(root);
      expect(owned()).toBe(block);
      expect(language()).toBe(target);
      expect(target.disabled).toBe(!editable);
      if (editable) {
        await focusText();
        const selectionBefore = snapshot();
        expect((await press(root)).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(target);
        expectUnchanged(selectionBefore);
      } else {
        const active = document.activeElement;
        expect((await press(root)).defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(active);
      }
      expect(model()).toEqual(before);
    }
  });

  it('does not use stale editability before React rerenders', async () => {
    await mount();
    await focusText();
    const before = model(), event = keyboard('F6');
    await act(async () => {
      editor.setEditable(false);
      editor.getRootElement().dispatchEvent(event);
    });
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(language());
    expect(model()).toEqual(before);
  });

  for (const [name, init] of Object.entries({
    Shift: { shiftKey: true }, Control: { ctrlKey: true }, Alt: { altKey: true }, Meta: { metaKey: true },
    composition: { isComposing: true }, keyCode229: { keyCode: 229 }, which229: { which: 229 },
  })) {
    it(`leaves ${name} F6 unhandled without moving focus or selection`, async () => {
      await mount();
      await focusText();
      const before = snapshot(), root = editor.getRootElement();
      expect((await press(root, 'F6', init)).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(root);
      expectUnchanged(before);
    });
  }

  it('yields to a pre-consumed capture F6 without requiring stopPropagation', async () => {
    await mount();
    await focusText();
    const root = editor.getRootElement(), before = snapshot();
    const consume = event => event.preventDefault();
    root.addEventListener('keydown', consume, true);
    const event = await press(root);
    root.removeEventListener('keydown', consume, true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root);
    expectUnchanged(before);
  });

  it('never steals F6 from a header action, code textarea or a foreign editor root', async () => {
    await mount();
    const before = model();
    for (const target of [language(), owned().querySelector('textarea')]) {
      await act(async () => target.focus());
      expect((await press(target)).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(target);
      expect(model()).toEqual(before);
    }
    const foreign = document.createElement('div');
    foreign.className = 'editor-input';
    foreign.setAttribute('contenteditable', 'true');
    host.append(foreign);
    foreign.focus();
    expect((await press(foreign)).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(foreign);
    expect(model()).toEqual(before);
    foreign.remove();
  });

  it('requires the event target and current focus both to be the actual root', async () => {
    await mount();
    language().focus();
    const target = language(), before = model();
    expect((await press(editor.getRootElement())).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(target);
    expect(model()).toEqual(before);
  });

  it('chooses only the first enabled same-root real header across multiple code components and an outside preview', async () => {
    await mount({ count: 2 });
    const preview = document.createElement('div');
    preview.innerHTML = '<div class="code-block-wrapper"><div class="code-block-header"><button class="language-selector-button">foreign preview</button></div></div>';
    host.prepend(preview);
    const root = editor.getRootElement();
    const targets = [...root.querySelectorAll(ownerSelector)].map(block => block.querySelector('.language-selector-button'));
    const focused = targets.map(target => vi.spyOn(target, 'focus'));
    await focusText();
    const before = snapshot();
    expect((await press(root)).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(targets[0]);
    expect(focused[0]).toHaveBeenCalledTimes(1);
    expect(focused[1]).not.toHaveBeenCalled();
    expectUnchanged(before);
    targets[0].disabled = true;
    await focusText();
    const secondBefore = snapshot();
    expect((await press(root)).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(targets[1]);
    expect(focused[1]).toHaveBeenCalledTimes(1);
    expectUnchanged(secondBefore);
    targets[0].disabled = false;
    preview.remove();
  });

  it('does not consume when the only language button is disabled, disconnected or cannot receive focus', async () => {
    await mount();
    const root = editor.getRootElement(), target = language(), parent = target.parentNode, next = target.nextSibling;
    for (const state of ['disabled', 'disconnected', 'focus-failed']) {
      await focusText();
      const before = snapshot();
      let focus;
      if (state === 'disabled') target.disabled = true;
      if (state === 'disconnected') target.remove();
      if (state === 'focus-failed') focus = vi.spyOn(target, 'focus').mockImplementation(() => {});
      const event = await press(root);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(root);
      expectUnchanged(before);
      if (focus) { expect(focus).toHaveBeenCalledTimes(1); focus.mockRestore(); }
      target.disabled = false;
      if (!target.isConnected) parent.insertBefore(target, next);
    }
  });

  for (const previous of Object.keys(previousEntries)) {
    for (const previousFirst of [false, true]) {
      it(`retains actual ${previous} capture priority with code mounted ${previousFirst ? 'after' : 'before'} it`, async () => {
        await mount({ previous, previousFirst });
        const root = editor.getRootElement(), action = root.querySelector(previousEntries[previous].action);
        expect(action).toBeTruthy();
        expect(action.disabled).toBe(false);
        if (previous === 'embed') {
          expect(root.querySelector('.block-reference-embed pre').textContent).toBe('来源已保存正文');
          expect(api).toHaveBeenCalledTimes(1);
        }
        await focusText();
        const before = snapshot(), codeFocus = vi.spyOn(language(), 'focus');
        expect((await press(root)).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(action);
        expect(codeFocus).not.toHaveBeenCalled();
        expectUnchanged(before);
      });
    }
  }

  it('allows uncanceled Tab and ShiftTab on every actual header button without bubbling to Lexical', async () => {
    await mount();
    const root = editor.getRootElement(), bubbled = vi.fn();
    root.addEventListener('keydown', bubbled);
    const buttons = [...owned().querySelectorAll('.code-block-header button')];
    expect(buttons).toHaveLength(4);
    const before = model();
    for (const button of buttons) {
      for (const shiftKey of [false, true]) {
        await act(async () => button.focus());
        const selectionBefore = snapshot();
        const event = await press(button, 'Tab', { shiftKey });
        expect(event.defaultPrevented).toBe(false);
        expect(bubbled).not.toHaveBeenCalled();
        // Happy DOM has no browser Tab traversal: this verifies the event boundary only.
        expect(document.activeElement).toBe(button);
        expectUnchanged(selectionBefore);
      }
    }
    expect(model()).toEqual(before);
    root.removeEventListener('keydown', bubbled);
  });

  it('does not intercept modified, composing, pre-consumed, unfocused or disabled header Tab', async () => {
    await mount();
    const root = editor.getRootElement(), target = language(), bubbled = vi.fn();
    root.addEventListener('keydown', bubbled);
    for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { which: 229 }]) {
      await act(async () => target.focus());
      const event = await press(target, 'Tab', init);
      expect(bubbled).toHaveBeenLastCalledWith(event);
    }
    const consumed = keyboard('Tab');
    consumed.preventDefault();
    await act(async () => target.dispatchEvent(consumed));
    expect(bubbled).toHaveBeenLastCalledWith(consumed);
    await focusText();
    const unfocused = await press(target, 'Tab');
    expect(bubbled).toHaveBeenLastCalledWith(unfocused);
    await act(async () => target.focus());
    target.disabled = true;
    const disabled = await press(target, 'Tab');
    expect(bubbled).toHaveBeenLastCalledWith(disabled);
    target.disabled = false;
    root.removeEventListener('keydown', bubbled);
    expect(errors).toEqual([]);
  });

  it('does not intercept textarea or language search Tab, nor textarea IME F6', async () => {
    await mount();
    const root = editor.getRootElement(), bubbled = vi.fn(), before = model();
    root.addEventListener('keydown', bubbled);
    const textarea = owned().querySelector('textarea');
    textarea.focus();
    textarea.setSelectionRange(2, 7);
    const tab = await press(textarea, 'Tab');
    expect(bubbled).toHaveBeenLastCalledWith(tab);
    expect((await press(textarea, 'F6', { isComposing: true })).defaultPrevented).toBe(false);
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(7);
    expect(document.activeElement).toBe(textarea);
    await act(async () => language().click());
    await settle();
    const search = owned().querySelector('.language-selector-search');
    expect(search).toBeTruthy();
    search.focus();
    const searchTab = await press(search, 'Tab');
    expect(bubbled).toHaveBeenLastCalledWith(searchTab);
    expect(model()).toEqual(before);
    root.removeEventListener('keydown', bubbled);
  });

  it('leaves a focused button outside the actual direct header on the original bubbling path', async () => {
    await mount();
    const root = editor.getRootElement(), bubbled = vi.fn(), before = model();
    const foreign = document.createElement('button');
    foreign.type = 'button';
    foreign.textContent = 'foreign code-content action';
    owned().querySelector('.code-block-content').append(foreign);
    root.addEventListener('keydown', bubbled);
    foreign.focus();
    const event = await press(foreign, 'Tab');
    expect(bubbled).toHaveBeenLastCalledWith(event);
    expect(model()).toEqual(before);
    root.removeEventListener('keydown', bubbled);
    foreign.remove();
  });

  it('keeps real body Tab and ShiftTab indentation with each editor update committed', async () => {
    await mount();
    await focusText();
    // Lexical indents at a block start; a mid-text range correctly inserts a tab.
    await act(async () => editor.update(() => {
      $getRoot().getFirstChildOrThrow().getFirstChildOrThrow().select(0, 0);
    }, { discrete: true }));
    await settle();
    const before = model(), root = editor.getRootElement();
    expect(before.root.children[0].indent).toBe(2);
    expect((await press(root, 'Tab')).defaultPrevented).toBe(true);
    expect(model().root.children[0].indent).toBe(3);
    expect((await press(root, 'Tab', { shiftKey: true })).defaultPrevented).toBe(true);
    expect(model()).toEqual(before);
    expect(document.activeElement).toBe(root);
    expect(errors).toEqual([]);
  });

  it('removes root and header listeners when the actual component unmounts', async () => {
    await mount();
    const root = editor.getRootElement(), header = owned().querySelector('.code-block-header');
    const rootRemove = vi.spyOn(root, 'removeEventListener'), headerRemove = vi.spyOn(header, 'removeEventListener');
    await act(async () => reactRoot.unmount());
    reactRoot = null;
    expect(rootRemove.mock.calls.some(([name, handler, capture]) => name === 'keydown' && typeof handler === 'function' && !capture)).toBe(true);
    expect(headerRemove.mock.calls.some(([name, handler, capture]) => name === 'keydown' && typeof handler === 'function' && !capture)).toBe(true);
  });
});
