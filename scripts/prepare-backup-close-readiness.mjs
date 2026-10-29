import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export const ORIGINAL_DRIVER='a7382f2db196f7e1ab94ba48ad3736b16221d9a7'
// Read-only browser observation. Never cancel animations, change styles, focus,
// viewport, timers or application state. The original click remains the only input.
export async function observeBackupCloseReadiness(){
 const selector='.backup-center-modal button[aria-label="关闭备份中心"]'
 const sample=()=>{
  const owners=document.querySelectorAll('.backup-center-modal'),buttons=document.querySelectorAll(selector)
  if(owners.length!==1||buttons.length!==1)return null
  const owner=owners[0],button=buttons[0]
  if(!button.isConnected||button.disabled||!owner.contains(button)||button.closest('[inert]')||owner.querySelector('[aria-busy="true"]'))return null
  for(let n=button;n;n=n.parentElement){
   const style=getComputedStyle(n)
   if(n.hidden||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return null
   if(n.getAnimations().some(a=>a.pending||a.playState==='running'||a.playState==='paused'))return null
  }
  const b=button.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2
  const rect={left:b.left,top:b.top,right:b.right,bottom:b.bottom}
  if(!Object.values(rect).every(Number.isFinite)||!(b.width>0&&b.height>0&&b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight)||!button.contains(document.elementFromPoint(x,y)))return null
  return{button,rect,width:innerWidth,height:innerHeight}
 }
 const first=sample(),started=performance.now();if(!first)return null
 let last=first
 for(let i=0;i<3;i++){
  await new Promise(resolve=>requestAnimationFrame(resolve));last=sample()
  if(!last||last.button!==first.button||last.width!==first.width||last.height!==first.height||Object.keys(first.rect).some(k=>Math.abs(first.rect[k]-last.rect[k])>0.1))return null
 }
 return{selector,before:first.rect,after:last.rect,width:last.width,height:last.height,frames:3,elapsedMs:performance.now()-started,activeAnimations:0,backupBusy:false,hit:true}
}
export function verifyBackupCloseWitness(report){
 const r=report.backupCloseReadiness;assert.ok(r)
 assert.equal(r.selector,'.backup-center-modal button[aria-label="关闭备份中心"]')
 assert.equal(r.frames,3);assert.ok(Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0)
 assert.equal(r.activeAnimations,0);assert.equal(r.backupBusy,false);assert.equal(r.hit,true)
 for(const k of ['width','height'])assert.ok(Number.isFinite(r[k])&&r[k]>0)
 for(const k of ['left','top','right','bottom']){assert.ok(Number.isFinite(r.before[k])&&Number.isFinite(r.after[k]));assert.ok(Math.abs(r.before[k]-r.after[k])<=0.1)}
 assert.ok(r.after.left>=0&&r.after.top>=0&&r.after.right>r.after.left&&r.after.bottom>r.after.top&&r.after.right<=r.width&&r.after.bottom<=r.height)
 assert.equal(r.originalClickCount,1);assert.equal(r.normalCloseObserved,true)
 assert.equal(report.destinations.filter(x=>x.id==='backup'&&x.accepted&&x.launcherClosed).length,1)
 return true
}
export function buildBackupCloseDriver(original){
 assert.equal(blob(original),ORIGINAL_DRIVER,'Unreviewed original local-actions driver')
 const anchor="  if(closeLabel){await click(selector+' button[aria-label='+q(closeLabel)+']');await gone(selector);"
 const updated="  if(closeLabel){if(id==='backup'){report.backupCloseReadiness=await until(()=>evaluate('('+observeBackupCloseReadiness.toString()+')()'),'Backup close button has not settled');save()}await click(selector+' button[aria-label='+q(closeLabel)+']');await gone(selector);if(id==='backup'){Object.assign(report.backupCloseReadiness,{originalClickCount:1,normalCloseObserved:true});verifyBackupCloseWitness(report);save()}"
 assert.equal(original.split(anchor).length,2);assert.equal(original.includes(updated),false)
 const additions='\n// 2F112 verifier-only readiness; product and original click unchanged.\n'+observeBackupCloseReadiness.toString()+'\n'+verifyBackupCloseWitness.toString()+'\n'
 const next=original.replace(anchor,updated)+additions
 assert.equal(next.slice(0,-additions.length).replace(updated,anchor),original,'Original targets/clicks/assertions changed')
 return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86')
 const root=fileURLToPath(new URL('../',import.meta.url)),file=path.join(root,'scripts/local-actions-desktop-driver.mjs'),out=path.join(root,'test-results/installer-lifecycle/backup-close-preparation')
 const before=readFileSync(file,'utf8').replace(/\r\n/g,'\n'),after=buildBackupCloseDriver(before)
 mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'local-actions-desktop-driver.mjs.before.txt'),before,{flag:'wx'});writeFileSync(path.join(out,'local-actions-desktop-driver.mjs'),after,{flag:'wx'});writeFileSync(file,after)
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,before:blob(before),after:blob(after),originalDriverRecoveredByExactInverse:true,originalClickCount:1,clickRetries:0,productModified:false,nativeAcceptanceClaimed:false},null,2)+'\n',{flag:'wx'})
}
