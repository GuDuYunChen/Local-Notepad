import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export const RETAINED_109=Object.freeze({
 "appearance-desktop-evidence.mjs": {
  "sha": "d2d6e5026d5413344fe99c54209311b107f892db",
  "version": "4.238.0",
  "count": 1,
  "after": "72d985df723073ac4586a72d13e81efeafca8f00"
 },
 "appearance-desktop-evidence.node.mjs": {
  "sha": "5d680e1cdfd61ae71a11e5dc01c973d422cacd95",
  "version": "4.238.0",
  "count": 2,
  "after": "bcfd9678b8008663c17a892acb658c0be6f24ede"
 },
 "attachment-audit-desktop-evidence.mjs": {
  "sha": "8a52afa7ec834de477bc0890068d91b73735f5a9",
  "version": "4.241.0",
  "count": 1,
  "after": "9863cf7b42c09427bdac5bc9ba2eec6ce5a1518f"
 },
 "attachment-audit-desktop-evidence.node.mjs": {
  "sha": "34df031ee24c1e3ea28430a49239f8a17bb73fd9",
  "version": "4.241.0",
  "count": 2,
  "after": "bd6c89919917bbf7c238ce6af5c0fcf9026f5b67"
 },
 "library-statistics-desktop-evidence.mjs": {
  "sha": "67d7685a861448c708df868cd1088669aafcff29",
  "version": "4.240.0",
  "count": 1,
  "after": "0f19ae557f1ce7444e8d3f5446c9366ec5436aa7"
 },
 "library-statistics-desktop-evidence.node.mjs": {
  "sha": "c27c2fa62a05ab2b517b3cec1cd3a437854d2f62",
  "version": "4.240.0",
  "count": 2,
  "after": "d72ac135b8c27dde0e14afe429245bf6c44f08ac"
 },
 "prepare-appearance-verifier.mjs": {
  "sha": "bab43f88f99ff76453ddeea91d92bf33fb3e12fb",
  "version": "4.238.0",
  "count": 5,
  "head": "32e3a8aa2212a95c5707797f3d3afb2b3c55b24e",
  "after": "545d5d1b60b1d0bb5f9922a13fdd27c849aca782"
 },
 "prepare-attachment-audit-verifier.mjs": {
  "sha": "9529c667f9aaed9d69d38bd3e740325e2a77b5d6",
  "version": "4.241.0",
  "count": 1,
  "head": "ed96da5efa6ae8cd6e0af591a9b6e7349d4406c6",
  "runnerBefore": "fdcaa659a6cfc8eb5e279d430d6d23d42e6a6e68",
  "runnerAfter": "1d717c8f58ac07cb4a7dd77819d5d2b9127a56f2",
  "after": "69559c6ffb816b4813176a18d1d22b8e49056298"
 },
 "prepare-library-statistics-verifier.mjs": {
  "sha": "d3a3538d53430ff723fffaeafb2eb09526cf1186",
  "version": "4.240.0",
  "count": 1,
  "head": "9ad6be13bc2c7dee0902c7464724b23ad535b3e3",
  "runnerBefore": "b4ac535ad4f30ebb0458d106ce88eb941d0fddf6",
  "runnerAfter": "e19d16373fd3600e0c99719279e0c47cd880ebf0",
  "after": "6c64129bc3a93ebdec8a4986564a114760f95582"
 },
 "prepare-tag-workspace-verifier.mjs": {
  "sha": "325c01296995f6d2587a0fe10da59aef56176b18",
  "version": "4.239.0",
  "count": 1,
  "head": "568c229706a26973163bde1efc553fc2d900b1da",
  "after": "2a48698a98c1659bba43521cf08c1ebfd26a73d2"
 },
 "tag-workspace-desktop-evidence.mjs": {
  "sha": "5783e1fa6ba0638f1db58e7225cee9c493cdcc23",
  "version": "4.239.0",
  "count": 1,
  "after": "364a36ad6d2e7c83cae18ccfabbd457a659c64d5"
 },
 "tag-workspace-desktop-evidence.node.mjs": {
  "sha": "5541e7da4011cfd9809c299f2becdc56b185d60f",
  "version": "4.239.0",
  "count": 2,
  "after": "4de1ebb8f9903daa7a601eb2111049ebafbc457a"
 }
})
export function adaptRetained109(file,original){
 const spec=RETAINED_109[file];assert.ok(spec,'Unlisted retained source');assert.equal(blob(original),spec.sha,'Unreviewed retained source')
 assert.equal(original.split(spec.version).length-1,spec.count);assert.equal(original.includes('4.242.0'),false)
 let next=original.replaceAll(spec.version,'4.242.0')
 if(spec.head){assert.equal(next.split(spec.head).length,2);next=next.replace(spec.head,'754b97e696b4075038e288b92c4740a0142ec4a2')}
 if(spec.runnerBefore){assert.equal(next.split(spec.runnerBefore).length,2);next=next.replace(spec.runnerBefore,spec.runnerAfter)}
 let inverse=next;if(spec.runnerBefore)inverse=inverse.replace(spec.runnerAfter,spec.runnerBefore);if(spec.head)inverse=inverse.replace('754b97e696b4075038e288b92c4740a0142ec4a2',spec.head);inverse=inverse.replaceAll('4.242.0',spec.version)
 assert.equal(inverse,original,'Retained assertions or process policies changed');assert.equal(blob(next),spec.after);return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url));assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86')
 const out=path.join(root,'test-results/installer-lifecycle/retained-109-preparation');mkdirSync(out,{recursive:true});const records=[]
 for(const name of Object.keys(RETAINED_109)){const file=path.join(root,'scripts',name),original=readFileSync(file,'utf8').replace(/\r\n/g,'\n'),next=adaptRetained109(name,original);writeFileSync(path.join(out,name+'.before.txt'),original,{flag:'wx'});writeFileSync(file,next);records.push({file:name,before:blob(original),after:blob(next),inverseBytesEqual:true,changes:'release/source identity only'})}
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,productionChanged:false,nativeExecutionClaimed:false,records},null,2)+'\n',{flag:'wx'})
}
