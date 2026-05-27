import React, { useEffect, useMemo } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
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
import CodeBlockPlugin from "./plugins/CodeBlockPlugin";
import SearchPlugin from "./plugins/SearchPlugin";
import SlashMenuPlugin from "./plugins/SlashMenuPlugin";
import BlockHandlePlugin from "./plugins/BlockHandlePlugin";
import MentionPlugin from "./plugins/MentionPlugin";
import DragDropPlugin from "./plugins/DragDropPlugin";
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
import './Editor.css';
import './nodes/BlockNodes.css';

const theme = {
  paragraph: 'editor-paragraph',
  text: {
    bold: 'editor-text-bold',
    italic: 'editor-text-italic',
    underline: 'editor-text-underline',
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

function Placeholder() {
  return <div className="editor-placeholder">开始输入…</div>;
}

function OnChangePlugin({ onChange }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      onChange(JSON.stringify(editorState));
    });
  }, [editor, onChange]);
  return null;
}

function LoadContentPlugin({ content }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      if (!content) {
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode());
        });
        return;
      }
      try {
        const state = editor.parseEditorState(content);
        editor.setEditorState(state);
      } catch (e) {
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode(content));
          root.append(p);
        });
      }
    };
    Promise.resolve().then(run);
    return () => { cancelled = true };
  }, [editor, content]);
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
  InlineCodeNode, MentionNode
];

export default function Editor({ initialContent, onChange, readOnly }) {
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
      <div className="editor-shell">
        <ToolbarPlugin />
        <SearchPlugin />
        <PasteImagePlugin />
        <div className="editor-container">
          <RichTextPlugin
            contentEditable={<ContentEditable className="editor-input" />}
            placeholder={<Placeholder />}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <AutoFocusPlugin />
          <TablePlugin />
          <ListPlugin />
          <LinkPlugin />
          <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
          <CodeBlockPlugin />
          <SlashMenuPlugin />
          <BlockHandlePlugin />
          <MentionPlugin />
          <DragDropPlugin />
          <OnChangePlugin onChange={onChange} />
          <LoadContentPlugin content={initialContent} />
          <TableSelectionPlugin />
          <TableActionMenuPlugin />
        </div>
      </div>
    </LexicalComposer>
  );
}
