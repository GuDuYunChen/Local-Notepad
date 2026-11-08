import { act } from 'react'
import { vi } from 'vitest'

// Explicit interaction helpers for the real Ant Design DOM. Nothing overrides
// document APIs, renders a substitute select, or calls application handlers.
const hostFor = node => node?.closest?.('[data-ui-control="select"]') || null
export const isUiSelect = node => Boolean(hostFor(node))
const triggerFor = node => hostFor(node)?.querySelector('[role="combobox"]') || node
const normalize = selector => String(selector).replace(/(^|[\s>,+~(])select(?=[$\s.#[:>,+~)]|$)/g, '$1:is(select,[role="combobox"],[data-ui-control="select"])')
const resolve = node => {
 if(!node)return node
 if(node.matches?.('.ant-select,[data-ui-control="select"]')) return node.querySelector('[role="combobox"]') || node
 return node
}
export function uiQuery(root,selector) { return resolve(root.querySelector(normalize(selector))) }
export function uiQueryAll(root,selector) { return [...root.querySelectorAll(normalize(selector))].map(resolve).filter((node,index,array)=>array.indexOf(node)===index) }
function popupFor(node) {
 const trigger=triggerFor(node), owner=trigger?.ownerDocument
 if(trigger?.getAttribute('aria-expanded')!=='true')return null
 const id=trigger.getAttribute('aria-controls')
 const linked=id ? owner.getElementById(id) : null
 if(linked?.getAttribute('role')==='listbox' && linked.querySelector('[data-ui-option-value]'))return linked
 // Ant Design renders the actual option list as a role=listbox portal. Do not
 // depend on a visual wrapper class: its parent is intentionally unclassed.
 const scope=trigger.closest?.('[role="dialog"],[role="alertdialog"]') || owner
 const lists=container=>[...(container?.querySelectorAll?.('[role="listbox"]') || [])]
   .filter(list=>list.querySelector('[data-ui-option-value]'))
 const candidates=lists(scope)
 return candidates.at(-1) || (scope!==owner ? lists(owner).at(-1) : null) || null
}
export async function openUiSelect(node) {
 const trigger=triggerFor(node)
 const host=hostFor(trigger)
 if(!trigger || !host) throw Error('Expected a rendered UI selector')
 if(trigger.disabled) return null
 // rc-trigger first updates aria-expanded, then schedules its portal commit.
 // Keep the real pointer event and the deferred React render in one async act
 // scope so the listbox is queried only after the actual DOM has committed.
 await act(async () => {
  if(trigger.getAttribute('aria-expanded')!=='true') {
   const surface=trigger.closest('.ant-select')?.querySelector('.ant-select-selector') || trigger
   surface.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,cancelable:true}))
  }
  if(vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(50)
  else await new Promise(resolve => setTimeout(resolve,32))
 })
 const popup=popupFor(trigger)
 if(!popup) throw Error('Select opened but its real option listbox did not mount')
 return popup
}
export async function uiOptions(node) {
 if(!isUiSelect(node))return node.options
 const popup=await openUiSelect(node)
 return popup ? [...popup.querySelectorAll('[data-ui-option-value]')] : []
}
export async function uiSelectedOptions(node) {
 if(!isUiSelect(node))return node.selectedOptions
 return (await uiOptions(node)).filter(option=>option.closest('.ant-select-item-option-selected'))
}
export function uiValue(node) {
 if(node?.matches?.('[data-ui-option-value]'))return node.getAttribute('data-ui-option-value')
 const host=hostFor(node)
 return host ? JSON.parse(host.getAttribute('data-ui-value')) : node.value
}
export function uiDisabled(node) { return isUiSelect(node) ? Boolean(triggerFor(node).disabled) : node.disabled }
export function uiText(node) {
 if(isUiSelect(node))return hostFor(node)?.querySelector('.ant-select-content')?.textContent || ''
 return node.textContent
}
async function chooseUiOption(popup,value) {
 const option=[...popup.querySelectorAll('[data-ui-option-value]')].find(item=>item.getAttribute('data-ui-option-value')===String(value))
 if(!option)throw Error('Requested option is not available: '+String(value))
 if(option.closest('.ant-select-item-option-disabled'))return value
 await act(async () => option.click())
 return value
}
export function setUiValue(node,value) {
 if(isUiSelect(node)) {
  const trigger=triggerFor(node)
  if(trigger.disabled)return value
  const popup=popupFor(trigger)
  return popup ? chooseUiOption(popup,value) : setUiSelectValue(node,value)
 }
 const prototype=node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLInputElement ? HTMLInputElement.prototype : null
 if(prototype)Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value)
 else node.value=value
 return value
}
async function setUiSelectValue(node,value) {
 const trigger=triggerFor(node)
 const popup=await openUiSelect(trigger)
 return chooseUiOption(popup,value)
}
