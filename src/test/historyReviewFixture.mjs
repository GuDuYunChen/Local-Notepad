import { createHash } from 'node:crypto'
import { comparisonFixture, comparisonIndexFixture } from './noteComparisonFixture.mjs'
const hash=text=>createHash('sha256').update(text).digest('hex')
export { comparisonIndexFixture as historyIndexFixture }
export function historyReviewFixture(versionId=null,{file='a',count=3,body='one\ncurrent\nend\n',old='one\nhistorical\nend\n'}={}){
 const current=comparisonFixture([body,''],[file,'other']).notes[0]
 const versions=Array.from({length:count},(_,i)=>({id:count-i,file_id:file,title:'历史标题 '+(count-i),created_at:100-i,content_bytes:Buffer.byteLength(old)}))
 const selected=versionId===null?null:{...versions.find(v=>v.id===versionId),content:old,content_hash:hash(old)}
 return {version:1,complete:true,captured_at:1000,revision:hash(JSON.stringify([current,versions,selected])),current,versions,selected,total:count}
}
