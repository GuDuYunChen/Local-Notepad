import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { TRANSFORMERS } from '@lexical/markdown';
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $createParagraphNode, $createTextNode, $getSelection, $addUpdateTag, SKIP_SCROLL_INTO_VIEW_TAG } from 'lexical';

import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableNode, TableCellNode, TableRowNode } from "@lexical/table";
import { ListItemNode, ListNode } from "@lexical/list";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";

import ToolbarPlugin from "./plugins/ToolbarPlugin";
import PasteImagePlugin from "./plugins/PasteImagePlugin";
import TableSelectionPlugin from "./plugins/TableSelectionPlugin";
import TableActionMenuPlugin from "./plugins/TableActionMenuPlugin";
import TableColumnResizePlugin from "./plugins/TableColumnResizePlugin";
import TableReorderPlugin from "./plugins/TableReorderPlugin";
import TablePresentationPlugin from "./plugins/TablePresentationPlugin";
import CodeBlockPlugin from "./plugins/CodeBlockPlugin";
import SearchPlugin from "./plugins/SearchPlugin";
import FloatingTextToolbarPlugin from "./plugins/FloatingTextToolbarPlugin";
import DocumentOutlinePlugin from "./plugins/DocumentOutlinePlugin";
import SlashMenuPlugin from "./plugins/SlashMenuPlugin";
import BlockHandlePlugin from "./plugins/BlockHandlePlugin";
import BlockReferencePlugin from "./plugins/BlockReferencePlugin";
import MentionPlugin from "./plugins/MentionPlugin";
import WikiLinkPlugin from "./plugins/WikiLinkPlugin";
import LinkInteractionPlugin from "./plugins/LinkInteractionPlugin";
import DragDropPlugin from "./plugins/DragDropPlugin";
import EditorShortcutPlugin from "./plugins/EditorShortcutPlugin";
import FormulaShortcutPlugin from "./plugins/FormulaShortcutPlugin";
import ChecklistKeyboardPlugin from "./plugins/ChecklistKeyboardPlugin";
import CommandPalettePlugin from "./plugins/CommandPalettePlugin";
import ResourceManagerPlugin from "./plugins/ResourceManagerPlugin";
import EditorViewSettingsPlugin from "./plugins/EditorViewSettingsPlugin";
import DocumentSessionPlugin from "./plugins/DocumentSessionPlugin";
import EvidenceNavigationPlugin from "./plugins/EvidenceNavigationPlugin";
import { beginEvidenceContentLoad, completeEvidenceContentLoad, cancelEvidenceContentLoad } from '~/services/evidenceNavigation';
import MarkdownSourcePlugin from "./plugins/MarkdownSourcePlugin";
import { ImageNode } from "./nodes/ImageNode";
import { VideoNode } from "./nodes/VideoNode";
import { ImageGridNode } from "./nodes/ImageGridNode";
import { CodeBlockNode } from "./nodes/CodeBlockNode";
import { TodoNode } from "./nodes/TodoNode";
import { DividerNode } from "./nodes/DividerNode";
import { CalloutNode } from "./nodes/CalloutNode";
import { ToggleNode } from "./nodes/ToggleNode";
import { EmbedNode } from "./nodes/EmbedNode";
import { InlineCodeNode } from "./nodes/InlineCodeNode";
import { MentionNode } from "./nodes/MentionNode";
import { WikiLinkNode } from "./nodes/WikiLinkNode";
import { AttachmentNode } from "./nodes/AttachmentNode";
import { FormulaNode } from "./nodes/FormulaNode";
import './Editor.css';
import './nodes/BlockNodes.css';

const theme = {
  paragraph: 'editor-paragraph',
  heading: {
    h1: 'editor-heading-h1',
    h2: 'editor-heading-h2',
    h3: 'editor-heading-h3',
    h4: 'editor-heading-h4',
    h5: 'editor-heading-h5',
    h6: 'editor-heading-h6',
  },
  quote: 'editor-quote',
  list: {
    ol: 'editor-list-ol',
    ul: 'editor-list-ul',
    listitem: 'editor-list-item',
    listitemChecked: 'editor-list-item-checked',
    listitemUnchecked: 'editor-list-item-unchecked',
    nested: {
      listitem: 'editor-nested-list-item',
    },
  },
  link: 'editor-link',
  text: {
    bold: 'editor-text-bold',
    italic: 'editor-text-italic',
    underline: 'editor-text-underline',
    code: 'inline-code',
    strikethrough: 'editor-text-strikethrough',
    underlineStrikethrough: 'editor-text-underlineStrikethrough',
  },
  table: 'editor-table',
  tableCell: 'editor-table-cell',
  tableCellHeader: 'editor-table-cell-header',
  tableRowStriping: 'editor-table-row-striping',
  tableFrozenRow: 'editor-table-frozen-row',
  tableFrozenColumn: 'editor-table-frozen-column',
  image: 'editor-image',
  imageGrid: 'editor-image-grid',
  video: 'editor-video',
  codeBlock: 'code-block-wrapper',
};

