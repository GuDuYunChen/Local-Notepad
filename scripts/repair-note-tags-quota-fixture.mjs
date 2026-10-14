// Intercept the actual global storage used by the component, not a different
// Storage prototype, and require proof that the quota fault was reached.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const p='src/components/TagSelector.test.jsx',s=readFileSync(p,'utf8')
const hash=createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
assert.equal(hash,'90272e44269c8a421fc7215a33ed9648a52fcd99')
const a="test('quota failure prevents sending any mutation',async()=>{await open();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')});await choose();expect(api.mock.calls.filter(([,i])=>i.method)).toHaveLength(0)})"
const b=`test('quota failure prevents sending any mutation',async()=>{
 await open();const storage=globalThis.localStorage
 const write=vi.fn(()=>{throw new DOMException('Quota exceeded','QuotaExceededError')})
 vi.stubGlobal('localStorage',{getItem:storage.getItem.bind(storage),setItem:write,removeItem:storage.removeItem.bind(storage)})
 try{await choose();expect(write).toHaveBeenCalledTimes(1);expect(api.mock.calls.filter(([,i])=>i.method)).toHaveLength(0);expect(host.textContent).toContain('Quota exceeded')}
 finally{vi.unstubAllGlobals()}
})`
assert.equal(s.split(a).length,2);writeFileSync(p,s.replace(a,b))
