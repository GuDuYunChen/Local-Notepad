import { DecoratorNode } from 'lexical';
import React, { useRef, useEffect, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';

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
  { value: 'markup', label: 'Markup / HTML' },
  { value: 'xml', label: 'XML' },
  { value: 'objectivec', label: 'Objective-C' },
  { value: 'dart', label: 'Dart' },
  { value: 'scala', label: 'Scala' },
  { value: 'groovy', label: 'Groovy' },
  { value: 'perl', label: 'Perl' },
  { value: 'lua', label: 'Lua' },
  { value: 'r', label: 'R' },
  { value: 'matlab', label: 'MATLAB' },
  { value: 'elixir', label: 'Elixir' },
  { value: 'erlang', label: 'Erlang' },
  { value: 'haskell', label: 'Haskell' },
  { value: 'clojure', label: 'Clojure' },
  { value: 'lisp', label: 'Lisp' },
  { value: 'scheme', label: 'Scheme' },
  { value: 'fsharp', label: 'F#' },
  { value: 'vbnet', label: 'Visual Basic .NET' },
  { value: 'assembly', label: 'Assembly' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'nginx', label: 'Nginx' },
  { value: 'ini', label: 'INI' },
  { value: 'toml', label: 'TOML' },
  { value: 'makefile', label: 'Makefile' },
  { value: 'cmake', label: 'CMake' },
  { value: 'diff', label: 'Diff' },
  { value: 'http', label: 'HTTP' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'protobuf', label: 'Protocol Buffers' },
  { value: 'latex', label: 'LaTeX' },
  { value: 'coffeescript', label: 'CoffeeScript' },
  { value: 'handlebars', label: 'Handlebars' },
  { value: 'twig', label: 'Twig' },
  { value: 'awk', label: 'AWK' },
  { value: 'shell', label: 'Shell' },
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

  isInline() {
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

  getTextContent() {
    return this.__code;
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
 * LanguageSelector component for selecting programming language
 */
function LanguageSelector({ value, onChange, disabled = false }) {
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
        onClick={() => !disabled && setIsOpen(!isOpen)}
        type="button"
        disabled={disabled}
      >
        {currentLanguageLabel}
        <span className="language-selector-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>
      
      {isOpen && !disabled && (
        <div className="language-selector-dropdown">
          <input
            type="text"
            className="language-selector-search"
            placeholder="Search languages…"
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

const CodeBlockComponent = React.memo(function CodeBlockComponent({ code, language, nodeKey }) {
  const [editor] = useLexicalComposerContext();
  const textareaRef = useRef(null);
  const preRef = useRef(null);
  const [autoHighlight, setAutoHighlight] = useState(true);
  const [showEnableButton, setShowEnableButton] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchTarget, setSearchTarget] = useState(false);
  const highlightTimeoutRef = useRef(null);
  const highlightRequestRef = useRef(0);
  const searchTargetTimeoutRef = useRef(null);

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

  // Load syntax highlighting only when a non-plaintext code block is actually rendered.
  useEffect(() => {
    if (!preRef.current) return undefined;

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }

    const requestId = ++highlightRequestRef.current;
    let cancelled = false;

    highlightTimeoutRef.current = setTimeout(async () => {
      if (cancelled || requestId !== highlightRequestRef.current || !preRef.current) return;

      if ((!autoHighlight && isLargeFile) || language === 'plaintext' || language === 'text') {
        preRef.current.textContent = code;
        return;
      }

      try {
        const { highlightCode } = await import('../utils/syntaxHighlight');
        const highlighted = await highlightCode(code, language);

        if (!cancelled && requestId === highlightRequestRef.current && preRef.current) {
          preRef.current.innerHTML = highlighted;
        }
      } catch (error) {
        console.error('Syntax highlighting failed:', error);
        if (!cancelled && requestId === highlightRequestRef.current && preRef.current) {
          preRef.current.textContent = code;
        }
      }
    }, 200);

    return () => {
      cancelled = true;
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

  useEffect(() => {
    const handleSearchMatch = (event) => {
      const detail = event?.detail || {};
      if (detail.nodeKey !== nodeKey) return;

      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = Math.max(0, Math.min(code.length, Number(detail.offset) || 0));
      const length = Math.max(0, Number(detail.length) || 0);
      const end = Math.max(start, Math.min(code.length, start + length));

      if (searchTargetTimeoutRef.current) {
        window.clearTimeout(searchTargetTimeoutRef.current);
      }
      setSearchTarget(true);
      searchTargetTimeoutRef.current = window.setTimeout(() => {
        setSearchTarget(false);
        searchTargetTimeoutRef.current = null;
      }, 1400);

      requestAnimationFrame(() => {
        try {
          textarea.setSelectionRange(start, end);
        } catch {
          // Search positioning is best-effort only.
        }

        const before = code.slice(0, start);
        const lineIndex = before.split('\n').length - 1;
        const computedLineHeight = Number.parseFloat(
          window.getComputedStyle(textarea).lineHeight
        ) || 20;
        const targetScrollTop = Math.max(
          0,
          lineIndex * computedLineHeight - textarea.clientHeight * 0.35
        );

        textarea.scrollTop = targetScrollTop;
        if (preRef.current) preRef.current.scrollTop = targetScrollTop;

        if (detail.focus) {
          textarea.focus({ preventScroll: true });
        }
      });
    };

    window.addEventListener('editor:code-search-match', handleSearchMatch);
    return () => {
      window.removeEventListener('editor:code-search-match', handleSearchMatch);
      if (searchTargetTimeoutRef.current) {
        window.clearTimeout(searchTargetTimeoutRef.current);
        searchTargetTimeoutRef.current = null;
      }
    };
  }, [code, nodeKey]);

  const isEditable = editor.isEditable();

  const copyCode = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.error('复制代码失败:', error);
    }
  };

  const removeCodeBlock = () => {
    if (!isEditable) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node && $isCodeBlockNode(node)) {
        node.remove();
      }
    });
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
    <div className={'code-block-wrapper' + (searchTarget ? ' search-target' : '')}>
      <div className="code-block-header">
        <div className="code-block-header-left">
          <LanguageSelector value={language} onChange={handleLanguageChange} disabled={!isEditable} />
          <span className="code-block-meta">{lineCount} 行</span>
          {isLargeFile && (
            <span className="code-block-meta emphasis">大代码块</span>
          )}
        </div>

        <div className="code-block-toolbar" role="toolbar" aria-label="代码块工具">
          {showEnableButton && isEditable && (
            <button type="button" onClick={handleEnableHighlight}>启用高亮</button>
          )}
          <button
            type="button"
            className={wrapLines ? 'active' : ''}
            onClick={() => setWrapLines(value => !value)}
          >
            {wrapLines ? '取消换行' : '自动换行'}
          </button>
          <button type="button" onClick={copyCode}>{copied ? '已复制' : '复制'}</button>
          {isEditable && (
            <button type="button" className="danger" onClick={removeCodeBlock}>删除</button>
          )}
        </div>
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
            readOnly={!isEditable}
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
              whiteSpace: wrapLines ? 'pre-wrap' : 'pre',
              wordWrap: wrapLines ? 'break-word' : 'normal',
              overflowWrap: wrapLines ? 'anywhere' : 'normal',
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
              whiteSpace: wrapLines ? 'pre-wrap' : 'pre',
              wordWrap: wrapLines ? 'break-word' : 'normal',
              overflowWrap: wrapLines ? 'anywhere' : 'normal',
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
