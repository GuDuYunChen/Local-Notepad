import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LocalActions from './LocalActions'
let host,root,entry,execute,close,props
const drain=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
const render=async extra=>{props={...props,...extra};await act(async()=>{root.render(<LocalActions {...props}/>);await drain()})}
const key=async(k,extra={},target=document.querySelector('input'))=>{const e=new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...extra});await act(async()=>{target.dispatchEvent(e);await drain()});return e}
const click=async sel=>act(async()=>{document.querySelector(sel).click();await drain()})
const input=async(value)=>act(async()=>{const n=document.querySelector('input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}));await drain()})
beforeEach(async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');entry=document.createElement('button');entry.textContent='Entry';document.body.append(entry,host);entry.focus();root=createRoot(host);execute=vi.fn(async id=>({accepted:true,id}));close=vi.fn();props={open:true,onExecute:execute,onClose:close,contextVersion:1};await render();await act(async()=>{await new Promise(r=>setTimeout(r,1))})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();entry.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('opens all17 local entries and moves focus; cancel restores prior focus',async()=>{expect(document.querySelectorAll('[role=option]')).toHaveLength(17);expect(document.activeElement).toBe(document.querySelector('input'));await key('Escape');expect(close).toHaveBeenCalledTimes(1);expect(execute).not.toHaveBeenCalled();await render({open:false});expect(document.activeElement).toBe(entry)})
it('searches by actual input and executes the matching action from Enter',async()=>{await input('附件');expect(document.querySelectorAll('[role=option]')).toHaveLength(1);await key('Enter');expect(execute).toHaveBeenCalledWith('attachments',expect.objectContaining({signal:expect.any(AbortSignal)}));expect(close).toHaveBeenCalledTimes(1)})
it('arrow selection wraps and clicking a row executes its own ID',async()=>{await key('ArrowUp');expect(document.querySelector('[aria-selected=true]').dataset.localAction).toBe('settings');await key('ArrowDown');expect(document.querySelector('[aria-selected=true]').dataset.localAction).toBe('notes');await click('[data-local-action=tasks]');expect(execute.mock.calls[0][0]).toBe('tasks')})
it('empty search cannot dispatch or retain an obsolete selected ID',async()=>{await input('不存在的功能');expect(document.querySelector('[aria-selected=true]')).toBeNull();await key('Enter');expect(execute).not.toHaveBeenCalled();expect(document.querySelector('footer button').disabled).toBe(true)})
it.each([{isComposing:true},{keyCode:229},{repeat:true}])('does not launch on composition/repeat %j',async flags=>{await key('Enter',flags);expect(execute).not.toHaveBeenCalled()})
it('does not launch while the input composition session remains active',async()=>{await act(async()=>document.querySelector('input').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await key('Enter');expect(execute).not.toHaveBeenCalled()})
it('isolates Ctrl+S from the original editor',async()=>{expect((await key('s',{ctrlKey:true})).defaultPrevented).toBe(true);expect(execute).not.toHaveBeenCalled()})
it('prevents repeated dispatch while original navigation is awaiting a decision',async()=>{execute.mockImplementation(()=>new Promise(()=>{}));await key('Enter');await key('Enter');expect(execute).toHaveBeenCalledTimes(1);expect(document.querySelector('input').disabled).toBe(true);expect(document.querySelector('.local-actions-overlay').dataset.running).toBe('true')})
it('abort on close invalidates a late successful result',async()=>{let resolve;execute.mockImplementation(()=>new Promise(r=>{resolve=r}));await key('Enter');const signal=execute.mock.calls[0][1].signal;await click('[aria-label="关闭快捷操作"]');expect(signal.aborted).toBe(true);await act(async()=>{resolve({accepted:true,id:'notes'});await drain()});expect(close).toHaveBeenCalledTimes(1)})
it('does not close on a cancelled original save decision',async()=>{execute.mockResolvedValue({accepted:false,reason:'cancelled'});await key('Enter');expect(close).not.toHaveBeenCalled();expect(document.querySelector('[role=status]').textContent).toContain('保持不变');expect(document.querySelector('input').disabled).toBe(false)})
it('shows fixed error feedback, retries only on another explicit action',async()=>{execute.mockRejectedValueOnce(Error('private failure'));await key('Enter');expect(execute).toHaveBeenCalledTimes(1);expect(document.querySelector('[role=alert]').textContent).not.toContain('private');expect(document.querySelector('.local-actions-results').contains(document.querySelector('[role=alert]'))).toBe(false);await key('Enter');expect(execute).toHaveBeenCalledTimes(2);expect(close).toHaveBeenCalledTimes(1)})
it('context change aborts pending action without adopting stale completion',async()=>{let resolve;execute.mockImplementation(()=>new Promise(r=>{resolve=r}));await key('Enter');const signal=execute.mock.calls[0][1].signal;await render({contextVersion:2});expect(signal.aborted).toBe(true);await act(async()=>{resolve({accepted:true,id:'notes'});await drain()});expect(close).not.toHaveBeenCalled();expect(document.querySelector('[role=status]').textContent).toContain('页面已变化')})
it('resets search and prior notices on reopen',async()=>{await input('附件');await render({open:false});await render({open:true});expect(document.querySelector('input').value).toBe('');expect(document.querySelectorAll('[role=option]')).toHaveLength(17)})
it('leaves a nested original save dialog in control of Escape',async()=>{const other=document.createElement('div');other.setAttribute('role','dialog');other.setAttribute('aria-modal','true');document.body.append(other);try{await key('Escape');expect(close).not.toHaveBeenCalled()}finally{other.remove()}})
it('traps keyboard focus between close and execute controls',async()=>{const first=document.querySelector('[aria-label="关闭快捷操作"]'),last=document.querySelector('footer button');first.focus();expect((await key('Tab',{shiftKey:true},first)).defaultPrevented).toBe(true);expect(document.activeElement).toBe(last);await key('Tab',{},last);expect(document.activeElement).toBe(first)})

it('consumes a matching synchronous acknowledgement only once',async()=>{
 execute.mockImplementation(async(id,{onAccepted})=>{onAccepted({accepted:true,id});onAccepted({accepted:true,id});return{accepted:true,id}})
 await key('Enter');expect(close).toHaveBeenCalledTimes(1)
})
it('refuses a synchronous acknowledgement for the wrong target',async()=>{
 execute.mockImplementation(async(_, {onAccepted})=>{onAccepted({accepted:true,id:'tasks'});return{accepted:false}})
 await key('Enter');expect(close).not.toHaveBeenCalled()
})
it('external context cancellation still rejects the late synchronous receipt',async()=>{
 let notify,resolve;execute.mockImplementation((_,{onAccepted})=>{notify=onAccepted;return new Promise(r=>{resolve=r})})
 await key('Enter');await render({contextVersion:2});await act(async()=>{notify({accepted:true,id:'notes'});resolve({accepted:true,id:'notes'});await drain()})
 expect(close).not.toHaveBeenCalled();expect(document.querySelector('[role=status]').textContent).toContain('页面已变化')
})
it('closing the palette rejects a late receipt without a second close',async()=>{
 let notify,resolve;execute.mockImplementation((_,{onAccepted})=>{notify=onAccepted;return new Promise(r=>{resolve=r})})
 await key('Enter');await click('[aria-label="关闭快捷操作"]');await act(async()=>{notify({accepted:true,id:'notes'});resolve({accepted:true,id:'notes'});await drain()})
 expect(close).toHaveBeenCalledTimes(1)
})
