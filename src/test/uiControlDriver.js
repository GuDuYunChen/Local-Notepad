import { flushSync } from 'react-dom'

// Explicit interaction helpers for the real Ant Design DOM. Nothing overrides
// document APIs, renders a substitute select, or calls application handlers.
const hostFor = node => node?.closest?.('[data-ui-control="select"]') || null
export const isUiSelect = node => Boolean(hostFor(node))
const triggerFor = node => hostFor(node)?.querySelector('[role="combobox"]') || node
const normalize = selector => String(selector).replace(/(^|[\\s>,+~(])select(?=[$\\s.#[:>,+~)]|$)/g, '$1:is(select,[role="combobox"],[data-ui-control="select"])')
const resolve = node => {
 if(!node)return node
 if(node.matches?.('.ant-select,[data-ui-control="select"]')) return node.querySelector('[role="combobox"]') || node
 return node
}
export function uiQuery(root,selector) { return resolve(root.querySelector(normalize(selector))) }
export function uiQueryAll(root,selector) { return [...root.querySelectorAll(normalize(selector))].map(resolve).filter((node,index,array)=>array.indexOf(node)===index) }
function popupFor(node) {
 const trigger=triggerFor(node), id=trigger?.getAttribute('aria-controls')
 const list=id ? trigger.ownerDocument.getElementById(id) : null
 const linked=list?.closest('.ant-select-dropdown')
 if(linked)return linked
 // rc-select may mount its portal one render after aria-controls is assigned.
 // Resolve the visible real popup in the configured dialog/body container.
 const scope=trigger?.closest?.('[role="dialog"],[role="alertdialog"]') || trigger?.ownerDocument
 const candidates=[...(scope?.querySelectorAll?.('.ant-select-dropdown') || [])]
   .filter(popup=>!popup.classList.contains('ant-select-dropdown-hidden') && popup.getAttribute('aria-hidden')!=='true' && popup.querySelector('[data-ui-option-value]'))
 return candidates.at(-1) || null
}
export function openUiSelect(node) {
 const trigger=triggerFor(node)
 if(!trigger || !hostFor(trigger)) throw Error('Expected a rendered UI selector')
 if(trigger.disabled) return null
 if(trigger.getAttribute('aria-expanded')!=='true') {
  // Ant Design handles pointer opening on the selector surface, not the
  // nested combobox input. Flush the real bubbling event before reading portal.
  const surface=trigger.closest('.ant-select')?.querySelector('.ant-select-selector') || trigger
  flushSync(()=>surface.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0})))
 }
 const popup=popupFor(trigger)
 if(!popup)throw Error('Select menu did not open: '+(trigger.getAttribute('aria-label')||trigger.id))
 return popup
}
export function uiOptions(node) {
 if(!isUiSelect(node))return node.options
 const popup=openUiSelect(node)
 return popup ? [...popup.querySelectorAll('[data-ui-option-value]')] : []
}
export function uiSelectedOptions(node) {
 if(!isUiSelect(node))return node.selectedOptions
 return uiOptions(node).filter(option=>option.closest('.ant-select-item-option-selected'))
}
export function uiValue(node) {
 if(node?.matches?.('[data-ui-option-value]'))return node.getAttribute('data-ui-option-value')
 const host=hostFor(node)
 return host ? JSON.parse(host.getAttribute('data-ui-value')) : node.value
}
export function uiDisabled(node) { return isUiSelect(node) ? Boolean(triggerFor(node).disabled) : node.disabled }
export function uiText(node) {
 if(isUiSelect(node))return uiOptions(node).map(option=>option.textContent).join('')
 return node.textContent
}
export function setUiValue(node,value) {
 if(isUiSelect(node)) {
  const trigger=triggerFor(node)
  if(trigger.disabled)return value
  const popup=openUiSelect(trigger)
  const option=[...popup.querySelectorAll('[data-ui-option-value]')].find(item=>item.getAttribute('data-ui-option-value')===String(value))
  if(!option)throw Error('Requested option is not available: '+String(value))
  if(option.closest('.ant-select-item-option-disabled'))return value
  option.click()
  return value
 }
 const prototype=node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLInputElement ? HTMLInputElement.prototype : null
 if(prototype)Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value)
 else node.value=value
 return value
}
