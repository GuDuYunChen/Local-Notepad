import { describe, it, expect } from 'vitest';
import { createEditor } from 'lexical';
import { CodeBlockNode, $createCodeBlockNode, $isCodeBlockNode } from './nodes/CodeBlockNode';
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableNode, TableCellNode, TableRowNode } from "@lexical/table";
import { ListItemNode, ListNode } from "@lexical/list";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";

/**
 * Integration tests for Editor with CodeBlockNode registration
 * 
 * **Validates: Requirements 5.1, 5.2, 5.4**
 * 
 * These tests verify that CodeBlockNode is properly registered in the editor
 * and can be used within the editor's context.
 */
describe('Editor Integration with CodeBlockNode', () => {
  /**
   * Test that CodeBlockNode is registered in the editor configuration
   */
  it('should register CodeBlockNode in editor nodes', () => {
    const editor = createEditor({
      nodes: [
        HeadingNode, QuoteNode, ListItemNode, ListNode, CodeHighlightNode, CodeNode,
        TableNode, TableCellNode, TableRowNode,
        AutoLinkNode, LinkNode,
        CodeBlockNode
      ],
      onError: (error) => {
        throw error;
      },
    });

    // Verify editor was created successfully
    expect(editor).toBeDefined();

    // Verify we can create and use CodeBlockNode in the editor
    editor.update(() => {
      const node = $createCodeBlockNode('const x = 42;', 'javascript');
      expect($isCodeBlockNode(node)).toBe(true);
      expect(node.getCode()).toBe('const x = 42;');
      expect(node.getLanguage()).toBe('javascript');
    });
  });

  /**
   * Test that CodeBlockNode can be serialized and deserialized in editor context
   */
  it('should serialize and deserialize CodeBlockNode in editor', () => {
    const editor = createEditor({
      nodes: [CodeBlockNode],
      onError: (error) => {
        throw error;
      },
    });

    let serialized;
    
    // Create and serialize
    editor.update(() => {
      const node = $createCodeBlockNode('function hello() {\n  console.log("Hello");\n}', 'javascript');
      serialized = node.exportJSON();
    });

    // Verify serialization format
    expect(serialized.type).toBe('code-block');
    expect(serialized.version).toBe(1);
    expect(serialized.code).toBe('function hello() {\n  console.log("Hello");\n}');
    expect(serialized.language).toBe('javascript');

    // Deserialize and verify
    editor.update(() => {
      const deserialized = CodeBlockNode.importJSON(serialized);
      expect($isCodeBlockNode(deserialized)).toBe(true);
      expect(deserialized.getCode()).toBe(serialized.code);
      expect(deserialized.getLanguage()).toBe(serialized.language);
    });
  });

  /**
   * Test that CodeBlockNode theme class is applied correctly
   */
  it('should apply theme class to CodeBlockNode', () => {
    const theme = {
      codeBlock: 'code-block-wrapper',
    };

    const editor = createEditor({
      nodes: [CodeBlockNode],
      theme,
      onError: (error) => {
        throw error;
      },
    });

    editor.update(() => {
      const node = $createCodeBlockNode('test code', 'plaintext');
      const dom = node.createDOM({ theme });
      
      // Verify the theme class is applied
      expect(dom.className).toBe('code-block-wrapper');
    });
  });

  /**
   * Test that multiple CodeBlockNodes can coexist in the editor
   */
  it('should support multiple CodeBlockNodes in editor', () => {
    const editor = createEditor({
      nodes: [CodeBlockNode],
      onError: (error) => {
        throw error;
      },
    });

    editor.update(() => {
      const node1 = $createCodeBlockNode('const x = 1;', 'javascript');
      const node2 = $createCodeBlockNode('def hello():\n    print("Hello")', 'python');
      const node3 = $createCodeBlockNode('public class Main {}', 'java');

      expect($isCodeBlockNode(node1)).toBe(true);
      expect($isCodeBlockNode(node2)).toBe(true);
      expect($isCodeBlockNode(node3)).toBe(true);

      expect(node1.getLanguage()).toBe('javascript');
      expect(node2.getLanguage()).toBe('python');
      expect(node3.getLanguage()).toBe('java');
    });
  });

  /**
   * Test that CodeBlockNode can be cloned in editor context
   */
  it('should clone CodeBlockNode correctly in editor', () => {
    const editor = createEditor({
      nodes: [CodeBlockNode],
      onError: (error) => {
        throw error;
      },
    });

    editor.update(() => {
      const original = $createCodeBlockNode('original code', 'typescript');
      const cloned = CodeBlockNode.clone(original);

      expect($isCodeBlockNode(cloned)).toBe(true);
      expect(cloned.getCode()).toBe(original.getCode());
      expect(cloned.getLanguage()).toBe(original.getLanguage());
      
      // Verify they are separate instances
      cloned.setCode('modified code');
      expect(cloned.getCode()).not.toBe(original.getCode());
    });
  });

  /**
   * Test that CodeBlockNode decorate method returns valid React component
   */
  it('should return valid React component from decorate method', () => {
    const editor = createEditor({
      nodes: [CodeBlockNode],
      onError: (error) => {
        throw error;
      },
    });

    editor.update(() => {
      const node = $createCodeBlockNode('test code', 'javascript');
      const component = node.decorate();

      // Verify component structure
      expect(component).toBeDefined();
      expect(component.props).toBeDefined();
      expect(component.props.code).toBe('test code');
      expect(component.props.language).toBe('javascript');
      expect(component.props.nodeKey).toBeDefined();
    });
  });

  /**
   * Test that CodeBlockNode updateDOM returns false (uses decorate)
   */
  it('should return false from updateDOM to use decorate', () => {
    const editor = createEditor({
      nodes: [CodeBlockNode],
      onError: (error) => {
        throw error;
      },
    });

    editor.update(() => {
      const node = $createCodeBlockNode('test', 'plaintext');
      const shouldUpdate = node.updateDOM();
      
      // updateDOM should return false because we use decorate for rendering
      expect(shouldUpdate).toBe(false);
    });
  });
});
