// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { HistoryPlugin, createEmptyHistoryState } from '@lexical/react/LexicalHistoryPlugin';
import {
  $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection,
  createEditor, getNearestEditorFromDOMNode, HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG,
  UNDO_COMMAND, SKIP_SCROLL_INTO_VIEW_TAG,
} from 'lexical';
import UiThemeProvider from '~/components/ui/UiThemeProvider';
import Editor, { LoadContentPlugin } from './Editor';
import { CodeBlockNode, $createCodeBlockNode } from './nodes/CodeBlockNode';
import CodeBlockPlugin from './plugins/CodeBlockPlugin';
import DocumentSessionPlugin, { writeDocumentSession } from './plugins/DocumentSessionPlugin';
import EvidenceNavigationPlugin from './plugins/EvidenceNavigationPlugin';
import { createTextEvidenceTarget } from './utils/evidenceNavigationUtils';
import { evidenceNavigation, isEvidenceContentReady, subscribeEvidenceContentReady } from '~/services/evidenceNavigation';
import { toast } from '~/services/toast';

// Reauthored after the 1116 scratch loss, not a byte recovery of that unrun
// file. These checks use the real AutoFocus, LoadContent, selection and DOM
// focus implementations. They do not establish trusted Windows F6 or layout.
// Only missing jsdom Range geometry is supplied. The two browser-state guard
// cases explicitly override visibility/hasFocus; positive cases do not.
const LOAD_TAG = 'local-notepad:content-load';
const documentId = 'load-focus-1117';
const code = '// 仅本机合成代码\nconst note = "中文与长行显示";\nconsole.log(note);';
let host, reactRoot, editor, errors, targets, ready, loadCommits, updates, cleanups;
let parseCalls, afterLoadReadCalled, history, options, foreign, frames, nextFrame;
let rangeRectDescriptor;

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
  localStorage.clear();
  evidenceNavigation.cancel();
  errors = []; targets = []; ready = []; loadCommits = []; updates = []; cleanups = [];
  parseCalls = 0; afterLoadReadCalled = false; editor = null; options = {};
  history = createEmptyHistoryState();
  frames = new Map(); nextFrame = 0;
  host = document.createElement('div');
  foreign = document.createElement('button');
  foreign.type = 'button'; foreign.textContent = '外部操作';
  document.body.append(host, foreign);
  reactRoot = createRoot(host);
});

afterEach(async () => {
  if (reactRoot) await act(async () => reactRoot.unmount());
  for (const cleanup of cleanups.splice(0)) cleanup();
  evidenceNavigation.cancel();
  host.remove(); foreign.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

function body(kind = 'paragraph', text = '保留原始正文与格式') {
  const source = createEditor({ namespace: 'load-focus-body', nodes: [CodeBlockNode], onError: error => { throw error; } });
  source.update(() => {
    if (kind === 'code') $getRoot().append($createCodeBlockNode(code, 'javascript'));
    else {
      const paragraph = $createParagraphNode();
      if (kind === 'formatted') paragraph.setIndent(2);
      if (text) {
        const node = $createTextNode(text);
        if (kind === 'formatted') node.toggleFormat('bold');
        paragraph.append(node);
      }
      $getRoot().append(paragraph);
    }
  }, { discrete: true });
  return JSON.stringify(source.getEditorState());
}

function logical(state = editor.getEditorState()) {
  return state.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return selection ? { type: selection.constructor.name } : null;
    return {
      anchor: { key: selection.anchor.key, offset: selection.anchor.offset, type: selection.anchor.type },
      focus: { key: selection.focus.key, offset: selection.focus.offset, type: selection.focus.type },
      text: selection.getTextContent(), format: selection.format, style: selection.style,
    };
  });
}

function dom() {
  const selection = document.getSelection();
  return {
    rangeCount: selection.rangeCount,
    anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode, focusOffset: selection.focusOffset,
  };
}