function Placeholder({ readOnly = false }) {
  return <div className="editor-placeholder">{readOnly ? '这篇笔记还没有内容' : '开始输入…'}</div>;
}

function EditableModePlugin({ readOnly }) {
  const [editor] = useLexicalComposerContext();
  useLayoutEffect(() => {
    const shouldBeEditable = !readOnly;
    if (editor.isEditable() !== shouldBeEditable) editor.setEditable(shouldBeEditable);
  }, [editor, readOnly]);
  return null;
}

const CONTENT_LOAD_TAG = 'local-notepad:content-load';

function OnChangePlugin({ onChange }) {
  const [editor] = useLexicalComposerContext();
  const onChangeRef = useRef(onChange);
  
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let lastSerialized = ''

    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      const hasContentChanges = (dirtyElements?.size || 0) > 0 || (dirtyLeaves?.size || 0) > 0
      if (!hasContentChanges) return

      const serialized = JSON.stringify(editorState)
      if (serialized === lastSerialized) return
      lastSerialized = serialized
      // A load may normalize old JSON or represent an empty stored body with
      // a paragraph. Remember that baseline without inventing a user draft.
      if (tags.has(CONTENT_LOAD_TAG)) return
      onChangeRef.current?.(serialized)
    });
  }, [editor]);
  return null;
}

export function LoadContentPlugin({ content, documentId }) {
  const [editor] = useLexicalComposerContext();
  const currentLoad = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const loadToken = beginEvidenceContentLoad(editor, documentId, content);
    currentLoad.current = loadToken;
    const rootElement = editor.getRootElement();
    const ownerDocument = rootElement?.ownerDocument;
    const isCurrent = () => !cancelled && currentLoad.current === loadToken &&
      rootElement?.isConnected && editor.getRootElement() === rootElement &&
      rootElement.ownerDocument === ownerDocument;
    const ownsFocus = () => isCurrent() && editor.isEditable() &&
      ownerDocument.activeElement === rootElement && ownerDocument.hasFocus() &&
      ownerDocument.visibilityState === 'visible';
    const hasEmptyDOMSelection = () => {
      const selection = ownerDocument?.getSelection();
      return selection !== null && selection !== undefined && selection.rangeCount === 0 &&
        selection.anchorNode === null && selection.focusNode === null;
    };
    const hasCommittedSelection = () => editor.getEditorState().read(() => $getSelection() !== null);
    const run = () => {
      if (cancelled) return;
      // Flush already accepted edits before adding the load tag. Otherwise
      // Lexical can batch an earlier user edit into the ignored load commit.
      editor.read(() => {});
      if (cancelled) return;

      let completing = false;
      const complete = () => {
        if (completing || !isCurrent()) return;
        completing = true;
        const finish = () => {
          if (isCurrent()) completeEvidenceContentLoad(editor, loadToken);
        };
        // Loading parsed JSON can remove the caret installed by AutoFocus
        // without blurring the root. Repair that empty state once, before
        // announcing readiness; never take focus or replace a user's range.
        if (!ownsFocus() || !hasEmptyDOMSelection() || hasCommittedSelection() ||
          editor.read('pending', () => $getSelection() !== null)) {
          finish();
          return;
        }
        let attempted = false;
        let selected = false;
        editor.update(() => {
          // onUpdate may enqueue this callback behind another real update.
          // Recheck its current selection and ownership at execution time.
          if (!ownsFocus() || !hasEmptyDOMSelection() || hasCommittedSelection() || $getSelection() !== null) return;
          attempted = true;
          $getRoot().selectStart();
          selected = true;
          $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
        }, { discrete: true, onUpdate: () => {
          if (!attempted) {
            finish();
            return;
          }
          const selection = ownerDocument.getSelection();
          if (selected && hasCommittedSelection() && selection?.rangeCount > 0 &&
            rootElement.contains(selection.anchorNode) && rootElement.contains(selection.focusNode)) finish();
        } });
      };
      let loaded = false;
      if (content) {
        try {
          const state = editor.parseEditorState(content);
          editor.setEditorState(state, { tag: CONTENT_LOAD_TAG });
          // Keep load completion tied to an actual committed state, and keep
          // the following user update outside this tagged load boundary.
          editor.read(() => {});
          loaded = true;
        } catch {
          // Preserve the existing plain-text fallback for non-Lexical bodies.
        }
      }
      if (loaded) {
        // A focus-repair error is not a JSON parse failure. Keep it outside
        // the original plain-text fallback boundary.
        complete();
        return;
      }

      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        if (content) paragraph.append($createTextNode(content));
        root.append(paragraph);
      }, { tag: CONTENT_LOAD_TAG, discrete: true, onUpdate: complete });
    };
    Promise.resolve().then(run);
    return () => { cancelled = true; cancelEvidenceContentLoad(editor, loadToken) };
  }, [editor, content, documentId]);
  return null;
}

