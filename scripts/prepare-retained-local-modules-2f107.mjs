import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export const RETAINED_107=Object.freeze({
 'appearance-desktop-evidence.mjs':['d2d6e5026d5413344fe99c54209311b107f892db','4.238.0'],
 'appearance-desktop-evidence.node.mjs':['5d680e1cdfd61ae71a11e5dc01c973d422cacd95','4.238.0'],
 'prepare-appearance-verifier.mjs':['bab43f88f99ff76453ddeea91d92bf33fb3e12fb','4.238.0','32e3a8aa2212a95c5707797f3d3afb2b3c55b24e'],
 'tag-workspace-desktop-evidence.mjs':['5783e1fa6ba0638f1db58e7225cee9c493cdcc23','4.239.0'],
 'tag-workspace-desktop-evidence.node.mjs':['5541e7da4011cfd9809c299f2becdc56b185d60f','4.239.0'],
 'prepare-tag-workspace-verifier.mjs':['325c01296995f6d2587a0fe10da59aef56176b18','4.239.0','568c229706a26973163bde1efc553fc2d900b1da'],
})
export function adaptRetained107(name,original){
 const spec=RETAINED_107[name];assert.ok(spec,'Unlisted retained source');assert.equal(blob(original),spec[0],'Retained source identity changed');assert.equal(original.includes('4.240.0'),false);assert.ok(original.includes(spec[1]))
 let next=original.replaceAll(spec[1],'4.240.0');const head='9ad6be13bc2c7dee0902c7464724b23ad535b3e3'
 if(spec[2]){assert.equal(original.split(spec[2]).length,2);assert.equal(original.includes(head),false);next=next.replace(spec[2],head)}
 let inverse=next;if(spec[2])inverse=inverse.replace(head,spec[2]);inverse=inverse.replaceAll('4.240.0',spec[1]);assert.equal(inverse,original,'Original assertions changed');return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url));assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86');assert.equal(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,'4.240.0')
 const out=path.join(root,'test-results/installer-lifecycle/retained-107-preparation');mkdirSync(out,{recursive:true});const records=[]
 for(const name of Object.keys(RETAINED_107)){const f=path.join(root,'scripts',name),original=readFileSync(f,'utf8').replace(/\r\n/g,'\n'),next=adaptRetained107(name,original);writeFileSync(path.join(out,name+'.before.txt'),original,{flag:'wx'});writeFileSync(f,next);records.push({file:name,before:blob(original),after:blob(next),inverseBytesEqual:true,changes:'Exact target version and product HEAD only'})}
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,productionChanged:false,nativeAcceptanceClaimed:false,records},null,2)+'\n',{flag:'wx'})
}
