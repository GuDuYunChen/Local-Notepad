import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export const RETAINED_110=Object.freeze({
 "appearance-desktop-evidence.mjs": {
  "before": "d2d6e5026d5413344fe99c54209311b107f892db",
  "replacements": [
   [
    "4.238.0",
    "4.243.0",
    1
   ]
  ],
  "after": "a659cee9442d00600e3b8f1e6564986eb0f9b279"
 },
 "appearance-desktop-evidence.node.mjs": {
  "before": "5d680e1cdfd61ae71a11e5dc01c973d422cacd95",
  "replacements": [
   [
    "4.238.0",
    "4.243.0",
    2
   ]
  ],
  "after": "6077bad2f5a56452d5c3a5201f9bf0f84b4b28e7"
 },
 "prepare-appearance-verifier.mjs": {
  "before": "bab43f88f99ff76453ddeea91d92bf33fb3e12fb",
  "replacements": [
   [
    "4.238.0",
    "4.243.0",
    5
   ],
   [
    "32e3a8aa2212a95c5707797f3d3afb2b3c55b24e",
    "1e6742fe7032b17bbc6688605ce4a8c18c254967",
    1
   ]
  ],
  "after": "2c34cbb1630360c87c0ffdef18d8acb39d44c04e"
 },
 "tag-workspace-desktop-evidence.mjs": {
  "before": "5783e1fa6ba0638f1db58e7225cee9c493cdcc23",
  "replacements": [
   [
    "4.239.0",
    "4.243.0",
    1
   ]
  ],
  "after": "bc5e4a014c3f4f899bbc9195e7add4baff418313"
 },
 "tag-workspace-desktop-evidence.node.mjs": {
  "before": "5541e7da4011cfd9809c299f2becdc56b185d60f",
  "replacements": [
   [
    "4.239.0",
    "4.243.0",
    2
   ]
  ],
  "after": "6deef2d99b3c5f7931637384ee6f8de498647970"
 },
 "prepare-tag-workspace-verifier.mjs": {
  "before": "325c01296995f6d2587a0fe10da59aef56176b18",
  "replacements": [
   [
    "4.239.0",
    "4.243.0",
    1
   ],
   [
    "568c229706a26973163bde1efc553fc2d900b1da",
    "1e6742fe7032b17bbc6688605ce4a8c18c254967",
    1
   ]
  ],
  "after": "f3ecc0380abf2a4f39e3bfad2d21a2255ed1092f"
 },
 "library-statistics-desktop-evidence.mjs": {
  "before": "67d7685a861448c708df868cd1088669aafcff29",
  "replacements": [
   [
    "4.240.0",
    "4.243.0",
    1
   ]
  ],
  "after": "1a7f283799241bb0d404a255fa0dee42e7a06518"
 },
 "library-statistics-desktop-evidence.node.mjs": {
  "before": "c27c2fa62a05ab2b517b3cec1cd3a437854d2f62",
  "replacements": [
   [
    "4.240.0",
    "4.243.0",
    2
   ]
  ],
  "after": "ea5345d37a99a4aa861d2bd9297d758c95746090"
 },
 "prepare-library-statistics-verifier.mjs": {
  "before": "d3a3538d53430ff723fffaeafb2eb09526cf1186",
  "replacements": [
   [
    "4.240.0",
    "4.243.0",
    1
   ],
   [
    "9ad6be13bc2c7dee0902c7464724b23ad535b3e3",
    "1e6742fe7032b17bbc6688605ce4a8c18c254967",
    1
   ],
   [
    "b4ac535ad4f30ebb0458d106ce88eb941d0fddf6",
    "cee1bdef1ae6fe875c844cf59779aad92bea1b4d",
    1
   ]
  ],
  "after": "3b9be19ac6fa594d456e41a12e2ffeb7f28c16f0"
 },
 "attachment-audit-desktop-evidence.mjs": {
  "before": "8a52afa7ec834de477bc0890068d91b73735f5a9",
  "replacements": [
   [
    "4.241.0",
    "4.243.0",
    1
   ]
  ],
  "after": "54afaeeda806a50d83c9c0f63275219f1ea2a423"
 },
 "attachment-audit-desktop-evidence.node.mjs": {
  "before": "34df031ee24c1e3ea28430a49239f8a17bb73fd9",
  "replacements": [
   [
    "4.241.0",
    "4.243.0",
    2
   ]
  ],
  "after": "88778c61634d9a7734d9988973d812302f4f845c"
 },
 "prepare-attachment-audit-verifier.mjs": {
  "before": "9529c667f9aaed9d69d38bd3e740325e2a77b5d6",
  "replacements": [
   [
    "4.241.0",
    "4.243.0",
    1
   ],
   [
    "ed96da5efa6ae8cd6e0af591a9b6e7349d4406c6",
    "1e6742fe7032b17bbc6688605ce4a8c18c254967",
    1
   ],
   [
    "fdcaa659a6cfc8eb5e279d430d6d23d42e6a6e68",
    "163e281d9412564797173159e8815a7f1d1ef724",
    1
   ]
  ],
  "after": "6285b5802f1fd58ab50aa897f8244cae2e9dc1d6"
 },
 "task-center-desktop-evidence.mjs": {
  "before": "cfc194077d9f4e5d4ee356b59e8de78b9aba7c19",
  "replacements": [
   [
    "4.242.0",
    "4.243.0",
    1
   ]
  ],
  "after": "295b8d7472dde75e98e55f9f9086f4ec2f4a78b9"
 },
 "task-center-desktop-evidence.node.mjs": {
  "before": "d505edbe8617bd638ae2b2a64250015342c2862b",
  "replacements": [
   [
    "4.242.0",
    "4.243.0",
    2
   ]
  ],
  "after": "15c24fbb9b13eeea44a2b28fc2345540a43c1086"
 },
 "prepare-task-center-verifier.mjs": {
  "before": "c9d52eaf8e96098e35201dc50bba8e789545dfcc",
  "replacements": [
   [
    "4.242.0",
    "4.243.0",
    1
   ],
   [
    "1535cbe23b7d6c22e701d4ffd1c08fa8b5c9fc39",
    "1e6742fe7032b17bbc6688605ce4a8c18c254967",
    1
   ],
   [
    "e287b5a65a08de4c22db95d3234f459fc01b4889",
    "218ed5ce4540520def56d5ea89251a9c9a44f29b",
    1
   ]
  ],
  "after": "9b3f88ccad2c9abb2bc32bce53d230b1cebd4b74"
 },
 "prepare-recent-reload-readiness.mjs": {
  "before": "70bc8655517e9715c4e2979f6c67605bbc39c228",
  "replacements": [
   [
    "4.242.0",
    "4.243.0",
    1
   ],
   [
    "6e4ea504cc71129acdeb8c125b3098e4abb21994",
    "2ff241a3ed752d28e7f4cb7a2910ea6b5feda577",
    1
   ]
  ],
  "after": "81ec7a1d37b942e0596a4430388e0153aaae82db"
 }
})
export function adaptRetained110(file,original){
 const spec=RETAINED_110[file];assert.ok(spec,'Unlisted retained source');assert.equal(blob(original),spec.before,'Unreviewed original '+file)
 let next=original
 for(const[a,b,count]of spec.replacements){assert.equal(next.split(a).length-1,count);assert.equal(next.includes(b),false);next=next.replaceAll(a,b)}
 let inverse=next;for(const[a,b,count]of [...spec.replacements].reverse()){assert.equal(inverse.split(b).length-1,count);inverse=inverse.replaceAll(b,a)}
 assert.equal(inverse,original,'Retained policies or assertions changed');if(spec.after)assert.equal(blob(next),spec.after);return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url));assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86')
 const out=path.join(root,'test-results/installer-lifecycle/retained-110-preparation');mkdirSync(out,{recursive:true});const records=[]
 for(const name of Object.keys(RETAINED_110)){const file=path.join(root,'scripts',name),original=readFileSync(file,'utf8').replace(/\r\n/g,'\n'),next=adaptRetained110(name,original);writeFileSync(path.join(out,name+'.before.txt'),original,{flag:'wx'});writeFileSync(file,next);records.push({file:name,before:blob(original),after:blob(next),inverseBytesEqual:true,changes:'release/source identity only'})}
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,productionChanged:false,nativeExecutionClaimed:false,records},null,2)+'\n',{flag:'wx'})
}
