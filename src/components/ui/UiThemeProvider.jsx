import React, { useLayoutEffect, useMemo, useState } from 'react'
import ConfigProvider from 'antd/es/config-provider'
import theme from 'antd/es/theme'
import zhCN from 'antd/locale/zh_CN'
import UiControlDefaultsContext from './UiControlDefaultsContext'

function readTheme() {
  if (typeof document === 'undefined') return { dark: false }
  const root = document.documentElement, css = getComputedStyle(root)
  const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback
  const dark = root.dataset.theme === 'dark'
  return { dark, primary: token('--clay', dark ? '#75baff' : '#6e59d9'), primaryHover: token('--clay-hover', dark ? '#9dceff' : '#624ac8'),
    onAccent: token('--on-accent', dark ? '#081523' : '#ffffff'), text: token('--ink', dark ? '#eaf2ff' : '#261f42'),
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
    token: { colorPrimary: appearance.primary, colorPrimaryHover: appearance.primaryHover, colorTextLightSolid: appearance.onAccent, colorText: appearance.text, colorTextSecondary: appearance.muted, colorTextPlaceholder: appearance.muted, colorBgContainer: appearance.background,
      colorBgElevated: appearance.background, colorBgLayout: appearance.paper, colorBgContainerDisabled: appearance.paper, colorFillAlter: appearance.paper, colorTextDisabled: appearance.muted, colorBorder: appearance.border, colorBorderSecondary: appearance.border, colorError: appearance.danger,
      fontFamily: appearance.font, fontSize: 14, controlHeight: 40, controlHeightSM: 28, controlHeightLG: 44, borderRadius: 8, motion: false },
    components: {
      Button: { primaryColor: appearance.onAccent, primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
      // Input derives vertical padding from the shared height and font tokens.
      // Affix fields (including passwords) apply it once, on their wrapper.
      Input: { paddingInline: 10, paddingInlineSM: 10, activeShadow: 'none', errorActiveShadow: 'none', warningActiveShadow: 'none' },
      Select: { optionHeight: 32, zIndexPopup: 1600, controlOutlineWidth: 0 }
    } }), [appearance])
  return <ConfigProvider locale={zhCN} componentSize="middle" theme={configuration} button={{ autoInsertSpace: false }} wave={{ disabled: true }}>
    <UiControlDefaultsContext.Provider value={true}>{children}</UiControlDefaultsContext.Provider>
  </ConfigProvider>
}
