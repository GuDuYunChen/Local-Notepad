export function attachmentAuditFixture(count=4){
 const notes=[{id:'note-a',title:'来源笔记',scope:'active',parsed:true,rejected_urls:0},{id:'trash',title:'回收站来源',scope:'trash',parsed:true,rejected_urls:0},{id:'template',title:'模板来源',scope:'template',parsed:false,rejected_urls:1}]
 const items=Array.from({length:count},(_,i)=>({name:`asset-${String(i).padStart(3,'0')}.png`,state:['available','missing','unreferenced','blocked'][i%4],bytes:[12,0,20,0][i%4],notes:i%4<2?notes.map(n=>n.id):[]}))
 const totals={files:0,bytes:0,referenced:0,unreferenced:0,missing:0,blocked:0,notes:3,unparsed:1,rejected_urls:1,references:0}
 for(const i of items){if(['available','unreferenced'].includes(i.state)){totals.files++;totals.bytes+=i.bytes};totals[i.state==='available'?'referenced':i.state]++;totals.references+=i.notes.length}
 return {version:1,complete:true,revision:'a'.repeat(64),captured_at:1793188800,totals,items,notes}
}
