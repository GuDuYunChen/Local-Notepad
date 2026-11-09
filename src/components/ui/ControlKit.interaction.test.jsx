import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UiSelect } from './ControlKit'
import { openUiSelect, setUiValue } from '~/test/uiControlDriver'

let host, root
beforeEach(() => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async () => { await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals() })
const trigger=()=>host.querySelector('[role="combobox"]')
const render=async props=>act(async()=>root.render(<UiSelect aria-label="choice" options={[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]} {...props}/>))
async function pointerClick() {
 const surface=host.querySelector('.ant-select-content, .ant-select-selector')
 for(const type of ['mousedown','mouseup','click']) {
  await act(async()=>surface.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0})))
 }
}
it('a full pointer sequence opens, closes on the second click, and reopens once',async()=>{
 const onOpenChange=vi.fn();await render({onOpenChange})
 await pointerClick();expect(trigger().getAttribute('aria-expanded')).toBe('true')
 await pointerClick();expect(trigger().getAttribute('aria-expanded')).toBe('false')
 await pointerClick();expect(trigger().getAttribute('aria-expanded')).toBe('true')
 expect(onOpenChange.mock.calls.map(([open])=>open)).toEqual([true,false,true])
})
it('Escape closes only its own popup and returns to the same selector',async()=>{
 const parentKey=vi.fn()
 await act(async()=>root.render(<div onKeyDown={parentKey}><UiSelect aria-label="choice" options={[{value:'a',label:'Alpha'}]}/></div>))
 await openUiSelect(trigger());await act(async()=>trigger().focus())
 await act(async()=>trigger().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true})))
 expect(trigger().getAttribute('aria-expanded')).toBe('false')
 expect(parentKey).not.toHaveBeenCalled();expect(document.activeElement).toBe(trigger())
})
it('choosing a popup option emits one original value event',async()=>{
 const onChange=vi.fn();await render({onChange});await setUiValue(trigger(),'b')
 expect(onChange).toHaveBeenCalledTimes(1);expect(onChange.mock.calls[0][0].target.value).toBe('b')
 expect(trigger().getAttribute('aria-expanded')).toBe('false')
})
