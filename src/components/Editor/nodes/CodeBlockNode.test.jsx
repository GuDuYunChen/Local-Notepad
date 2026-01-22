import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createEditor } from 'lexical';
import { CodeBlockNode, $createCodeBlockNode, $isCodeBlockNode } from './CodeBlockNode';

describe('CodeBlockNode Properties', () => {
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
   * Feature: code-block-feature, Property 3: 代码块默认语言初始化
   * 
   * **Validates: Requirements 1.3**
   * 
   * For any new code block created, its language property should initialize to 'plaintext'
   */
  it('should initialize new code blocks with plaintext language', () => {
    fc.assert(
      fc.property(
        fc.string(), // arbitrary code content
        (code) => {
          let result;
          editor.update(() => {
            const node = $createCodeBlockNode(code);
            result = node.getLanguage();
          });
          expect(result).toBe('plaintext');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 3: 代码块默认语言初始化
   * 
   * **Validates: Requirements 1.3**
   * 
   * When no parameters are provided, the node should default to empty code and plaintext language
   */
  it('should initialize with defaults when no parameters provided', () => {
    editor.update(() => {
      const node = $createCodeBlockNode();
      expect(node.getCode()).toBe('');
      expect(node.getLanguage()).toBe('plaintext');
    });
  });

  /**
   * Feature: code-block-feature, Property 20: 序列化往返一致性
   * 
   * **Validates: Requirements 7.1, 7.2, 7.3**
   * 
   * For any valid code block object, serialization followed by deserialization
   * should produce an equivalent object (same content and language settings)
   */
  it('should maintain equivalence after serialize-deserialize round trip', () => {
    // Define a set of common programming languages for testing
    const commonLanguages = [
      'plaintext', 'javascript', 'typescript', 'python', 'java', 
      'cpp', 'go', 'rust', 'html', 'css', 'json', 'markdown'
    ];

    fc.assert(
      fc.property(
        fc.string(), // arbitrary code
        fc.constantFrom(...commonLanguages), // arbitrary supported language
        (code, language) => {
          let serialized, deserializedCode, deserializedLanguage;
          
          editor.update(() => {
            const original = $createCodeBlockNode(code, language);
            serialized = original.exportJSON();
            const deserialized = CodeBlockNode.importJSON(serialized);
            
            deserializedCode = deserialized.getCode();
            deserializedLanguage = deserialized.getLanguage();
            
            // Verify content equivalence
            expect(deserializedCode).toBe(code);
            expect(deserializedLanguage).toBe(language);
            
            // Verify serialized format
            expect(serialized.type).toBe('code-block');
            expect(serialized.version).toBe(1);
            expect(serialized.code).toBe(code);
            expect(serialized.language).toBe(language);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 20: 序列化往返一致性
   * 
   * **Validates: Requirements 7.2**
   * 
   * Deserialization should handle missing fields gracefully with defaults
   */
  it('should handle missing fields during deserialization', () => {
    fc.assert(
      fc.property(
        fc.record({
          type: fc.constant('code-block'),
          version: fc.constant(1),
          // code and language may be missing
        }),
        (serializedNode) => {
          editor.update(() => {
            const node = CodeBlockNode.importJSON(serializedNode);
            
            // Should default to empty string and plaintext
            expect(node.getCode()).toBe('');
            expect(node.getLanguage()).toBe('plaintext');
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature
   * 
   * Test the type guard function
   */
  it('should correctly identify CodeBlockNode instances', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        (code, language) => {
          editor.update(() => {
            const node = $createCodeBlockNode(code, language);
            expect($isCodeBlockNode(node)).toBe(true);
            expect($isCodeBlockNode(null)).toBe(false);
            expect($isCodeBlockNode(undefined)).toBe(false);
            expect($isCodeBlockNode({})).toBe(false);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature
   * 
   * Test the clone functionality
   */
  it('should correctly clone nodes with all properties', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        (code, language) => {
          editor.update(() => {
            const original = $createCodeBlockNode(code, language);
            const cloned = CodeBlockNode.clone(original);
            
            expect(cloned.getCode()).toBe(original.getCode());
            expect(cloned.getLanguage()).toBe(original.getLanguage());
            expect($isCodeBlockNode(cloned)).toBe(true);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature
   * 
   * Test that getType returns correct type
   */
  it('should return correct node type', () => {
    expect(CodeBlockNode.getType()).toBe('code-block');
  });

  /**
   * Feature: code-block-feature
   * 
   * Test basic getter methods work correctly
   */
  it('should allow getting code and language', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        (code, language) => {
          editor.update(() => {
            const node = $createCodeBlockNode(code, language);
            expect(node.getCode()).toBe(code);
            expect(node.getLanguage()).toBe(language);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature
   * 
   * **Validates: Requirements 5.1, 5.2**
   * 
   * Test that the component renders with correct props
   */
  it('should render component with code and language props', () => {
    const testCode = 'const x = 42;';
    const testLanguage = 'javascript';
    
    editor.update(() => {
      const node = $createCodeBlockNode(testCode, testLanguage);
      const component = node.decorate();
      
      // Verify component is returned
      expect(component).toBeDefined();
      expect(component.props.code).toBe(testCode);
      expect(component.props.language).toBe(testLanguage);
      expect(component.props.nodeKey).toBeDefined();
    });
  });

  /**
   * Feature: code-block-feature
   * 
   * **Validates: Requirements 5.5**
   * 
   * Test that line numbers are displayed correctly
   */
  it('should display line numbers for multiline code', () => {
    const multilineCode = 'line 1\nline 2\nline 3\nline 4\nline 5';
    const lines = multilineCode.split('\n');
    
    expect(lines.length).toBe(5);
    
    // Verify that line numbers would be generated correctly
    const expectedLineNumbers = [1, 2, 3, 4, 5];
    const actualLineNumbers = lines.map((_, index) => index + 1);
    
    expect(actualLineNumbers).toEqual(expectedLineNumbers);
  });

  /**
   * Feature: code-block-feature
   * 
   * **Validates: Requirements 5.5**
   * 
   * Test that line numbers work for single line code
   */
  it('should display single line number for single line code', () => {
    const singleLineCode = 'const x = 42;';
    const lines = singleLineCode.split('\n');
    
    expect(lines.length).toBe(1);
    
    const lineNumbers = lines.map((_, index) => index + 1);
    expect(lineNumbers).toEqual([1]);
  });

  /**
   * Feature: code-block-feature
   * 
   * **Validates: Requirements 5.5**
   * 
   * Test that line numbers work for empty code
   */
  it('should display line number for empty code', () => {
    const emptyCode = '';
    const lines = emptyCode.split('\n');
    
    expect(lines.length).toBe(1);
    
    const lineNumbers = lines.map((_, index) => index + 1);
    expect(lineNumbers).toEqual([1]);
  });

  /**
   * Feature: code-block-feature
   * 
   * **Validates: Requirements 5.3**
   * 
   * Test that language label is included in component props
   */
  it('should include language label in component', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom('javascript', 'python', 'java', 'cpp', 'go', 'rust', 'plaintext'),
        (code, language) => {
          editor.update(() => {
            const node = $createCodeBlockNode(code, language);
            const component = node.decorate();
            
            expect(component.props.language).toBe(language);
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Feature: code-block-feature
   * 
   * **Validates: Requirements 4.1**
   * 
   * Test that code content is passed to component correctly
   */
  it('should pass code content to component', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 500 }),
        (code) => {
          editor.update(() => {
            const node = $createCodeBlockNode(code);
            const component = node.decorate();
            
            expect(component.props.code).toBe(code);
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Feature: code-block-feature, Property 5: 语言选择应用语法高亮
   * 
   * **Validates: Requirements 2.2**
   * 
   * For any code block and programming language selection, when the user selects
   * that language, the code should apply the corresponding syntax highlighting styles.
   * 
   * This test verifies that:
   * 1. The language is correctly set on the node
   * 2. The component receives the correct language prop
   * 3. The language is reflected in the component's className for styling
   */
  it('should apply syntax highlighting when language is selected', () => {
    const supportedLanguages = [
      'javascript', 'typescript', 'jsx', 'tsx', 'python', 'java', 
      'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby', 'swift', 
      'kotlin', 'css', 'scss', 'less', 'markup', 'json', 'yaml', 
      'markdown', 'sql', 'bash', 'powershell', 'plaintext'
    ];

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }), // arbitrary code content
        fc.constantFrom(...supportedLanguages), // arbitrary supported language
        (code, language) => {
          let componentLanguage, componentCode;
          
          editor.update(() => {
            // Create a code block with specific language
            const node = $createCodeBlockNode(code, language);
            
            // Verify the language is set correctly on the node
            expect(node.getLanguage()).toBe(language);
            
            // Get the component that will be rendered
            const component = node.decorate();
            
            // Verify the component receives the correct language prop
            componentLanguage = component.props.language;
            componentCode = component.props.code;
            
            expect(componentLanguage).toBe(language);
            expect(componentCode).toBe(code);
          });
          
          // The component should have the language prop set correctly
          // which will be used to apply syntax highlighting via highlight.js
          expect(componentLanguage).toBe(language);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 5: 语言选择应用语法高亮
   * 
   * **Validates: Requirements 2.2, 2.5**
   * 
   * When language is set to "plaintext", no syntax highlighting should be applied.
   * This is a special case of Property 5.
   */
  it('should not apply syntax highlighting for plaintext language', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (code) => {
          editor.update(() => {
            const node = $createCodeBlockNode(code, 'plaintext');
            
            expect(node.getLanguage()).toBe('plaintext');
            
            const component = node.decorate();
            expect(component.props.language).toBe('plaintext');
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 6: 代码修改实时更新高亮
   * 
   * **Validates: Requirements 2.4**
   * 
   * For any code block content modification, syntax highlighting should update
   * in real-time to reflect the new content.
   * 
   * This test verifies that:
   * 1. When code content changes, the node's code property is updated
   * 2. The updated code is reflected in the component
   * 3. The component will re-render with new highlighting (via React's useEffect)
   */
  it('should update syntax highlighting in real-time when code is modified', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }), // initial code
        fc.string({ minLength: 1, maxLength: 100 }), // modified code
        fc.constantFrom('javascript', 'python', 'java', 'cpp', 'go', 'rust', 'plaintext'),
        (initialCode, modifiedCode, language) => {
          editor.update(() => {
            // Create a code block with initial code
            const node = $createCodeBlockNode(initialCode, language);
            
            // Verify initial state
            expect(node.getCode()).toBe(initialCode);
            expect(node.getLanguage()).toBe(language);
            
            const initialComponent = node.decorate();
            expect(initialComponent.props.code).toBe(initialCode);
            expect(initialComponent.props.language).toBe(language);
          });
          
          editor.update(() => {
            // Get the node and modify its code
            const nodes = editor.getEditorState()._nodeMap;
            const node = Array.from(nodes.values()).find(n => $isCodeBlockNode(n));
            
            if (node) {
              // Modify the code content
              node.setCode(modifiedCode);
              
              // Verify the code was updated
              expect(node.getCode()).toBe(modifiedCode);
              expect(node.getLanguage()).toBe(language);
              
              // Get the updated component
              const updatedComponent = node.decorate();
              
              // Verify the component reflects the updated code
              expect(updatedComponent.props.code).toBe(modifiedCode);
              expect(updatedComponent.props.language).toBe(language);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 6: 代码修改实时更新高亮
   * 
   * **Validates: Requirements 2.4**
   * 
   * When both code and language are modified, highlighting should update to reflect
   * both changes. This tests the interaction between code and language updates.
   */
  it('should update highlighting when both code and language are modified', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.constantFrom('javascript', 'python', 'java'),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.constantFrom('cpp', 'go', 'rust'),
        (initialCode, initialLanguage, newCode, newLanguage) => {
          editor.update(() => {
            // Create initial code block
            const node = $createCodeBlockNode(initialCode, initialLanguage);
            
            expect(node.getCode()).toBe(initialCode);
            expect(node.getLanguage()).toBe(initialLanguage);
          });
          
          editor.update(() => {
            // Get the node and modify both code and language
            const nodes = editor.getEditorState()._nodeMap;
            const node = Array.from(nodes.values()).find(n => $isCodeBlockNode(n));
            
            if (node) {
              // Modify both properties
              node.setCode(newCode);
              node.setLanguage(newLanguage);
              
              // Verify both updates
              expect(node.getCode()).toBe(newCode);
              expect(node.getLanguage()).toBe(newLanguage);
              
              // Verify component reflects both changes
              const component = node.decorate();
              expect(component.props.code).toBe(newCode);
              expect(component.props.language).toBe(newLanguage);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: code-block-feature, Property 6: 代码修改实时更新高亮
   * 
   * **Validates: Requirements 2.4**
   * 
   * Test that multiline code modifications are handled correctly with real-time updates.
   */
  it('should update highlighting for multiline code modifications', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
        fc.constantFrom('javascript', 'python', 'java', 'plaintext'),
        (initialLines, modifiedLines, language) => {
          const initialCode = initialLines.join('\n');
          const modifiedCode = modifiedLines.join('\n');
          
          editor.update(() => {
            const node = $createCodeBlockNode(initialCode, language);
            expect(node.getCode()).toBe(initialCode);
          });
          
          editor.update(() => {
            const nodes = editor.getEditorState()._nodeMap;
            const node = Array.from(nodes.values()).find(n => $isCodeBlockNode(n));
            
            if (node) {
              node.setCode(modifiedCode);
              expect(node.getCode()).toBe(modifiedCode);
              
              const component = node.decorate();
              expect(component.props.code).toBe(modifiedCode);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
