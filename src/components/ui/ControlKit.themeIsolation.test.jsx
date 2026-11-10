import React, { act } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ConfigProvider from 'antd/es/config-provider'
import theme from 'antd/es/theme'
import { createCache, StyleProvider } from '@ant-design/cssinjs'
import { UiButton, UiInput, UiSelect } from './ControlKit'
import UiThemeProvider from './UiThemeProvider'
import { setUiValue, uiValue } from '~/test/uiControlDriver'

const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]
let host, root, extraNodes, previousTheme
const render = children => act(async () => root.render(children))
const named = (name, owner = host) => owner.querySelector(`[aria-label="${name}"]`)
function scopeOf(element) {
  for (let node = element; node; node = node.parentElement) {
    const scope = [...node.classList].find(value => value.startsWith('css-var-'))
    if (scope) return scope
  }
  throw new Error('Rendered control has no actual CSS variable scope')
}
const stylesFor = (scope, owner = document) => [...owner.querySelectorAll('style[data-token-hash]')]
  .filter(style => style.getAttribute('data-token-hash') === scope)
const styleText = (scope, owner = document) => stylesFor(scope, owner).map(style => style.textContent).join('\n')
function variable(scope, name, owner = document) {
  const values = [...styleText(scope, owner).matchAll(new RegExp('(?:^|[;{])' + name + ':([^;}]+)', 'g'))]
    .map(match => match[1].trim())
  expect(values, `${name} must have one emitted declaration in ${scope}`).toHaveLength(1)
  return values[0]
}
const click = element => act(async () => element.click())

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  previousTheme = document.documentElement.getAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  extraNodes = []
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); extraNodes.forEach(node => node.remove())
  if (previousTheme === null) document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', previousTheme)
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
})

