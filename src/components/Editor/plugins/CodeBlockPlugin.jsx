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
  $insertNodes,
  $isTextNode,
} from 'lexical';
import { $createCodeBlockNode, $isCodeBlockNode } from '../nodes/CodeBlockNode';
import { mergeRegister } from '@lexical/utils';

// Define custom command for inserting code blocks
export const INSERT_CODE_BLOCK_COMMAND = createCommand('INSERT_CODE_BLOCK_COMMAND');

export default function CodeBlockPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Register command handler for INSERT_CODE_BLOCK_COMMAND
    const removeInsertCommand = editor.registerCommand(
      INSERT_CODE_BLOCK_COMMAND,
      () => {
        editor.update(() => {
          const selection = $getSelection();
          
          if (!$isRangeSelection(selection)) {
            // No selection, insert empty code block at cursor
            const codeBlock = $createCodeBlockNode('', 'plaintext');
            $insertNodes([codeBlock]);
            
            // Add a paragraph after the code block for easier navigation
            const paragraph = $createParagraphNode();
            $insertNodes([paragraph]);
            
            return true;
          }

          // Get selected text content
          const selectedText = selection.getTextContent();
          
          if (selectedText) {
            // Handle multi-paragraph selection by merging content
            const nodes = selection.getNodes();
            let fullText = '';
            
            // Collect text from all selected nodes
            for (let i = 0; i < nodes.length; i++) {
              const node = nodes[i];
              if ($isTextNode(node)) {
                const text = node.getTextContent();
                fullText += text;
                
                // Add newline between different parent nodes (paragraphs)
                if (i < nodes.length - 1) {
                  const nextNode = nodes[i + 1];
                  const currentParent = node.getParent();
                  const nextParent = nextNode.getParent();
                  
                  if (currentParent !== nextParent) {
                    fullText += '\n';
                  }
                }
              }
            }
            
            // Create code block with selected text
            const codeBlock = $createCodeBlockNode(fullText || selectedText, 'plaintext');
            
            // Remove selected content and insert code block
            selection.removeText();
            $insertNodes([codeBlock]);
            
            // Add a paragraph after the code block
            const paragraph = $createParagraphNode();
            $insertNodes([paragraph]);
            
            // Keep the code block selected
            const codeBlockKey = codeBlock.getKey();
            setTimeout(() => {
              editor.update(() => {
                const node = $getNodeByKey(codeBlockKey);
                if (node) {
                  node.selectNext();
                }
              });
            }, 0);
          } else {
            // No text selected, insert empty code block
            const codeBlock = $createCodeBlockNode('', 'plaintext');
            $insertNodes([codeBlock]);
            
            // Add a paragraph after the code block
            const paragraph = $createParagraphNode();
            $insertNodes([paragraph]);
          }
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
            // Remove the ``` text
            anchorNode.remove();
            
            // Insert code block
            const codeBlock = $createCodeBlockNode('', 'plaintext');
            $insertNodes([codeBlock]);
            
            // Add a paragraph after the code block
            const paragraph = $createParagraphNode();
            $insertNodes([paragraph]);
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
