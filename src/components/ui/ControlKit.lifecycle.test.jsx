import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UiButton, UiInput, UiSelect } from './ControlKit'
import UiThemeProvider from './UiThemeProvider'
import { setUiValue } from '~/test/uiControlDriver'

let host, root
beforeEach(() => {
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async () => {
 if(root)await act(async()=>root.unmount())
 host.remove();vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals()
})
async function unmountWithoutAdvancingTimers() {
 await act(async()=>root.unmount());root=null
 // Do not advance/clear timers or ignore a library timer to make cleanup pass.
 expect(vi.getTimerCount()).toBe(0)
}
it('a clicked button leaves no global click-position timeout after unmount', async () => {
 const clicked=vi.fn()
 await act(async()=>root.render(<UiButton onClick={clicked}>Action</UiButton>))
 await act(async()=>host.querySelector('button').click())
 expect(clicked).toHaveBeenCalledOnce()
 await unmountWithoutAdvancingTimers()
})
it('the shared theme cancels its pending observation frame on unmount',async()=>{
 await act(async()=>root.render(<UiThemeProvider><UiButton>Action</UiButton></UiThemeProvider>))
 await act(async()=>host.querySelector('button').click())
 await unmountWithoutAdvancingTimers()
})
it('an open Select releases its scheduled work on unmount',async()=>{
 await act(async()=>root.render(<UiSelect aria-label="choice" options={[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]}/>))
 await setUiValue(host.querySelector('[role="combobox"]'),'b')
 await unmountWithoutAdvancingTimers()
})
it('input refs still expose the real focusable native input',async()=>{
 const ref=React.createRef()
 await act(async()=>root.render(<UiInput ref={ref} aria-label="text"/>))
 expect(ref.current).toBe(host.querySelector('input'))
 await act(async()=>ref.current.focus())
 expect(document.activeElement).toBe(ref.current)
 await unmountWithoutAdvancingTimers()
})
it('application theme preserves Select state, refs and disabled-fieldset form behavior',async()=>{
 const ref=React.createRef(),changed=vi.fn(),clicked=vi.fn()
 const render=async disabled=>act(async()=>root.render(<UiThemeProvider><form>
  <fieldset disabled={disabled}>
   <UiSelect ref={ref} name="mode" aria-label="choice" defaultValue="a" onChange={changed}
    options={[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]}/>
   <UiButton type="button" onClick={clicked}>Action</UiButton>
  </fieldset>
 </form></UiThemeProvider>))
 await render(false)
 const field=host.querySelector('[role="combobox"]'),form=host.querySelector('form')
 await setUiValue(field,'b');await act(async()=>ref.current.focus())
 expect(changed).toHaveBeenCalledOnce();expect(ref.current.value).toBe('b')
 expect(document.activeElement).toBe(field);expect(new FormData(form).get('mode')).toBe('b')
 await render(true)
 expect(field.disabled).toBe(true);expect(ref.current.disabled).toBe(true)
 expect(new FormData(form).has('mode')).toBe(false)
 await act(async()=>host.querySelector('button').click());expect(clicked).not.toHaveBeenCalled()
 await render(false);await act(async()=>ref.current.focus())
 expect(host.querySelector('[role="combobox"]')).toBe(field);expect(ref.current.value).toBe('b')
 expect(document.activeElement).toBe(field);expect(new FormData(form).get('mode')).toBe('b')
 expect(changed).toHaveBeenCalledOnce()
 await unmountWithoutAdvancingTimers()
})
