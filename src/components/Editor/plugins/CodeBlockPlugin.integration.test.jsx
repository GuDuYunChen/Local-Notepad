import { describe, it, expect, beforeEach } from 'vitest';
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
import { CodeBlockNode, $createCodeBlockNode, $isCodeBlockNode } from '../nodes/CodeBlockNode';
import { ImageNode, $createImageNode } from '../nodes/ImageNode';

/**
 * Integration tests for CodeBlockPlugin
 * 
 * These tests verify the integration of code blocks with other editor features
 * including other nodes, serialization, and complete workflows.
 */
describe('CodeBlockPlugin Integration Tests', () => {
  let editor;

  beforeEach(() => {
    editor = createEditor({
      nodes: [CodeBlockNode, ImageNode],
      onError: (error) => {
        throw error;
      },
    });
  });

  /**
   * Test code block interaction with paragraphs
   */
  it('should work correctly with paragraphs', () => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      // Create mixed content
      const paragraph1 = $createParagraphNode();
      const text1 = $createTextNode('First paragraph');
      paragraph1.append(text1);
      root.append(paragraph1);

      const codeBlock = $createCodeBlockNode('const x = 42;', 'javascript');
      root.append(codeBlock);

      const paragraph2 = $createParagraphNode();
      const text2 = $createTextNode('Second paragraph');
      paragraph2.append(text2);
      root.append(paragraph2);

      // Verify structure
      const children = root.getChildren();
      expect(children.length).toBe(3);
      expect(children[0].getType()).toBe('paragraph');
      expect(children[1].getType()).toBe('code-block');
      expect(children[2].getType()).toBe('paragraph');

      // Verify content
      expect(root.getTextContent()).toContain('First paragraph');
      expect(root.getTextContent()).toContain('const x = 42;');
      expect(root.getTextContent()).toContain('Second paragraph');
    });
  });

  /**
   * Test code block interaction with images
   */
  it('should work correctly with image nodes', () => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      // Create mixed content
      const codeBlock = $createCodeBlockNode('console.log("test");', 'javascript');
      root.append(codeBlock);

      const image = $createImageNode('test.jpg', 'Test Image', 100, 100);
      root.append(image);

      const paragraph = $createParagraphNode();
      root.append(paragraph);

      // Verify structure
      const children = root.getChildren();
      expect(children.length).toBe(3);
      expect(children[0].getType()).toBe('code-block');
      expect(children[1].getType()).toBe('image');
      expect(children[2].getType()).toBe('paragraph');
    });
  });

  /**
   * Test code block with very long content
   */
  it('should handle code blocks with long content', () => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      // Create long code (2000 lines)
      const lines = [];
      for (let i = 0; i < 2000; i++) {
        lines.push(`line ${i}`);
      }
      const longCode = lines.join('\n');

      const codeBlock = $createCodeBlockNode(longCode, 'plaintext');
      root.append(codeBlock);

      // Verify
      expect(codeBlock.getCode()).toBe(longCode);
      expect(codeBlock.getCode().split('\n').length).toBe(2000);
    });
  });

  /**
   * Test inserting code block between existing content
   */
  it('should correctly insert code block between existing content', () => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      // Create initial content
      const paragraph1 = $createParagraphNode();
      const text1 = $createTextNode('First');
      paragraph1.append(text1);
      root.append(paragraph1);

      const paragraph2 = $createParagraphNode();
      const text2 = $createTextNode('Second');
      paragraph2.append(text2);
      root.append(paragraph2);

      // Insert code block between them
      const codeBlock = $createCodeBlockNode('inserted code', 'javascript');
      paragraph1.insertAfter(codeBlock);

      // Verify order
      const children = root.getChildren();
      expect(children.length).toBe(3);
      expect(children[0].getType()).toBe('paragraph');
      expect(children[1].getType()).toBe('code-block');
      expect(children[2].getType()).toBe('paragraph');

      expect(children[0].getTextContent()).toBe('First');
      expect(children[1].getCode()).toBe('inserted code');
      expect(children[2].getTextContent()).toBe('Second');
    });
  });

  /**
   * Test replacing paragraph with code block
   */
  it('should correctly replace paragraph with code block', () => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const paragraph = $createParagraphNode();
      const text = $createTextNode('Replace me');
      paragraph.append(text);
      root.append(paragraph);

      // Replace with code block
      const codeBlock = $createCodeBlockNode('replacement code', 'javascript');
      paragraph.replace(codeBlock);

      // Verify
      const children = root.getChildren();
      expect(children.length).toBe(1);
      expect($isCodeBlockNode(children[0])).toBe(true);
      expect(children[0].getCode()).toBe('replacement code');
    });
  });
});
