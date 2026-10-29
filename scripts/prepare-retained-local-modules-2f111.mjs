import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
export const RETAINED_111=Object.freeze({
 "appearance-desktop-evidence.mjs": {
  "before": "d2d6e5026d5413344fe99c54209311b107f892db",
  "replacements": [
   [
    "4.238.0",
    "4.244.0",
    1
   ]
  ],
  "after": "1104e16adc5ef4686658bbbfe0f0ac6a83fb3158"
 },
 "appearance-desktop-evidence.node.mjs": {
  "before": "5d680e1cdfd61ae71a11e5dc01c973d422cacd95",
  "replacements": [
   [
    "4.238.0",
    "4.244.0",
    2
   ]
  ],
  "after": "8f78d84c5c4e1ae092c9c9ec5989bc12ef6afcd4"
 },
 "prepare-appearance-verifier.mjs": {
  "before": "bab43f88f99ff76453ddeea91d92bf33fb3e12fb",
  "replacements": [
   [
    "4.238.0",
    "4.244.0",
    5
   ],
   [
    "32e3a8aa2212a95c5707797f3d3afb2b3c55b24e",
    "f059280614b6df3a03025d8f2567417bd14f2839",
    1
   ]
  ],
  "after": "a757932f86938b4c87c9ccf00051a1fcff311cf1"
 },
 "tag-workspace-desktop-evidence.mjs": {
  "before": "5783e1fa6ba0638f1db58e7225cee9c493cdcc23",
  "replacements": [
   [
    "4.239.0",
    "4.244.0",
    1
   ]
  ],
  "after": "48473eb0c9fb0d533adcf96091de17d596d069f0"
 },
 "tag-workspace-desktop-evidence.node.mjs": {
  "before": "5541e7da4011cfd9809c299f2becdc56b185d60f",
  "replacements": [
   [
    "4.239.0",
    "4.244.0",
    2
   ]
  ],
  "after": "a5ff25aab79e6e7e6c0799e137c63b9f720e8767"
 },
 "prepare-tag-workspace-verifier.mjs": {
  "before": "325c01296995f6d2587a0fe10da59aef56176b18",
  "replacements": [
   [
    "4.239.0",
    "4.244.0",
    1
   ],
   [
    "568c229706a26973163bde1efc553fc2d900b1da",
    "f059280614b6df3a03025d8f2567417bd14f2839",
    1
   ]
  ],
  "after": "f1c9a6b87ac4c2a4b67bd9900abae4288aa5ec6a"
 },
 "library-statistics-desktop-evidence.mjs": {
  "before": "67d7685a861448c708df868cd1088669aafcff29",
  "replacements": [
   [
    "4.240.0",
    "4.244.0",
    1
   ]
  ],
  "after": "321d1f3f94ee95d30ec81b85550df7cae2704bbb"
 },
 "library-statistics-desktop-evidence.node.mjs": {
  "before": "c27c2fa62a05ab2b517b3cec1cd3a437854d2f62",
  "replacements": [
   [
    "4.240.0",
    "4.244.0",
    2
   ]
  ],
  "after": "18706271829d5e2c4dbf524cde5eeaf82790d79d"
 },
 "prepare-library-statistics-verifier.mjs": {
  "before": "d3a3538d53430ff723fffaeafb2eb09526cf1186",
  "replacements": [
   [
    "4.240.0",
    "4.244.0",
    1
   ],
   [
    "9ad6be13bc2c7dee0902c7464724b23ad535b3e3",
    "f059280614b6df3a03025d8f2567417bd14f2839",
    1
   ],
   [
    "b4ac535ad4f30ebb0458d106ce88eb941d0fddf6",
    "ec62fa287ba67203e1623c6bd83bbba93386e619",
    1
   ]
  ],
  "after": "f78f8a3715db3235e47e0b0d1c6936db58344222"
 },
 "attachment-audit-desktop-evidence.mjs": {
  "before": "8a52afa7ec834de477bc0890068d91b73735f5a9",
  "replacements": [
   [
    "4.241.0",
    "4.244.0",
    1
   ]
  ],
  "after": "a6cb484860d19195dc64995f749676c60837974e"
 },
 "attachment-audit-desktop-evidence.node.mjs": {
  "before": "34df031ee24c1e3ea28430a49239f8a17bb73fd9",
  "replacements": [
   [
    "4.241.0",
    "4.244.0",
    2
   ]
  ],
  "after": "2fa533850cc2993ef18bbe9813d020e890aee920"
 },
 "prepare-attachment-audit-verifier.mjs": {
  "before": "9529c667f9aaed9d69d38bd3e740325e2a77b5d6",
  "replacements": [
   [
    "4.241.0",
    "4.244.0",
    1
   ],
   [
    "ed96da5efa6ae8cd6e0af591a9b6e7349d4406c6",
    "f059280614b6df3a03025d8f2567417bd14f2839",
    1
   ],
   [
    "fdcaa659a6cfc8eb5e279d430d6d23d42e6a6e68",
    "85e9ea9a64a7cfcaf35c322a72ce8ce9e9ee9291",
    1
   ]
  ],
  "after": "643af5496bffe039852bd213c92586bc9f7122fd"
 },
 "task-center-desktop-evidence.mjs": {
  "before": "cfc194077d9f4e5d4ee356b59e8de78b9aba7c19",
  "replacements": [
   [
    "4.242.0",
    "4.244.0",
    1
   ]
  ],
  "after": "0ad39e4bfacb67e0555108a9f3fb0a314dc9a99c"
 },
 "task-center-desktop-evidence.node.mjs": {
  "before": "d505edbe8617bd638ae2b2a64250015342c2862b",
  "replacements": [
   [
    "4.242.0",
    "4.244.0",
    2
   ]
  ],
  "after": "ac37aea71187e03cdfb782f2b624af90e6c68d88"
 },
 "prepare-task-center-verifier.mjs": {
  "before": "c9d52eaf8e96098e35201dc50bba8e789545dfcc",
  "replacements": [
   [
    "4.242.0",
    "4.244.0",
    1
   ],
   [
    "1535cbe23b7d6c22e701d4ffd1c08fa8b5c9fc39",
    "f059280614b6df3a03025d8f2567417bd14f2839",
    1
   ],
   [
    "e287b5a65a08de4c22db95d3234f459fc01b4889",
    "81e7741a59cea788765410cc4ea014b29698d67b",
    1
   ]
  ],
  "after": "8903175522850c9d210ddf895d8eb76f9847c6c9"
 },
 "prepare-recent-reload-readiness.mjs": {
  "before": "70bc8655517e9715c4e2979f6c67605bbc39c228",
  "replacements": [
   [
    "4.242.0",
    "4.244.0",
    1
   ],
   [
    "6e4ea504cc71129acdeb8c125b3098e4abb21994",
    "6b70ea7dbb14214be0b08fb6ecbadab7ef1cf3b0",
    1
   ]
  ],
  "after": "1c27b26421651f08f95b89442a139dbaeaf3d957"
 },
 "local-actions-desktop-evidence.mjs": {
  "before": "74476b2b69897be636af16753561a66dc6943f3e",
  "replacements": [
   [
    "4.243.0",
    "4.244.0",
    1
   ]
  ],
  "after": "e58a67641c6be3a947877c347d905a4950ae1b65"
 },
 "local-actions-desktop-evidence.node.mjs": {
  "before": "080c11b83e0915077d957edfb7010378b3f7f805",
  "replacements": [
   [
    "4.243.0",
    "4.244.0",
    2
   ]
  ],
  "after": "77240c638a77ef64d2927c2fa1f38daddf4418a9"
 },
 "prepare-local-actions-verifier.mjs": {
  "before": "d1c2c2049f44b08d941e1f4a21374718f0deac99",
  "replacements": [
   [
    "4.243.0",
    "4.244.0",
    1
   ],
   [
    "1e6742fe7032b17bbc6688605ce4a8c18c254967",
    "f059280614b6df3a03025d8f2567417bd14f2839",
    1
   ],
   [
    "38cd45cfa9908015d6b40eafd2ee8cd51b1f8cda",
    "8e6179fabc0fbf3682e675ea57480d6988208d63",
    1
   ],
   [
    "fd6db6c06f463622429c4a590f7a2126df089f2a",
    "07c984213c372acf85d6aeea84906d7c703e0385",
    1
   ]
  ],
  "after": "5f1343086559bddcc6f45399ec7dc69a7d6d817e"
 }
})
export function adaptRetained111(file,original){
 const spec=RETAINED_111[file];assert.ok(spec,'Unlisted retained source');assert.equal(blob(original),spec.before,'Unreviewed original '+file)
 let next=original
 for(const[a,b,count]of spec.replacements){assert.equal(next.split(a).length-1,count);assert.equal(next.includes(b),false);next=next.replaceAll(a,b)}
 let inverse=next;for(const[a,b,count]of [...spec.replacements].reverse()){assert.equal(inverse.split(b).length-1,count);inverse=inverse.replaceAll(b,a)}
 assert.equal(inverse,original,'Retained policies or assertions changed');if(spec.after)assert.equal(blob(next),spec.after);return next
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url));assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86')
 const out=path.join(root,'test-results/installer-lifecycle/retained-111-preparation');mkdirSync(out,{recursive:true});const records=[]
 for(const name of Object.keys(RETAINED_111)){const file=path.join(root,'scripts',name),original=readFileSync(file,'utf8').replace(/\r\n/g,'\n'),next=adaptRetained111(name,original);writeFileSync(path.join(out,name+'.before.txt'),original,{flag:'wx'});writeFileSync(file,next);records.push({file:name,before:blob(original),after:blob(next),inverseBytesEqual:true,changes:'release/source identity only'})}
 writeFileSync(path.join(out,'source-preparation.json'),JSON.stringify({verifierCommit:process.env.GITHUB_SHA,productionChanged:false,nativeExecutionClaimed:false,records},null,2)+'\n',{flag:'wx'})
}
