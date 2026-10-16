import assert from 'node:assert/strict'
import { pinJournal, PIN_JOURNAL_KEY, changePin, readPins } from '../src/services/localPins.mjs'
const row = (title = '普通笔记') => ({id:'owned-note',title,is_folder:false,is_pinned:false,updated_at:1})
const intent = item => ({version:1,started_at:1,item,pinned:true})
const memory = () => {const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}}
export function registerPinJournalBoundaries(test){
  for (const [label,title] of [
    ['JSON control-character expansion', '\u0001'.repeat(16384)],
    ['quotes at byte limit','"'.repeat(16384)],
    ['backslashes at byte limit','\\'.repeat(16384)],
    ['three-byte Unicode at limit','中'.repeat(5461)],
    ['four-byte Unicode at limit','🙂'.repeat(4096)],
    ['mixed escaped characters','\u0001"\\中🙂'.repeat(1200)],
  ]) test('supported title can always reopen its saved journal: '+label,()=>{
    const storage=memory(),j=pinJournal(storage),value=intent(row(title));j.save(value)
    const raw=j.raw();assert.ok(raw);assert.deepEqual(j.read(),value)
    assert.deepEqual(pinJournal(storage).read(),value);j.clear(raw);assert.equal(j.read(),null)
  })
  test('storage access exception occurs within journal actions, never at workspace construction',()=>{
    const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let reads=0
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){reads++;throw new Error('Storage disabled')}})
    try{
      let j;assert.doesNotThrow(()=>{j=pinJournal()});assert.equal(reads,0)
      assert.throws(()=>j.read(),/Storage disabled/);assert.throws(()=>j.raw(),/Storage disabled/)
      assert.throws(()=>j.save(intent(row())),/Storage disabled/)
      assert.throws(()=>j.clear('known'),/Storage disabled/)
    }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage}
  })
  test('storage becoming available can be retried without recreating the page',()=>{
    const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let available=false;const storage=memory()
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){if(!available)throw new Error('Storage disabled');return storage}})
    try{
      let j;assert.doesNotThrow(()=>{j=pinJournal()});assert.throws(()=>j.read(),/Storage disabled/)
      available=true;assert.equal(j.read(),null);j.save(intent(row()));assert.deepEqual(j.read(),intent(row()))
      j.clear(j.raw());assert.equal(j.read(),null)
    }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage}
  })
  test('explicit storage adapter never touches the browser storage getter',()=>{
    const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('must not read global')}})
    try{const storage=memory(),j=pinJournal(storage);j.save(intent(row()));assert.deepEqual(j.read(),intent(row()));j.clear(j.raw())}
    finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage}
  })
  test('over-budget corrupt journal is retained, not parsed as empty or overwritten',()=>{
    const storage=memory(),j=pinJournal(storage),raw='x'.repeat(131073);storage.setItem(PIN_JOURNAL_KEY,raw)
    assert.throws(()=>j.read());assert.equal(j.raw(),raw);assert.throws(()=>j.save(intent(row())))
    assert.equal(j.raw(),raw);j.clear(raw);assert.equal(j.read(),null)
  })
  test('maximum escaped title with lost response remains reconcilable without a second PUT',async()=>{
    const storage=memory(),item=row('\u0001'.repeat(16384));let writes=0
    await assert.rejects(changePin(async()=>{writes++;throw Error('response lost')},item,true,{storage}),{code:'unconfirmed'})
    const pending=pinJournal(storage).read();assert.equal(pending.item.title,item.title);assert.equal(writes,1)
    let reads=0;await readPins(async(_,o)=>{reads++;assert.equal(o.method,undefined);return {scope:'active-note-pins-v1',complete:true,items:[{...item,is_pinned:true}]}})
    assert.equal(reads,1);assert.equal(writes,1);assert.ok(pinJournal(storage).read())
  })
  test('replacement record cannot be erased by the original successful HTTP completion',async()=>{
    const storage=memory(),original=intent(row()),replacement=JSON.stringify({...original,started_at:2})
    await assert.rejects(changePin(async()=>{storage.setItem(PIN_JOURNAL_KEY,replacement);return {...row(),is_pinned:true}},row(),true,{storage}),{code:'unconfirmed'})
    assert.equal(storage.getItem(PIN_JOURNAL_KEY),replacement)
  })
  test('rejected oversized title never creates a journal or sends HTTP',async()=>{
    const storage=memory();let writes=0
    await assert.rejects(changePin(()=>{writes++},row('x'.repeat(16385)),true,{storage}))
    assert.equal(writes,0);assert.equal(storage.data.size,0)
  })
}
