import { DecoratorNode } from 'lexical';
import React, { useRef, useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';

// Import highlight.js - simple and reliable
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';

// Supported languages list
export const SUPPORTED_LANGUAGES = [
  { value: 'plaintext', label: 'Plain Text' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'less', label: 'Less' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'jsx', label: 'JSX' },
  { value: 'tsx', label: 'TSX' },
  { value: 'json', label: 'JSON' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
  { value: 'powershell', label: 'PowerShell' },
];

/**
 * Validate language and return valid language or fallback to plaintext
 */
export function validateLanguage(language) {
  const validLanguages = SUPPORTED_LANGUAGES.map(lang => lang.value);
  if (!validLanguages.includes(language)) {
    console.warn(`Unsupported language: ${language}, falling back to plaintext`);
    return 'plaintext';
  }
  return language;
}

export class CodeBlockNode extends DecoratorNode {
  __code;
  __language;

  static getType() {
    return 'code-block';
  }

  static clone(node) {
    return new CodeBlockNode(node.__code, node.__language, node.__key);
  }

  static importJSON(serializedNode) {
    const { code, language } = serializedNode;
    return new CodeBlockNode(code || '', validateLanguage(language || 'plaintext'));
  }

  exportJSON() {
    return {
      type: 'code-block',
      code: this.__code,
      language: this.__language,
      version: 1,
    };
  }

  constructor(code = '', language = 'plaintext', key) {
    super(key);
    this.__code = code;
    this.__language = language;
  }

  createDOM(config) {
    const div = document.createElement('div');
    const theme = config.theme;
    const className = theme.codeBlock;
    if (className !== undefined) {
      div.className = className;
    }
    return div;
  }

  updateDOM() {
    return false;
  }

  decorate() {
    return (
      <CodeBlockComponent
        code={this.__code}
        language={this.__language}
        nodeKey={this.getKey()}
      />
    );
  }

  // Accessor methods
  getCode() {
    return this.__code;
  }

  setCode(code) {
    const writable = this.getWritable();
    writable.__code = code;
  }

  getLanguage() {
    return this.__language;
  }

  setLanguage(language) {
    const writable = this.getWritable();
    writable.__language = language;
  }
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * LanguageSelector component for selecting programming language
 */
function LanguageSelector({ value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  // Filter languages based on search term
  const filteredLanguages = SUPPORTED_LANGUAGES.filter(lang =>
    lang.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lang.value.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  const handleLanguageSelect = (language) => {
    const validatedLanguage = validateLanguage(language);
    onChange(validatedLanguage);
    setIsOpen(false);
    setSearchTerm('');
  };

  const currentLanguageLabel = SUPPORTED_LANGUAGES.find(lang => lang.value === value)?.label || value;

  return (
    <div className="language-selector" ref={dropdownRef}>
      <button
        className="language-selector-button"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        {currentLanguageLabel}
        <span className="language-selector-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>
      
      {isOpen && (
        <div className="language-selector-dropdown">
          <input
            type="text"
            className="language-selector-search"
            placeholder="Search languages..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
          <div className="language-selector-list">
            {filteredLanguages.length > 0 ? (
              filteredLanguages.map((lang) => (
                <div
                  key={lang.value}
                  className={`language-selector-item ${lang.value === value ? 'selected' : ''}`}
                  onClick={() => handleLanguageSelect(lang.value)}
                >
                  {lang.label}
                </div>
              ))
            ) : (
              <div className="language-selector-item disabled">
                No languages found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Highlight code using highlight.js
 * Falls back to plain text if highlighting fails
 */
function highlightCode(code, language) {
  try {
    // Handle plaintext - no highlighting needed
    if (language === 'plaintext' || language === 'text') {
      return escapeHtml(code);
    }

    // Map language aliases
    const languageMap = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'sh': 'bash',
      'html': 'xml',
      'xml': 'xml',
      'yml': 'yaml',
    };

    const hlLanguage = languageMap[language] || language;

    // Try to highlight with the specified language
    try {
      const result = hljs.highlight(code, { language: hlLanguage, ignoreIllegals: true });
      return result.value;
    } catch (err) {
      // If language not found, try auto-detection
      const result = hljs.highlightAuto(code);
      return result.value;
    }
  } catch (error) {
    // Highlighting failed, fall back to plain text
    console.error('Syntax highlighting failed:', error);
    return escapeHtml(code);
  }
}

const CodeBlockComponent = React.memo(function CodeBlockComponent({ code, language, nodeKey }) {
  const [editor] = useLexicalComposerContext();
  const textareaRef = useRef(null);
  const preRef = useRef(null);
  const [autoHighlight, setAutoHighlight] = useState(true);
  const [showEnableButton, setShowEnableButton] = useState(false);
  const highlightTimeoutRef = useRef(null);

  // Performance optimization: detect large files
  const MAX_LINES_FOR_AUTO_HIGHLIGHT = 1000;
  const lineCount = code.split('\n').length;
  const isLargeFile = lineCount > MAX_LINES_FOR_AUTO_HIGHLIGHT;

  // Calculate line numbers based on code content
  const lines = code.split('\n');
  const lineNumbers = lines.map((_, index) => index + 1);

  // Check if auto-highlighting should be disabled for large files
  useEffect(() => {
    if (isLargeFile && autoHighlight) {
      setAutoHighlight(false);
      setShowEnableButton(true);
    }
  }, [isLargeFile, autoHighlight]);

  // Apply syntax highlighting to the preview element
  useEffect(() => {
    if (!preRef.current) return;

    // Clear previous timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }

    // Debounce highlighting for better performance
    highlightTimeoutRef.current = setTimeout(() => {
      if (autoHighlight || !isLargeFile) {
        const highlighted = highlightCode(code, language);
        preRef.current.innerHTML = highlighted;
      } else {
        // For large files with auto-highlight disabled, show plain text
        preRef.current.textContent = code;
      }
    }, 200);

    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, [code, language, autoHighlight, isLargeFile]);

  // Handle manual highlight enable for large files
  const handleEnableHighlight = () => {
    setAutoHighlight(true);
    setShowEnableButton(false);
  };

  // Handle textarea input changes
  const handleTextareaChange = (event) => {
    const newCode = event.target.value;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node && $isCodeBlockNode(node)) {
        node.setCode(newCode);
      }
    });
  };

  // Handle paste events
  const handlePaste = (event) => {
    // Let the default paste behavior work
    setTimeout(() => {
      const newCode = textareaRef.current?.value || '';
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node && $isCodeBlockNode(node)) {
          node.setCode(newCode);
        }
      });
    }, 0);
  };

  // Handle language selection changes
  const handleLanguageChange = (newLanguage) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node && $isCodeBlockNode(node)) {
        node.setLanguage(newLanguage);
      }
    });
  };

  // Sync textarea scroll with preview
  const handleScroll = (event) => {
    if (preRef.current && textareaRef.current) {
      preRef.current.scrollTop = event.target.scrollTop;
      preRef.current.scrollLeft = event.target.scrollLeft;
    }
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <LanguageSelector value={language} onChange={handleLanguageChange} />
        {showEnableButton && (
          <button
            className="enable-highlight-button"
            onClick={handleEnableHighlight}
            style={{
              marginLeft: '10px',
              padding: '4px 12px',
              fontSize: '12px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            启用高亮 ({lineCount} 行)
          </button>
        )}
        {isLargeFile && !showEnableButton && (
          <span style={{ marginLeft: '10px', fontSize: '12px', color: '#666' }}>
            大文件 ({lineCount} 行)
          </span>
        )}
      </div>
      <div className="code-block-content">
        <div className="line-numbers" aria-hidden="true">
          {lineNumbers.map((num) => (
            <div key={num} className="line-number">
              {num}
            </div>
          ))}
        </div>
        <div className="code-editor-container">
          <textarea
            ref={textareaRef}
            value={code}
            onChange={handleTextareaChange}
            onPaste={handlePaste}
            onScroll={handleScroll}
            className="code-textarea"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              padding: '12px',
              margin: 0,
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              fontSize: '13px',
              lineHeight: '1.5',
              color: 'transparent',
              backgroundColor: 'transparent',
              caretColor: '#333',
              whiteSpace: 'pre',
              wordWrap: 'normal',
              overflowWrap: 'normal',
              tabSize: 4,
              zIndex: 3,
            }}
          />
          <pre
            ref={preRef}
            className={`language-${language} code-preview`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              padding: '12px',
              margin: 0,
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              fontSize: '13px',
              lineHeight: '1.5',
              color: '#333',
              backgroundColor: '#f5f5f5',
              whiteSpace: 'pre',
              wordWrap: 'normal',
              overflowWrap: 'normal',
              tabSize: 4,
              overflow: 'auto',
              zIndex: 2,
              pointerEvents: 'none',
            }}
          >
            {code}
          </pre>
        </div>
      </div>
    </div>
  );
});

// Factory functions
export function $createCodeBlockNode(code = '', language = 'plaintext') {
  return new CodeBlockNode(code, language);
}

export function $isCodeBlockNode(node) {
  return node instanceof CodeBlockNode;
}
