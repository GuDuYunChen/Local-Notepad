import React, { useEffect } from 'react';
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
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';
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
import { ImageNode } from "./nodes/ImageNode";
import { VideoNode } from "./nodes/VideoNode";
import { ImageGridNode } from "./nodes/ImageGridNode";
import './Editor.css';

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
  image: 'editor-image',
  imageGrid: 'editor-image-grid',
  video: 'editor-video',
};

function Placeholder() {
  return <div className="editor-placeholder">开始输入...</div>;
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

export default function Editor({ initialContent, onChange, readOnly }) {
  const initialConfig = {
    namespace: 'MyEditor',
    theme,
    onError(error) {
      console.error(error);
    },
    nodes: [
      HeadingNode, QuoteNode, ListItemNode, ListNode, CodeHighlightNode, CodeNode,
      TableNode, TableCellNode, TableRowNode,
      AutoLinkNode, LinkNode,
      ImageNode, VideoNode, ImageGridNode
    ],
    editable: !readOnly,
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="editor-shell">
        <ToolbarPlugin />
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
          <OnChangePlugin onChange={onChange} />
          <LoadContentPlugin content={initialContent} />
          <TableSelectionPlugin />
        </div>
      </div>
    </LexicalComposer>
  );
}
