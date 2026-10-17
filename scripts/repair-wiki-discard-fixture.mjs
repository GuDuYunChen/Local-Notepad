// Keep the real App/TextEditor/quit assertions. Preserve existing overrides and
// let newly used, unrelated reference exports come from their real module.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
const file='src/AppExitDiscard.test.jsx',configFile='scripts/wiki-integration.json'
const hash=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const original=readFileSync(file,'utf8')
assert.equal(hash(original),'b27ae6dc992bccffa1b2fa221d560d41a91b442d')
const from="vi.mock('./components/Editor/utils/referenceUtils', () => ({\n"
const to="vi.mock('./components/Editor/utils/referenceUtils', async (importOriginal) => ({\n  ...(await importOriginal()),\n"
assert.equal(original.split(from).length,2)
const updated=original.replace(from,to)
assert.equal(updated.replace(to,from),original)
const config=JSON.parse(readFileSync(configFile,'utf8'))
assert.equal(Object.keys(config.expected).length,18)
assert.equal(Object.hasOwn(config.expected,file),false)
config.expected[file]=hash(updated)
writeFileSync(file,updated)
writeFileSync(configFile,JSON.stringify(config,null,2)+'\n')
mkdirSync('wiki-evidence',{recursive:true})
writeFileSync('wiki-evidence/discard-fixture-repair.json',JSON.stringify({path:file,original:hash(original),updated:hash(updated),originalAssertionsPreserved:true,realNewReferenceExports:true,productionChanged:false},null,2)+'\n')
console.log('Preserved all original discard/quit assertions; added real reference exports to its partial fixture.')