function snapshot() {
  return {
    body: JSON.stringify(editor.getEditorState()), logical: logical(), dom: dom(),
    pendingLogical: editor._pendingEditorState ? logical(editor._pendingEditorState) : null,
    active: document.activeElement, hasFocus: document.hasFocus(), visibility: document.visibilityState,
    root: editor.getRootElement(), editable: editor.isEditable(), undoCount: history.undoStack.length,
  };
}

function observe(instance) {
  editor = instance;
  const parse = instance.parseEditorState.bind(instance);
  vi.spyOn(instance, 'parseEditorState').mockImplementation((...args) => {
    parseCalls += 1;
    return parse(...args);
  });
  const read = instance.read.bind(instance);
  vi.spyOn(instance, 'read').mockImplementation((...args) => {
    const result = read(...args);
    // This hook runs only after the actual JSON load's force-commit read.
    // It injects a real competing update/focus action, never a replacement
    // selection getter or a manually manufactured positive-case gap.
    if (args.length === 1 && loadCommits.length && !afterLoadReadCalled && options.afterLoadRead) {
      afterLoadReadCalled = true;
      options.afterLoadRead(instance);
    }
    return result;
  });
  const update = instance.update.bind(instance);
  vi.spyOn(instance, 'update').mockImplementation((callback, updateOptions) => {
    if (updateOptions?.tag === LOAD_TAG && updateOptions.onUpdate && options.queueBeforeFallbackComplete) {
      return update(callback, { ...updateOptions, onUpdate: () => {
        // Lexical invokes onUpdate with _updating true. Queue a genuine
        // competing update first, then invoke the unchanged load callback.
        // The competing update has not executed when complete checks its
        // outer guard; it executes before the repair's queued callback.
        options.queueBeforeFallbackComplete(instance);
        updateOptions.onUpdate();
      } });
    }
    return update(callback, updateOptions);
  });
  cleanups.push(instance.registerUpdateListener(({ tags, dirtyElements, dirtyLeaves }) => {
    const row = { ...snapshot(), tags: [...tags], dirty: dirtyElements.size + dirtyLeaves.size };
    updates.push(row);
    if (tags.has(LOAD_TAG)) loadCommits.push(row);
  }));
  cleanups.push(subscribeEvidenceContentReady(() => {
    for (const target of targets) {
      if (isEvidenceContentReady(instance, target.id, target.content)) ready.push({ ...target, ...snapshot() });
    }
  }));
}

function Capture() {
  const [instance] = useLexicalComposerContext();
  useEffect(() => { observe(instance); }, [instance]);
  return null;
}

function fixture(content, id = documentId) {
  targets.push({ id, content });
  return <UiThemeProvider>
    <LexicalComposer initialConfig={{
      namespace: 'load-focus-1117', nodes: [CodeBlockNode],
      theme: { codeBlock: 'code-block-wrapper' }, editable: options.editable !== false,
      onError: error => errors.push(error),
    }}>
      <div className="editor-shell"><div className="editor-container">
        <RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />
        <HistoryPlugin externalHistoryState={history} />
        <Capture />
        {options.autoFocus !== false && <AutoFocusPlugin />}
        <CodeBlockPlugin />
        <LoadContentPlugin content={content} documentId={id} />
        {options.session && <DocumentSessionPlugin documentId={id} restoreSelection={options.editable !== false} />}
        {options.evidence && <EvidenceNavigationPlugin documentId={id} initialContent={content} />}
      </div></div>
    </LexicalComposer>
  </UiThemeProvider>;
}

const settle = async () => act(async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
  // One task delivers jsdom selectionchange. This is fixture event delivery,
  // not a product timer, a retry, or a native readiness-budget replacement.
  await new Promise(resolve => setTimeout(resolve, 0));
});

async function mount(content, configuration = {}) {
  options = configuration;
  await act(async () => {
    flushSync(() => reactRoot.render(fixture(content)));
    configuration.beforeRun?.(editor);
    await Promise.resolve();
  });
  await settle();
}

