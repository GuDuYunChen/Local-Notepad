// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, SKIP_DOM_SELECTION_TAG } from 'lexical';
import UiThemeProvider from '~/components/ui/UiThemeProvider';
import { CodeBlockNode, $createCodeBlockNode } from './CodeBlockNode';
import CodeBlockPlugin from '../plugins/CodeBlockPlugin';
import { restoreDocumentSelectionSnapshot } from '../plugins/DocumentSessionPlugin';

// This explicitly schedules a real Lexical selection-only update in the same
// task as a synthetic F6. It proves the pending-commit boundary in jsdom, not
// the source or timing of the original Windows trusted F6 failure. No focus or
// Selection API is mocked, no production timer/budget is changed, and the old
// 38 tests remain separate and unmodified.
const code = '// 仅本机合成代码\nconst note = "中文与长行显示";\nconsole.log(note);';
let host, reactRoot, editor, errors, rangeRectDescriptor;

beforeAll(() => {
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

const settleSelectionTask = async () => act(async () => {
  await Promise.resolve();
  // A single task turn delivers jsdom's queued selectionchange notification;
  // it is a fixture event-loop drain, not a product wait or repair.
  await new Promise(resolve => setTimeout(resolve, 0));
});

function logical(state = editor.getEditorState()) {
  return state.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return selection ? { type: selection.constructor.name } : null;
    return {
      anchor: { key: selection.anchor.key, offset: selection.anchor.offset, type: selection.anchor.type },
      focus: { key: selection.focus.key, offset: selection.focus.offset, type: selection.focus.type },
      format: selection.format, style: selection.style,
    };
  });
}

function dom() {
  const selection = window.getSelection();
  return { rangeCount: selection.rangeCount, anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode, focusOffset: selection.focusOffset };
}

function diagnostic(stage, event) {
  const root = editor.getRootElement(), selection = dom();
  const node = value => value && { name: value.nodeName, type: value.nodeType, inEditor: value === root || root.contains(value) };
  const pending = editor._pendingEditorState;
  return { stage, key: event?.key, trusted: event?.isTrusted, defaultPrevented: event?.defaultPrevented,
    active: document.activeElement === root ? 'editor' : document.activeElement?.className,
    dom: { ...selection, anchorNode: node(selection.anchorNode), focusNode: node(selection.focusNode) },
    logical: logical(), pendingLogical: pending ? logical(pending) : null,
    pendingSelectionDirty: Boolean(pending?._selection?.dirty) };
}

