import { act } from 'react'
import { flushSync } from 'react-dom'
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
 const id=trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns')
 if(id) {
  const linked=owner.getElementById(id)
  const list=linked?.getAttribute('role')==='listbox' ? linked : linked?.querySelector?.('[role="listbox"]')
  // A different Select may leave its old portal mounted during close motion.
  // Never borrow that listbox when this trigger already identifies its own.
  return list?.querySelector('[data-ui-option-value]') ? list : null
 }
 // Older compatible markup may omit aria-controls. Only then use the scoped
 // fallback; the current Ant Design trigger normally exposes a stable id.
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

 // Native <select> controls can be assigned while their disclosure is
 // collapsed. A custom popup cannot: a user must first reveal the real
 // disclosure before its trigger can receive pointer/keyboard interaction.
 // Reproduce that user action instead of opening a hidden popup or querying a
 // stale listbox left by another selector.
 const disclosures=[]
 for(let parent=host.parentElement;parent;parent=parent.parentElement) {
  if(parent.tagName==='DETAILS' && !parent.open) disclosures.push(parent)
 }
 if(disclosures.length) await act(async () => {
  for(const disclosure of disclosures.reverse()) {
   const summary=disclosure.querySelector(':scope > summary')
   if(!summary) throw Error('Collapsed details has no summary control')
   summary.click()
  }
 })

 await act(async () => {
  if(trigger.getAttribute('aria-expanded')!=='true') {
   // Ant Design's current trigger is .ant-select-content. Keep the older
   // selector fallback for compatible markup; never dispatch to the readonly
   // combobox input when the real clickable surface is present.
   const surface=trigger.closest('.ant-select')?.querySelector('.ant-select-content, .ant-select-selector') || trigger
   flushSync(() => surface.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,cancelable:true})))
  }
  if(vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(50)
 })
 // rc-trigger commits the portal after the event's React act scope closes.
 // Poll the actual listbox, yielding through short act scopes so deferred
 // timers/animation-frame work is flushed before each DOM observation.
 const deadline = Date.now() + 1500
 while(Date.now() <= deadline) {
  const popup = popupFor(trigger)
  if(popup) return popup
  await act(async () => {
   if(vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10)
   else await new Promise(resolve => setTimeout(resolve,10))
  })
 }
 throw Error('Select opened but its real option listbox did not mount')
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
