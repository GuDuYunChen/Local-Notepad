import { createHash } from 'node:crypto'
const hash = text => createHash('sha256').update(text).digest('hex')
export const lexicalComparisonBody = text => JSON.stringify({root:{children:[{children:[{type:'text',text,version:1,detail:0,format:0,mode:'normal',style:''}],direction:null,format:'',indent:0,type:'paragraph',version:1}],direction:null,format:'',indent:0,type:'root',version:1}})
export function comparisonFixture(contents = ['one\nleft\nend\n', 'one\nright\nend\n'], ids = ['a','b']) {
 const notes=contents.map((content,i)=>({id:ids[i],title:'比较笔记 '+ids[i]+'.md',parent_id:'',folder:'根目录',updated_at:10+i,content,content_hash:hash(content),content_bytes:Buffer.byteLength(content)}))
 return {version:1,complete:true,captured_at:100,revision:hash(JSON.stringify(notes)),notes,raw_equal:contents[0]===contents[1]}
}
export function comparisonIndexFixture(count=2){return {version:1,complete:true,revision:'a'.repeat(64),hidden_count:2,items:Array.from({length:count},(_,i)=>({id:i<2?['a','b'][i]:'note-'+i,title:'比较笔记 '+(i<2?['a','b'][i]:'note-'+i)+'.md',parent_id:'',is_folder:false,sort_order:0,updated_at:i<2?10+i:1,hidden_children:0}))}}
