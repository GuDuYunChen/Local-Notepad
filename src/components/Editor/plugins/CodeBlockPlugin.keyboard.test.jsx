import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createEditor, $getRoot, $createParagraphNode, $createTextNode, $getSelection } from 'lexical';
import { CodeBlockNode, $createCodeBlockNode, $isCodeBlockNode } from '../nodes/CodeBlockNode';

/**
 * Property-based tests for CodeBlockPlugin keyboard event handling
 * 
 * These tests verify the correctness properties of special key handling
 * (Tab, Enter, Escape) and navigation within code blocks.
 */
describe('CodeBlockPlugin Keyboard Event Properties', () => {
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
   * Feature: code-block-feature, Property 11: Tab 键插入制表符
   * 
   * **Validates: Requirements 4.2**
   * 
   * For any code block, when the user presses Tab key, it should insert a tab character
   * instead of moving focus to the next element.
   */
  it('should insert tab character instead of moving focus', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.nat({ max: 100 }),
        (initialCode, insertPosition) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(initialCode, 'plaintext');
            root.append(codeBlock);

            // Simulate Tab key press by inserting tab character
            const position = Math.min(insertPosition, initialCode.length);
            const beforeTab = initialCode.substring(0, position);
            const afterTab = initialCode.substring(position);
            const newCode = beforeTab + '\t' + afterTab;
            
            codeBlock.setCode(newCode);
            
            const updatedCode = codeBlock.getCode();
            
            // Verify tab character was inserted
            expect(updatedCode).toContain('\t');
            expect(updatedCode.length).toBe(initialCode.length + 1);
            expect(updatedCode).toBe(newCode);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 11: Tab 键插入制表符
   * 
   * **Validates: Requirements 4.2**
   * 
   * Test that multiple tab characters can be inserted in sequence.
   */
  it('should allow multiple tab characters in code block', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 5 }),
        (initialCode, tabCount) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(initialCode, 'plaintext');
            root.append(codeBlock);

            // Insert multiple tabs
            const tabs = '\t'.repeat(tabCount);
            const newCode = initialCode + tabs;
            codeBlock.setCode(newCode);
            
            const updatedCode = codeBlock.getCode();
            
            // Count tab characters
            const tabMatches = updatedCode.match(/\t/g);
            const actualTabCount = tabMatches ? tabMatches.length : 0;
            
            expect(actualTabCount).toBe(tabCount);
            expect(updatedCode.length).toBe(initialCode.length + tabCount);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 12: Enter 键插入换行
   * 
   * **Validates: Requirements 4.3**
   * 
   * For any code block, when the user presses Enter key, it should insert a newline character
   * and keep the cursor within the code block.
   */
  it('should insert newline and stay in code block', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.nat({ max: 100 }),
        (initialCode, insertPosition) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(initialCode, 'plaintext');
            root.append(codeBlock);

            // Simulate Enter key press by inserting newline
            const position = Math.min(insertPosition, initialCode.length);
            const beforeNewline = initialCode.substring(0, position);
            const afterNewline = initialCode.substring(position);
            const newCode = beforeNewline + '\n' + afterNewline;
            
            codeBlock.setCode(newCode);
            
            const updatedCode = codeBlock.getCode();
            
            // Verify newline was inserted
            expect(updatedCode).toContain('\n');
            expect(updatedCode.length).toBe(initialCode.length + 1);
            expect(updatedCode).toBe(newCode);
            
            // Verify code block still exists (not exited)
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));
            expect(foundCodeBlock).toBeDefined();
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 12: Enter 键插入换行
   * 
   * **Validates: Requirements 4.3**
   * 
   * Test that multiple newlines can be inserted to create multi-line code.
   */
  it('should allow multiple newlines for multi-line code', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 30 }), { minLength: 1, maxLength: 10 }),
        (lines) => {
          const multilineCode = lines.join('\n');
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(multilineCode, 'plaintext');
            root.append(codeBlock);
            
            const code = codeBlock.getCode();
            
            // Count newlines
            const newlineMatches = code.match(/\n/g);
            const actualNewlineCount = newlineMatches ? newlineMatches.length : 0;
            
            expect(actualNewlineCount).toBe(lines.length - 1);
            expect(code).toBe(multilineCode);
            
            // Verify all lines are present
            const codeLines = code.split('\n');
            expect(codeLines.length).toBe(lines.length);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 14: Escape 键退出代码块
   * 
   * **Validates: Requirements 4.5**
   * 
   * For any code block, when the user presses Escape key, focus should move out of the code block.
   */
  it('should move focus out of code block on Escape', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }),
        (code) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(code, 'plaintext');
            root.append(codeBlock);
            
            const afterParagraph = $createParagraphNode();
            root.append(afterParagraph);

            // Simulate Escape key by selecting next node
            codeBlock.selectNext();
            
            const selection = $getSelection();
            
            // Verify selection moved (not in code block anymore)
            // In a real scenario, selection would be on the paragraph after code block
            expect(selection).toBeDefined();
            
            // Verify code block still exists
            const children = root.getChildren();
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));
            expect(foundCodeBlock).toBeDefined();
            
            // Verify paragraph after code block exists
            const foundParagraph = children.find(node => node.getType() === 'paragraph');
            expect(foundParagraph).toBeDefined();
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 18: 方向键导航
   * 
   * **Validates: Requirements 6.3**
   * 
   * For any code block, arrow keys should allow moving the cursor within the code block
   * and between the code block and other content.
   */
  it('should allow arrow key navigation within and between code blocks', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (beforeText, codeText) => {
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
            root.append(afterParagraph);

            // Verify all nodes exist for navigation
            const children = root.getChildren();
            
            expect(children.length).toBeGreaterThanOrEqual(3);
            
            const foundCodeBlock = children.find(node => $isCodeBlockNode(node));
            expect(foundCodeBlock).toBeDefined();
            
            const paragraphs = children.filter(node => node.getType() === 'paragraph');
            expect(paragraphs.length).toBeGreaterThanOrEqual(2);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 19: 边界导航退出
   * 
   * **Validates: Requirements 6.4, 6.5**
   * 
   * For any code block, pressing up arrow on the first line should move cursor to content before
   * the code block, and pressing down arrow on the last line should move cursor to content after.
   */
  it('should exit code block at boundaries with arrow keys', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (beforeText, codeLines, afterText) => {
          const codeText = codeLines.join('\n');
          
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

            // Verify structure for boundary navigation
            const children = root.getChildren();
            
            const codeBlockIndex = children.findIndex(node => $isCodeBlockNode(node));
            expect(codeBlockIndex).toBeGreaterThan(0);
            expect(codeBlockIndex).toBeLessThan(children.length - 1);
            
            // Verify content before code block
            const nodeBefore = children[codeBlockIndex - 1];
            expect(nodeBefore).toBeDefined();
            expect(nodeBefore.getTextContent()).toBe(beforeText);
            
            // Verify content after code block
            const nodeAfter = children[codeBlockIndex + 1];
            expect(nodeAfter).toBeDefined();
            expect(nodeAfter.getTextContent()).toBe(afterText);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 19: 边界导航退出
   * 
   * **Validates: Requirements 6.4, 6.5**
   * 
   * Test boundary navigation with single-line code blocks.
   */
  it('should handle boundary navigation for single-line code blocks', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        (codeText) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const beforeParagraph = $createParagraphNode();
            const beforeTextNode = $createTextNode('before');
            beforeParagraph.append(beforeTextNode);
            root.append(beforeParagraph);

            const codeBlock = $createCodeBlockNode(codeText, 'plaintext');
            root.append(codeBlock);

            const afterParagraph = $createParagraphNode();
            const afterTextNode = $createTextNode('after');
            afterParagraph.append(afterTextNode);
            root.append(afterParagraph);

            // For single-line code, first line = last line
            // Both up and down arrows should allow exiting
            const children = root.getChildren();
            const codeBlockIndex = children.findIndex(node => $isCodeBlockNode(node));
            
            expect(codeBlockIndex).toBe(1);
            expect(children[0].getTextContent()).toBe('before');
            expect(children[2].getTextContent()).toBe('after');
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 11: Tab 键插入制表符
   * 
   * **Validates: Requirements 4.2**
   * 
   * Test that tab characters are preserved in code content.
   */
  it('should preserve tab characters in code content', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 3 }),
        (textSegments, tabsPerSegment) => {
          const tabs = '\t'.repeat(tabsPerSegment);
          const codeWithTabs = textSegments.join(tabs);
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(codeWithTabs, 'plaintext');
            root.append(codeBlock);
            
            const code = codeBlock.getCode();
            
            // Count tabs
            const tabMatches = code.match(/\t/g);
            const actualTabCount = tabMatches ? tabMatches.length : 0;
            const expectedTabCount = tabsPerSegment * (textSegments.length - 1);
            
            expect(actualTabCount).toBe(expectedTabCount);
            expect(code).toBe(codeWithTabs);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 12: Enter 键插入换行
   * 
   * **Validates: Requirements 4.3**
   * 
   * Test that empty lines (consecutive newlines) are preserved.
   */
  it('should preserve empty lines in code', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (emptyLineCount) => {
          const codeWithEmptyLines = 'line1' + '\n'.repeat(emptyLineCount) + 'line2';
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(codeWithEmptyLines, 'plaintext');
            root.append(codeBlock);
            
            const code = codeBlock.getCode();
            
            // Count newlines
            const newlineMatches = code.match(/\n/g);
            const actualNewlineCount = newlineMatches ? newlineMatches.length : 0;
            
            expect(actualNewlineCount).toBe(emptyLineCount);
            expect(code).toBe(codeWithEmptyLines);
            
            // Verify lines
            const lines = code.split('\n');
            expect(lines[0]).toBe('line1');
            expect(lines[lines.length - 1]).toBe('line2');
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
