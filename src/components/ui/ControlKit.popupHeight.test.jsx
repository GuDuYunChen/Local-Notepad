import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ConfigProvider from 'antd/es/config-provider'
import { UiSelect } from './ControlKit'
import { openUiSelect, setUiValue } from '~/test/uiControlDriver'

// The real Select renders and handles every interaction. Only browser layout
// measurements are controlled here; Windows popup bounds remain native gates.
const options = Array.from({ length: 6 }, (_, index) => ({ value: String(index), label: `Choice ${index + 1}` }))
let host, root, viewportHeight, triggerRect, boxes, extraNodes
const rectangle = (top, height, left = 102, width = 266) => new DOMRect(left, top, width, height)
const field = () => host.querySelector('[role="combobox"]')
const popup = () => {
  let element = document.getElementById(field().getAttribute('aria-controls'))
  while (element && ![...element.classList].some(value => value.endsWith('-select-dropdown'))) element = element.parentElement
  return element
}
const holder = () => popup().querySelector('[class$="-select-dropdown-list-holder"]')
const render = async props => act(async () => root.render(<UiSelect aria-label="choice" options={options} {...props}/>))
const event = async (target, type) => act(async () => target.dispatchEvent(new Event(type)))

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  viewportHeight = 455; triggerRect = rectangle(241, 40); boxes = new Map(); extraNodes = []
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockImplementation(() => viewportHeight)
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(704)
  const originalRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.classList.contains('app-ui-select') ? triggerRect : boxes.get(this)?.rect ?? originalRect.call(this)
  })
  for (const property of ['offsetHeight', 'clientHeight', 'clientTop']) {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property).get
    vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(function () {
      return boxes.get(this)?.[property] ?? original.call(this)
    })
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host.remove(); extraNodes.forEach(node => node.remove())
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
})

it('caps the original 704 by 455 six-option menu while keeping every real option and the popup frame', async () => {
  await render({ defaultValue: '0' }); await openUiSelect(field())
  // Above: 241px. Keep the normal 4px gap and two 4px padding edges.
  expect(holder().style.maxHeight).toBe('229px')
  expect(holder().style.overflowY).toBe('auto')
  expect([...popup().querySelectorAll('[data-ui-option-value]')].map(node => node.textContent)).toEqual(options.map(option => option.label))
  expect(popup().style.padding).toBe('')
  expect(popup().querySelector('[data-ui-option-value]').getAttribute('style')).toBeNull()
  expect(field().getAttribute('aria-expanded')).toBe('true')
})

it('retains a caller list-height ceiling smaller than the available space', async () => {
  await render({ listHeight: 96 }); await openUiSelect(field())
  expect(holder().style.maxHeight).toBe('96px')
  expect(holder().style.overflowY).toBe('auto')
  expect(popup().querySelectorAll('[data-ui-option-value]')).toHaveLength(6)
})

it('recomputes on resize and nested scroll without replacing the field, changing its value or replaying callbacks', async () => {
  const ref = React.createRef(), changed = vi.fn(), opened = vi.fn(), legacyOpened = vi.fn()
  await render({ ref, name: 'mode', defaultValue: '2', onChange: changed, onOpenChange: opened, onDropdownVisibleChange: legacyOpened })
  const originalField = field()
  await openUiSelect(originalField); await act(async () => ref.current.focus())
  expect(holder().style.maxHeight).toBe('229px')
  viewportHeight = 350; triggerRect = rectangle(150, 40); await event(window, 'resize')
  expect(holder().style.maxHeight).toBe('148px')
  triggerRect = rectangle(20, 40); await event(host, 'scroll')
  expect(holder().style.maxHeight).toBe('256px')
  expect(field()).toBe(originalField); expect(document.activeElement).toBe(originalField)
  expect(ref.current.value).toBe('2'); expect(host.querySelector('[name="mode"]').value).toBe('2')
  expect(changed).not.toHaveBeenCalled(); expect(opened.mock.calls).toEqual([[true]])
  expect(legacyOpened.mock.calls).toEqual([[true]])
  await setUiValue(originalField, '5')
  expect(changed).toHaveBeenCalledOnce(); expect(changed.mock.calls[0][0].target.value).toBe('5')
  expect(opened.mock.calls).toEqual([[true], [false]])
  expect(legacyOpened.mock.calls).toEqual([[true], [false]])
})

it('uses the inherited theme and a prefixed popup, then measures caller padding and borders when they change', async () => {
  const view = styles => <ConfigProvider prefixCls="scoped" theme={{ token: { paddingXXS: 10 } }}>
    <UiSelect aria-label="choice" options={options} styles={styles}/>
  </ConfigProvider>
  await act(async () => root.render(view(undefined)))
  // The existing helper intentionally targets Ant's usual class names; the
  // prefixed real selector is activated by its actual content surface here.
  await act(async () => {
    host.querySelector('.scoped-select-content').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true }))
    await vi.advanceTimersByTimeAsync(50)
  })
  expect(popup().classList.contains('scoped-select-dropdown')).toBe(true)
  expect(holder().style.maxHeight).toBe('217px')
  const styles = { popup: { root: { paddingTop: 12, paddingBottom: 18, borderTop: '2px solid transparent', borderBottom: '3px solid transparent' } } }
  await act(async () => root.render(view(styles)))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(popup().style.paddingTop).toBe('12px'); expect(popup().style.paddingBottom).toBe('18px')
  expect(holder().style.maxHeight).toBe('202px')
})

