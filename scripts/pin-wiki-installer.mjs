import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {validateWikiPin} from './wiki-installed-evidence.mjs'
const pin=JSON.parse(readFileSync(new URL('./wiki-installer-pin.json',import.meta.url),'utf8'));validateWikiPin(pin)
const hash=b=>createHash('sha256').update(b).digest('hex'),blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
for(const which of ['current','previous']){
 const expected=pin[which],binary=readFileSync(path.resolve('.installer-input',which,'Notepad-'+expected.version+'-Setup.exe'))
 assert.equal(binary.length,expected.bytes);assert.equal(hash(binary),expected.sha256);assert.equal(binary.subarray(0,2).toString(),'MZ')
}
const file=new URL('./template-installed-evidence.mjs',import.meta.url),before=readFileSync(file,'utf8').replace(/\r\n/g,'\n')
assert.equal(blob(before),'5c676571f38982d2df6053dc8ca735f474684e9e')
const changes=[
 ["export const PRODUCT='29c140a989984e981d6e99a6078145f1d05323dc'",`export const PRODUCT='${pin.product}'`],
 ["export const CURRENT=Object.freeze({version:'4.222.2',bytes:104244051,sha256:'7d8b4d6196c90a3346b64e0c4124a4b92f80e0c46aa4e4bb347e3e04aaa373b2'})",`export const CURRENT=Object.freeze(${JSON.stringify(pin.current)})`],
 ["export const PREVIOUS=Object.freeze({version:'4.221.1',bytes:104218653,sha256:'de069090d8013bbbcc8aa076d610909b99703f1372fce22ed713cad0bfeeab6a'})",`export const PREVIOUS=Object.freeze(${JSON.stringify(pin.previous)})`],
 ["export const TEMPLATE_BLOB='c440d9bf107fe6f1d4bef1f06f845139b57fe9ef'",`export const TEMPLATE_BLOB='${pin.templateBlob}'`],
]
let after=before;for(const[a,b]of changes){assert.equal(after.split(a).length,2);after=after.replace(a,b)}
let inverse=after;for(const[a,b]of changes){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}assert.equal(inverse,before)
const out=path.resolve('test-results/installer-lifecycle');mkdirSync(out,{recursive:true})
writeFileSync(path.join(out,'templateValidatorBefore.txt'),before,{flag:'wx'});writeFileSync(path.join(out,'templateValidatorPinned.txt'),after,{flag:'wx'});writeFileSync(file,after)
// Only pin release pairs in generated copies; keep original validators/tests.
const generated={}
for(const spec of [
 {name:'graph',source:'local-graph-installed-evidence.mjs',output:'wiki-graph-validator.mjs',hash:'9a6b24e3eec09947e3b3426fed1fb97bcec49390',current:'4.228.0',previous:'4.227.1'},
 {name:'pins',source:'local-pins-installed-evidence.mjs',output:'wiki-pins-validator.mjs',hash:'d1d285314f82f341779a549536f356ce922c15c7',current:'4.229.0',previous:'4.228.0'},
 {name:'recent',source:'recent-notes-installed-evidence.mjs',output:'wiki-recent-validator.mjs',hash:'26f37bed14c20992d70ae8fe16d20cfb3e7f1118',current:'4.230.1',previous:'4.229.0'},
]){
 const original=readFileSync(new URL('./'+spec.source,import.meta.url),'utf8').replace(/\r\n/g,'\n');assert.equal(blob(original),spec.hash)
 const changes=[["['current','"+spec.current+"']","['current','4.231.1']"],["['previous','"+spec.previous+"']","['previous','4.230.1']"]]
 let pinned=original
 for(const[a,b]of changes){assert.equal(pinned.split(a).length,2);pinned=pinned.replace(a,b)}
 let inverse=pinned
 for(const[a,b]of changes){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}
 assert.equal(inverse,original)
 writeFileSync(new URL('./'+spec.output,import.meta.url),pinned,{flag:'wx'})
 writeFileSync(path.join(out,spec.name+'ValidatorBefore.txt'),original,{flag:'wx'})
 writeFileSync(path.join(out,spec.name+'ValidatorPinned.txt'),pinned,{flag:'wx'})
 generated[spec.name]={original:blob(original),pinned:blob(pinned),versionOnly:true}
}
writeFileSync(path.join(out,'installer-pin.json'),JSON.stringify({...pin,verifierCommit:process.env.GITHUB_SHA,allOtherValidatorBytesPreserved:true,actualDownloadedBinaryVerified:true,generated,productionModified:false},null,2))