async function mount({ paragraph }) {
  await act(async () => reactRoot.render(
    <UiThemeProvider>
      <LexicalComposer initialConfig={{
        namespace: 'code-block-pending-selection', theme: { codeBlock: 'code-block-wrapper' }, nodes: [CodeBlockNode],
        editorState: () => {
          if (paragraph) $getRoot().append($createParagraphNode().append($createTextNode('保留原始正文与格式')));
          $getRoot().append($createCodeBlockNode(code, 'plaintext'));
        },
        onError: error => errors.push(error),
      }}>
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <TabIndentationPlugin maxIndent={8} />
        <CodeBlockPlugin />
        <CaptureEditor />
      </LexicalComposer>
    </UiThemeProvider>
  ));
  await settleSelectionTask();
  await act(async () => {
    editor.getRootElement().focus();
    editor.update(() => {
      if (paragraph) $getRoot().getFirstChildOrThrow().getFirstChildOrThrow().select(1, 5);
      else $getRoot().select(0, 0);
    }, { discrete: true });
  });
  await settleSelectionTask();
  expect(errors).toEqual([]);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  errors = [];
  host = document.createElement('div');
  document.body.append(host);
  reactRoot = createRoot(host);
});
afterEach(async () => {
  await act(async () => reactRoot.unmount());
  host.remove();
  vi.restoreAllMocks();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('CodeBlock F6 preserves empty endpoints through a real pending selection-only commit', () => {
  for (const producer of ['editor-focus', 'document-session-restore']) {
    it(`retains empty DOM selection with ${producer} pending in the explicitly constructed task`, async () => {
      await mount({ paragraph: producer === 'document-session-restore' });
      const root = editor.getRootElement();
      const target = root.querySelector('.code-block-wrapper > .code-block-header .language-selector-button');
      const beforeDocument = editor.getEditorState().toJSON();
      const beforeLogical = logical();
      window.getSelection().removeAllRanges();
      const beforeDOM = dom();
      expect(beforeDOM).toEqual({ rangeCount: 0, anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
      expect(document.activeElement).toBe(root);

      const trace = [diagnostic('initial-empty')];
      const commits = [];
      const unregister = editor.registerUpdateListener(({ editorState, tags }) => {
        commits.push({ document: editorState.toJSON(), tags: [...tags] });
        trace.push({ ...diagnostic('lexical-commit'), tags: [...tags] });
      });
      const capture = event => trace.push(diagnostic('root-capture', event));
      const bubble = event => trace.push(diagnostic('root-bubble-after-entry', event));
      root.addEventListener('keydown', capture, true);
      root.addEventListener('keydown', bubble);
      const event = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true });
      let synchronousDOM;
      try {
        await act(async () => {
          if (producer === 'editor-focus') editor.focus();
          else editor.update(() => {
            expect(restoreDocumentSelectionSnapshot({ anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 5 } })).toBe(true);
          });
          trace.push(diagnostic('producer-pending-before-key'));
          expect(editor._pendingEditorState?._selection?.dirty).toBe(true);
          expect(dom()).toEqual(beforeDOM);
          expect(document.activeElement).toBe(root);
          root.dispatchEvent(event);
          synchronousDOM = dom();
          trace.push(diagnostic('synchronous-after-key'));
        });
        await settleSelectionTask();
        trace.push(diagnostic('settled-entered'));
        console.info('PENDING_SELECTION_TRACE', JSON.stringify({ producer, simulatedTrustedInput: false, trace, commits }));
        expect(event.isTrusted).toBe(false);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(target);
        expect(synchronousDOM).toEqual(beforeDOM);
        expect(commits.length).toBeGreaterThan(0);
        expect(commits.every(item => JSON.stringify(item.document) === JSON.stringify(beforeDocument))).toBe(true);
        expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
        expect(logical()).toEqual(beforeLogical);
        expect(errors).toEqual([]);
        expect(dom()).toEqual(beforeDOM);
      } finally {
        unregister();
        root.removeEventListener('keydown', capture, true);
        root.removeEventListener('keydown', bubble);
      }
    });
  }

  it('commits a same-batch real body edit and delivers its update listener while preserving the focus entrance, then reconciles the next edit normally', async () => {
    await mount({ paragraph: true });
    const root = editor.getRootElement();
    const target = root.querySelector('.language-selector-button');
    const beforeDocument = editor.getEditorState().toJSON();
    window.getSelection().removeAllRanges();
    const beforeDOM = dom(), commits = [];
    const unregister = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      commits.push({ document: editorState.toJSON(), dirty: dirtyElements.size + dirtyLeaves.size, tags: [...tags] });
    });
    try {
      const event = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true });
      await act(async () => {
        editor.update(() => {
          const text = $getRoot().getFirstChildOrThrow().getFirstChildOrThrow();
          text.setTextContent('同批正文修改仍提交');
          text.select(1, 5);
        });
        expect(dom()).toEqual(beforeDOM);
        root.dispatchEvent(event);
      });
      await settleSelectionTask();
      const afterFirstEdit = editor.getEditorState().toJSON();
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(target);
      expect(dom()).toEqual(beforeDOM);
      expect(afterFirstEdit.root.children[0].children[0].text).toBe('同批正文修改仍提交');
      expect(afterFirstEdit.root.children[1]).toEqual(beforeDocument.root.children[1]);
      expect(commits).toHaveLength(1);
      expect(commits[0].dirty).toBeGreaterThan(0);
      expect(commits[0].document).toEqual(afterFirstEdit);
      expect(commits[0].tags).toContain(SKIP_DOM_SELECTION_TAG);
      expect(editor.parseEditorState(JSON.stringify(afterFirstEdit)).toJSON()).toEqual(afterFirstEdit);

      const previousCommitCount = commits.length;
      await act(async () => {
        root.focus();
        editor.update(() => {
          const text = $getRoot().getFirstChildOrThrow().getFirstChildOrThrow();
          text.setTextContent('下一次正文修改正常选区');
          text.select(2, 6);
        }, { discrete: true });
      });
      await settleSelectionTask();
      const afterSecondEdit = editor.getEditorState().toJSON();
      const nextCommits = commits.slice(previousCommitCount);
      expect(afterSecondEdit.root.children[0].children[0].text).toBe('下一次正文修改正常选区');
      expect(afterSecondEdit.root.children[1]).toEqual(beforeDocument.root.children[1]);
      expect(nextCommits.length).toBeGreaterThan(0);
      expect(nextCommits.every(item => !item.tags.includes(SKIP_DOM_SELECTION_TAG))).toBe(true);
      expect(nextCommits.some(item => item.dirty > 0 && JSON.stringify(item.document) === JSON.stringify(afterSecondEdit))).toBe(true);
      expect(dom().rangeCount).toBe(1);
      expect(dom().anchorOffset).toBe(2);
      expect(dom().focusOffset).toBe(6);
      expect(root.contains(dom().anchorNode)).toBe(true);
      expect(document.activeElement).toBe(root);
      expect(errors).toEqual([]);
      console.info('PENDING_BODY_COMMIT_TRACE', JSON.stringify({ commits, finalDOM: diagnostic('next-edit') }));
    } finally { unregister(); }
  });

  it('adds no body commit for an otherwise quiescent empty-selection entrance and leaves the next normal selection update untagged', async () => {
    await mount({ paragraph: true });
    const root = editor.getRootElement(), target = root.querySelector('.language-selector-button');
    const beforeDocument = editor.getEditorState().toJSON(), beforeLogical = logical();
    window.getSelection().removeAllRanges();
    const beforeDOM = dom(), commits = [];
    const unregister = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      commits.push({ document: editorState.toJSON(), dirty: dirtyElements.size + dirtyLeaves.size, tags: [...tags] });
    });
    try {
      const event = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true });
      await act(async () => root.dispatchEvent(event));
      await settleSelectionTask();
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(target);
      expect(dom()).toEqual(beforeDOM);
      expect(logical()).toEqual(beforeLogical);
      expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
      expect(commits).toHaveLength(0);
      await act(async () => {
        root.focus();
        editor.update(() => $getRoot().getFirstChildOrThrow().getFirstChildOrThrow().select(2, 6), { discrete: true });
      });
      await settleSelectionTask();
      expect(commits.length).toBeGreaterThan(0);
      expect(commits.every(item => !item.tags.includes(SKIP_DOM_SELECTION_TAG))).toBe(true);
      expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
      expect(dom().rangeCount).toBe(1);
      expect(dom().anchorOffset).toBe(2);
      expect(dom().focusOffset).toBe(6);
      expect(document.activeElement).toBe(root);
      expect(errors).toEqual([]);
    } finally { unregister(); }
  });

  for (const boundary of ['focus-failed', 'focus-diverted', 'nonempty-selection', 'owner-changed-on-focus', 'preconsumed-capture', 'modified-F6']) {
    it(`does not tag the pending normal update for ${boundary}`, async () => {
      await mount({ paragraph: false });
      const root = editor.getRootElement(), target = root.querySelector('.language-selector-button');
      const header = target.closest('.code-block-header');
      const beforeDocument = editor.getEditorState().toJSON();
      if (boundary !== 'nonempty-selection') window.getSelection().removeAllRanges();
      const beforeDOM = dom(), commits = [];
      const unregister = editor.registerUpdateListener(({ editorState, tags }) => commits.push({ document: editorState.toJSON(), tags: [...tags] }));
      const other = document.createElement('button');
      other.textContent = 'separate focus owner';
      host.append(other);
      const divertFocus = () => other.focus();
      const changeOwner = () => header.classList.remove('code-block-header');
      const consume = event => event.preventDefault();
      if (boundary === 'focus-failed') vi.spyOn(target, 'focus').mockImplementation(() => {});
      if (boundary === 'focus-diverted') target.addEventListener('focus', divertFocus);
      if (boundary === 'owner-changed-on-focus') target.addEventListener('focus', changeOwner);
      if (boundary === 'preconsumed-capture') root.addEventListener('keydown', consume, true);
      const event = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true, ctrlKey: boundary === 'modified-F6' });
      let synchronousActive, synchronousPrevented;
      try {
        await act(async () => {
          editor.focus();
          expect(dom()).toEqual(beforeDOM);
          root.dispatchEvent(event);
          synchronousActive = document.activeElement;
          synchronousPrevented = event.defaultPrevented;
        });
        await settleSelectionTask();
        expect(commits.length).toBeGreaterThan(0);
        expect(commits.every(item => !item.tags.includes(SKIP_DOM_SELECTION_TAG))).toBe(true);
        expect(commits.every(item => JSON.stringify(item.document) === JSON.stringify(beforeDocument))).toBe(true);
        expect(editor.getEditorState().toJSON()).toEqual(beforeDocument);
        expect(dom().rangeCount).toBe(1);
        if (boundary === 'nonempty-selection') expect(dom()).toEqual(beforeDOM);
        if (boundary === 'focus-failed' || boundary === 'modified-F6') {
          expect(synchronousActive).toBe(root);
          expect(synchronousPrevented).toBe(false);
        }
        if (boundary === 'focus-diverted') {
          expect(synchronousActive).toBe(other);
          expect(synchronousPrevented).toBe(false);
        }
        if (boundary === 'owner-changed-on-focus') {
          expect(synchronousActive).toBe(target);
          expect(target.closest('.code-block-header')).toBeNull();
        }
        if (boundary === 'preconsumed-capture') {
          expect(synchronousActive).toBe(root);
          expect(synchronousPrevented).toBe(true);
        }
        expect(errors).toEqual([]);
        console.info('PENDING_GUARD_TRACE', JSON.stringify({ boundary, commits, final: diagnostic('guard-complete') }));
      } finally {
        unregister();
        target.removeEventListener('focus', divertFocus);
        target.removeEventListener('focus', changeOwner);
        root.removeEventListener('keydown', consume, true);
        header.classList.add('code-block-header');
        other.remove();
      }
    });
  }
});
