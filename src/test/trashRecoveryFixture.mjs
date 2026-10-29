import { recoveryPlan } from '../services/trashRecovery.mjs'
export const recoveryRow=(id,title,is_folder=false,parent_id='',extra={})=>({id,title,parent_id,is_folder,is_deleted:true,sort_order:0,updated_at:1,deleted_at:10,...extra})
export const recoveryFixture=(items=[recoveryRow('live','现存目录',true,'',{is_deleted:false,deleted_at:0}),recoveryRow('gone','旧目录',true,'live'),recoveryRow('note','旧笔记',false,'gone')],revision=1)=>({version:1,complete:true,revision:BigInt(revision).toString(16).padStart(64,'0'),items:items.toSorted((a,b)=>a.id<b.id?-1:1)})
export function recoveryApply(before,intent){
 const plan=recoveryPlan(before,intent.ids,intent.mode,intent.parent_id),affected=new Map(plan.map(r=>[r.id,r])),orders=new Map()
 let max=before.items.reduce((n,r)=>!r.is_deleted&&r.parent_id===intent.parent_id?Math.max(n,r.sort_order):n,0)
 if(intent.mode==='target')for(const id of intent.ids){max+=1000;orders.set(id,max)}
 return {...before,revision:(BigInt('0x'+before.revision)+1n).toString(16).padStart(64,'0'),items:before.items.map(row=>affected.has(row.id)?{...row,is_deleted:false,deleted_at:0,updated_at:10,parent_id:affected.get(row.id).parent_id,sort_order:orders.has(row.id)?orders.get(row.id):row.sort_order}:{...row})}
}
export function recoveryReceipt(before,intent){const snapshot=recoveryApply(before,intent);return{request_id:intent.request_id,before_revision:before.revision,applied_ids:intent.ids,restored_ids:recoveryPlan(before,intent.ids,intent.mode,intent.parent_id).map(r=>r.id),snapshot}}
