// Isolated schema fixtures; these are not native acceptance evidence.
export const folderRow = (id,title,is_folder=true,parent_id='',extra={}) => ({id,title,parent_id,is_folder,sort_order:1000,updated_at:1,hidden_children:0,...extra})
export const folderFixture = (items,revision=1,hidden_count=0) => ({version:1,complete:true,revision:revision.toString(16).padStart(64,'0'),hidden_count,items:items||[folderRow('a','来源'),folderRow('b','目标'),folderRow('empty','空目录'),folderRow('n','笔记甲',false,'a'),folderRow('n2','笔记乙',false,'a')]})
export const memoryFolderStorage = () => {const map=new Map();return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}}
export function applyFolderFixture(before,command){
 const after=structuredClone(before);after.revision=(parseInt(before.revision,16)+1).toString(16).padStart(64,'0')
 if(command.kind==='create')after.items.push(folderRow(command.ids[0],command.name,true,command.parent_id))
 if(command.kind==='rename')after.items.find(n=>n.id===command.ids[0]).title=command.name
 if(command.kind==='move')for(const id of command.ids){const n=after.items.find(n=>n.id===id);n.parent_id=command.parent_id;n.sort_order+=1000;n.updated_at+=1}
 if(command.kind==='trash-empty'){const removed=after.items.find(n=>n.id===command.ids[0]),parent=after.items.find(n=>n.id===removed.parent_id);if(parent)parent.hidden_children++;after.items=after.items.filter(n=>n.id!==removed.id);after.hidden_count++}
 return after
}
