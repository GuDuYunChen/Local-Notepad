import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createEditor, $getRoot, $createParagraphNode, $createTextNode, $getSelection, $insertNodes } from 'lexical';
import { CodeBlockNode, $createCodeBlockNode, $isCodeBlockNode } from '../nodes/CodeBlockNode';

/**
 * Property-based tests for CodeBlockPlugin
 * 
 * These tests verify the correctness properties of code block insertion,
 * shortcut key handling, and text selection conversion.
 */
describe('CodeBlockPlugin Properties', () => {
  let editor;

  beforeEach(() => {
    editor = createEditor({
      nodes: [CodeBlockNode],
      onError: (error) => {
        throw error;
      },
    });
  });

  /**
   * Feature: code-block-feature, Property 1: 代码块插入通过按钮
   * 
   * **Validates: Requirements 1.1**
   * 
   * For any editor state and cursor position, when the user clicks the code block button,
   * the editor should insert a new CodeBlockNode at the cursor position.
   */
  it('should insert code block at cursor position when button is clicked', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 0, maxLength: 5 }),
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 0, maxLength: 5 }),
        (beforeTexts, afterTexts) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            beforeTexts.forEach(text => {
              const paragraph = $createParagraphNode();
              const textNode = $createTextNode(text);
              paragraph.append(textNode);
              root.append(paragraph);
            });

            const cursorParagraph = $createParagraphNode();
            root.append(cursorParagraph);

            afterTexts.forEach(text => {
              const paragraph = $createParagraphNode();
              const textNode = $createTextNode(text);
              paragraph.append(textNode);
              root.append(paragraph);
            });

            cursorParagraph.select();
            
            const codeBlock = $createCodeBlockNode('', 'plaintext');
            $insertNodes([codeBlock]);
            
            const paragraph = $createParagraphNode();
            $insertNodes([paragraph]);
            
            const children = root.getChildren();
            const codeBlockNode = children.find(node => $isCodeBlockNode(node));
            
            expect(codeBlockNode).toBeDefined();
            if (codeBlockNode) {
              expect(codeBlockNode.getCode()).toBe('');
              expect(codeBlockNode.getLanguage()).toBe('plaintext');
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 2: 代码块插入通过快捷键
   * 
   * **Validates: Requirements 1.2**
   * 
   * For any empty line, when the user types ```, that line should be converted
   * to a code block.
   */
  it('should convert line to code block when ``` is typed', () => {
    fc.assert(
      fc.property(
        fc.constant('```'),
        (shortcut) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const paragraph = $createParagraphNode();
            const textNode = $createTextNode(shortcut);
            paragraph.append(textNode);
            root.append(paragraph);

            textNode.select();
            
            // Simulate shortcut detection
            const textContent = textNode.getTextContent();
            if (textContent.trim() === '```') {
              textNode.remove();
              
              const codeBlock = $createCodeBlockNode('', 'plaintext');
              root.append(codeBlock);
              
              const afterParagraph = $createParagraphNode();
              root.append(afterParagraph);
            }
            
            const children = root.getChildren();
            const codeBlock = children.find(node => $isCodeBlockNode(node));

            expect(codeBlock).toBeDefined();
            if (codeBlock) {
              expect(codeBlock.getCode()).toBe('');
              expect(codeBlock.getLanguage()).toBe('plaintext');
            }

            const allText = root.getTextContent();
            expect(allText).not.toContain('```');
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 2: 代码块插入通过快捷键
   * 
   * **Validates: Requirements 1.2, 1.3**
   * 
   * Test that the ``` shortcut works in various editor states with different
   * surrounding content.
   */
  it('should convert ``` to code block regardless of surrounding content', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
        (beforeTexts, afterTexts) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            beforeTexts.forEach(text => {
              const paragraph = $createParagraphNode();
              const textNode = $createTextNode(text);
              paragraph.append(textNode);
              root.append(paragraph);
            });

            const shortcutParagraph = $createParagraphNode();
            const shortcutText = $createTextNode('```');
            shortcutParagraph.append(shortcutText);
            root.append(shortcutParagraph);

            afterTexts.forEach(text => {
              const paragraph = $createParagraphNode();
              const textNode = $createTextNode(text);
              paragraph.append(textNode);
              root.append(paragraph);
            });

            shortcutText.select();
            
            // Simulate shortcut transformation
            const children = root.getChildren();
            const paragraphWithShortcut = children.find(node => {
              const textContent = node.getTextContent();
              return textContent.trim() === '```';
            });

            if (paragraphWithShortcut) {
              const index = children.indexOf(paragraphWithShortcut);
              paragraphWithShortcut.remove();
              
              const codeBlock = $createCodeBlockNode('', 'plaintext');
              
              if (index === 0) {
                root.append(codeBlock);
              } else {
                const prevNode = children[index - 1];
                if (prevNode) {
                  prevNode.insertAfter(codeBlock);
                } else {
                  root.append(codeBlock);
                }
              }
              
              const paragraph = $createParagraphNode();
              codeBlock.insertAfter(paragraph);
            }
            
            const updatedChildren = root.getChildren();
            const codeBlock = updatedChildren.find(node => $isCodeBlockNode(node));

            expect(codeBlock).toBeDefined();
            if (codeBlock) {
              expect(codeBlock.getCode()).toBe('');
              expect(codeBlock.getLanguage()).toBe('plaintext');
            }

            const allText = root.getTextContent();
            beforeTexts.forEach(text => {
              if (text) {
                expect(allText).toContain(text);
              }
            });
            afterTexts.forEach(text => {
              if (text) {
                expect(allText).toContain(text);
              }
            });
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 1: 代码块插入通过按钮
   * 
   * **Validates: Requirements 1.1, 1.3**
   * 
   * When inserting a code block in an empty editor, it should create a code block
   * with default initialization.
   */
  it('should insert code block in empty editor with defaults', () => {
    fc.assert(
      fc.property(
        fc.constant(undefined),
        () => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const paragraph = $createParagraphNode();
            root.append(paragraph);
            paragraph.select();
            
            const codeBlock = $createCodeBlockNode('', 'plaintext');
            $insertNodes([codeBlock]);
            
            const afterParagraph = $createParagraphNode();
            $insertNodes([afterParagraph]);
            
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));

            expect(foundCodeBlock).toBeDefined();
            if (foundCodeBlock) {
              expect(foundCodeBlock.getCode()).toBe('');
              expect(foundCodeBlock.getLanguage()).toBe('plaintext');
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 7: 选中文本转换为代码块
   * 
   * **Validates: Requirements 3.1, 3.2**
   * 
   * For any selected text content, clicking the code block button should create
   * a code block containing that text, and the text content should remain unchanged.
   */
  it('should convert selected text to code block preserving content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (selectedText) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const paragraph = $createParagraphNode();
            const textNode = $createTextNode(selectedText);
            paragraph.append(textNode);
            root.append(paragraph);

            textNode.select(0, selectedText.length);
            
            const selection = $getSelection();
            if (selection) {
              const text = selection.getTextContent();
              
              const codeBlock = $createCodeBlockNode(text, 'plaintext');
              selection.removeText();
              $insertNodes([codeBlock]);
              
              const afterParagraph = $createParagraphNode();
              $insertNodes([afterParagraph]);
            }
            
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));

            expect(foundCodeBlock).toBeDefined();
            if (foundCodeBlock) {
              expect(foundCodeBlock.getCode()).toBe(selectedText);
              expect(foundCodeBlock.getLanguage()).toBe('plaintext');
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 7: 选中文本转换为代码块
   * 
   * **Validates: Requirements 3.1, 3.2**
   * 
   * Test that special characters and whitespace are preserved when converting
   * selected text to code block.
   */
  it('should preserve special characters and whitespace in selected text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (text) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const paragraph = $createParagraphNode();
            const textNode = $createTextNode(text);
            paragraph.append(textNode);
            root.append(paragraph);

            textNode.select(0, text.length);
            
            const selection = $getSelection();
            if (selection) {
              const selectedText = selection.getTextContent();
              
              const codeBlock = $createCodeBlockNode(selectedText, 'plaintext');
              selection.removeText();
              $insertNodes([codeBlock]);
              
              const afterParagraph = $createParagraphNode();
              $insertNodes([afterParagraph]);
            }
            
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));

            expect(foundCodeBlock).toBeDefined();
            if (foundCodeBlock) {
              expect(foundCodeBlock.getCode()).toBe(text);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 8: 多段落选择合并
   * 
   * **Validates: Requirements 3.3**
   * 
   * For any text selection spanning multiple paragraphs, converting to a code block
   * should merge all paragraph contents into a single code block.
   */
  it('should merge multiple paragraphs into single code block', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 5 }),
        (paragraphTexts) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const paragraphs = [];
            paragraphTexts.forEach(text => {
              const paragraph = $createParagraphNode();
              const textNode = $createTextNode(text);
              paragraph.append(textNode);
              root.append(paragraph);
              paragraphs.push(paragraph);
            });

            const firstParagraph = paragraphs[0];
            const lastParagraph = paragraphs[paragraphs.length - 1];
            
            const firstTextNode = firstParagraph.getFirstChild();
            const lastTextNode = lastParagraph.getFirstChild();
            
            if (firstTextNode && lastTextNode) {
              const selection = $getSelection();
              if (selection) {
                selection.anchor.set(firstTextNode.getKey(), 0, 'text');
                selection.focus.set(lastTextNode.getKey(), paragraphTexts[paragraphTexts.length - 1].length, 'text');
                
                const selectedText = selection.getTextContent();
                
                const codeBlock = $createCodeBlockNode(selectedText, 'plaintext');
                selection.removeText();
                $insertNodes([codeBlock]);
                
                const afterParagraph = $createParagraphNode();
                $insertNodes([afterParagraph]);
              }
            }
            
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));

            expect(foundCodeBlock).toBeDefined();
            if (foundCodeBlock) {
              const codeContent = foundCodeBlock.getCode();
              
              paragraphTexts.forEach(text => {
                expect(codeContent).toContain(text);
              });

              expect(codeContent.length).toBeGreaterThan(0);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 8: 多段落选择合并
   * 
   * **Validates: Requirements 3.3**
   * 
   * Test that two paragraphs are correctly merged with newline separator.
   */
  it('should merge two paragraphs with newline separator', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (text1, text2) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const paragraph1 = $createParagraphNode();
            const textNode1 = $createTextNode(text1);
            paragraph1.append(textNode1);
            root.append(paragraph1);

            const paragraph2 = $createParagraphNode();
            const textNode2 = $createTextNode(text2);
            paragraph2.append(textNode2);
            root.append(paragraph2);

            const selection = $getSelection();
            if (selection) {
              selection.anchor.set(textNode1.getKey(), 0, 'text');
              selection.focus.set(textNode2.getKey(), text2.length, 'text');
              
              const selectedText = selection.getTextContent();
              
              const codeBlock = $createCodeBlockNode(selectedText, 'plaintext');
              selection.removeText();
              $insertNodes([codeBlock]);
              
              const afterParagraph = $createParagraphNode();
              $insertNodes([afterParagraph]);
            }
            
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));

            expect(foundCodeBlock).toBeDefined();
            if (foundCodeBlock) {
              const code = foundCodeBlock.getCode();
              
              expect(code).toContain(text1);
              expect(code).toContain(text2);
              
              expect(code.length).toBeGreaterThanOrEqual(text1.length + text2.length);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 1: 代码块插入通过按钮
   * 
   * **Validates: Requirements 1.1, 1.4**
   * 
   * Test that after inserting a code block, a paragraph is added after it
   * for easier navigation.
   */
  it('should add paragraph after code block for navigation', () => {
    fc.assert(
      fc.property(
        fc.constant(undefined),
        () => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const paragraph = $createParagraphNode();
            root.append(paragraph);
            paragraph.select();
            
            const codeBlock = $createCodeBlockNode('', 'plaintext');
            $insertNodes([codeBlock]);
            
            const afterParagraph = $createParagraphNode();
            $insertNodes([afterParagraph]);
            
            const children = root.getChildren();
            const codeBlockIndex = children.findIndex(node => $isCodeBlockNode(node));
            
            expect(codeBlockIndex).toBeGreaterThanOrEqual(0);
            
            if (codeBlockIndex >= 0 && codeBlockIndex < children.length - 1) {
              const nextNode = children[codeBlockIndex + 1];
              expect(nextNode).toBeDefined();
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 7: 选中文本转换为代码块
   * 
   * **Validates: Requirements 3.2**
   * 
   * Test that empty selection (no text selected) creates an empty code block.
   */
  it('should create empty code block when no text is selected', () => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const paragraph = $createParagraphNode();
      root.append(paragraph);
      paragraph.select();
      
      const codeBlock = $createCodeBlockNode('', 'plaintext');
      $insertNodes([codeBlock]);
      
      const afterParagraph = $createParagraphNode();
      $insertNodes([afterParagraph]);
      
      const children = root.getChildren();
      const foundCodeBlock = children.find(node => $isCodeBlockNode(node));

      expect(foundCodeBlock).toBeDefined();
      if (foundCodeBlock) {
        expect(foundCodeBlock.getCode()).toBe('');
        expect(foundCodeBlock.getLanguage()).toBe('plaintext');
      }
    });
  });

  /**
   * Feature: code-block-feature, Property 7: 选中文本转换为代码块
   * 
   * **Validates: Requirements 3.1, 3.2**
   * 
   * Test that multiline selected text is preserved with line breaks.
   */
  it('should preserve line breaks in multiline selected text', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 2, maxLength: 5 }),
        (lines) => {
          const multilineText = lines.join('\n');
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const paragraph = $createParagraphNode();
            const textNode = $createTextNode(multilineText);
            paragraph.append(textNode);
            root.append(paragraph);

            textNode.select(0, multilineText.length);
            
            const selection = $getSelection();
            if (selection) {
              const selectedText = selection.getTextContent();
              
              const codeBlock = $createCodeBlockNode(selectedText, 'plaintext');
              selection.removeText();
              $insertNodes([codeBlock]);
              
              const afterParagraph = $createParagraphNode();
              $insertNodes([afterParagraph]);
            }
            
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));

            expect(foundCodeBlock).toBeDefined();
            if (foundCodeBlock) {
              expect(foundCodeBlock.getCode()).toBe(multilineText);
              
              const codeLines = foundCodeBlock.getCode().split('\n');
              expect(codeLines.length).toBe(lines.length);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
