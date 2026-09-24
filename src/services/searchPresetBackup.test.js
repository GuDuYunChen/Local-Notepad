import { it, expect, vi } from 'vitest'
import { createSearchPresetStore, SEARCH_PRESET_PREFIX } from './searchPresets'
import { buildSearchPresetBackup, parseSearchPresetBackup, planSearchPresetImport, applySearchPresetImport, MAX_PRESET_BACKUP_BYTES } from './searchPresetBackup'
const filters=()=>({query:'关关',source:'body',folderId:'p',days:'7',pinned:false,matchCase:true,sort:'updated',content:'not saved'})
function fixture(){
 const values=new Map();let serial=0
 const storage={get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
 const store=createSearchPresetStore({storage:()=>storage,createId:()=>`id-${++serial}`,now:()=>new Date('2026-09-23T12:00:00.000Z')})
 return {values,storage,store}
}
function backup(names=['人物检索','设定检查']){const f=fixture();for(const name of names) f.store.save(name,filters());return buildSearchPresetBackup(f.store)}
it('exports every saved preset and only whitelisted data',()=>{
 const f=fixture();for(let i=0;i<40;i++)f.store.save('检索'+i,filters());const before=[...f.values]
 const result=parseSearchPresetBackup(buildSearchPresetBackup(f.store));expect(result).toHaveLength(40);expect(JSON.stringify(result)).not.toContain('not saved');expect([...f.values]).toEqual(before)
})
it('does not call an unreadable or empty shelf a complete backup',()=>{
 const f=fixture();expect(()=>buildSearchPresetBackup(f.store)).toThrow('没有');f.values.set(SEARCH_PRESET_PREFIX+'bad','broken');expect(()=>buildSearchPresetBackup(f.store)).toThrow('不可读取')
})
it('rejects a shelf changed while exporting',()=>{
 const f=fixture();f.store.save('a',filters());const original=f.store.readUnchanged;f.store.readUnchanged=e=>{const raw=original(e);f.values.delete(e.key);return raw}
 expect(()=>buildSearchPresetBackup(f.store)).toThrow('已变化')
})
it('accepts UTF-8 BOM and removes hidden manuscript or result fields',()=>{
 const raw=JSON.parse(backup());raw.presets[0].body='secret body';raw.presets[0].filters.results=['secret'];const result=parseSearchPresetBackup('\uFEFF'+JSON.stringify(raw))
 expect(JSON.stringify(result)).not.toContain('secret');expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result[0].filters)).toBe(true)
})
it('validates every entry before planning a write, including the last one',()=>{
 const f=fixture(),data=JSON.parse(backup());data.presets[1].version=2;expect(()=>planSearchPresetImport(JSON.stringify(data),f.store)).toThrow();expect(f.values.size).toBe(0)
})
it('rejects unsupported formats dates versions and empty bundles',()=>{
 const data=JSON.parse(backup());for(const patch of [{format:'other'},{version:2},{exportedAt:'yesterday'},{presets:[]},{presets:Array(41).fill(data.presets[0])}])expect(()=>parseSearchPresetBackup(JSON.stringify({...data,...patch}))).toThrow()
 expect(()=>parseSearchPresetBackup('broken')).toThrow('JSON')
})
it('applies a byte limit rather than only a character limit',()=>{
 expect(()=>parseSearchPresetBackup('x'.repeat(MAX_PRESET_BACKUP_BYTES+1))).toThrow('512')
 expect(()=>parseSearchPresetBackup('汉'.repeat(MAX_PRESET_BACKUP_BYTES/2))).toThrow('512')
})
it('preflight is read-only and explicitly counts local and in-file duplicates',()=>{
 const f=fixture();f.store.save('人物检索',filters());const before=[...f.values]
 const plan=planSearchPresetImport(backup(['人物检索','设定检查','设定检查']),f.store)
 expect(plan).toMatchObject({total:3,newCount:1,existingCount:1,fileDuplicateCount:1});expect([...f.values]).toEqual(before)
})
it('same name with changed filters is a distinct entry, not an overwrite',()=>{
 const f=fixture();f.store.save('人物检索',{...filters(),query:'赵三'});const plan=planSearchPresetImport(backup(['人物检索']),f.store)
 expect(plan.newCount).toBe(1);expect(applySearchPresetImport(plan,f.store).added).toBe(1);expect(f.store.list().entries).toHaveLength(2)
})
it('duplicates ignore foreign IDs timestamps and JSON property order',()=>{
 const f=fixture();f.store.save('人物检索',filters());const data=JSON.parse(backup(['人物检索']));data.presets[0].id='foreign';data.presets[0].savedAt='2026-01-01T00:00:00.000Z';data.presets[0].filters=Object.fromEntries(Object.entries(data.presets[0].filters).reverse())
 expect(planSearchPresetImport(JSON.stringify(data),f.store).existingCount).toBe(1)
})
it('successful import creates fresh local IDs without changing current conditions or unrelated storage',()=>{
 const f=fixture();f.values.set('theme','dark');f.store.save('old',filters());const result=applySearchPresetImport(planSearchPresetImport(backup(),f.store),f.store)
 expect(result).toMatchObject({added:2,remaining:0,error:''});expect(f.values.get('theme')).toBe('dark');expect(f.store.list().entries).toHaveLength(3)
})
it('one-shot plans cannot be reused or applied to another store',()=>{
 const a=fixture(),b=fixture();const plan=planSearchPresetImport(backup(),a.store)
 expect(()=>applySearchPresetImport(plan,b.store)).toThrow('失效');applySearchPresetImport(plan,a.store);expect(()=>applySearchPresetImport(plan,a.store)).toThrow('失效');expect(()=>applySearchPresetImport({...plan},a.store)).toThrow()
})
it('capacity includes corrupt entries and is checked before any writes',()=>{
 const f=fixture();for(let i=0;i<39;i++)f.values.set(SEARCH_PRESET_PREFIX+'bad-'+i,'broken')
 expect(()=>planSearchPresetImport(backup(),f.store)).toThrow('仅余 1');expect(f.values.size).toBe(39)
})
it('an all-duplicate bundle can be confirmed on a full shelf',()=>{
 const f=fixture();f.store.save('人物检索',filters());for(let i=0;i<39;i++)f.values.set(SEARCH_PRESET_PREFIX+'bad-'+i,'broken')
 const result=applySearchPresetImport(planSearchPresetImport(backup(['人物检索']),f.store),f.store);expect(result).toMatchObject({added:0,skipped:1,error:''});expect(f.values.size).toBe(40)
})
it('added modified or removed local entries invalidate confirmation',()=>{
 for(const change of ['add','edit','remove']){const f=fixture();f.store.save('old',filters());const plan=planSearchPresetImport(backup(),f.store);const e=f.store.list().entries[0]
 if(change==='add')f.store.save('another',filters());if(change==='edit')f.values.set(e.key,e.raw+' ');if(change==='remove')f.values.delete(e.key)
 const before=[...f.values];const result=applySearchPresetImport(plan,f.store);expect(result.added).toBe(0);expect(result.error).toContain('已变化');expect([...f.values]).toEqual(before)}
})
it('partial failure retains successes and re-preflight skips them',()=>{
 const f=fixture(),raw=backup();const set=f.storage.setItem;let calls=0;f.storage.setItem=(k,v)=>{if(++calls===2)throw Error('quota');return set(k,v)}
 const result=applySearchPresetImport(planSearchPresetImport(raw,f.store),f.store);expect(result).toMatchObject({added:1,remaining:1});expect(result.error).toContain('保存失败')
 f.storage.setItem=set;const retry=planSearchPresetImport(raw,f.store);expect(retry).toMatchObject({newCount:1,existingCount:1});expect(applySearchPresetImport(retry,f.store).added).toBe(1)
})
it('concurrent changes caused by observers stop remaining writes without deleting anything',()=>{
 const f=fixture();const off=f.store.subscribe(()=>f.values.set(SEARCH_PRESET_PREFIX+'concurrent','broken'))
 const result=applySearchPresetImport(planSearchPresetImport(backup(),f.store),f.store);off()
 expect(result).toMatchObject({added:1,remaining:1});expect(result.error).toContain('发生变化');expect(f.values.size).toBe(2)
})
it('blocked storage is not a zero-count successful import',()=>{
 const store=createSearchPresetStore({storage:()=>{throw Error('denied')}});expect(()=>planSearchPresetImport(backup(),store)).toThrow('无法读取')
})
it('a throwing view observer cannot falsify successful import counts',()=>{
 const f=fixture();f.store.subscribe(()=>{throw Error('view')});expect(applySearchPresetImport(planSearchPresetImport(backup(),f.store),f.store)).toMatchObject({added:2,error:''})
})
