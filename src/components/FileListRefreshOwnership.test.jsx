import React, {act, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, test, expect, vi} from 'vitest'
import {DndProvider} from 'react-dnd'
import {TestBackend} from 'react-dnd-test-backend'
import FileList from './FileList'
import {api, listAllFiles} from '~/services/api'
vi.mock('~/services/api',()=>({api:vi.fn(),listAllFiles:vi.fn()}))
const oldNote={id:'old-note',title:'Previous.md',content:'previous-body',parent_id:'',is_folder:false,updated_at:1}
const daily={id:'daily-note',title:'2097-02-21',content:'canonical-empty-body',parent_id:'',is_folder:false,updated_at:2}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
let host,root,notifications
function Parent({initial=oldNote}){
 const[current,setCurrent]=useState(initial),[content,setContent]=useState(initial?.content||'')
 const select=file=>{setCurrent(file);setContent(file?.content||'')}
 return <DndProvider backend={TestBackend}>
  <output data-current>{current?.id||''}</output><output data-title>{current?.title||''}</output>
  <output data-dirty>{String(!!current&&content!==(current.content||''))}</output>
  <button data-daily-handoff onClick={()=>{window.dispatchEvent(new Event('library:refresh'));select(daily)}}>Daily handoff</button>
  <button data-select-daily onClick={()=>select(daily)}>Select daily</button>
  <FileList selectedId={current?.id} updatedItem={current} onSelect={select} onItemsChanged={list=>{
   notifications(list)
   // Same current-note metadata and fallback contract as the production App.
   if(current){const matched=list.find(item=>item.id===current.id)
    if(!matched){select(list.find(item=>!item.is_folder)||list[0]||null);return}
    setCurrent(prev=>prev?{...prev,...matched,content:prev.content}:prev)
   }else if(list.length)select(list[0])
  }}/>
 </DndProvider>
}
const flush=()=>act(async()=>{for(let i=0;i<10;i++)await Promise.resolve()})
async function render(initial=oldNote){await act(async()=>root.render(<Parent initial={initial}/>));await flush()}
async function refresh(){await act(async()=>window.dispatchEvent(new Event('library:refresh')))}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();api.mockReset();api.mockResolvedValue([]);listAllFiles.mockReset();listAllFiles.mockResolvedValue([oldNote,daily]);notifications=vi.fn();host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{if(root)await act(async()=>root.unmount());host.remove();localStorage.clear();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('daily refresh delivered after navigation cannot replace the newly opened note identity',async()=>{
 await render();const read=deferred();listAllFiles.mockReturnValueOnce(read.promise)
 await act(async()=>host.querySelector('[data-daily-handoff]').click());await flush()
 expect(host.querySelector('[data-current]').textContent).toBe(daily.id)
 await act(async()=>read.resolve([oldNote,daily]));await flush()
 expect(host.querySelector('[data-current]').textContent).toBe(daily.id)
 expect(host.querySelector('[data-title]').textContent).toBe(daily.title)
 expect(host.querySelector('[data-dirty]').textContent).toBe('false')
})
test('initial read cannot auto-select its old first row after a note was explicitly selected',async()=>{
 const read=deferred();listAllFiles.mockReturnValueOnce(read.promise);await render(null)
 await act(async()=>host.querySelector('[data-select-daily]').click());await flush()
 await act(async()=>read.resolve([oldNote,daily]));await flush()
 expect(host.querySelector('[data-current]').textContent).toBe(daily.id)
 expect(host.querySelector('[data-title]').textContent).toBe(daily.title)
})
test('older refresh results cannot overwrite a newer complete list and its metadata',async()=>{
 await render();const first=deferred(),second=deferred()
 listAllFiles.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
 await refresh();await refresh()
 await act(async()=>second.resolve([{...oldNote,title:'Newest.md'},daily]));await flush()
 const delivered=notifications.mock.calls.length
 await act(async()=>first.resolve([{...oldNote,title:'Stale.md'}]));await flush()
 expect(notifications.mock.calls.length).toBe(delivered)
 expect(host.querySelector('[data-title]').textContent).toBe('Newest.md')
 expect(host.querySelector('[data-file-id="daily-note"]')).toBeTruthy()
})
test('unmounted list never delivers a late result to the parent navigation callback',async()=>{
 await render();const read=deferred();listAllFiles.mockReturnValueOnce(read.promise);await refresh()
 const count=notifications.mock.calls.length
 await act(async()=>root.unmount());root=null
 await act(async()=>read.resolve([oldNote,daily]));await flush()
 expect(notifications.mock.calls.length).toBe(count)
})
test('current refresh still updates the selected note metadata without replacing its body',async()=>{
 await render();listAllFiles.mockResolvedValue([{...oldNote,title:'Renamed.md',content:'metadata-only-body'},daily]);await refresh();await flush()
 expect(host.querySelector('[data-current]').textContent).toBe(oldNote.id)
 expect(host.querySelector('[data-title]').textContent).toBe('Renamed.md')
 expect(host.querySelector('[data-dirty]').textContent).toBe('false')
})

test('pre-navigation list missing the new note triggers a fresh read instead of deletion fallback',async()=>{
 const read=deferred();listAllFiles.mockReturnValueOnce(read.promise);await render(null)
 await act(async()=>host.querySelector('[data-select-daily]').click());await flush()
 const calls=listAllFiles.mock.calls.length
 await act(async()=>read.resolve([oldNote]));await flush()
 expect(listAllFiles.mock.calls.length).toBe(calls+1)
 expect(host.querySelector('[data-current]').textContent).toBe(daily.id)
 expect(host.querySelector('[data-title]').textContent).toBe(daily.title)
 expect(host.querySelector('[data-file-id="daily-note"]')).toBeTruthy()
 expect(host.querySelector('[data-dirty]').textContent).toBe('false')
})