it('fits the actual custom portal clipping area and keeps the caller container and native option interaction', async () => {
  const container = document.createElement('div'); container.style.overflow = 'auto'; document.body.append(container); extraNodes.push(container)
  boxes.set(container, { rect: rectangle(80, 280, 0, 704), offsetHeight: 280, clientHeight: 280, clientTop: 0 })
  triggerRect = rectangle(220, 40)
  const getPopupContainer = vi.fn(() => container), changed = vi.fn()
  await render({ getPopupContainer, onChange: changed }); await openUiSelect(field())
  expect(container.contains(popup())).toBe(true)
  expect(getPopupContainer).toHaveBeenCalled()
  expect(getPopupContainer.mock.calls.every(([node]) => node === field().closest('.app-ui-select'))).toBe(true)
  expect(holder().style.maxHeight).toBe('128px')
  await setUiValue(field(), '4')
  expect(changed).toHaveBeenCalledOnce(); expect(changed.mock.calls[0][0].target.value).toBe('4')
})

it('keeps the existing dialog portal and excludes the dialog border from its available height', async () => {
  await act(async () => root.render(<div role="dialog" style={{ overflow: 'hidden' }}><UiSelect aria-label="choice" options={options}/></div>))
  const dialog = host.querySelector('[role="dialog"]')
  boxes.set(dialog, { rect: rectangle(80, 280, 0, 704), offsetHeight: 280, clientHeight: 276, clientTop: 2 })
  triggerRect = rectangle(220, 40)
  await openUiSelect(field())
  expect(dialog.contains(popup())).toBe(true)
  expect(holder().style.maxHeight).toBe('126px')
})

it('does not treat horizontal-only clipping as a vertical boundary, but responds when vertical clipping is enabled', async () => {
  const container = document.createElement('div')
  container.style.overflowX = 'clip'; container.style.overflowY = 'visible'
  document.body.append(container); extraNodes.push(container)
  boxes.set(container, { rect: rectangle(80, 280, 0, 704), offsetHeight: 280, clientHeight: 280, clientTop: 0 })
  await render({ getPopupContainer: () => container }); await openUiSelect(field())
  expect(window.getComputedStyle(container).overflowY).toBe('visible')
  expect(holder().style.maxHeight).toBe('229px')
  await act(async () => {
    container.style.overflowY = 'hidden'
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(window.getComputedStyle(container).overflowY).toBe('hidden')
  expect(holder().style.maxHeight).toBe('149px')
})

it('cleans up its open-only observers and resize/scroll handlers when controlled open closes, disables or unmounts', async () => {
  const addResize = vi.spyOn(window, 'addEventListener'), removeResize = vi.spyOn(window, 'removeEventListener')
  const addScroll = vi.spyOn(document, 'addEventListener'), removeScroll = vi.spyOn(document, 'removeEventListener')
  const observe = vi.spyOn(window.MutationObserver.prototype, 'observe'), disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect')
  const opened = vi.fn(), ref = React.createRef()
  const props = { ref, open: true, defaultValue: '3', onOpenChange: opened }
  await render(props); await openUiSelect(field())
  const ownedObservers = () => observe.mock.calls.flatMap(([target, options], index) => target === document.body && options.attributeFilter?.join(',') === 'class,style' ? [observe.mock.instances[index]] : [])
  const ownedScroll = () => addScroll.mock.calls.filter(([type, , capture]) => type === 'scroll' && capture === true).map(([, listener]) => listener)
  const firstListeners = ownedScroll(), firstObservers = ownedObservers()
  expect(firstListeners.length).toBeGreaterThan(0); expect(firstObservers.length).toBeGreaterThan(0)
  await render({ ...props, open: false })
  for (const listener of firstListeners) {
    expect(addResize.mock.calls.some(([type, callback]) => type === 'resize' && callback === listener)).toBe(true)
    expect(removeResize.mock.calls.some(([type, callback]) => type === 'resize' && callback === listener)).toBe(true)
    expect(removeScroll.mock.calls.some(([type, callback, capture]) => type === 'scroll' && callback === listener && capture === true)).toBe(true)
  }
  expect(firstObservers.every(observer => disconnect.mock.instances.includes(observer))).toBe(true)
  await render(props); await openUiSelect(field()); await render({ ...props, disabled: true })
  expect(field().getAttribute('aria-expanded')).toBe('false'); expect(ref.current.value).toBe('3')
  await render(props); await openUiSelect(field())
  const allListeners = ownedScroll(), allObservers = ownedObservers()
  await act(async () => root.unmount()); root = null
  expect(allListeners.every(listener => removeResize.mock.calls.some(([type, callback]) => type === 'resize' && callback === listener))).toBe(true)
  expect(allListeners.every(listener => removeScroll.mock.calls.some(([type, callback, capture]) => type === 'scroll' && callback === listener && capture === true))).toBe(true)
  expect(allObservers.every(observer => disconnect.mock.instances.includes(observer))).toBe(true)
  expect(opened).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
