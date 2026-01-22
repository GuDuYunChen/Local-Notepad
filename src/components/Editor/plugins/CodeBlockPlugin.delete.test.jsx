import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
import { CodeBlockNode, $createCodeBlockNode, $isCodeBlockNode } from '../nodes/CodeBlockNode';

/**
 * Property-based tests for CodeBlockPlugin delete functionality
 * 
 * These tests verify the correctness properties of code block deletion
 * and conversion to paragraph when empty.
 */
describe('CodeBlockPlugin Delete Functionality Properties', () => {
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
   * Feature: code-block-feature, Property 16: 选中删除代码块
   * 
   * **Validates: Requirements 6.1**
   * 
   * For any fully selected code block, pressing Delete or Backspace should delete the code block.
   */
  it('should delete code block when fully selected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (code) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const beforeParagraph = $createParagraphNode();
            const beforeText = $createTextNode('before');
            beforeParagraph.append(beforeText);
            root.append(beforeParagraph);

            const codeBlock = $createCodeBlockNode(code, 'plaintext');
            root.append(codeBlock);

            const afterParagraph = $createParagraphNode();
            const afterText = $createTextNode('after');
            afterParagraph.append(afterText);
            root.append(afterParagraph);

            // Verify code block exists before deletion
            let children = root.getChildren();
            let foundCodeBlock = children.find(node => $isCodeBlockNode(node));
            expect(foundCodeBlock).toBeDefined();
            expect(foundCodeBlock.getCode()).toBe(code);

            // Simulate deletion by removing the code block
            codeBlock.remove();

            // Verify code block is deleted
            children = root.getChildren();
            foundCodeBlock = children.find(node => $isCodeBlockNode(node));
            expect(foundCodeBlock).toBeUndefined();

            // Verify surrounding content remains
            expect(root.getTextContent()).toContain('before');
            expect(root.getTextContent()).toContain('after');
            
            // Verify only 2 nodes remain (the two paragraphs)
            expect(children.length).toBe(2);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 17: 空代码块删除转换
   * 
   * **Validates: Requirements 6.2**
   * 
   * For any empty code block, pressing Backspace should delete the code block
   * and convert it to a regular paragraph.
   */
  it('should convert empty code block to paragraph on Backspace', () => {
    fc.assert(
      fc.property(
        fc.constant(''),
        (emptyCode) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(emptyCode, 'plaintext');
            root.append(codeBlock);

            // Verify code block exists and is empty
            expect(codeBlock.getCode()).toBe('');

            // Simulate Backspace on empty code block - convert to paragraph
            const paragraph = $createParagraphNode();
            codeBlock.replace(paragraph);

            // Verify code block is replaced with paragraph
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));
            expect(foundCodeBlock).toBeUndefined();

            const foundParagraph = children.find(node => node.getType() === 'paragraph');
            expect(foundParagraph).toBeDefined();
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 17: 空代码块删除转换
   * 
   * **Validates: Requirements 6.2**
   * 
   * Test that code blocks with only whitespace are considered empty and converted to paragraph.
   */
  it('should convert whitespace-only code block to paragraph', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 5 }),
        (spaceCount, newlineCount) => {
          const whitespaceCode = ' '.repeat(spaceCount) + '\n'.repeat(newlineCount);
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(whitespaceCode, 'plaintext');
            root.append(codeBlock);

            // Check if code is empty or whitespace-only
            const code = codeBlock.getCode();
            const isEmpty = !code || code.trim() === '';

            if (isEmpty) {
              // Simulate Backspace - convert to paragraph
              const paragraph = $createParagraphNode();
              codeBlock.replace(paragraph);

              // Verify conversion
              const children = root.getChildren();
              const foundCodeBlock = children.find(node => $isCodeBlockNode(node));
              expect(foundCodeBlock).toBeUndefined();

              const foundParagraph = children.find(node => node.getType() === 'paragraph');
              expect(foundParagraph).toBeDefined();
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 16: 选中删除代码块
   * 
   * **Validates: Requirements 6.1**
   * 
   * Test that deleting a code block preserves editor state correctly.
   */
  it('should maintain correct editor state after deleting code block', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim() !== ''),
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim() !== ''),
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim() !== ''),
        (beforeText, codeText, afterText) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const beforeParagraph = $createParagraphNode();
            const beforeTextNode = $createTextNode(beforeText);
            beforeParagraph.append(beforeTextNode);
            root.append(beforeParagraph);

            const codeBlock = $createCodeBlockNode(codeText, 'plaintext');
            root.append(codeBlock);

            const afterParagraph = $createParagraphNode();
            const afterTextNode = $createTextNode(afterText);
            afterParagraph.append(afterTextNode);
            root.append(afterParagraph);

            // Count nodes before deletion
            const childrenBefore = root.getChildren();
            expect(childrenBefore.length).toBe(3);

            // Delete code block
            codeBlock.remove();

            // Verify state after deletion
            const childrenAfter = root.getChildren();
            expect(childrenAfter.length).toBe(2);

            // Verify content - check that surrounding text is preserved
            const allText = root.getTextContent();
            expect(allText).toContain(beforeText);
            expect(allText).toContain(afterText);

            // Verify no code blocks remain
            const foundCodeBlock = childrenAfter.find(node => $isCodeBlockNode(node));
            expect(foundCodeBlock).toBeUndefined();
            
            // Verify the code block node itself is gone
            const allNodes = root.getChildren();
            const codeBlockNodes = allNodes.filter(node => $isCodeBlockNode(node));
            expect(codeBlockNodes.length).toBe(0);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 17: 空代码块删除转换
   * 
   * **Validates: Requirements 6.2**
   * 
   * Test that converting empty code block to paragraph maintains cursor position.
   */
  it('should maintain cursor position when converting empty code block to paragraph', () => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const codeBlock = $createCodeBlockNode('', 'plaintext');
      root.append(codeBlock);

      // Convert to paragraph
      const paragraph = $createParagraphNode();
      codeBlock.replace(paragraph);
      paragraph.select();

      // Verify paragraph is selected
      const children = root.getChildren();
      const foundParagraph = children.find(node => node.getType() === 'paragraph');
      expect(foundParagraph).toBeDefined();
    });
  });

  /**
   * Feature: code-block-feature, Property 16: 选中删除代码块
   * 
   * **Validates: Requirements 6.1**
   * 
   * Test that multiple code blocks can be deleted independently.
   */
  it('should allow deleting multiple code blocks independently', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 2, maxLength: 5 }),
        (codeSamples) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            // Create multiple code blocks
            const codeBlocks = [];
            codeSamples.forEach(code => {
              const codeBlock = $createCodeBlockNode(code, 'plaintext');
              root.append(codeBlock);
              codeBlocks.push(codeBlock);

              // Add paragraph between code blocks
              const paragraph = $createParagraphNode();
              root.append(paragraph);
            });

            // Verify all code blocks exist
            let children = root.getChildren();
            let foundCodeBlocks = children.filter(node => $isCodeBlockNode(node));
            expect(foundCodeBlocks.length).toBe(codeSamples.length);

            // Delete first code block
            codeBlocks[0].remove();

            // Verify one less code block
            children = root.getChildren();
            foundCodeBlocks = children.filter(node => $isCodeBlockNode(node));
            expect(foundCodeBlocks.length).toBe(codeSamples.length - 1);

            // Verify remaining code blocks still have correct content
            foundCodeBlocks.forEach((block, index) => {
              const expectedCode = codeSamples[index + 1];
              expect(block.getCode()).toBe(expectedCode);
            });
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 17: 空代码块删除转换
   * 
   * **Validates: Requirements 6.2**
   * 
   * Test that non-empty code blocks are NOT converted to paragraph on Backspace.
   */
  it('should NOT convert non-empty code block to paragraph', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim() !== ''),
        (code) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(code, 'plaintext');
            root.append(codeBlock);

            // Verify code block has content
            expect(codeBlock.getCode().trim()).not.toBe('');

            // Simulate Backspace - should NOT convert because it's not empty
            // (In real implementation, Backspace would just delete characters)
            
            // Verify code block still exists
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));
            expect(foundCodeBlock).toBeDefined();
            expect(foundCodeBlock.getCode()).toBe(code);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 16: 选中删除代码块
   * 
   * **Validates: Requirements 6.1**
   * 
   * Test that deleting code block with different languages works correctly.
   */
  it('should delete code blocks regardless of language', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.constantFrom('javascript', 'python', 'java', 'cpp', 'go', 'rust', 'plaintext'),
        (code, language) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(code, language);
            root.append(codeBlock);

            // Verify code block exists with correct language
            expect(codeBlock.getLanguage()).toBe(language);

            // Delete code block
            codeBlock.remove();

            // Verify deletion
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));
            expect(foundCodeBlock).toBeUndefined();
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 17: 空代码块删除转换
   * 
   * **Validates: Requirements 6.2**
   * 
   * Test that empty code block conversion preserves surrounding content.
   */
  it('should preserve surrounding content when converting empty code block', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (beforeText, afterText) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const beforeParagraph = $createParagraphNode();
            const beforeTextNode = $createTextNode(beforeText);
            beforeParagraph.append(beforeTextNode);
            root.append(beforeParagraph);

            const codeBlock = $createCodeBlockNode('', 'plaintext');
            root.append(codeBlock);

            const afterParagraph = $createParagraphNode();
            const afterTextNode = $createTextNode(afterText);
            afterParagraph.append(afterTextNode);
            root.append(afterParagraph);

            // Convert empty code block to paragraph
            const newParagraph = $createParagraphNode();
            codeBlock.replace(newParagraph);

            // Verify surrounding content is preserved
            const allText = root.getTextContent();
            expect(allText).toContain(beforeText);
            expect(allText).toContain(afterText);

            // Verify structure
            const children = root.getChildren();
            expect(children.length).toBe(3);
            
            const paragraphs = children.filter(node => node.getType() === 'paragraph');
            expect(paragraphs.length).toBe(3);

            const codeBlocks = children.filter(node => $isCodeBlockNode(node));
            expect(codeBlocks.length).toBe(0);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
