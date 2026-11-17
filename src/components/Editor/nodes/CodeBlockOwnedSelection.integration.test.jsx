// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import {
  $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection,
  SKIP_DOM_SELECTION_TAG, SKIP_SCROLL_INTO_VIEW_TAG,
} from 'lexical';
import UiThemeProvider from '~/components/ui/UiThemeProvider';
import { CodeBlockNode, $createCodeBlockNode } from './CodeBlockNode';
import CodeBlockPlugin from '../plugins/CodeBlockPlugin';
import { bindCodeBlockKeyboardAccess } from './codeBlockKeyboard';

// Real jsdom focus and Selection APIs. The two positive cases also mount the
// real Lexical CodeBlock component and deliver its selectionchange task.
// Guard cases prove that F6 does not restore an old range over an observed
// handler change. jsdom itself may subsequently collapse that handler's range;
// these cases do not call that automatic behavior preservation of user intent.
// Synthetic F6 and missing-layout shims do not establish native Windows input.
const text = '保留原始正文与格式，继续本地选择';
const code = 'const note = "synthetic";\nconsole.log(note);';
let host, reactRoot, editor, errors, cleanups, rangeRectDescriptor;

beforeAll(() => {
  rangeRectDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
  if (!rangeRectDescriptor) Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true, value: () => new DOMRect(),
  });
});
afterAll(() => {
  if (!rangeRectDescriptor) delete Range.prototype.getBoundingClientRect;
});
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  reactRoot = null; editor = null; errors = []; cleanups = [];
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  if (reactRoot) await act(async () => reactRoot.unmount());
  host.remove();
  vi.restoreAllMocks();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const settleSelectionTask = async () => act(async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
  // One fixture task delivers jsdom's actual asynchronous selectionchange.
  await new Promise(resolve => setTimeout(resolve, 0));
});

function dom() {
  const selection = document.getSelection();
  return {
    rangeCount: selection.rangeCount,
    anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode, focusOffset: selection.focusOffset,
  };
}
function logical() {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return selection ? { type: selection.constructor.name } : null;
    return {
      anchor: { key: selection.anchor.key, offset: selection.anchor.offset, type: selection.anchor.type },
      focus: { key: selection.focus.key, offset: selection.focus.offset, type: selection.focus.type },
      text: selection.getTextContent(), format: selection.format, style: selection.style,
      backward: selection.isBackward(),
    };
  });
}
function CaptureEditor() {
  const [instance] = useLexicalComposerContext();
  useEffect(() => { editor = instance; }, [instance]);
  return null;
}
function f6(root) {
  const event = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true });
  root.dispatchEvent(event);
  return event;
}
function listen(target, name, handler, options) {
  target.addEventListener(name, handler, options);
  cleanups.push(() => target.removeEventListener(name, handler, options));
}

