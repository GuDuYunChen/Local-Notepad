import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getSelection, $isRangeSelection } from 'lexical'

const STORAGE_KEY = 'localNotepad.editorView.v1'

const FONT_OPTIONS = [
  {
    value: 'system',
    label: '系统默认',
    css: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    value: 'serif',
    label: '衬线阅读',
    css: 'Georgia, "Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif',
  },
  {
    value: 'mono',
    label: '等宽',
    css: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  },
]

const WIDTH_OPTIONS = [
  { value: 720, label: '窄' },
  { value: 860, label: '舒适' },
  { value: 1040, label: '宽' },
  { value: 0, label: '铺满' },
]

export const DEFAULT_EDITOR_VIEW_SETTINGS = {
  fontSize: 16,
  lineHeight: 1.85,
  pageWidth: 860,
  fontFamily: 'system',
  typewriter: false,
}

export function getEditorWheelFontStep(event) {
  if (!event || (!event.ctrlKey && !event.metaKey)) return 0
  if (event.altKey || event.shiftKey) return 0

  const deltaY = Number(event.deltaY)
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0
  return deltaY < 0 ? 1 : -1
}

export function normalizeEditorViewSettings(value) {
  const source = value && typeof value === 'object' ? value : {}
  const fontSize = Math.max(13, Math.min(22, Number(source.fontSize) || DEFAULT_EDITOR_VIEW_SETTINGS.fontSize))
  const lineHeight = Math.max(1.4, Math.min(2.3, Number(source.lineHeight) || DEFAULT_EDITOR_VIEW_SETTINGS.lineHeight))
  const pageWidth = [0, 720, 860, 1040].includes(Number(source.pageWidth))
    ? Number(source.pageWidth)
    : DEFAULT_EDITOR_VIEW_SETTINGS.pageWidth
  const fontFamily = FONT_OPTIONS.some(option => option.value === source.fontFamily)
    ? source.fontFamily
    : DEFAULT_EDITOR_VIEW_SETTINGS.fontFamily

  return {
    fontSize,
    lineHeight: Math.round(lineHeight * 10) / 10,
    pageWidth,
    fontFamily,
    typewriter: Boolean(source.typewriter),
  }
}

function loadSettings() {
  try {
    return normalizeEditorViewSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))
  } catch {
    return { ...DEFAULT_EDITOR_VIEW_SETTINGS }
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // View preferences are optional and should never block editing.
  }
}

function Stepper({ label, value, onChange, min, max, step = 1, suffix = '' }) {
  return (
    <div className="editor-view-setting-row">
      <span>{label}</span>
      <div className="editor-view-stepper">
        <button type="button" onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <strong>{Number.isInteger(value) ? value : value.toFixed(1)}{suffix}</strong>
        <button type="button" onClick={() => onChange(Math.min(max, value + step))}>＋</button>
      </div>
    </div>
  )
}

