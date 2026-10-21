import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {validateLocalImportPin} from './local-import-installed-evidence.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex'),blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
// Pure source generation is also used by the offline prepare-chain check. Binary
// acceptance remains exclusively in the CLI below and is never inferred here.
export function prepareLocalImportValidatorPin(pin,readSource){
validateLocalImportPin(pin)
const before=readSource('template-installed-evidence.mjs').replace(/\r\n/g,'\n')
assert.equal(blob(before),'5c676571f38982d2df6053dc8ca735f474684e9e')
const changes=[
 ["export const PRODUCT='29c140a989984e981d6e99a6078145f1d05323dc'",`export const PRODUCT='${pin.product}'`],
 ["export const CURRENT=Object.freeze({version:'4.222.2',bytes:104244051,sha256:'7d8b4d6196c90a3346b64e0c4124a4b92f80e0c46aa4e4bb347e3e04aaa373b2'})",`export const CURRENT=Object.freeze(${JSON.stringify(pin.current)})`],
 ["export const PREVIOUS=Object.freeze({version:'4.221.1',bytes:104218653,sha256:'de069090d8013bbbcc8aa076d610909b99703f1372fce22ed713cad0bfeeab6a'})",`export const PREVIOUS=Object.freeze(${JSON.stringify(pin.previous)})`],
 ["export const TEMPLATE_BLOB='c440d9bf107fe6f1d4bef1f06f845139b57fe9ef'",`export const TEMPLATE_BLOB='${pin.templateBlob}'`],
]
let after=before;for(const[a,b]of changes){assert.equal(after.split(a).length,2);after=after.replace(a,b)}
let inverse=after;for(const[a,b]of changes){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}assert.equal(inverse,before)
// Only pin release pairs in generated copies; keep original validators/tests.
const generated=[]
for(const spec of [
 {name:'graph',source:'local-graph-installed-evidence.mjs',output:'import-graph-validator.mjs',hash:'9a6b24e3eec09947e3b3426fed1fb97bcec49390',current:'4.228.0',previous:'4.227.1'},
 {name:'pins',source:'local-pins-installed-evidence.mjs',output:'import-pins-validator.mjs',hash:'d1d285314f82f341779a549536f356ce922c15c7',current:'4.229.0',previous:'4.228.0'},
 {name:'recent',source:'recent-notes-installed-evidence.mjs',output:'import-recent-validator.mjs',hash:'26f37bed14c20992d70ae8fe16d20cfb3e7f1118',current:'4.230.1',previous:'4.229.0'},
 {name:'wiki',source:'wiki-installed-evidence.mjs',output:'import-wiki-validator.mjs',hash:'3da0e57ddc3154659e97eb5e300b7676e83a56eb',current:'4.231.2',previous:'4.230.1'},
]){
 const original=readSource(spec.source).replace(/\r\n/g,'\n');assert.equal(blob(original),spec.hash)
 const changes=[["['current','"+spec.current+"']","['current','"+pin.current.version+"']"],["['previous','"+spec.previous+"']","['previous','"+pin.previous.version+"']"]]
 let pinned=original
 for(const[a,b]of changes){assert.equal(pinned.split(a).length,2);pinned=pinned.replace(a,b)}
 let inverse=pinned
 for(const[a,b]of changes){assert.equal(inverse.split(b).length,2);inverse=inverse.replace(b,a)}
 assert.equal(inverse,original)
 generated.push({...spec,original,pinned})
}
return {before,after,generated}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
const pin=JSON.parse(readFileSync(new URL('./local-import-installer-pin.json',import.meta.url),'utf8'));validateLocalImportPin(pin)
for(const which of ['current','previous']){
 const expected=pin[which],binary=readFileSync(path.resolve('.installer-input',which,'Notepad-'+expected.version+'-Setup.exe'))
 assert.equal(binary.length,expected.bytes);assert.equal(hash(binary),expected.sha256);assert.equal(binary.subarray(0,2).toString(),'MZ')
}
const prepared=prepareLocalImportValidatorPin(pin,file=>readFileSync(new URL('./'+file,import.meta.url),'utf8'))
const out=path.resolve('test-results/installer-lifecycle');mkdirSync(out,{recursive:true})
writeFileSync(path.join(out,'templateValidatorBefore.txt'),prepared.before,{flag:'wx'})
writeFileSync(path.join(out,'templateValidatorPinned.txt'),prepared.after,{flag:'wx'})
writeFileSync(new URL('./template-installed-evidence.mjs',import.meta.url),prepared.after)
const generated={}
for(const spec of prepared.generated){
 writeFileSync(new URL('./'+spec.output,import.meta.url),spec.pinned,{flag:'wx'})
 writeFileSync(path.join(out,spec.name+'ValidatorBefore.txt'),spec.original,{flag:'wx'})
 writeFileSync(path.join(out,spec.name+'ValidatorPinned.txt'),spec.pinned,{flag:'wx'})
 generated[spec.name]={original:blob(spec.original),pinned:blob(spec.pinned),versionOnly:true}
}
writeFileSync(path.join(out,'installer-pin.json'),JSON.stringify({...pin,verifierCommit:process.env.GITHUB_SHA,allOtherValidatorBytesPreserved:true,actualDownloadedBinaryVerified:true,generated,productionModified:false},null,2))
}