const EDITOR_NODES = [
  HeadingNode, QuoteNode, ListItemNode, ListNode, CodeHighlightNode, CodeNode,
  TableNode, TableCellNode, TableRowNode,
  AutoLinkNode, LinkNode,
  ImageNode, VideoNode, ImageGridNode,
  CodeBlockNode,
  TodoNode, DividerNode, CalloutNode,
  ToggleNode, EmbedNode,
  InlineCodeNode, MentionNode, WikiLinkNode,
  AttachmentNode,
  FormulaNode
];

export default function Editor({ documentId, documentTitle, initialContent, onChange, readOnly }) {
  const initialConfig = useMemo(() => ({
    namespace: 'MyEditor',
    theme,
    onError(error) {
      console.error(error);
    },
    nodes: EDITOR_NODES,
    editable: !readOnly,
  }), [readOnly]);

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={`editor-shell${readOnly ? ' editor-reading-mode' : ''}`}>
        <EditableModePlugin readOnly={readOnly} />
        {!readOnly && <ToolbarPlugin documentId={documentId} />}
        <SearchPlugin key={documentId} documentId={documentId} />
        {!readOnly && <CommandPalettePlugin documentId={documentId} />}
        <BlockReferencePlugin documentId={documentId} documentTitle={documentTitle} initialContent={initialContent} />
        <EditorViewSettingsPlugin readOnly={readOnly} />
        <MarkdownSourcePlugin readOnly={readOnly} />
        <ResourceManagerPlugin readOnly={readOnly} />
        {!readOnly && <FloatingTextToolbarPlugin />}
        <DocumentOutlinePlugin documentId={documentId} documentTitle={documentTitle} initialContent={initialContent} requireLoaded />
        {!readOnly && <PasteImagePlugin documentId={documentId} />}
        <div className="editor-container">
          <RichTextPlugin
            contentEditable={(
              <ContentEditable
                className="editor-input"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />
            )}
            placeholder={<Placeholder readOnly={readOnly} />}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          {!readOnly && <AutoFocusPlugin />}
          <TablePlugin />
          <TablePresentationPlugin />
          <ListPlugin />
          <CheckListPlugin />
          <TabIndentationPlugin maxIndent={8} />
          <LinkPlugin />
          <LinkInteractionPlugin readOnly={readOnly} />
          <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
          {!readOnly && <CodeBlockPlugin />}
          {!readOnly && <SlashMenuPlugin documentId={documentId} />}
          {!readOnly && <BlockHandlePlugin documentId={documentId} />}
          {!readOnly && <MentionPlugin documentId={documentId} />}
          <WikiLinkPlugin documentId={documentId} />
          {!readOnly && <DragDropPlugin documentId={documentId} />}
          {!readOnly && <EditorShortcutPlugin documentId={documentId} />}
          {!readOnly && <FormulaShortcutPlugin />}
          {!readOnly && <ChecklistKeyboardPlugin />}
          <OnChangePlugin onChange={onChange} />
          <LoadContentPlugin content={initialContent} documentId={documentId} />
          <DocumentSessionPlugin documentId={documentId} restoreSelection={!readOnly} />
          <EvidenceNavigationPlugin documentId={documentId} initialContent={initialContent} />
          {!readOnly && <TableSelectionPlugin documentId={documentId} />}
          {!readOnly && <TableActionMenuPlugin documentId={documentId} />}
          {!readOnly && <TableColumnResizePlugin documentId={documentId} />}
          {!readOnly && <TableReorderPlugin documentId={documentId} />}
        </div>
      </div>
    </LexicalComposer>
  );
}
