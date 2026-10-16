import {readQuickTarget} from './quickSwitcher.mjs'

export const RECENT_KEY = 'local-notepad.recent-notes.v1'
export const RECENT_EVENT = 'recent-notes:changed'
export const RECENT_LIMIT = 100
export const RECENT_PAGE_SIZE = 20
const MAX_RAW = 256 * 1024
const fail = (code,message) => { throw Object.assign(new Error(message),{code}) }
const scalar = value => typeof value === 'string' && !Array.from(value).some(c=>c.codePointAt(0)>=0xd800&&c.codePointAt(0)<=0xdfff)
const idOK = id => scalar(id)&&id.length>0&&id.length<=512&&!/[\u0000-\u001f\u007f]/.test(id)
const empty = () => ({version:1,enabled:true,entries:[]})
let recordingWarning = ''
export function recentWarning() { return recordingWarning }
export function notifyRecent() { if(typeof window!=='undefined')window.dispatchEvent(new Event(RECENT_EVENT)) }
export function validateRecent(value) {
  if(!value||value.version!==1||typeof value.enabled!=='boolean'||!Array.isArray(value.entries)||value.entries.length>RECENT_LIMIT)
    fail('invalid','最近访问记录不完整或格式不受支持，原记录保留。')
  const ids=new Set()
  const entries=value.entries.map(row=>{
    if(!row||!idOK(row.id)||ids.has(row.id)||!scalar(row.title)||Array.from(row.title).length>120||/[\u0000-\u001f\u007f-\u009f]/.test(row.title)||!Number.isSafeInteger(row.visitedAt)||row.visitedAt<1||row.visitedAt>8640000000000000)
      fail('invalid','最近访问记录身份或内容无效，原记录保留。')
    ids.add(row.id)
    return Object.freeze({id:row.id,title:row.title,visitedAt:row.visitedAt})
  })
  return Object.freeze({version:1,enabled:value.enabled,entries:Object.freeze(entries)})
}
export function recentStore(storage) {
  const access=()=>storage===undefined?globalThis.localStorage:storage
  const raw=()=>{try{return access().getItem(RECENT_KEY)}catch{fail('storage','本机访问记录暂时不可读取；笔记内容不受影响，可以重试。')}}
  const read=()=>{
    const text=raw()
    if(text===null)return {raw:null,data:validateRecent(empty())}
    if(typeof text!=='string'||text.length>MAX_RAW)fail('invalid','最近访问记录过大或损坏，原记录保留。')
    try{return {raw:text,data:validateRecent(JSON.parse(text))}}
    catch{fail('invalid','最近访问记录损坏或版本不受支持，原记录保留。')}
  }
  const write=(expected,data)=>{
    const next=JSON.stringify(validateRecent(data))
    if(next.length>MAX_RAW)fail('limit','访问记录超过本机保存上限；没有删改笔记。')
    if(raw()!==expected)fail('changed','访问记录已变化，请重新读取后再操作。')
    try{access().setItem(RECENT_KEY,next)}catch{fail('storage','本机记录写入失败。请重新读取核对，不会自动重复操作。')}
    if(raw()!==next)fail('unconfirmed','访问记录写入未确认，请重新读取核对。')
    recordingWarning=''
    return {raw:next,data:validateRecent(data)}
  }
  return {raw,read,write,
    remove(expected,id){const current=read();if(current.raw!==expected)fail('changed','访问记录已变化，请重新读取后再移除。');if(!current.data.entries.some(e=>e.id===id))fail('missing','这条访问记录已不存在。');return write(expected,{...current.data,entries:current.data.entries.filter(e=>e.id!==id)})},
    clear(expected){const current=read();if(current.raw!==expected)fail('changed','访问记录已变化，请重新读取后再清空。');return write(expected,{...current.data,entries:[]})},
    enable(expected,enabled){if(typeof enabled!=='boolean')fail('invalid','记录设置无效。');const current=read();if(current.raw!==expected)fail('changed','访问记录已变化，请重新读取后再设置。');return write(expected,{...current.data,enabled})},
    reset(expected){return write(expected,{version:1,enabled:false,entries:[]})},
  }
}
// Called only after the application has entered its ordinary note view. It never
// saves note content or makes network requests. A failed history write must not
// interfere with the editor's existing draft, save or quit decisions.
export function recordRecentVisit(file,{storage,now=Date.now()}={}) {
  try{
    if(!file||!idOK(file.id)||!scalar(file.title)||file.is_folder||file.is_deleted||file.title.startsWith('__tpl__'))return false
    if(!Number.isSafeInteger(now)||now<1||now>8640000000000000)fail('clock','访问时间不可用，未记录本次访问。')
    const store=recentStore(storage),current=store.read()
    if(!current.data.enabled)return false
    const title=Array.from(file.title.replace(/[\u0000-\u001f\u007f-\u009f]/g,' ')).slice(0,120).join('')
    const entry={id:file.id,title,visitedAt:now}
    store.write(current.raw,{...current.data,entries:[entry,...current.data.entries.filter(e=>e.id!==file.id)].slice(0,RECENT_LIMIT)})
    notifyRecent();return true
  }catch(e){recordingWarning=e?.message||'本次访问未确认记录，笔记内容不受影响。';notifyRecent();return false}
}
export function recentQuery(value) {
  if(!scalar(value)||Array.from(value).length>100||/[\u0000-\u001f\u007f]/.test(value))fail('query','查找词最多100个字符，不能包含控制字符。')
  return value.trim()
}
export function recentView(data,query='') {
  const q=recentQuery(query).toLocaleLowerCase()
  return data.entries.filter(e=>!q||e.title.toLocaleLowerCase().includes(q))
}
export async function readRecentTarget(api,entry,signal,timeout) {
  if(!entry||!idOK(entry.id))fail('target','访问记录目标身份无效。')
  // Identity is stable across a rename. Always fetch the latest title/body and
  // let the original App guard decide whether leaving the current note is safe.
  return readQuickTarget(api,entry.id,signal,timeout)
}
