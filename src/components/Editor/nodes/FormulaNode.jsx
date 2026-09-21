import { $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import katex from 'katex'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import 'katex/dist/katex.min.css'

const FORMULA_HISTORY_KEY = 'localNotepad.formulaHistory.v1'
const COMMON_FORMULAS = [
  { label: '分数', expression: '\\frac{a}{b}' },
  { label: '平方和', expression: 'a^2 + b^2 = c^2' },
  { label: '求和', expression: '\\sum_{i=1}^{n} i' },
  { label: '积分', expression: '\\int_a^b f(x)\\,dx' },
  { label: '根号', expression: '\\sqrt{x}' },
  { label: '矩阵', expression: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}' },
]

export function rememberFormulaExpression(history, expression, limit = 6) {
  const value = String(expression || '').trim()
  if (!value) return Array.isArray(history) ? history.slice(0, limit) : []

  const current = Array.isArray(history) ? history : []
  return [value, ...current.filter(item => item !== value)].slice(0, limit)
}

function loadFormulaHistory() {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FORMULA_HISTORY_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 6) : []
  } catch {
    return []
  }
}

function saveFormulaHistory(items) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FORMULA_HISTORY_KEY, JSON.stringify(items))
  } catch {
    // History is a convenience only; formula editing should still work.
  }
}

export class FormulaNode extends DecoratorNode {
  __expression
  __displayMode

  static getType() {
    return 'formula'
  }

  static clone(node) {
    return new FormulaNode(node.__expression, node.__displayMode, node.__key)
  }

  static importJSON(serializedNode) {
    return new FormulaNode(
      serializedNode.expression || '',
      Boolean(serializedNode.displayMode)
    )
  }

  exportJSON() {
    return {
      type: 'formula',
      version: 1,
      expression: this.__expression,
      displayMode: this.__displayMode,
    }
  }

  constructor(expression = '', displayMode = true, key) {
    super(key)
    this.__expression = expression
    this.__displayMode = displayMode
  }

  setExpression(expression) {
    const writable = this.getWritable()
    writable.__expression = expression
  }

  setDisplayMode(displayMode) {
    const writable = this.getWritable()
    writable.__displayMode = Boolean(displayMode)
  }

  createDOM() {
    return document.createElement(this.__displayMode ? 'div' : 'span')
  }

  updateDOM(previousNode) {
    return previousNode.__displayMode !== this.__displayMode
  }

  isInline() {
    return !this.__displayMode
  }

  decorate() {
    return (
      <FormulaComponent
        nodeKey={this.__key}
        expression={this.__expression}
        displayMode={this.__displayMode}
      />
    )
  }
}

function FormulaComponent({ nodeKey, expression, displayMode }) {
  const [editor] = useLexicalComposerContext()
  const [editing, setEditing] = useState(!expression)
  const [draft, setDraft] = useState(expression || '')
  const [blockMode, setBlockMode] = useState(Boolean(displayMode))
  const [recentFormulas, setRecentFormulas] = useState(() => loadFormulaHistory())
  const editorRef = useRef(null)

  useEffect(() => setDraft(expression || ''), [expression])
  useEffect(() => setBlockMode(Boolean(displayMode)), [displayMode])

  const html = useMemo(() => {
    if (!draft.trim()) return ''
    try {
      return katex.renderToString(draft, {
        throwOnError: false,
        displayMode: blockMode,
        strict: 'ignore',
        trust: false,
      })
    } catch {
      return ''
    }
  }, [draft, blockMode])

  const persist = patch => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isFormulaNode(node)) return
      if (patch.expression !== undefined) node.setExpression(patch.expression)
      if (patch.displayMode !== undefined) node.setDisplayMode(patch.displayMode)
    })
  }

  const save = () => {
    const next = draft.trim()
    persist({ expression: next, displayMode: blockMode })

    if (next) {
      const history = rememberFormulaExpression(recentFormulas, next)
      setRecentFormulas(history)
      saveFormulaHistory(history)
    }

    setEditing(false)
    editor.focus()
  }

  const remove = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isFormulaNode(node)) node.remove()
    })
  }

  if (editing) {
    return (
      <span className={`formula-editor${blockMode ? ' block' : ' inline'}`} ref={editorRef}>
        <span className="formula-editor-preview">
          {html ? (
            <span dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span className="formula-editor-placeholder">输入 LaTeX 公式</span>
          )}
        </span>

        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="例如：E = mc^2"
          rows={blockMode ? 3 : 1}
          autoFocus
          onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              save()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(expression || '')
              setEditing(false)
            }
          }}
        />

        <div className="formula-library">
          <div className="formula-library-section">
            <span className="formula-library-label">常用</span>
            <div className="formula-library-items">
              {COMMON_FORMULAS.map(item => (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => setDraft(item.expression)}
                  title={item.expression}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {recentFormulas.length > 0 && (
            <div className="formula-library-section">
              <span className="formula-library-label">最近</span>
              <div className="formula-library-items recent">
                {recentFormulas.map(item => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => setDraft(item)}
                    title={item}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <span className="formula-editor-actions">
          <button
            type="button"
            className={blockMode ? 'active' : ''}
            onClick={() => setBlockMode(true)}
          >
            独立公式
          </button>
          <button
            type="button"
            className={!blockMode ? 'active' : ''}
            onClick={() => setBlockMode(false)}
          >
            行内公式
          </button>
          <button type="button" onClick={save}>完成</button>
          <button type="button" className="danger" onClick={remove}>删除</button>
        </span>
      </span>
    )
  }

  return (
    <span
      className={`formula-rendered${blockMode ? ' block' : ' inline'}`}
      onDoubleClick={() => setEditing(true)}
      title="双击编辑公式"
    >
      {html ? (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="formula-editor-placeholder" onClick={() => setEditing(true)}>
          添加公式
        </span>
      )}
    </span>
  )
}

export function $createFormulaNode({ expression = '', displayMode = true } = {}) {
  return new FormulaNode(expression, displayMode)
}

export function $isFormulaNode(node) {
  return node instanceof FormulaNode
}
