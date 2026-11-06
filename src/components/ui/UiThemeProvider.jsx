import React, { useLayoutEffect, useMemo, useState } from 'react'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'

function readTheme() {
  if (typeof document === 'undefined') return { dark: false }
  const root = document.documentElement, css = getComputedStyle(root)
  const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback
  const dark = root.dataset.theme === 'dark'
  return { dark, primary: token('--clay', dark ? '#75baff' : '#6e59d9'), text: token('--ink', dark ? '#eaf2ff' : '#261f42'),
    muted: token('--ink-soft', dark ? '#b8c7dc' : '#675e8c'), background: token('--surface', dark ? '#1b2330' : '#ffffff'),
    paper: token('--paper', dark ? '#0f131a' : '#f7f4ff'), border: token('--control-border', token('--line-strong', dark ? '#70849f' : '#c7bfdc')),
    danger: token('--danger', dark ? '#ff9c9c' : '#c85a5a'), font: getComputedStyle(document.body).fontFamily }
}
export default function UiThemeProvider({ children }) {
  const [appearance, setAppearance] = useState(readTheme)
  useLayoutEffect(() => {
    let frame = 0
    const read = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { const next = readTheme(); setAppearance(old => JSON.stringify(old) === JSON.stringify(next) ? old : next) }) }
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    read()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [])
  const configuration = useMemo(() => ({ algorithm: appearance.dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: { colorPrimary: appearance.primary, colorText: appearance.text, colorTextSecondary: appearance.muted, colorTextPlaceholder: appearance.muted, colorBgContainer: appearance.background,
      colorBgElevated: appearance.background, colorBgLayout: appearance.paper, colorBorder: appearance.border, colorError: appearance.danger,
      fontFamily: appearance.font, fontSize: 14, controlHeight: 40, controlHeightSM: 28, controlHeightLG: 44, borderRadius: 8, motion: false },
    components: {
      Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
      Input: { paddingBlock: 8, paddingInline: 10, paddingBlockSM: 5, paddingInlineSM: 10 },
      Select: { optionHeight: 32, zIndexPopup: 1600 }
    } }), [appearance])
  return <ConfigProvider locale={zhCN} componentSize="middle" theme={configuration} button={{ autoInsertSpace: false }} wave={{ disabled: true }}>{children}</ConfigProvider>
}
