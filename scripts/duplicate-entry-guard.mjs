import assert from 'node:assert/strict'

export const DUPLICATE_ENTRY_STEPS=Object.freeze([
 'dirty-note','request-settings','original-dialog','cancel','cancelled-note',
 'request-settings','original-dialog','discard','accepted-settings'
])

// The installed App guards leaving Notes, before Settings (and its child) mounts.
// Exercise only the original visible decisions; never dismiss or bypass them.
export async function exerciseDuplicateEntryGuard(io){
 const steps=[]
 const state=async(label,expected)=>{
  const value=await io.readState()
  for(const [k,v]of Object.entries(expected))assert.equal(value[k],v,label+': '+k)
  assert.equal(value.bodyUnchanged,true,label+': saved body changed')
  steps.push(label)
 }
 const note={workspace:'notes',dialog:false,dirty:true,draftPresent:true,titleUnchanged:true}
 await state('dirty-note',note)
 const request=async()=>{
  steps.push('request-settings');await io.requestSettings();await io.waitDialog()
  await state('original-dialog',{...note,dialog:true})
 }
 await request();await io.captureDialog()
 steps.push('cancel');await io.choose('取消');await io.waitDialogClosed()
 await state('cancelled-note',note)
 await io.cancelled()
 await request();steps.push('discard');await io.choose('不保存');await io.waitDialogClosed();await io.waitSettings()
 await state('accepted-settings',{workspace:'settings',dialog:false,dirty:false})
 const result={owner:'notes-to-settings',steps,originalCancel:true,originalDiscard:true,bodyUnchanged:true}
 validateDuplicateEntryGuard(result)
 return result
}
export function validateDuplicateEntryGuard(value){
 assert.deepEqual(value,{owner:'notes-to-settings',steps:DUPLICATE_ENTRY_STEPS,originalCancel:true,originalDiscard:true,bodyUnchanged:true})
 return true
}