function expectNaturalJSONGap(content) {
  expect(parseCalls).toBe(1);
  expect(loadCommits).toHaveLength(1);
  const row = loadCommits[0];
  expect(row.body).toBe(content);
  expect(row.active).toBe(row.root);
  expect(row.hasFocus).toBe(true);
  expect(row.visibility).toBe('visible');
  expect(row.logical).toBeNull();
  expect(row.dom).toEqual({ rangeCount: 0, anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
  return row;
}

function expectReadyCaret(content) {
  expect(errors).toEqual([]);
  expect(ready).toHaveLength(1);
  const row = ready[0];
  // Both body assertions must run before the expected old-version missing
  // logical-caret assertion. A failing old control cannot skip these proofs.
  expect(row.body).toBe(content);
  expect(JSON.stringify(editor.getEditorState())).toBe(content);
  expect(row.active).toBe(row.root);
  expect(row.hasFocus).toBe(true);
  expect(row.visibility).toBe('visible');
  expect(row.logical).not.toBeNull();
  expect(row.dom.rangeCount).toBe(1);
  expect(row.root.contains(row.dom.anchorNode)).toBe(true);
  expect(row.root.contains(row.dom.focusNode)).toBe(true);
  return row;
}

function expectOrdinaryReady(content) {
  expect(errors).toEqual([]);
  expect(ready).toHaveLength(1);
  expect(ready[0].body).toBe(content);
  expect(JSON.stringify(editor.getEditorState())).toBe(content);
  expect(isEvidenceContentReady(editor, documentId, targets[0].content)).toBe(true);
}

function prepareExplicitFallbackQueueGap(instance) {
  // This is an explicit competing-update fixture, separate from LF01/LF02's
  // natural defect reproduction. Real AutoFocus first commits its caret;
  // real parsed JSON then clears it without blurring the root. No selection
  // getter, focus API or private Lexical state is replaced or manufactured.
  instance.read(() => {});
  const focused = snapshot();
  expect(focused.body).toBe(body('paragraph', ''));
  expect(focused.active).toBe(instance.getRootElement());
  expect(focused.hasFocus).toBe(true);
  expect(focused.visibility).toBe('visible');
  expect(focused.logical).not.toBeNull();
  expect(focused.dom.rangeCount).toBe(1);
  expect(focused.root.contains(focused.dom.anchorNode)).toBe(true);
  expect(focused.root.contains(focused.dom.focusNode)).toBe(true);
  const preparedContent = body('paragraph', '显式排队竞争的前置正文');
  const parsed = instance.parseEditorState(preparedContent);
  instance.setEditorState(parsed, { tag: 'load-focus-fixture:queued-gap' });
  instance.read(() => {});
  const gap = snapshot();
  expect(gap.body).toBe(preparedContent);
  expect(JSON.stringify(instance.getEditorState())).toBe(preparedContent);
  expect(gap.active).toBe(focused.root);
  expect(gap.hasFocus).toBe(true);
  expect(gap.visibility).toBe('visible');
  expect(gap.logical).toBeNull();
  expect(gap.pendingLogical).toBeNull();
  expect(gap.dom).toEqual({ rangeCount: 0, anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
  expect(loadCommits).toEqual([]);
  expect(updates.filter(item => item.tags.includes('load-focus-fixture:queued-gap'))).toHaveLength(1);
  return { focused, gap };
}

function controlFrames() {
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
}

async function flushFrames() {
  for (let round = 0; round < 4 && frames.size; round++) {
    const callbacks = [...frames.values()]; frames.clear();
    await act(async () => { for (const callback of callbacks) callback(0); await Promise.resolve(); });
  }
  await settle();
}

describe('LoadContent focus ownership and committed readiness', () => {
  it('LF01 repairs the natural code-only JSON load gap before ready and preserves F6 endpoints and roundtrip', async () => {
    const content = body('code');
    await mount(content);
    expectNaturalJSONGap(content);
    const row = expectReadyCaret(content);
    const input = editor.getRootElement();
    const button = input.querySelector('.language-selector-button');
    expect(button).toBeTruthy();
    const before = snapshot();
    const key = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(key));
    await settle();
    expect(key.isTrusted).toBe(false);
    expect(key.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(dom()).toEqual(before.dom);
    expect(logical()).toEqual(before.logical);
    expect(JSON.stringify(editor.getEditorState())).toBe(content);
    expect(editor.parseEditorState(content).toJSON()).toEqual(JSON.parse(content));
    expect(input.querySelector('.language-selector-dropdown')).toBeNull();
    const repairCommits = updates.filter(item => item.tags.includes(SKIP_SCROLL_INTO_VIEW_TAG));
    expect(repairCommits).toHaveLength(1);
    expect(repairCommits[0].dirty).toBe(0);
    expect(repairCommits[0].body).toBe(content);
    expect(row.logical.anchor.type).toBe('element');
    expect(errors).toEqual([]);
  });

  it('LF02 repairs the natural paragraph JSON load gap without another history entry and keeps real undo', async () => {
    const content = body('formatted');
    await mount(content);
    const loaded = expectNaturalJSONGap(content);
    const row = expectReadyCaret(content);
    expect(row.undoCount).toBe(loaded.undoCount);
    expect(row.logical.anchor.type).toBe('text');
    await act(async () => editor.update(() => {
      $getRoot().getFirstChildOrThrow().getFirstChildOrThrow().setTextContent('后续实际输入');
    }, { discrete: true, tag: HISTORY_PUSH_TAG }));
    expect(JSON.stringify(editor.getEditorState())).toContain('后续实际输入');
    await act(async () => editor.dispatchCommand(UNDO_COMMAND, undefined));
    await settle();
    expect(JSON.stringify(editor.getEditorState())).toBe(content);
    expect(errors).toEqual([]);
  });

  it('LF03 retains the actual plain-text fallback body and marks its committed state ready once', async () => {
    const text = '不是 Lexical JSON 的原始正文\n第二行';
    await mount(text);
    expect(parseCalls).toBe(1);
    expect(loadCommits).toHaveLength(1);
    expectOrdinaryReady(body('paragraph', text));
    expect(editor.getRootElement().textContent).toBe(text);
    expect(loadCommits[0].tags).toContain(LOAD_TAG);
  });

  it('LF04 preserves empty-body normalization without another load or premature readiness', async () => {
    await mount('');
    expect(parseCalls).toBe(0);
    expect(loadCommits).toHaveLength(1);
    expectOrdinaryReady(body('paragraph', ''));
    expect(editor.getRootElement().textContent).toBe('');
    expect(ready[0].body).toBe(loadCommits[0].body);
  });

  it('LF05 leaves actual foreign focus alone while completing the current JSON load', async () => {
    const content = body();
    await mount(content, { afterLoadRead: () => foreign.focus() });
    expectNaturalJSONGap(content);
    expect(afterLoadReadCalled).toBe(true);
    expectOrdinaryReady(content);
    expect(ready[0].active).toBe(foreign);
    expect(document.activeElement).toBe(foreign);
    expect(ready[0].logical).toBeNull();
  });

  it('LF06 does not install a caret into a focused read-only root', async () => {
    const content = body();
    let focused, gap;
    await mount(content, { editable: false, autoFocus: false, beforeRun: instance => {
      const input = instance.getRootElement(); input.tabIndex = 0; input.focus();
      focused = snapshot();
      expect(focused.dom).toEqual({ rangeCount: 1, anchorNode: focused.root, anchorOffset: 0, focusNode: focused.root, focusOffset: 0 });
      expect(focused.logical).toBeNull();
      expect(focused.editable).toBe(false);
      // Explicit guard preparation, not LF01/LF02's natural JSON-load gap:
      // clear the real focus-created DOM range so only read-only ownership
      // prevents repair. Later selectionchange reads this current empty range.
      document.getSelection().removeAllRanges();
      gap = snapshot();
    } });
    expect(gap.body).toBe(focused.body);
    expect(gap.root).toBe(focused.root);
    expect(gap.root.ownerDocument).toBe(document);
    expect(gap.root.isConnected).toBe(true);
    expect(gap.active).toBe(gap.root);
    expect(gap.hasFocus).toBe(true);
    expect(gap.visibility).toBe('visible');
    expect(gap.editable).toBe(false);
    expect(gap.logical).toBeNull();
    expect(gap.pendingLogical).toBeNull();
    expect(gap.dom).toEqual({ rangeCount: 0, anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
    expectOrdinaryReady(content);
    expect(parseCalls).toBe(1);
    expect(loadCommits).toHaveLength(1);
    expect(loadCommits[0].body).toBe(content);
    expect(loadCommits[0].logical).toBeNull();
    expect(loadCommits[0].dom).toEqual(gap.dom);
    expect(ready[0].root).toBe(gap.root);
    expect(ready[0].active).toBe(gap.root);
    expect(ready[0].hasFocus).toBe(true);
    expect(ready[0].visibility).toBe('visible');
    expect(ready[0].editable).toBe(false);
    expect(ready[0].logical).toBeNull();
    expect(ready[0].pendingLogical).toBeNull();
    expect(ready[0].dom).toEqual(gap.dom);
    expect(updates.filter(item => item.tags.includes(SKIP_SCROLL_INTO_VIEW_TAG))).toEqual([]);
    expect(editor.isEditable()).toBe(false);
    expect(document.activeElement).toBe(gap.root);
    expect(editor.getRootElement()).toBe(gap.root);
    expect(dom()).toEqual(gap.dom);
    expect(logical()).toBeNull();
    expect(snapshot().pendingLogical).toBeNull();
  });

  it('LF07 preserves ordinary readiness without caret repair when the document lacks window focus', async () => {
    const content = body();
    await mount(content, { afterLoadRead: () => vi.spyOn(document, 'hasFocus').mockReturnValue(false) });
    expect(loadCommits[0].logical).toBeNull();
    expectOrdinaryReady(content);
    expect(ready[0].active).toBe(editor.getRootElement());
    expect(ready[0].hasFocus).toBe(false);
    expect(ready[0].logical).toBeNull();
    expect(ready[0].dom.rangeCount).toBe(0);
  });

  it('LF08 preserves ordinary readiness without caret repair in an explicitly hidden document', async () => {
    const content = body();
    await mount(content, { afterLoadRead: () => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden') });
    expect(loadCommits[0].logical).toBeNull();
    expectOrdinaryReady(content);
    expect(ready[0].active).toBe(editor.getRootElement());
    expect(ready[0].visibility).toBe('hidden');
    expect(ready[0].logical).toBeNull();
    expect(ready[0].dom.rangeCount).toBe(0);
  });

  it('LF09 refuses stale readiness for a root disconnected after the load effect captured it', async () => {
    const content = body();
    await mount(content, { beforeRun: instance => instance.getRootElement().remove() });
    expect(parseCalls).toBe(1);
    expect(JSON.stringify(editor.getEditorState())).toBe(content);
    expect(editor.getRootElement().isConnected).toBe(false);
    expect(ready).toEqual([]);
    expect(isEvidenceContentReady(editor, documentId, content)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('LF10 refuses stale readiness when a different connected root replaces the captured root', async () => {
    const content = body();
    let original, replacement;
    await mount(content, { beforeRun: instance => {
      original = instance.getRootElement();
      replacement = document.createElement('div'); replacement.contentEditable = 'true';
      host.append(replacement); instance.setRootElement(replacement);
    } });
    expect(original.isConnected).toBe(true);
    expect(replacement.isConnected).toBe(true);
    expect(editor.getRootElement()).toBe(replacement);
    expect(JSON.stringify(editor.getEditorState())).toBe(content);
    expect(ready).toEqual([]);
    expect(isEvidenceContentReady(editor, documentId, content)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('LF11 cancels the scheduled load on real React unmount before its microtask', async () => {
    const content = body();
    await mount(content, { beforeRun: () => {
      flushSync(() => reactRoot.unmount()); reactRoot = null;
    } });
    expect(parseCalls).toBe(0);
    expect(loadCommits).toEqual([]);
    expect(ready).toEqual([]);
    expect(isEvidenceContentReady(editor, documentId, content)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('LF12 completes only the current B load when A is replaced before either load microtask', async () => {
    const first = body('paragraph', '文档 A');
    const second = body('paragraph', '文档 B');
    await mount(first, { beforeRun: () => flushSync(() => reactRoot.render(fixture(second, 'load-focus-B'))) });
    expect(parseCalls).toBe(1);
    expect(loadCommits).toHaveLength(1);
    expect(loadCommits[0].body).toBe(second);
    expectReadyCaret(second);
    expect(ready[0].id).toBe('load-focus-B');
    expect(isEvidenceContentReady(editor, documentId, first)).toBe(false);
    expect(isEvidenceContentReady(editor, 'load-focus-B', second)).toBe(true);
  });

  it('LF13 lets a genuine user range queued by fallback completion win before the queued repair executes', async () => {
    const text = 'abcdef', content = body('paragraph', text);
    let preparation, beforeQueue, queuedRange, queuedCallbackRan = false, wasStillQueued;
    await mount(text, { beforeRun: instance => { preparation = prepareExplicitFallbackQueueGap(instance); }, queueBeforeFallbackComplete: instance => {
      beforeQueue = snapshot();
      instance.update(() => {
        queuedCallbackRan = true;
        $getRoot().getFirstChildOrThrow().getFirstChildOrThrow().select(1, 4);
        queuedRange = logical(instance._pendingEditorState);
      });
      wasStillQueued = !queuedCallbackRan;
    } });
    expect(wasStillQueued).toBe(true);
    expect(queuedCallbackRan).toBe(true);
    expect(parseCalls).toBe(2); // Explicit JSON preparation, then original plain-text parse/fallback.
    expect(loadCommits).toHaveLength(1);
    expect(beforeQueue.root).toBe(preparation.gap.root);
    expect(beforeQueue.body).toBe(content);
    expect(beforeQueue.active).toBe(editor.getRootElement());
    expect(beforeQueue.hasFocus).toBe(true);
    expect(beforeQueue.visibility).toBe('visible');
    expect(beforeQueue.logical).toBeNull();
    expect(beforeQueue.pendingLogical).toBeNull();
    expect(beforeQueue.dom.rangeCount).toBe(0);
    expectOrdinaryReady(content);
    expect(logical()).toEqual(queuedRange);
    expect(logical().anchor.offset).toBe(1);
    expect(logical().focus.offset).toBe(4);
    expect(dom().anchorOffset).toBe(1);
    expect(dom().focusOffset).toBe(4);
    expect(updates.some(item => item.logical?.anchor.offset === 1 && item.logical?.focus.offset === 4)).toBe(true);
    expect(updates.filter(item => item.tags.includes(SKIP_SCROLL_INTO_VIEW_TAG))).toEqual([]);
  });

  it('LF14 lets foreign focus queued by fallback completion win before the queued repair executes', async () => {
    const text = 'abcdef', content = body('paragraph', text);
    let preparation, beforeQueue, foreignSelection, queuedCallbackRan = false, wasStillQueued;
    await mount(text, { beforeRun: instance => { preparation = prepareExplicitFallbackQueueGap(instance); }, queueBeforeFallbackComplete: instance => {
      beforeQueue = snapshot();
      instance.update(() => { queuedCallbackRan = true; foreign.focus(); foreignSelection = dom(); });
      wasStillQueued = !queuedCallbackRan;
    } });
    expect(wasStillQueued).toBe(true);
    expect(queuedCallbackRan).toBe(true);
    expect(parseCalls).toBe(2); // Explicit JSON preparation, then original plain-text parse/fallback.
    expect(loadCommits).toHaveLength(1);
    expect(beforeQueue.root).toBe(preparation.gap.root);
    expect(beforeQueue.body).toBe(content);
    expect(beforeQueue.active).toBe(editor.getRootElement());
    expect(beforeQueue.hasFocus).toBe(true);
    expect(beforeQueue.visibility).toBe('visible');
    expect(beforeQueue.logical).toBeNull();
    expect(beforeQueue.pendingLogical).toBeNull();
    expect(beforeQueue.dom.rangeCount).toBe(0);
    expectOrdinaryReady(content);
    expect(document.activeElement).toBe(foreign);
    expect(logical()).toBeNull();
    expect(foreignSelection).toEqual({ rangeCount: 1, anchorNode: foreign, anchorOffset: 0, focusNode: foreign, focusOffset: 0 });
    expect(dom()).toEqual(foreignSelection);
    expect(updates.filter(item => item.tags.includes(SKIP_SCROLL_INTO_VIEW_TAG))).toEqual([]);
  });

  it('LF15 preserves logical-only pending selection and its explicit DOM-selection suppression', async () => {
    const content = body('paragraph', 'abcdef');
    let pending;
    await mount(content, { afterLoadRead: instance => {
      instance.update(() => $getRoot().getFirstChildOrThrow().getFirstChildOrThrow().select(2, 5), { tag: SKIP_DOM_SELECTION_TAG });
      pending = snapshot();
    } });
    expectNaturalJSONGap(content);
    expect(pending.logical).toBeNull();
    expect(pending.pendingLogical.anchor.offset).toBe(2);
    expect(pending.pendingLogical.focus.offset).toBe(5);
    expect(pending.dom.rangeCount).toBe(0);
    expectOrdinaryReady(content);
    expect(ready[0].pendingLogical).toEqual(pending.pendingLogical);
    expect(logical()).toEqual(pending.pendingLogical);
    expect(dom().rangeCount).toBe(0);
    expect(document.activeElement).toBe(editor.getRootElement());
  });

  it('LF16 preserves a DOM-only range without replacing it with a manufactured logical caret', async () => {
    const content = body('paragraph', 'abcdef');
    let chosen;
    await mount(content, { afterLoadRead: instance => {
      const text = document.createTreeWalker(instance.getRootElement().querySelector('p'), NodeFilter.SHOW_TEXT).nextNode();
      expect(text?.nodeType).toBe(Node.TEXT_NODE);
      expect(text.textContent).toBe('abcdef');
      const range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 4);
      document.getSelection().addRange(range);
      chosen = snapshot();
    } });
    expectNaturalJSONGap(content);
    expect(chosen.logical).toBeNull();
    expect(chosen.dom.rangeCount).toBe(1);
    expectOrdinaryReady(content);
    expect(ready[0].logical).toBeNull();
    expect(ready[0].dom).toEqual(chosen.dom);
    expect(dom()).toEqual(chosen.dom);
  });

  it('LF17 lets the actual session plugin restore its saved selection and scroll after initial readiness', async () => {
    controlFrames();
    const content = body('paragraph', 'abcdef');
    writeDocumentSession(documentId, { scrollTop: 123, selection: {
      anchor: { blockIndex: 0, offset: 2 }, focus: { blockIndex: 0, offset: 5 },
    } });
    await mount(content, { session: true });
    expectNaturalJSONGap(content);
    expectReadyCaret(content);
    await flushFrames();
    expect(logical().anchor.offset).toBe(2);
    expect(logical().focus.offset).toBe(5);
    expect(host.querySelector('.editor-container').scrollTop).toBe(123);
    expect(JSON.stringify(editor.getEditorState())).toBe(content);
    expect(ready).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('LF18 keeps explicit evidence navigation ahead of session restoration after the committed load', async () => {
    controlFrames();
    vi.spyOn(toast, 'success').mockImplementation(() => {});
    vi.spyOn(toast, 'warning').mockImplementation(() => {});
    const content = body('paragraph', '关关出发，关关返回。');
    writeDocumentSession(documentId, { scrollTop: 123, selection: {
      anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 0, offset: 0 },
    } });
    const target = createTextEvidenceTarget(content, { start: 5, end: 7, match: '关关' });
    expect(target).toBeTruthy();
    evidenceNavigation.start(documentId, target);
    await mount(content, { session: true, evidence: true });
    expectNaturalJSONGap(content);
    expectReadyCaret(content);
    await flushFrames();
    expect(evidenceNavigation.peek(documentId)).toBeNull();
    expect(logical().text).toBe('关关');
    expect(logical().anchor.offset).toBe(5);
    expect(logical().focus.offset).toBe(7);
    expect(host.querySelector('.editor-evidence-target')).toBeTruthy();
    expect(JSON.stringify(editor.getEditorState())).toBe(content);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('LF19 keeps actual Editor pre-load edits, silent load, next draft callback and serialized body boundaries', async () => {
    controlFrames();
    const initial = body('paragraph', '原正文');
    const replacement = body('paragraph', '外部载入正文');
    const onChange = vi.fn();
    const view = content => <UiThemeProvider><Editor documentId={documentId} initialContent={content} onChange={onChange} readOnly={false} /></UiThemeProvider>;
    targets.push({ id: documentId, content: initial });
    await act(async () => {
      flushSync(() => reactRoot.render(view(initial)));
      observe(getNearestEditorFromDOMNode(host.querySelector('.editor-input')));
      const onError = editor._onError.bind(editor);
      vi.spyOn(editor, '_onError').mockImplementation(error => { errors.push(error); onError(error); });
      await Promise.resolve();
    });
    await settle();
    expectNaturalJSONGap(initial);
    expectReadyCaret(initial);
    expect(onChange).not.toHaveBeenCalled();
    targets.push({ id: documentId, content: replacement });
    await act(async () => {
      flushSync(() => reactRoot.render(view(replacement)));
      editor.update(() => {
        $getRoot().getFirstChildOrThrow().append($createTextNode(' 已接受的输入'));
      });
      await Promise.resolve();
    });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    const acceptedDraft = onChange.mock.calls[0][0];
    expect(acceptedDraft).toContain('原正文 已接受的输入');
    expect(JSON.stringify(editor.getEditorState())).toBe(replacement);
    expect(ready).toHaveLength(2);
    expect(ready[1].content).toBe(replacement);
    expect(ready[1].body).toBe(replacement);
    onChange.mockClear();
    await act(async () => editor.update(() => {
      $getRoot().getFirstChildOrThrow().clear().append($createTextNode('原正文 已接受的输入'));
    }, { discrete: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(acceptedDraft);
    expect(JSON.stringify(editor.getEditorState())).toBe(acceptedDraft);
    expect(editor.parseEditorState(acceptedDraft).toJSON()).toEqual(JSON.parse(acceptedDraft));
    expect(errors).toEqual([]);
  });

  it('LF20 keeps a repair failure outside JSON fallback and refuses a false ready notification', async () => {
    const content = body('paragraph', '仍然是有效 JSON 正文');
    const failure = new Error('injected selection-repair failure');
    let repair;
    await mount(content, { afterLoadRead: instance => {
      const prototype = instance.getEditorState().read(() => Object.getPrototypeOf($getRoot()));
      repair = vi.spyOn(prototype, 'selectStart').mockImplementation(() => { throw failure; });
    } });
    expectNaturalJSONGap(content);
    expect(JSON.stringify(editor.getEditorState())).toBe(content);
    expect(editor.getRootElement().textContent).toBe('仍然是有效 JSON 正文');
    expect(parseCalls).toBe(1);
    expect(loadCommits).toHaveLength(1);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([failure]);
    expect(ready).toEqual([]);
    expect(isEvidenceContentReady(editor, documentId, content)).toBe(false);
  });
});
