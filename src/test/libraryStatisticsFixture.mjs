export function libraryStatisticsFixture(count=2) {
 const captured=Date.parse('2026-10-28T12:00:00Z')/1000
 const notes=Array.from({length:count},(_,i)=>({id:`note-${i}`,title:`笔记 ${i}`,folder:'根目录',created_at:captured,updated_at:captured-i,pinned:i===0,tag_count:i===0?1:0,characters:i===1?0:10,content_bytes:i===1?0:20,text_supported:true}))
 return {version:1,complete:true,revision:'a'.repeat(64),captured_at:captured,day_utc:'2026-10-28',totals:{notes:count,folders:0,templates:0,trash:0,tags:1,unused_tags:count?0:1,tagged:count?1:0,pinned:count?1:0,no_text:count>1?1:0,unsupported:0,characters:Math.max(0,count-(count>1?1:0))*10,content_bytes:Math.max(0,count-(count>1?1:0))*20},notes,activity:Array.from({length:30},(_,i)=>({day:new Date((captured-29*86400+i*86400)*1000).toISOString().slice(0,10),created:i===29?count:0,updated:i===29?count:0}))}
}
