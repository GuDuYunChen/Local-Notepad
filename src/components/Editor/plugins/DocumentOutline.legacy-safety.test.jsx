import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Read the real committed CSS without Vite's CSS loader. Vitest may rewrite
// import.meta.url to a virtual module URL rather than a file:// URL; CI runs
// these suites with the repository as cwd, so use stable root-relative paths.
const outlineCss = readFileSync(resolve(process.cwd(), 'src/components/Editor/plugins/DocumentOutline.css'), 'utf8');
const sharedControlCss = readFileSync(resolve(process.cwd(), 'src/components/ui/control-kit.css'), 'utf8');
import { uiQuery, uiText } from "~/test/uiControlDriver";import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { test, expect, vi } from 'vitest';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $getRoot, $createTextNode, $createParagraphNode } from 'lexical';
import { HeadingNode, $createHeadingNode } from '@lexical/rich-text';
import DocumentOutlinePlugin, { findHeadingByPath } from './DocumentOutlinePlugin';
test('ambiguous heading paths must not select the first source', () => {expect(findHeadingByPath([{ key: 'A', text: '同名', level: 1, isHeading: true }, { key: 'B', text: '同名', level: 1, isHeading: true }], ['同名'])).toBeNull();});
async function real(check) {globalThis.IS_REACT_ACT_ENVIRONMENT = true;let editor;const host = document.createElement('div');document.body.append(host);const root = createRoot(host);function Capture() {const [e] = useLexicalComposerContext();useEffect(() => {editor = e;}, [e]);return null;}
  try {await act(async () => root.render(<LexicalComposer initialConfig={{ namespace: 'outline-negative', nodes: [HeadingNode], onError: (e) => {throw e;} }}><div className="editor-shell"><DocumentOutlinePlugin documentId="A" documentTitle="标题" /><div className="editor-container"><RichTextPlugin contentEditable={<ContentEditable className="editor-input" />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} /><Capture /></div></div></LexicalComposer>));await act(async () => editor.update(() => $getRoot().clear().append($createHeadingNode('h1').append($createTextNode('唯一标题')), $createParagraphNode().append($createTextNode('正文'))), { discrete: true }));await act(async () => {for (let i = 0; i < 10; i++) await Promise.resolve();});await check(host);} finally {await act(async () => root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();delete globalThis.IS_REACT_ACT_ENVIRONMENT;}}
test('single-heading documents retain the outline entry', async () => real(async (host) => expect(uiQuery(host, 'button[aria-label="文档目录"]')).toBeTruthy()));
test('fallback clipboard returning false cannot be reported as copied', async () => real(async (host) => {vi.stubGlobal('navigator', {});const prior = document.execCommand;document.execCommand = vi.fn(() => false);try {await act(async () => window.dispatchEvent(new Event('editor:copy-current-reference')));await act(async () => {for (let i = 0; i < 20; i++) await Promise.resolve();});expect(document.execCommand).toHaveBeenCalled();expect(uiText(host)).toContain('复制未成功');} finally {document.execCommand = prior;}}));

test('outline action rows use compact shared-control height, not the 40px form-toolbar minimum', async () => real(async (host) => {
  await act(async () => host.querySelector('[aria-label="文档目录"]').click());
  const controls = [...host.querySelectorAll('.document-outline-panel .outline-tools > button')];
  expect(controls.length).toBeGreaterThanOrEqual(3);
  expect(controls.every(button => button.getAttribute('data-ui-control') === 'button' &&
    button.getAttribute('data-ui-layout') === 'action' && button.classList.contains('ant-btn-sm'))).toBe(true);
  expect(sharedControlCss).toMatch(/\[data-ui-layout="action"\]\s*\{\s*min-height:\s*40px\s*;/);
  const rule = outlineCss.match(/\.editor-shell \.local-outline \.outline-tools > \[data-ui-control="button"\]\[data-ui-layout="action"\]\s*\{([^}]*)\}/);
  expect(rule?.[1]).toMatch(/min-height:\s*0\s*;/);
}));
