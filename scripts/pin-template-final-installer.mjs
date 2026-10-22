// Same installer checks and native module scripts; only bind them to the
// independently verified final product and its new source-bound installer.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
const PRODUCT='6100a3522e875bf4247bcc48a6742f4f2c97a3a9'
const CURRENT={version:'4.222.3',bytes:104247187,sha256:'fcfd696fca085b61eed80f7331e81b57167c56e28548b5ca849f323f0f9cd037'}
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const file=new URL('./template-installed-evidence.mjs',import.meta.url)
const before=readFileSync(file,'utf8').replace(/\r\n/g,'\n')
assert.equal(blob(before),'5c676571f38982d2df6053dc8ca735f474684e9e','Unexpected original installer validator')
const replacements=[
 ["export const PRODUCT='29c140a989984e981d6e99a6078145f1d05323dc'",`export const PRODUCT='${PRODUCT}'`],
 ["export const CURRENT=Object.freeze({version:'4.222.2',bytes:104244051,sha256:'7d8b4d6196c90a3346b64e0c4124a4b92f80e0c46aa4e4bb347e3e04aaa373b2'})",`export const CURRENT=Object.freeze(${JSON.stringify(CURRENT)})`],
]
let after=before
for(const[from,to]of replacements){assert.equal(after.split(from).length,2);after=after.replace(from,to)}
let reverted=after
for(const[from,to]of replacements){assert.equal(reverted.split(to).length,2);reverted=reverted.replace(to,from)}
assert.equal(reverted,before,'Only installer identity and product commit may change')
const binary=readFileSync(path.resolve('.installer-input/current/Notepad-4.222.3-Setup.exe'))
assert.equal(binary.length,CURRENT.bytes)
assert.equal(createHash('sha256').update(binary).digest('hex'),CURRENT.sha256)
const out=path.resolve('test-results/installer-lifecycle');mkdirSync(out,{recursive:true})
writeFileSync(path.join(out,'templateValidatorBefore.txt'),before,{flag:'wx'})
writeFileSync(path.join(out,'templateValidatorPinned.txt'),after,{flag:'wx'})
writeFileSync(file,after)
writeFileSync(path.join(out,'installer-pin.json'),JSON.stringify({productCommit:PRODUCT,verifierCommit:process.env.GITHUB_SHA,installer:CURRENT,previousProduct:'29c140a989984e981d6e99a6078145f1d05323dc',beforeBlob:blob(before),pinnedBlob:blob(after),allOtherValidatorBytesPreserved:true,actualDownloadedBinaryVerified:true,productionModified:false},null,2)+'\n')
console.log('Pinned final installer; all native test assertions and upgrade seed unchanged.')
