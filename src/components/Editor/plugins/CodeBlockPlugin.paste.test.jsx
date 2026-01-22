import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createEditor, $getRoot } from 'lexical';
import { CodeBlockNode, $createCodeBlockNode, $isCodeBlockNode } from '../nodes/CodeBlockNode';

/**
 * Property-based tests for CodeBlockPlugin paste handling
 * 
 * These tests verify the correctness properties of paste format preservation
 * (indentation, newlines, whitespace) in code blocks.
 */
describe('CodeBlockPlugin Paste Format Preservation Properties', () => {
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
   * Feature: code-block-feature, Property 13: 粘贴保留格式
   * 
   * **Validates: Requirements 4.4**
   * 
   * For any text pasted into a code block, the original format (including indentation,
   * newlines, and whitespace) should be preserved.
   */
  it('should preserve indentation when pasting code', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }),
        (lines, indentLevel) => {
          const indent = ' '.repeat(indentLevel * 2);
          const indentedLines = lines.map(line => indent + line);
          const pastedText = indentedLines.join('\n');
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode('', 'plaintext');
            root.append(codeBlock);

            // Simulate paste by setting code with indentation
            codeBlock.setCode(pastedText);
            
            const code = codeBlock.getCode();
            
            // Verify indentation is preserved
            expect(code).toBe(pastedText);
            
            // Verify each line has correct indentation
            const codeLines = code.split('\n');
            codeLines.forEach((line, index) => {
              if (lines[index]) {
                expect(line).toBe(indent + lines[index]);
              }
            });
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 13: 粘贴保留格式
   * 
   * **Validates: Requirements 4.4**
   * 
   * Test that newlines are preserved when pasting multi-line code.
   */
  it('should preserve newlines when pasting multi-line code', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 2, maxLength: 10 }),
        (lines) => {
          const pastedText = lines.join('\n');
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode('', 'plaintext');
            root.append(codeBlock);

            // Simulate paste
            codeBlock.setCode(pastedText);
            
            const code = codeBlock.getCode();
            
            // Verify newlines are preserved
            expect(code).toBe(pastedText);
            
            // Count newlines
            const newlineMatches = code.match(/\n/g);
            const actualNewlineCount = newlineMatches ? newlineMatches.length : 0;
            expect(actualNewlineCount).toBe(lines.length - 1);
            
            // Verify all lines are present
            const codeLines = code.split('\n');
            expect(codeLines.length).toBe(lines.length);
            codeLines.forEach((line, index) => {
              expect(line).toBe(lines[index]);
            });
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 13: 粘贴保留格式
   * 
   * **Validates: Requirements 4.4**
   * 
   * Test that whitespace (spaces and tabs) is preserved when pasting.
   */
  it('should preserve whitespace (spaces and tabs) when pasting', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        (text, spaceCount, tabCount) => {
          const spaces = ' '.repeat(spaceCount);
          const tabs = '\t'.repeat(tabCount);
          const pastedText = spaces + text + tabs;
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode('', 'plaintext');
            root.append(codeBlock);

            // Simulate paste
            codeBlock.setCode(pastedText);
            
            const code = codeBlock.getCode();
            
            // Verify whitespace is preserved
            expect(code).toBe(pastedText);
            expect(code.length).toBe(text.length + spaceCount + tabCount);
            
            // Verify leading spaces
            if (spaceCount > 0) {
              expect(code.substring(0, spaceCount)).toBe(spaces);
            }
            
            // Verify trailing tabs
            if (tabCount > 0) {
              expect(code.substring(code.length - tabCount)).toBe(tabs);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 13: 粘贴保留格式
   * 
   * **Validates: Requirements 4.4**
   * 
   * Test that mixed indentation (spaces and tabs) is preserved.
   */
  it('should preserve mixed indentation (spaces and tabs)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            spaces: fc.integer({ min: 0, max: 4 }),
            tabs: fc.integer({ min: 0, max: 2 }),
            text: fc.string({ minLength: 1, maxLength: 30 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (lineConfigs) => {
          const lines = lineConfigs.map(config => {
            const spaces = ' '.repeat(config.spaces);
            const tabs = '\t'.repeat(config.tabs);
            return spaces + tabs + config.text;
          });
          const pastedText = lines.join('\n');
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode('', 'plaintext');
            root.append(codeBlock);

            // Simulate paste
            codeBlock.setCode(pastedText);
            
            const code = codeBlock.getCode();
            
            // Verify mixed indentation is preserved
            expect(code).toBe(pastedText);
            
            // Verify each line
            const codeLines = code.split('\n');
            codeLines.forEach((line, index) => {
              expect(line).toBe(lines[index]);
              
              // Verify spaces
              const expectedSpaces = ' '.repeat(lineConfigs[index].spaces);
              if (lineConfigs[index].spaces > 0) {
                expect(line.substring(0, lineConfigs[index].spaces)).toBe(expectedSpaces);
              }
              
              // Verify tabs
              const expectedTabs = '\t'.repeat(lineConfigs[index].tabs);
              if (lineConfigs[index].tabs > 0) {
                const tabStart = lineConfigs[index].spaces;
                const tabEnd = tabStart + lineConfigs[index].tabs;
                expect(line.substring(tabStart, tabEnd)).toBe(expectedTabs);
              }
            });
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 13: 粘贴保留格式
   * 
   * **Validates: Requirements 4.4**
   * 
   * Test that empty lines are preserved when pasting.
   */
  it('should preserve empty lines when pasting', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 5 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (line1, emptyLineCount, line2) => {
          const emptyLines = '\n'.repeat(emptyLineCount);
          const pastedText = line1 + emptyLines + line2;
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode('', 'plaintext');
            root.append(codeBlock);

            // Simulate paste
            codeBlock.setCode(pastedText);
            
            const code = codeBlock.getCode();
            
            // Verify empty lines are preserved
            expect(code).toBe(pastedText);
            
            // Count newlines
            const newlineMatches = code.match(/\n/g);
            const actualNewlineCount = newlineMatches ? newlineMatches.length : 0;
            expect(actualNewlineCount).toBe(emptyLineCount);
            
            // Verify structure
            const lines = code.split('\n');
            expect(lines[0]).toBe(line1);
            expect(lines[lines.length - 1]).toBe(line2);
            
            // Verify empty lines in between
            for (let i = 1; i < lines.length - 1; i++) {
              expect(lines[i]).toBe('');
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 13: 粘贴保留格式
   * 
   * **Validates: Requirements 4.4**
   * 
   * Test that trailing whitespace is preserved when pasting.
   */
  it('should preserve trailing whitespace when pasting', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 5 }),
        (text, trailingSpaces) => {
          const spaces = ' '.repeat(trailingSpaces);
          const pastedText = text + spaces;
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode('', 'plaintext');
            root.append(codeBlock);

            // Simulate paste
            codeBlock.setCode(pastedText);
            
            const code = codeBlock.getCode();
            
            // Verify trailing whitespace is preserved
            expect(code).toBe(pastedText);
            expect(code.length).toBe(text.length + trailingSpaces);
            expect(code.substring(code.length - trailingSpaces)).toBe(spaces);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 13: 粘贴保留格式
   * 
   * **Validates: Requirements 4.4**
   * 
   * Test that pasting into existing code preserves format of both old and new content.
   */
  it('should preserve format when pasting into existing code', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.nat({ max: 50 }),
        (existingCode, pastedText, insertPosition) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode(existingCode, 'plaintext');
            root.append(codeBlock);

            // Simulate paste at position
            const position = Math.min(insertPosition, existingCode.length);
            const beforePaste = existingCode.substring(0, position);
            const afterPaste = existingCode.substring(position);
            const newCode = beforePaste + pastedText + afterPaste;
            
            codeBlock.setCode(newCode);
            
            const code = codeBlock.getCode();
            
            // Verify format is preserved
            expect(code).toBe(newCode);
            expect(code.length).toBe(existingCode.length + pastedText.length);
            
            // Verify parts
            expect(code.substring(0, beforePaste.length)).toBe(beforePaste);
            expect(code.substring(beforePaste.length, beforePaste.length + pastedText.length)).toBe(pastedText);
            expect(code.substring(beforePaste.length + pastedText.length)).toBe(afterPaste);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 13: 粘贴保留格式
   * 
   * **Validates: Requirements 4.4**
   * 
   * Test that special characters are preserved when pasting.
   */
  it('should preserve special characters when pasting', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (text) => {
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode('', 'plaintext');
            root.append(codeBlock);

            // Simulate paste
            codeBlock.setCode(text);
            
            const code = codeBlock.getCode();
            
            // Verify all characters are preserved exactly
            expect(code).toBe(text);
            expect(code.length).toBe(text.length);
            
            // Verify character by character
            for (let i = 0; i < text.length; i++) {
              expect(code[i]).toBe(text[i]);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 13: 粘贴保留格式
   * 
   * **Validates: Requirements 4.4**
   * 
   * Test that pasting code with various line endings (LF, CRLF) is handled correctly.
   */
  it('should handle different line endings when pasting', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 2, maxLength: 5 }),
        fc.constantFrom('\n', '\r\n'),
        (lines, lineEnding) => {
          const pastedText = lines.join(lineEnding);
          
          editor.update(() => {
            const root = $getRoot();
            root.clear();

            const codeBlock = $createCodeBlockNode('', 'plaintext');
            root.append(codeBlock);

            // Simulate paste
            codeBlock.setCode(pastedText);
            
            const code = codeBlock.getCode();
            
            // Verify content is preserved (line endings may be normalized)
            expect(code).toBe(pastedText);
            
            // Verify all lines are present
            const codeLines = code.split(/\r?\n/);
            expect(codeLines.length).toBe(lines.length);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
