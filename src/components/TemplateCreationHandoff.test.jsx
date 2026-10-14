import React, {act, Suspense, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {test, expect, vi} from 'vitest'
import {DndProvider} from 'react-dnd'
import {TestBackend} from 'react-dnd-test-backend'
import FileList from './FileList'
import {api, listAllFiles} from '~/services/api'
vi.mock('~/services/api',()=>({api:vi.fn(),listAllFiles:vi.fn()}))
vi.mock('./TemplateSelector',()=>({default:({onCreated})=><button data-confirm-template-copy onClick={()=>void onCreated({id:'new-note',title:'Copied.md',content:'copied-body',parent_id:'',is_folder:false,updated_at:2})}>Confirmed copy</button>}))
const previous={id:'old-note',title:'Previous.md',content:'previous-body',parent_id:'',is_folder:false,updated_at:1}
const created={id:'new-note',title:'Copied.md',content:'copied-body',parent_id:'',is_folder:false,updated_at:2}
function ParentWithOriginalAppListContract(){
 const [current,setCurrent]=useState(previous)
 return <DndProvider backend={TestBackend}><output data-current-note>{current.id}</output><Suspense fallback={<span>loading</span>}><FileList selectedId={current.id} updatedItem={current} onSelect={file=>setCurrent(file)} onBeforeNew={async()=>true} onItemsChanged={list=>{
  const matched=list.find(item=>item.id===current.id)
  if(matched)setCurrent(prev=>prev?{...prev,...matched,content:prev.content}:prev)
 }}/></Suspense></DndProvider>
}
test('confirmed template handoff keeps the new note selected after list callbacks settle',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();api.mockReset();listAllFiles.mockReset()
 let copyExists=false;listAllFiles.mockImplementation(async()=>copyExists?[previous,created]:[previous]);api.mockResolvedValue([])
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const settle=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,25)))
 try{
  await act(async()=>root.render(<ParentWithOriginalAppListContract/>));await settle()
  await act(async()=>window.dispatchEvent(new Event('library:create-note')))
  for(let i=0;i<20&&!host.querySelector('[data-confirm-template-copy]');i++)await settle()
  expect(host.querySelector('[data-confirm-template-copy]')).toBeTruthy()
  const reads=listAllFiles.mock.calls.length;copyExists=true
  await act(async()=>host.querySelector('[data-confirm-template-copy]').click());await settle();await settle()
  expect(host.querySelector('[data-current-note]').textContent).toBe('new-note')
  expect(listAllFiles.mock.calls.length).toBe(reads)
  expect(host.querySelector('[data-file-id="new-note"]')).toBeTruthy()
 }finally{await act(async()=>root.unmount());host.remove();localStorage.clear();delete globalThis.IS_REACT_ACT_ENVIRONMENT}
})