it('shares identical default variables across real mixed controls and retains surviving owners through unmount and remount', async () => {
  const pressed = vi.fn(), changed = vi.fn()
  const view = first => <>
    {first && <UiButton key="first" type="button" size="small" variant="dashed" aria-label="first" onClick={pressed}>First</UiButton>}
    <UiButton key="remaining" type="button" size="large" variant="primary" aria-label="remaining">Remaining</UiButton>
    <ConfigProvider key="rtl" direction="rtl" componentSize="large">
      <UiButton type="button" size="small" aria-label="rtl">RTL</UiButton>
      <UiSelect size="small" aria-label="choice" defaultValue="a" options={options} onChange={changed}/>
    </ConfigProvider>
  </>
  await render(view(true))
  const field = named('choice'), scope = scopeOf(named('remaining'))
  expect(new Set(['first', 'remaining', 'rtl', 'choice'].map(name => scopeOf(named(name))))).toEqual(new Set([scope]))
  expect(named('first').classList.contains('ant-btn-sm')).toBe(true)
  expect(named('remaining').classList.contains('ant-btn-lg')).toBe(true)
  expect(named('rtl').classList.contains('ant-btn-rtl')).toBe(true)
  expect(field.closest('.ant-select').classList.contains('ant-select-rtl')).toBe(true)
  expect(field.closest('.ant-select').classList.contains('ant-select-sm')).toBe(true)
  expect(variable(scope, '--ant-color-primary')).toBe(theme.defaultSeed.colorPrimary)
  expect(variable(scope, '--ant-button-default-shadow')).toBe('none')
  expect(variable(scope, '--ant-select-option-height')).toBe('32px')
  await click(named('first')); await setUiValue(field, 'b')
  expect(pressed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce()
  const before = styleText(scope)
  await render(view(false))
  expect(named('first')).toBeNull(); expect(named('choice')).toBe(field)
  expect(uiValue(field)).toBe('b'); expect(scopeOf(field)).toBe(scope)
  expect(styleText(scope)).toBe(before)
  await render(null)
  expect(host.childElementCount).toBe(0)
  // Upstream may retain unrelated cached CSS. The new owner must get usable
  // variable sheets regardless of whether those unrelated styles remain.
  await render(view(false))
  expect(scopeOf(named('remaining'))).toBe(scope)
  expect(variable(scope, '--ant-color-primary')).toBe(theme.defaultSeed.colorPrimary)
  expect(variable(scope, '--ant-select-option-height')).toBe('32px')
})

it('isolates a custom prefix and nonce while a live Select changes between shared and nonce-owned variables', async () => {
  const pressed = vi.fn(), changed = vi.fn(), nonce = 'synthetic-ui-isolation-nonce'
  const view = secured => <>
    <UiButton key="default" type="button" aria-label="default">Default</UiButton>
    <ConfigProvider key="prefix" prefixCls="isolated">
      <UiButton type="button" aria-label="prefixed" onClick={pressed}>Prefixed</UiButton>
      <UiSelect aria-label="prefixed-choice" options={options}/>
    </ConfigProvider>
    <ConfigProvider key="nonce" csp={secured ? { nonce } : undefined}>
      <UiSelect aria-label="nonce-choice" defaultValue="a" options={options} onChange={changed}/>
    </ConfigProvider>
  </>
  await render(view(false))
  const defaultScope = scopeOf(named('default')), field = named('nonce-choice')
  const prefixScope = scopeOf(named('prefixed')), prefixSelectScope = scopeOf(named('prefixed-choice'))
  expect(scopeOf(field)).toBe(defaultScope)
  expect(new Set([defaultScope, prefixScope, prefixSelectScope]).size).toBe(3)
  expect(named('prefixed').classList.contains('isolated-btn')).toBe(true)
  expect(variable(prefixScope, '--isolated-color-primary')).toBe(theme.defaultSeed.colorPrimary)
  expect(variable(prefixSelectScope, '--isolated-select-option-height')).toBe('32px')
  await click(named('prefixed')); await setUiValue(field, 'b')
  expect(pressed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce()
  const defaultPrimary = variable(defaultScope, '--ant-color-primary'), prefixCSS = styleText(prefixScope)
  await render(view(true))
  const nonceScope = scopeOf(named('nonce-choice'))
  expect(named('nonce-choice')).toBe(field); expect(uiValue(field)).toBe('b')
  expect(nonceScope).not.toBe(defaultScope)
  expect(variable(nonceScope, '--ant-color-primary')).toBe(theme.defaultSeed.colorPrimary)
  expect(stylesFor(nonceScope).length).toBeGreaterThan(0)
  expect(stylesFor(nonceScope).every(style => style.nonce === nonce)).toBe(true)
  expect(variable(defaultScope, '--ant-color-primary')).toBe(defaultPrimary)
  expect(variable(defaultScope, '--ant-button-default-shadow')).toBe('none')
  expect(styleText(prefixScope)).toBe(prefixCSS)
  await render(view(false))
  expect(named('nonce-choice')).toBe(field); expect(uiValue(field)).toBe('b')
  expect(scopeOf(field)).toBe(defaultScope)
  expect(variable(defaultScope, '--ant-color-primary')).toBe(theme.defaultSeed.colorPrimary)
  expect(changed).toHaveBeenCalledOnce()
})

it('keeps explicit themes and component overrides independent when a live theme changes tokens and algorithm', async () => {
  const changed = vi.fn(), pressed = vi.fn()
  const first = { token: { colorPrimary: '#8734be' }, components: { Button: { contentFontSize: 17 }, Select: { optionSelectedBg: '#f0e1fa' } } }
  const next = { algorithm: theme.darkAlgorithm, token: { colorPrimary: '#b852d7' }, components: { Button: { contentFontSize: 19 }, Select: { optionSelectedBg: '#34203e' } } }
  const second = { algorithm: theme.darkAlgorithm, token: { colorPrimary: '#32996a' }, components: { Button: { contentFontSize: 21 }, Select: { optionSelectedBg: '#16382a' } } }
  const view = selectedTheme => <>
    <UiButton key="default" type="button" aria-label="default">Default</UiButton>
    <ConfigProvider key="first" theme={selectedTheme}>
      <UiButton type="button" aria-label="first" onClick={pressed}>First</UiButton>
      <UiSelect aria-label="first-choice" defaultValue="a" options={options} onChange={changed}/>
    </ConfigProvider>
    <ConfigProvider key="second" theme={second}>
      <UiButton type="button" aria-label="second">Second</UiButton>
      <UiSelect aria-label="second-choice" options={options}/>
    </ConfigProvider>
  </>
  await render(view(first))
  const scope = Object.fromEntries(['default', 'first', 'first-choice', 'second', 'second-choice'].map(name => [name, scopeOf(named(name))]))
  expect(new Set(Object.values(scope)).size).toBe(5)
  expect(variable(scope.first, '--ant-color-primary')).toBe(theme.getDesignToken(first).colorPrimary)
  expect(variable(scope.first, '--ant-button-content-font-size')).toBe('17px')
  expect(variable(scope['first-choice'], '--ant-select-option-selected-bg')).toBe('#f0e1fa')
  expect(variable(scope.second, '--ant-color-bg-container')).toBe(theme.getDesignToken(second).colorBgContainer)
  expect(variable(scope.second, '--ant-button-content-font-size')).toBe('21px')
  expect(variable(scope['second-choice'], '--ant-select-option-selected-bg')).toBe('#16382a')
  const field = named('first-choice'), defaultCSS = styleText(scope.default), secondCSS = styleText(scope.second)
  await setUiValue(field, 'b'); await render(view(next))
  expect(named('first-choice')).toBe(field); expect(uiValue(field)).toBe('b')
  expect(scopeOf(named('first'))).toBe(scope.first)
  expect(variable(scope.first, '--ant-color-primary')).toBe(theme.getDesignToken(next).colorPrimary)
  expect(variable(scope.first, '--ant-color-bg-container')).toBe(theme.getDesignToken(next).colorBgContainer)
  expect(variable(scope.first, '--ant-button-content-font-size')).toBe('19px')
  expect(variable(scope['first-choice'], '--ant-select-option-selected-bg')).toBe('#34203e')
  expect(styleText(scope.default)).toBe(defaultCSS); expect(styleText(scope.second)).toBe(secondCSS)
  await click(named('first'))
  expect(pressed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce()
})

it('emits independent variables into real custom style containers and preserves the other cache after one owner leaves', async () => {
  const firstContainer = document.createElement('div'), secondContainer = document.createElement('div')
  document.body.append(firstContainer, secondContainer); extraNodes.push(firstContainer, secondContainer)
  const firstCache = createCache(), secondCache = createCache(), pressed = vi.fn(), changed = vi.fn()
  const view = first => <>
    <UiButton key="default" type="button" aria-label="default">Default</UiButton>
    {first && <StyleProvider key="first" cache={firstCache} container={firstContainer}>
      {createPortal(<UiButton type="button" aria-label="separate-button" onClick={pressed}>Separate</UiButton>, firstContainer)}
    </StyleProvider>}
    <StyleProvider key="second" cache={secondCache} container={secondContainer}>
      {createPortal(<UiSelect aria-label="separate-choice" defaultValue="a" options={options} onChange={changed}/>, secondContainer)}
    </StyleProvider>
  </>
  await render(view(true))
  const button = named('separate-button', firstContainer), field = named('separate-choice', secondContainer)
  const firstScope = scopeOf(button), secondScope = scopeOf(field), defaultScope = scopeOf(named('default'))
  expect(new Set([firstScope, secondScope, defaultScope]).size).toBe(3)
  expect(variable(firstScope, '--ant-color-primary', firstContainer)).toBe(theme.defaultSeed.colorPrimary)
  expect(variable(secondScope, '--ant-color-primary', secondContainer)).toBe(theme.defaultSeed.colorPrimary)
  expect(variable(secondScope, '--ant-select-option-height', secondContainer)).toBe('32px')
  expect(stylesFor(firstScope, secondContainer)).toHaveLength(0)
  expect(stylesFor(secondScope, firstContainer)).toHaveLength(0)
  await click(button); await setUiValue(field, 'b')
  const remainingCSS = styleText(secondScope, secondContainer)
  await render(view(false))
  expect(named('separate-button', firstContainer)).toBeNull()
  expect(named('separate-choice', secondContainer)).toBe(field); expect(uiValue(field)).toBe('b')
  expect(styleText(secondScope, secondContainer)).toBe(remainingCSS)
  expect(variable(defaultScope, '--ant-color-primary')).toBe(theme.defaultSeed.colorPrimary)
  expect(pressed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce()
})

it('retains the canonical application theme as one separate real control scope', async () => {
  const changed = vi.fn(), pressed = vi.fn()
  await render(<>
    <UiButton type="button" aria-label="standalone">Standalone</UiButton>
    <UiThemeProvider>
      <UiButton type="button" aria-label="themed-button" onClick={pressed}>Themed</UiButton>
      <UiInput aria-label="themed-input" defaultValue="unchanged"/>
      <UiSelect aria-label="themed-choice" defaultValue="a" options={options} onChange={changed}/>
    </UiThemeProvider>
  </>)
  const scope = scopeOf(named('themed-button')), standaloneScope = scopeOf(named('standalone'))
  expect(new Set(['themed-button', 'themed-input', 'themed-choice'].map(name => scopeOf(named(name))))).toEqual(new Set([scope]))
  expect(scope).not.toBe(standaloneScope)
  expect(variable(scope, '--ant-control-height')).toBe('40px')
  expect(variable(standaloneScope, '--ant-control-height')).toBe('32px')
  expect(variable(scope, '--ant-button-default-shadow')).toBe('none')
  expect(variable(scope, '--ant-select-option-height')).toBe('32px')
  await click(named('themed-button')); await setUiValue(named('themed-choice'), 'b')
  expect(pressed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce()
  expect(uiValue(named('themed-choice'))).toBe('b'); expect(named('themed-input').value).toBe('unchanged')
})
