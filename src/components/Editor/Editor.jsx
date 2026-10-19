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
import { $getRoot, $createParagraphNode, $createTextNode } from 'lexical';

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
import CodeBlockPlugin from "./plugins/CodeBlockPlugin";
import SearchPlugin from "./plugins/SearchPlugin";
import FloatingTextToolbarPlugin from "./plugins/FloatingTextToolbarPlugin";
import DocumentOutlinePlugin from "./plugins/DocumentOutlinePlugin";
import SlashMenuPlugin from "./plugins/SlashMenuPlugin";
import BlockHandlePlugin from "./plugins/BlockHandlePlugin";
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
  useEffect(() => {
    let cancelled = false;
    const loadToken = beginEvidenceContentLoad(editor, documentId, content);
    const run = () => {
      if (cancelled) return;
      // Flush already accepted edits before adding the load tag. Otherwise
      // Lexical can batch an earlier user edit into the ignored load commit.
      editor.read(() => {});
      if (cancelled) return;

      const complete = () => {
        if (!cancelled) completeEvidenceContentLoad(editor, loadToken);
      };
      if (content) {
        try {
          const state = editor.parseEditorState(content);
          editor.setEditorState(state, { tag: CONTENT_LOAD_TAG });
          // Keep load completion tied to an actual committed state, and keep
          // the following user update outside this tagged load boundary.
          editor.read(() => {});
          complete();
          return;
        } catch {
          // Preserve the existing plain-text fallback for non-Lexical bodies.
        }
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
          <ListPlugin />
          <CheckListPlugin />
          <TabIndentationPlugin maxIndent={8} />
          <LinkPlugin />
          <LinkInteractionPlugin readOnly={readOnly} />
          <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
          {!readOnly && <CodeBlockPlugin />}
          {!readOnly && <SlashMenuPlugin documentId={documentId} />}
          {!readOnly && <BlockHandlePlugin />}
          {!readOnly && <MentionPlugin />}
          <WikiLinkPlugin />
          {!readOnly && <DragDropPlugin />}
          {!readOnly && <EditorShortcutPlugin />}
          {!readOnly && <FormulaShortcutPlugin />}
          {!readOnly && <ChecklistKeyboardPlugin />}
          <OnChangePlugin onChange={onChange} />
          <LoadContentPlugin content={initialContent} documentId={documentId} />
          <DocumentSessionPlugin documentId={documentId} restoreSelection={!readOnly} />
          <EvidenceNavigationPlugin documentId={documentId} initialContent={initialContent} />
          {!readOnly && <TableSelectionPlugin />}
          {!readOnly && <TableActionMenuPlugin />}
          {!readOnly && <TableColumnResizePlugin />}
          {!readOnly && <TableReorderPlugin />}
        </div>
      </div>
    </LexicalComposer>
  );
}
