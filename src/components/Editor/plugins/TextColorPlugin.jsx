import { useEffect, useState, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection } from 'lexical'
import { $patchStyleText } from '@lexical/selection'
import './TextColorPlugin.css'

const TEXT_COLORS = [
  { label: '默认', value: '' },
  { label: '红色', value: '#ef4444' },
  { label: '橙色', value: '#f97316' },
  { label: '黄色', value: '#eab308' },
  { label: '绿色', value: '#22c55e' },
  { label: '蓝色', value: '#3b82f6' },
  { label: '紫色', value: '#8b5cf6' },
  { label: '粉色', value: '#ec4899' },
]

const HIGHLIGHT_COLORS = [
  { label: '无', value: '' },
  { label: '红色', value: '#fee2e2' },
  { label: '橙色', value: '#ffedd5' },
  { label: '黄色', value: '#fef9c3' },
  { label: '绿色', value: '#dcfce7' },
  { label: '蓝色', value: '#dbeafe' },
  { label: '紫色', value: '#f3e8ff' },
  { label: '粉色', value: '#fce7f3' },
]

export default function TextColorPlugin() {
  const [editor] = useLexicalComposerContext()
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showHighlightPicker, setShowHighlightPicker] = useState(false)
  const pickerRef = useRef(null)

  const applyTextColor = useCallback(
    (color) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        $patchStyleText(selection, { color })
      })
      setShowColorPicker(false)
      editor.focus()
    },
    [editor]
  )

  const applyHighlight = useCallback(
    (color) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        $patchStyleText(selection, { 'background-color': color })
      })
      setShowHighlightPicker(false)
      editor.focus()
    },
    [editor]
  )

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowColorPicker(false)
        setShowHighlightPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="text-color-toolbar" ref={pickerRef}>
      <div className="text-color-group">
        <button
          className="text-color-btn"
          onClick={() => {
            setShowColorPicker(!showColorPicker)
            setShowHighlightPicker(false)
          }}
          title="文本颜色"
          aria-label="文本颜色"
        >
          <span className="text-color-icon">A</span>
        </button>
        {showColorPicker && (
          <div className="color-picker-dropdown" role="listbox" aria-label="文本颜色选择">
            {TEXT_COLORS.map((color) => (
              <button
                key={color.value || 'default'}
                className="color-option"
                onClick={() => applyTextColor(color.value)}
                title={color.label}
                aria-label={color.label}
              >
                <span
                  className="color-swatch"
                  style={{ backgroundColor: color.value || 'transparent', border: !color.value ? '1px dashed var(--muted)' : 'none' }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="text-color-group">
        <button
          className="text-color-btn"
          onClick={() => {
            setShowHighlightPicker(!showHighlightPicker)
            setShowColorPicker(false)
          }}
          title="文本高亮"
          aria-label="文本高亮"
        >
          <span className="highlight-icon">🖍</span>
        </button>
        {showHighlightPicker && (
          <div className="color-picker-dropdown" role="listbox" aria-label="高亮颜色选择">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value || 'default'}
                className="color-option"
                onClick={() => applyHighlight(color.value)}
                title={color.label}
                aria-label={color.label}
              >
                <span
                  className="color-swatch"
                  style={{ backgroundColor: color.value || 'transparent', border: !color.value ? '1px dashed var(--muted)' : 'none' }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
