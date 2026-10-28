import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export const RETAINED_APPEARANCE=Object.freeze({
 'appearance-desktop-evidence.mjs':['d2d6e5026d5413344fe99c54209311b107f892db',1,'1f12840ff0275ef8c2c53c24712134f37e341eea'],
 'appearance-desktop-evidence.node.mjs':['5d680e1cdfd61ae71a11e5dc01c973d422cacd95',2,'62c87ff16d939b94ecc66b5b78074e5ce600845a'],
 'prepare-appearance-verifier.mjs':['bab43f88f99ff76453ddeea91d92bf33fb3e12fb',5,'f91814c3ba059ec83a999c2c9cafe09df967742f'],
})
export function adaptRetainedAppearance(file,original){
 const spec=RETAINED_APPEARANCE[file];assert.ok(spec,'Unlisted retained verifier');assert.equal(blob(original),spec[0],'Unreviewed appearance verifier');assert.equal(original.split('4.238.0').length-1,spec[1]);assert.equal(original.includes('4.239.0'),false)
 let next=original.replaceAll('4.238.0','4.239.0')
 const oldHead='32e3a8aa2212a95c5707797f3d3afb2b3c55b24e',newHead='568c229706a26973163bde1efc553fc2d900b1da'
 if(file==='prepare-appearance-verifier.mjs'){assert.equal(next.split(oldHead).length,2);next=next.replace(oldHead,newHead)}
 assert.equal(next.replaceAll(newHead,oldHead).replaceAll('4.239.0','4.238.0'),original,'Original appearance assertions changed');assert.equal(blob(next),spec[2]);return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url));assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86')
 const out=path.join(root,'test-results/installer-lifecycle/retained-local-preparation');mkdirSync(out,{recursive:true});const records=[]
 for(const name of Object.keys(RETAINED_APPEARANCE)){const file=path.join(root,'scripts',name),original=readFileSync(file,'utf8').replace(/\r\n/g,'\n'),next=adaptRetainedAppearance(name,original);writeFileSync(path.join(out,name+'.before.txt'),original,{flag:'wx'});writeFileSync(file,next);records.push({file:name,before:blob(original),after:blob(next),inverseBytesEqual:true,changes:'version and exact product binding only'})}
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,productionChanged:false,nativeExecutionClaimed:false,records},null,2)+'\n',{flag:'wx'})
}
