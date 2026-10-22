import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Identifiers from './SyncHistoryFileIdentifiers'
let host, root, oldAct, context, row
const pause = () => new Promise(resolve => setTimeout(resolve, 5))
const code = field => host.querySelector(`[data-history-file-selectable-id="${field}"]`)
const button = field => host.querySelector(`[data-history-file-select-id="${field}"]`)
const notice = () => host.querySelector('[data-history-file-selection-notice]')
async function render(nextContext = context, nextRow = row) {
  await act(async () => root.render(<Identifiers row={nextRow} context={nextContext} hintID="file-id-test-hint"/>))
}
async function toggle(open) {
  await act(async () => { host.querySelector('details').open = open; await pause() })
}
async function select(field) { button(field).focus(); await act(async () => button(field).click()) }
beforeEach(async () => {
  oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  context={};row={id:'记录-🌱-1',itemID:'对象-<literal>&ＡＢＣ'}
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
  await render();await toggle(true)
})
afterEach(async () => {
  await act(async () => root.unmount());host.remove();vi.restoreAllMocks()
  window.getSelection()?.removeAllRanges();globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct
})
it('renders exactly the existing two inert code values and two explicit selection buttons',()=>{
  expect([...host.querySelectorAll('code')].map(n=>n.textContent)).toEqual([row.itemID,row.id])
  expect(host.querySelectorAll('button')).toHaveLength(2);expect(host.querySelector('literal')).toBeNull();expect(notice()).toBeNull()
})
it('object selection contains the entire Unicode identifier and no label or other field',async()=>{
  await select('object');expect(window.getSelection().toString()).toBe(row.itemID)
  expect(window.getSelection().rangeCount).toBe(1);expect(notice().textContent).toContain('已选中对象标识')
  expect(notice().textContent).not.toContain('已复制')
})
it('record selection replaces the earlier object selection, never joins both fields',async()=>{
  await select('object');await select('record');expect(window.getSelection().toString()).toBe(row.id)
  expect(window.getSelection().rangeCount).toBe(1);expect(notice().textContent).toContain('已选中记录标识')
})
it('selection is idempotent and retains the clicked button focus',async()=>{
  await select('record');const target=button('record');await select('record')
  expect(document.activeElement).toBe(target);expect(window.getSelection().toString()).toBe(row.id)
})
it('ordinary rerender keeps the selected text, notice, disclosure, and actual DOM',async()=>{
  await select('object');const target=code('object'),message=notice().textContent;await render()
  expect(code('object')).toBe(target);expect(window.getSelection().toString()).toBe(row.itemID)
  expect(notice().textContent).toBe(message);expect(host.querySelector('details').open).toBe(true)
})
it('new context clears its owned selection and notice even with the same IDs',async()=>{
  await select('object');await render({})
  expect(window.getSelection().toString()).toBe('');expect(notice()).toBeNull()
})
it('changed record values clear old selection and feedback before displaying the new ID',async()=>{
  await select('record');await render(context,{...row,id:'another-record'})
  expect(window.getSelection().toString()).toBe('');expect(notice()).toBeNull();expect(code('record').textContent).toBe('another-record')
})
it('native collapse clears a hidden identifier selection and its success notice',async()=>{
  await select('record');await toggle(false)
  expect(window.getSelection().toString()).toBe('');expect(notice()).toBeNull()
  await toggle(true);expect(notice()).toBeNull()
})
it('removing this component clears its selection, without a delayed callback',async()=>{
  await select('object');await act(async()=>root.render(null));expect(window.getSelection().toString()).toBe('')
})
it('context changes do not clear a selection outside this row',async()=>{
  const outside=document.createElement('p');outside.textContent='other-panel';document.body.append(outside)
  const range=document.createRange();range.selectNodeContents(outside);window.getSelection().removeAllRanges();window.getSelection().addRange(range)
  await render({});expect(window.getSelection().toString()).toBe('other-panel');outside.remove()
})
it('native collapse preserves a selection outside this row',async()=>{
  const outside=document.createElement('p');outside.textContent='other-panel';document.body.append(outside)
  const range=document.createRange();range.selectNodeContents(outside);window.getSelection().removeAllRanges();window.getSelection().addRange(range)
  await toggle(false);expect(window.getSelection().toString()).toBe('other-panel');outside.remove()
})
it('missing browser selection produces a manual fallback, not a copy receipt',async()=>{
  const spy=vi.spyOn(window,'getSelection').mockReturnValue(null);await select('record')
  expect(notice().textContent).toContain('无法自动选中');expect(notice().textContent).not.toContain('已复制');spy.mockRestore()
})
it('throwing browser selection does not leak the exception or trap the button',async()=>{
  const spy=vi.spyOn(window,'getSelection').mockImplementation(()=>{throw Error('PRIVATE_BROWSER_ERROR')})
  await select('object');expect(notice().textContent).not.toContain('PRIVATE');expect(document.activeElement).toBe(button('object'))
  spy.mockRestore();await select('object');expect(window.getSelection().toString()).toBe(row.itemID)
})
it('selection does not call clipboard, network, storage or download operations',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard'),getClipboard=vi.fn(()=>{throw Error('must not access clipboard')})
  Object.defineProperty(navigator,'clipboard',{configurable:true,get:getClipboard})
  const fetch=vi.spyOn(globalThis,'fetch'),store=vi.spyOn(Storage.prototype,'setItem'),download=vi.spyOn(HTMLAnchorElement.prototype,'click')
  try{await select('object');await select('record');expect(getClipboard).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(store).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled()}
  finally{if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete navigator.clipboard}
})
it('full long identifier is selected without truncation and both controls refer to the scope hint',async()=>{
  const longRow={...row,itemID:'x'.repeat(128)};await render(context,longRow);await select('object')
  expect(window.getSelection().toString()).toBe(longRow.itemID)
  for(const field of ['object','record'])expect(button(field).getAttribute('aria-describedby')).toBe('file-id-test-hint')
})
