import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export const RETAINED_108=Object.freeze({
 "appearance-desktop-evidence.mjs": {
  "sha": "d2d6e5026d5413344fe99c54209311b107f892db",
  "version": "4.238.0",
  "count": 1,
  "after": "526c8ca2a843c23c5064558511a5a258362a2bb6"
 },
 "appearance-desktop-evidence.node.mjs": {
  "sha": "5d680e1cdfd61ae71a11e5dc01c973d422cacd95",
  "version": "4.238.0",
  "count": 2,
  "after": "068ccfb0aaa5f356d1240146061b7844c0a7665e"
 },
 "prepare-appearance-verifier.mjs": {
  "sha": "bab43f88f99ff76453ddeea91d92bf33fb3e12fb",
  "version": "4.238.0",
  "count": 5,
  "head": "32e3a8aa2212a95c5707797f3d3afb2b3c55b24e",
  "after": "68fc8cf9d81a466698eff120a79c8fb99b3ac2e8"
 },
 "prepare-tag-workspace-verifier.mjs": {
  "sha": "325c01296995f6d2587a0fe10da59aef56176b18",
  "version": "4.239.0",
  "count": 1,
  "head": "568c229706a26973163bde1efc553fc2d900b1da",
  "after": "d7434790a25a4b2c8e98401676a073668f239a84"
 },
 "tag-workspace-desktop-evidence.mjs": {
  "sha": "5783e1fa6ba0638f1db58e7225cee9c493cdcc23",
  "version": "4.239.0",
  "count": 1,
  "after": "e874fd101b1e210e90c0684a0d501b7508ca4e45"
 },
 "tag-workspace-desktop-evidence.node.mjs": {
  "sha": "5541e7da4011cfd9809c299f2becdc56b185d60f",
  "version": "4.239.0",
  "count": 2,
  "after": "0eb18537955bad9b4abf0df13229a2ef82be66d1"
 },
 "library-statistics-desktop-evidence.mjs": {
  "sha": "67d7685a861448c708df868cd1088669aafcff29",
  "version": "4.240.0",
  "count": 1,
  "after": "315e64e1f22f5bf582a957e7f743c68608ec8c3d"
 },
 "library-statistics-desktop-evidence.node.mjs": {
  "sha": "c27c2fa62a05ab2b517b3cec1cd3a437854d2f62",
  "version": "4.240.0",
  "count": 2,
  "after": "d956a5b3fef37a2b146e261b2bfc8d1c55afc6f0"
 },
 "prepare-library-statistics-verifier.mjs": {
  "sha": "d3a3538d53430ff723fffaeafb2eb09526cf1186",
  "version": "4.240.0",
  "count": 1,
  "head": "9ad6be13bc2c7dee0902c7464724b23ad535b3e3",
  "runnerBefore": "b4ac535ad4f30ebb0458d106ce88eb941d0fddf6",
  "runnerAfter": "e5c4564474a81452ef9f1a15717adf08a031962a",
  "after": "9886d54883634765439ab03d9ed67c9fa0557f01"
 }
})
export function adaptRetained108(file,original){
 const spec=RETAINED_108[file];assert.ok(spec,'Unlisted retained source');assert.equal(blob(original),spec.sha,'Unreviewed retained source')
 assert.equal(original.split(spec.version).length-1,spec.count);assert.equal(original.includes('4.241.0'),false)
 let next=original.replaceAll(spec.version,'4.241.0')
 if(spec.head){assert.equal(next.split(spec.head).length,2);next=next.replace(spec.head,'ed96da5efa6ae8cd6e0af591a9b6e7349d4406c6')}
 if(spec.runnerBefore){assert.equal(next.split(spec.runnerBefore).length,2);next=next.replace(spec.runnerBefore,spec.runnerAfter)}
 let inverse=next;if(spec.runnerBefore)inverse=inverse.replace(spec.runnerAfter,spec.runnerBefore);if(spec.head)inverse=inverse.replace('ed96da5efa6ae8cd6e0af591a9b6e7349d4406c6',spec.head);inverse=inverse.replaceAll('4.241.0',spec.version)
 assert.equal(inverse,original,'Retained assertions or process policies changed');assert.equal(blob(next),spec.after);return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url));assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86')
 const out=path.join(root,'test-results/installer-lifecycle/retained-108-preparation');mkdirSync(out,{recursive:true});const records=[]
 for(const name of Object.keys(RETAINED_108)){const file=path.join(root,'scripts',name),original=readFileSync(file,'utf8').replace(/\r\n/g,'\n'),next=adaptRetained108(name,original);writeFileSync(path.join(out,name+'.before.txt'),original,{flag:'wx'});writeFileSync(file,next);records.push({file:name,before:blob(original),after:blob(next),inverseBytesEqual:true,changes:'release/source identity only'})}
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,productionChanged:false,nativeExecutionClaimed:false,records},null,2)+'\n',{flag:'wx'})
}