async function checkLexicalRange(backward) {
  reactRoot = createRoot(host);
  await act(async () => reactRoot.render(
    <UiThemeProvider>
      <LexicalComposer initialConfig={{
        namespace: 'code-block-owned-selection', nodes: [CodeBlockNode],
        theme: { codeBlock: 'code-block-wrapper' },
        editorState: () => {
          const paragraph = $createParagraphNode().setIndent(2);
          paragraph.append($createTextNode(text).toggleFormat('bold'));
          $getRoot().append(paragraph, $createCodeBlockNode(code, 'javascript'));
        },
        onError: error => errors.push(error),
      }}>
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <CodeBlockPlugin />
        <CaptureEditor />
      </LexicalComposer>
    </UiThemeProvider>
  ));
  await settleSelectionTask();
  const root = editor.getRootElement();
  const button = root.querySelector('.code-block-wrapper > .code-block-header .language-selector-button');
  expect(button).toBeTruthy();
  await act(async () => {
    root.focus();
    editor.update(() => {
      $getRoot().getFirstChildOrThrow().getFirstChildOrThrow().select(backward ? 5 : 1, backward ? 1 : 5);
    }, { discrete: true });
  });
  await settleSelectionTask();
  const before = { body: JSON.stringify(editor.getEditorState()), logical: logical(), dom: dom() };
  expect(document.activeElement).toBe(root);
  expect(before.dom.rangeCount).toBe(1);
  expect(before.dom.anchorNode.nodeType).toBe(Node.TEXT_NODE);
  expect(root.contains(before.dom.anchorNode)).toBe(true);
  expect(before.dom.focusNode).toBe(before.dom.anchorNode);
  expect(before.dom.anchorOffset).toBe(backward ? 5 : 1);
  expect(before.dom.focusOffset).toBe(backward ? 1 : 5);
  expect(before.logical.backward).toBe(backward);
  expect(before.logical.text).toBe(text.slice(1, 5));
  expect(errors).toEqual([]);
  const commits = [];
  cleanups.push(editor.registerUpdateListener(({ editorState, tags, dirtyElements, dirtyLeaves }) => {
    commits.push({ body: JSON.stringify(editorState), tags: [...tags], dirty: dirtyElements.size + dirtyLeaves.size });
  }));
  const clicked = vi.fn();
  listen(button, 'click', clicked);
  let key, synchronous;
  await act(async () => { key = f6(root); synchronous = dom(); });
  await settleSelectionTask();
  expect(key.isTrusted).toBe(false);
  expect(key.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(button);
  expect(synchronous).toEqual(before.dom);
  expect(dom()).toEqual(before.dom);
  expect(logical()).toEqual(before.logical);
  expect(JSON.stringify(editor.getEditorState())).toBe(before.body);
  expect(editor.parseEditorState(before.body).toJSON()).toEqual(JSON.parse(before.body));
  expect(commits.filter(item => item.dirty > 0)).toEqual([]);
  expect(commits.flatMap(item => item.tags)).not.toContain(SKIP_DOM_SELECTION_TAG);
  expect(commits.flatMap(item => item.tags)).not.toContain(SKIP_SCROLL_INTO_VIEW_TAG);
  expect(clicked).not.toHaveBeenCalled();
  expect(root.querySelector('.language-selector-dropdown')).toBeNull();
  expect(errors).toEqual([]);
}

async function plainFixture() {
  const root = document.createElement('div');
  root.className = 'editor-input'; root.setAttribute('contenteditable', 'true'); root.tabIndex = 0;
  root.innerHTML = '<p>original owned text for code selection</p><div class="code-block-wrapper"><div class="code-block-header"><button type="button" class="language-selector-button">JavaScript</button></div></div>';
  host.append(root);
  const block = root.querySelector('.code-block-wrapper');
  const button = root.querySelector('.language-selector-button');
  const node = root.querySelector('p').firstChild;
  const preserveEmpty = vi.fn();
  cleanups.push(bindCodeBlockKeyboardAccess(block, () => root.getAttribute('contenteditable') === 'true', preserveEmpty));
  root.focus();
  const selection = document.getSelection();
  selection.setBaseAndExtent(node, 1, node, 5);
  await settleSelectionTask();
  expect(document.activeElement).toBe(root);
  expect(dom()).toEqual({ rangeCount: 1, anchorNode: node, anchorOffset: 1, focusNode: node, focusOffset: 5 });
  return { root, block, button, node, selection, preserveEmpty, before: dom(), html: root.innerHTML };
}
function expectButtonRange(button) {
  expect(dom()).toEqual({ rangeCount: 1, anchorNode: button, anchorOffset: 0, focusNode: button, focusOffset: 0 });
}

async function checkHandlerRange(where) {
  const fixture = await plainFixture();
  const { root, button, node, selection, preserveEmpty, before, html } = fixture;
  const originalRange = selection.getRangeAt(0);
  const setBaseAndExtent = vi.spyOn(selection, 'setBaseAndExtent'); // delegates to the real API
  let calls = 0, observed, handlerRange;
  const target = where === 'target' ? button : where === 'root' ? root : where === 'document' ? document : window;
  const name = where === 'target' ? 'focus' : 'focusin';
  listen(target, name, event => {
    if (event.target !== button) return;
    calls += 1;
    if (where === 'root') {
      // Mutate the same live Range; the saved primitive endpoints must still
      // reveal the change even though Range object identity remains equal.
      originalRange.setStart(node, 2); originalRange.setEnd(node, 6);
    } else if (where === 'document') {
      // A new Range with the same points also belongs to the focus handler.
      const range = document.createRange(); range.setStart(node, 1); range.setEnd(node, 5);
      selection.removeAllRanges(); selection.addRange(range);
    } else selection.setBaseAndExtent(node, where === 'window' ? 14 : 7, node, where === 'window' ? 8 : 12);
    observed = dom(); handlerRange = selection.getRangeAt(0);
  });
  const key = f6(root);
  expect(calls).toBe(1);
  const anchor = where === 'root' ? 2 : where === 'document' ? 1 : where === 'window' ? 14 : 7;
  const focus = where === 'root' ? 6 : where === 'document' ? 5 : where === 'window' ? 8 : 12;
  expect(observed).toEqual({ rangeCount: 1, anchorNode: node, anchorOffset: anchor, focusNode: node, focusOffset: focus });
  if (where === 'root') expect(handlerRange).toBe(originalRange);
  else expect(handlerRange).not.toBe(originalRange);
  expect(setBaseAndExtent).toHaveBeenCalledTimes(where === 'target' || where === 'window' ? 1 : 0);
  if (where === 'target' || where === 'window') expect(setBaseAndExtent).toHaveBeenLastCalledWith(node, anchor, node, focus);
  expect(document.activeElement).toBe(button);
  expect(key.defaultPrevented).toBe(true);
  // jsdom's own focus algorithm collapses after these handlers. The contract
  // here is that our entrance did not then restore the superseded old range.
  expectButtonRange(button);
  expect(dom()).not.toEqual(before);
  await settleSelectionTask();
  expectButtonRange(button);
  expect(root.innerHTML).toBe(html);
  expect(preserveEmpty).not.toHaveBeenCalled();
}

describe('CodeBlock owned nonempty selection through real focus', () => {
  it('NS01 preserves forward Lexical text endpoints and body through the actual selectionchange task', async () => {
    await checkLexicalRange(false);
  });
  it('NS02 preserves backward Lexical text endpoints and direction through the actual selectionchange task', async () => {
    await checkLexicalRange(true);
  });
  it('NS03 yields to a new range from the target focus handler', async () => {
    await checkHandlerRange('target');
  });
  it('NS04 yields to an in-place live Range mutation from the root focusin handler', async () => {
    await checkHandlerRange('root');
  });
  it('NS05 yields to a new same-endpoint Range from the document focusin handler', async () => {
    await checkHandlerRange('document');
  });
  it('NS06 yields to a backward new range from an existing window focusin handler', async () => {
    await checkHandlerRange('window');
  });
  it('NS07 does not restore the old range after a real focus handler transfers focus to a foreign control', async () => {
    const { root, button, selection, preserveEmpty, before, html } = await plainFixture();
    const foreign = document.createElement('button'); foreign.type = 'button'; foreign.textContent = 'foreign focus'; host.append(foreign);
    const restore = vi.spyOn(selection, 'setBaseAndExtent');
    listen(button, 'focus', () => foreign.focus());
    const key = f6(root);
    expect(document.activeElement).toBe(foreign);
    expect(key.defaultPrevented).toBe(false);
    expect(restore).not.toHaveBeenCalled();
    expect(dom()).not.toEqual(before);
    await settleSelectionTask();
    expect(document.activeElement).toBe(foreign);
    expect(root.innerHTML).toBe(html);
    expect(preserveEmpty).not.toHaveBeenCalled();
  });
  it('NS08 does not restore when real focus invalidates the original editor root ownership', async () => {
    const { root, button, selection, preserveEmpty } = await plainFixture();
    const restore = vi.spyOn(selection, 'setBaseAndExtent');
    listen(button, 'focus', () => root.classList.remove('editor-input'));
    f6(root);
    expect(document.activeElement).toBe(button);
    expect(root.isConnected).toBe(true);
    expect(button.closest('.editor-input[contenteditable]')).toBeNull();
    expect(restore).not.toHaveBeenCalled();
    expectButtonRange(button);
    await settleSelectionTask();
    expectButtonRange(button);
    expect(preserveEmpty).not.toHaveBeenCalled();
  });
  it('NS09 does not restore saved endpoints detached by a real focus handler', async () => {
    const { root, button, node, selection, preserveEmpty } = await plainFixture();
    const restore = vi.spyOn(selection, 'setBaseAndExtent');
    listen(button, 'focus', () => node.remove());
    f6(root);
    expect(document.activeElement).toBe(button);
    expect(node.isConnected).toBe(false);
    expect(root.querySelector('p').textContent).toBe('');
    expect(restore).not.toHaveBeenCalled();
    expectButtonRange(button);
    await settleSelectionTask();
    expectButtonRange(button);
    expect(preserveEmpty).not.toHaveBeenCalled();
  });
  it('NS10 yields when an existing handler prevents completion of the focusin observation', async () => {
    const { root, button, selection, preserveEmpty } = await plainFixture();
    const restore = vi.spyOn(selection, 'setBaseAndExtent');
    let stopped = 0;
    listen(window, 'focusin', event => {
      if (event.target === button) { stopped += 1; event.stopImmediatePropagation(); }
    });
    f6(root);
    expect(stopped).toBe(1);
    expect(document.activeElement).toBe(button);
    expect(restore).not.toHaveBeenCalled();
    expectButtonRange(button);
    await settleSelectionTask();
    expectButtonRange(button);
    expect(preserveEmpty).not.toHaveBeenCalled();
  });
  it('NS11 removes both temporary observers after each successful entrance and preserves the next independent range', async () => {
    const { root, button, node, selection, preserveEmpty } = await plainFixture();
    const documentAdd = vi.spyOn(document, 'addEventListener'), documentRemove = vi.spyOn(document, 'removeEventListener');
    const windowAdd = vi.spyOn(window, 'addEventListener'), windowRemove = vi.spyOn(window, 'removeEventListener');
    for (const [anchor, focus] of [[1, 5], [6, 2]]) {
      root.focus(); selection.setBaseAndExtent(node, anchor, node, focus);
      const before = dom();
      expect(f6(root).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(button);
      expect(dom()).toEqual(before);
      await settleSelectionTask();
      expect(dom()).toEqual(before);
    }
    const focusAdds = documentAdd.mock.calls.filter(([name, , capture]) => name === 'focus' && capture === true);
    const focusInAdds = windowAdd.mock.calls.filter(([name]) => name === 'focusin');
    expect(focusAdds).toHaveLength(2);
    expect(focusInAdds).toHaveLength(2);
    for (const [name, listener, capture] of focusAdds) expect(documentRemove).toHaveBeenCalledWith(name, listener, capture);
    for (const [name, listener] of focusInAdds) expect(windowRemove).toHaveBeenCalledWith(name, listener);
    expect(preserveEmpty).not.toHaveBeenCalled();
  });
  it('NS12 never adopts a pre-existing selection whose endpoints belong to a foreign root', async () => {
    const { root, button, selection, preserveEmpty } = await plainFixture();
    const foreign = document.createElement('div'); foreign.className = 'editor-input'; foreign.setAttribute('contenteditable', 'true');
    foreign.textContent = 'foreign text'; host.append(foreign);
    selection.setBaseAndExtent(foreign.firstChild, 1, foreign.firstChild, 5);
    expect(document.activeElement).toBe(root);
    expect(root.contains(dom().anchorNode)).toBe(false);
    const restore = vi.spyOn(selection, 'setBaseAndExtent');
    f6(root);
    expect(document.activeElement).toBe(button);
    expect(restore).not.toHaveBeenCalled();
    expectButtonRange(button);
    await settleSelectionTask();
    expectButtonRange(button);
    expect(preserveEmpty).not.toHaveBeenCalled();
  });
  it('NS13 yields to an existing document focus capture handler that creates a new button-origin range', async () => {
    const { root, button, selection, preserveEmpty, before, html } = await plainFixture();
    const originalRange = selection.getRangeAt(0);
    const restore = vi.spyOn(selection, 'setBaseAndExtent');
    let calls = 0, observed, handlerRange;
    listen(document, 'focus', event => {
      if (event.target !== button) return;
      calls += 1;
      selection.setBaseAndExtent(button, 0, button, 0);
      observed = dom(); handlerRange = selection.getRangeAt(0);
    }, true);
    const key = f6(root);
    expect(calls).toBe(1);
    expect(observed).toEqual({ rangeCount: 1, anchorNode: button, anchorOffset: 0, focusNode: button, focusOffset: 0 });
    expect(handlerRange).not.toBe(originalRange);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith(button, 0, button, 0);
    expect(document.activeElement).toBe(button);
    expect(key.defaultPrevented).toBe(true);
    expectButtonRange(button);
    expect(dom()).not.toEqual(before);
    await settleSelectionTask();
    expectButtonRange(button);
    expect(root.innerHTML).toBe(html);
    expect(preserveEmpty).not.toHaveBeenCalled();
  });
});