export default function EditorViewSettingsPlugin({ readOnly = false }) {
  const [editor] = useLexicalComposerContext()
  const [settings, setSettings] = useState(loadSettings)
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)
  const frameRef = useRef(0)

  const fontCss = useMemo(
    () => FONT_OPTIONS.find(option => option.value === settings.fontFamily)?.css || FONT_OPTIONS[0].css,
    [settings.fontFamily]
  )

  useEffect(() => {
    const rootElement = editor.getRootElement()
    const shell = rootElement?.closest('.editor-shell')
    if (!shell) return

    shell.style.setProperty('--editor-view-font-size', `${settings.fontSize}px`)
    shell.style.setProperty('--editor-view-line-height', String(settings.lineHeight))
    shell.style.setProperty('--editor-view-page-width', settings.pageWidth ? `${settings.pageWidth}px` : '100%')
    shell.style.setProperty('--editor-view-font-family', fontCss)
    shell.classList.toggle('editor-typewriter-mode', settings.typewriter && !readOnly)

    saveSettings(settings)

    return () => {
      shell.classList.remove('editor-typewriter-mode')
    }
  }, [editor, fontCss, readOnly, settings])

  useEffect(() => {
    const toggleSettings = () => setOpen(value => !value)
    window.addEventListener('editor:toggle-view-settings', toggleSettings)
    return () => window.removeEventListener('editor:toggle-view-settings', toggleSettings)
  }, [])

  useEffect(() => {
    const rootElement = editor.getRootElement()
    const shell = rootElement?.closest('.editor-shell')
    if (!shell) return undefined

    const onWheel = event => {
      const step = getEditorWheelFontStep(event)
      if (!step) return

      event.preventDefault()
      setSettings(current => normalizeEditorViewSettings({
        ...current,
        fontSize: current.fontSize + step,
      }))
    }

    shell.addEventListener('wheel', onWheel, { passive: false })
    return () => shell.removeEventListener('wheel', onWheel)
  }, [editor])

  useEffect(() => {
    if (!open) return

    const onPointerDown = event => {
      if (event.target?.closest?.('.toolbar-view-btn')) return
      if (panelRef.current && !panelRef.current.contains(event.target)) setOpen(false)
    }

    const onKeyDown = event => {
      if (event.key === 'Escape') {
        setOpen(false)
        editor.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [editor, open])

  useEffect(() => {
    if (!settings.typewriter || readOnly) return undefined

    const rootElement = editor.getRootElement()
    const scroller = rootElement?.closest('.editor-container')
    if (!rootElement || !scroller) return undefined

    const keepCaretInWritingBand = () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = requestAnimationFrame(() => {
        let targetKey = ''

        editor.getEditorState().read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return
          const anchorNode = selection.anchor.getNode()
          const topLevel = anchorNode.getTopLevelElement?.()
          if (topLevel) targetKey = topLevel.getKey()
        })

        if (!targetKey) return
        const element = editor.getElementByKey(targetKey)
        if (!element) return

        const containerRect = scroller.getBoundingClientRect()
        const rect = element.getBoundingClientRect()
        const upper = containerRect.top + containerRect.height * 0.36
        const lower = containerRect.top + containerRect.height * 0.64

        if (rect.top >= upper && rect.bottom <= lower) return

        const elementCenter = rect.top + Math.min(rect.height, 44) / 2
        const desired = containerRect.top + containerRect.height * 0.5
        scroller.scrollTop += elementCenter - desired
      })
    }

    return editor.registerUpdateListener(keepCaretInWritingBand)
  }, [editor, readOnly, settings.typewriter])

  const update = patch => {
    setSettings(current => normalizeEditorViewSettings({ ...current, ...patch }))
  }

  const reset = () => setSettings({ ...DEFAULT_EDITOR_VIEW_SETTINGS })

  return (
    <div className={`editor-view-settings-host${open ? ' open' : ''}`} ref={panelRef}>
      {open && (
        <section className="editor-view-settings" aria-label="写作视图设置">
          <header>
            <div>
              <strong>写作视图</strong>
              <span>只影响显示，不修改正文格式 · Ctrl/Cmd + 滚轮快速调字号</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭">×</button>
          </header>

          <div className="editor-view-settings-body">
            <Stepper
              label="正文字号"
              value={settings.fontSize}
              min={13}
              max={22}
              suffix="px"
              onChange={fontSize => update({ fontSize })}
            />

            <Stepper
              label="行距"
              value={settings.lineHeight}
              min={1.4}
              max={2.3}
              step={0.1}
              onChange={lineHeight => update({ lineHeight })}
            />

            <div className="editor-view-setting-row stacked">
              <span>页面宽度</span>
              <div className="editor-view-segments">
                {WIDTH_OPTIONS.map(option => (
                  <button
                    type="button"
                    key={option.value}
                    className={settings.pageWidth === option.value ? 'active' : ''}
                    onClick={() => update({ pageWidth: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="editor-view-setting-row">
              <span>写作字体</span>
              <select
                value={settings.fontFamily}
                onChange={event => update({ fontFamily: event.target.value })}
              >
                {FONT_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {!readOnly && (
              <label className="editor-view-toggle-row">
                <span>
                  <strong>Typewriter 模式</strong>
                  <small>让当前输入位置保持在视口中部</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.typewriter}
                  onChange={event => update({ typewriter: event.target.checked })}
                />
              </label>
            )}
          </div>

          <footer>
            <button type="button" onClick={reset}>恢复默认</button>
          </footer>
        </section>
      )}
    </div>
  )
}
