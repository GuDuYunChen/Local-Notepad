import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_BACKSPACE_COMMAND,
  DELETE_CHARACTER_COMMAND,
  $getNodeByKey,
  $getRoot,
} from 'lexical';
import { $createCodeBlockNode, $isCodeBlockNode } from '../nodes/CodeBlockNode';
import { mergeRegister } from '@lexical/utils';

// Define custom command for inserting code blocks
export const INSERT_CODE_BLOCK_COMMAND = createCommand('INSERT_CODE_BLOCK_COMMAND');

export function $insertCodeBlockAtSelection(codeOverride) {
  const selection = $getSelection();
  const code = codeOverride !== undefined
    ? codeOverride
    : ($isRangeSelection(selection) ? selection.getTextContent() : '');

  if ($isRangeSelection(selection) && !selection.isCollapsed()) {
    selection.removeText();
  }

  const codeBlock = $createCodeBlockNode(code || '', 'plaintext');
  const trailingParagraph = $createParagraphNode();
  const currentSelection = $getSelection();

  if ($isRangeSelection(currentSelection)) {
    const anchorNode = currentSelection.anchor.getNode();
    const topLevel = anchorNode.getTopLevelElementOrThrow();

    if (topLevel.getType() === 'paragraph' && topLevel.getTextContent().length === 0) {
      topLevel.replace(codeBlock);
    } else {
      topLevel.insertAfter(codeBlock);
    }
  } else {
    $getRoot().append(codeBlock);
  }

  codeBlock.insertAfter(trailingParagraph);
  trailingParagraph.select();

  return codeBlock;
}

export default function CodeBlockPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Register command handler for INSERT_CODE_BLOCK_COMMAND
    const removeInsertCommand = editor.registerCommand(
      INSERT_CODE_BLOCK_COMMAND,
      () => {
        editor.update(() => {
          $insertCodeBlockAtSelection();
        });

        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );

    // Register text input listener for ``` shortcut
    const removeTextListener = editor.registerTextContentListener((textContent) => {
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        
        if (!$isRangeSelection(selection)) {
          return;
        }
        
        const anchorNode = selection.anchor.getNode();
        const text = anchorNode.getTextContent();
        
        // Check if the current line starts with ```
        if (text.trim() === '```') {
          editor.update(() => {
            anchorNode.remove();
            $insertCodeBlockAtSelection('');
          });
        }
      });
    });

    // Register keyboard event handlers for special keys
    const removeKeyboardHandlers = mergeRegister(
      // Handle Tab key - insert tab character instead of moving focus
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          const selection = $getSelection();
          
          if (!$isRangeSelection(selection)) {
            return false;
          }
          
          const anchorNode = selection.anchor.getNode();
          const parent = anchorNode.getParent();
          
          // Check if we're inside a code block
          if (parent && $isCodeBlockNode(parent)) {
            event.preventDefault();
            
            // Insert tab character
            selection.insertText('\t');
            
            return true;
          }
          
          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
      
      // Handle Enter key - insert newline and stay in code block
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          const selection = $getSelection();
          
          if (!$isRangeSelection(selection)) {
            return false;
          }
          
          const anchorNode = selection.anchor.getNode();
          const parent = anchorNode.getParent();
          
          // Check if we're inside a code block
          if (parent && $isCodeBlockNode(parent)) {
            event?.preventDefault();
            
            // Insert newline character
            selection.insertText('\n');
            
            return true;
          }
          
          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
      
      // Handle Escape key - move focus out of code block
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          const selection = $getSelection();
          
          if (!$isRangeSelection(selection)) {
            return false;
          }
          
          const anchorNode = selection.anchor.getNode();
          const parent = anchorNode.getParent();
          
          // Check if we're inside a code block
          if (parent && $isCodeBlockNode(parent)) {
            event?.preventDefault();
            
            // Move focus to the next node (paragraph after code block)
            parent.selectNext();
            
            return true;
          }
          
          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
      
      // Handle Backspace - delete empty code block or convert to paragraph
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          const selection = $getSelection();
          
          if (!$isRangeSelection(selection)) {
            return false;
          }
          
          const anchorNode = selection.anchor.getNode();
          const parent = anchorNode.getParent();
          
          // Check if we're inside a code block
          if (parent && $isCodeBlockNode(parent)) {
            const code = parent.getCode();
            
            // If code block is empty, delete it and convert to paragraph
            if (!code || code.trim() === '') {
              event?.preventDefault();
              
              // Create a new paragraph
              const paragraph = $createParagraphNode();
              parent.replace(paragraph);
              paragraph.select();
              
              return true;
            }
          }
          
          return false;
        },
        COMMAND_PRIORITY_LOW
      )
    );

    // Cleanup
    return () => {
      removeInsertCommand();
      removeTextListener();
      removeKeyboardHandlers();
    };
  }, [editor]);

  return null;
}
