import { dailyRequest } from './dailyNotes.mjs'
export const STATISTICS_LIMIT = 20000
export const STATISTICS_PAGE_SIZE = 50
const fail = () => { throw new Error('统计响应不完整或相互矛盾，未采用部分结果。请重新统计。') }
const int = (v, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= 0 && v <= max
const text = (v, max) => typeof v === 'string' && v.length <= max
const date = seconds => new Date(seconds * 1000).toISOString().slice(0, 10)
export function validateLibraryStatistics(raw) {
  if (!raw || raw.version !== 1 || raw.complete !== true || !/^[a-f0-9]{64}$/.test(raw.revision || '') || !int(raw.captured_at, 253402300799) || raw.day_utc !== date(raw.captured_at) || !Array.isArray(raw.notes) || raw.notes.length > STATISTICS_LIMIT || !Array.isArray(raw.activity) || raw.activity.length !== 30) fail()
  const keys = ['notes','folders','templates','trash','tags','unused_tags','tagged','pinned','no_text','unsupported','characters','content_bytes']
  const totals = {}; for (const key of keys) { if (!int(raw.totals?.[key])) fail(); totals[key] = raw.totals[key] }
  if (totals.tags > 500 || totals.unused_tags > totals.tags || totals.notes + totals.folders + totals.templates + totals.trash > STATISTICS_LIMIT) fail()
  const seen = new Set(), sum = { notes: 0, tagged: 0, pinned: 0, no_text: 0, unsupported: 0, characters: 0, content_bytes: 0 }
  const notes = raw.notes.map(n => {
    if (!n || !text(n.id,128) || !n.id || n.id.trim() !== n.id || /[\u0000-\u001f\u007f]/.test(n.id) || seen.has(n.id) || !text(n.title,4000) || !text(n.folder,4000) || !int(n.created_at,253402300799) || !int(n.updated_at,253402300799) || typeof n.pinned !== 'boolean' || typeof n.text_supported !== 'boolean' || !int(n.tag_count,totals.tags) || !int(n.characters,16*1024*1024) || !int(n.content_bytes,16*1024*1024) || (!n.text_supported && n.characters !== 0)) fail()
    seen.add(n.id); sum.notes++; sum.tagged += Number(n.tag_count > 0); sum.pinned += Number(n.pinned); sum.no_text += Number(n.text_supported && n.characters === 0); sum.unsupported += Number(!n.text_supported); sum.characters += n.characters; sum.content_bytes += n.content_bytes
    return Object.freeze({ id:n.id,title:n.title,folder:n.folder,created_at:n.created_at,updated_at:n.updated_at,pinned:n.pinned,tag_count:n.tag_count,characters:n.characters,content_bytes:n.content_bytes,text_supported:n.text_supported })
  })
  for (const key of Object.keys(sum)) if (totals[key] !== sum[key]) fail()
  if (sum.content_bytes > 64*1024*1024 || JSON.stringify(notes).length > 8*1024*1024) fail()
  const day = Date.parse(raw.day_utc + 'T00:00:00Z')
  const activity = raw.activity.map((a,i) => {
    const expected = new Date(day - (29-i)*86400000).toISOString().slice(0,10)
    if (!a || a.day !== expected || !int(a.created,notes.length) || !int(a.updated,notes.length)) fail()
    return {day:a.day,created:a.created,updated:a.updated}
  })
  const counts = new Map(activity.map(a=>[a.day,{created:0,updated:0}]))
  for (const n of notes) { const a = counts.get(date(n.created_at)), b = counts.get(date(n.updated_at)); if (a) a.created++; if (b) b.updated++ }
  for (const a of activity) { const b = counts.get(a.day); if (a.created !== b.created || a.updated !== b.updated) fail(); Object.freeze(a) }
  return Object.freeze({version:1,complete:true,revision:raw.revision,captured_at:raw.captured_at,day_utc:raw.day_utc,totals:Object.freeze(totals),activity:Object.freeze(activity),notes:Object.freeze(notes)})
}
export async function readLibraryStatistics(load, signal, budget = 10000) {
  const raw = await dailyRequest(load,'/api/library-statistics',{signal},budget)
  if (signal?.aborted) throw new Error('统计已取消')
  return validateLibraryStatistics(raw)
}
export function statisticsNotes(snapshot,{query='',filter='all',sort='updated'}={}) {
  if (!text(query,128) || !['all','untagged','pinned','no-text','unsupported'].includes(filter) || !['updated','characters','title'].includes(sort)) throw new Error('统计筛选参数无效')
  const q=query.trim().normalize('NFC').toLocaleLowerCase()
  return snapshot.notes.filter(n => (!q || n.title.normalize('NFC').toLocaleLowerCase().includes(q)) && (filter==='all' || filter==='untagged' && n.tag_count===0 || filter==='pinned' && n.pinned || filter==='no-text' && n.text_supported && n.characters===0 || filter==='unsupported' && !n.text_supported)).sort((a,b)=> (sort==='updated' ? b.updated_at-a.updated_at : sort==='characters' ? Number(b.text_supported)-Number(a.text_supported) || b.characters-a.characters : a.title.localeCompare(b.title)) || a.id.localeCompare(b.id))
}
export function statisticsReport(snapshot, options, includeTitles = false) {
  const value=validateLibraryStatistics(snapshot), filtered=statisticsNotes(value,options)
  return JSON.stringify({format:'local-notepad-library-statistics',version:1,revision:value.revision,captured_at:value.captured_at,day_utc:value.day_utc,
    scope:'saved-active-notes-only',character_metric:'searchable Unicode characters excluding whitespace; not words',
    activity_metric:'creation and latest modification dates in UTC; not edit-event counts',
    excludes:['unsaved drafts','trash bodies','template bodies','attachment bytes'],totals:value.totals,activity:value.activity,
    selection:{query:includeTitles===true?(options.query||''):'',query_omitted:includeTitles!==true&&Boolean(options.query),filter:options.filter||'all',sort:options.sort||'updated',count:filtered.length},
    contains_titles:includeTitles===true,...(includeTitles===true?{notes:filtered}:{})},null,2)+'\n'
}
export function downloadStatisticsReport(snapshot,options,includeTitles=false) {
  const content=statisticsReport(snapshot,options,includeTitles)
  let url,anchor
  try { url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));anchor=document.createElement('a');anchor.href=url;anchor.download='local-notepad-statistics.json';document.body.appendChild(anchor);anchor.click() }
  finally { anchor?.remove();if(url)setTimeout(()=>URL.revokeObjectURL(url),1000) }
}
