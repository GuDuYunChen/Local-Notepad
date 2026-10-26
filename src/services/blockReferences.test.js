import { describe, test, expect, vi } from 'vitest'
import { BLOCK_BODY_BYTES, blockLocator, parseBlockLocator, findReferenceBlock, referenceBlockText, removeCopiedBlockIds } from './blockReferenceModel.mjs'
import { readBlockReference, queueBlockReference } from './blockReferences.mjs'
import { createWikiNavigator, wikiRequest } from './wikiNavigation.mjs'
const blockId = 'b-' + 'a'.repeat(32)
const paragraph = (text = '来源正文', id = blockId) => ({ type: 'paragraph', $: { localBlockId: id }, children: [{ type: 'text', text }] })
const body = (...children) => JSON.stringify({ root: { type: 'root', children } })
const file = (content = body(paragraph())) => ({ id: '源/笔记', title: '来源.md', content, is_folder: false, is_deleted: false, updated_at: 1700000000 })
const request = { id: '源/笔记', blockId }
describe('note-scoped stable block references', () => {
  test('round-trips IDs without using titles as lookup identities', () => {
    const address = blockLocator('源/笔记', blockId)
    expect(parseBlockLocator(address)).toEqual(request)
    expect(address).toContain('%2F')
  })
  test.each(['https://example.org/a', 'notepad://block/a/bad', 'notepad://block/a/' + blockId + '?x=1', 'notepad://user@block/a/' + blockId, 'notepad://block/a/' + blockId + '#fragment', 'notepad://block/a%ZZ/' + blockId, 'notepad://block//'+blockId])('refuses untrusted locator %s', text => expect(() => parseBlockLocator(text)).toThrow())
  test('locates a renamed/moved block only by its stable ID', () => {
    const content = body(paragraph('其他', 'b-'+'b'.repeat(32)), paragraph('已修改'))
    expect(findReferenceBlock(content, blockId).children[0].text).toBe('已修改')
  })
  test('missing blocks and duplicate IDs are refused, even with equal text', () => {
    expect(() => findReferenceBlock(body(paragraph('相同', 'b-'+'b'.repeat(32))), blockId)).toThrow(/删除/)
    expect(() => findReferenceBlock(body(paragraph(), paragraph()), blockId)).toThrow(/重复/)
  })
  test('a moved nested block is not confused with its former top-level block', () => {
    expect(() => findReferenceBlock(body({ type:'quote', children:[paragraph()] }), blockId)).toThrow(/删除/)
  })
  test('source parsing has bounds and rejects malformed children', () => {
    expect(() => findReferenceBlock('x'.repeat(BLOCK_BODY_BYTES+1), blockId)).toThrow(/上限/)
    expect(() => findReferenceBlock(body({ ...paragraph(), children:{} }), blockId)).toThrow(/结构/)
    expect(() => findReferenceBlock(body({ ...paragraph(), children:[{type:'text',text:3}] }), blockId)).toThrow(/文本/)
  })
  test('nested/self embeds are projected as labels without recursive network reads', async () => {
    const api = vi.fn().mockResolvedValue(file(body({ ...paragraph(), children:[{type:'wiki-link',id:request.id,title:'自己',blockId,embedded:true}] })))
    const result = await readBlockReference(api, request)
    expect(result.text).toContain('[引用：自己#^'+blockId+']'); expect(api).toHaveBeenCalledTimes(1)
  })
  test('text/table/list/media projection is read-only and bounded', () => {
    expect(referenceBlockText({type:'table',children:[{type:'tablerow',children:[{type:'tablecell',children:[{type:'text',text:'一'}]},{type:'tablecell',children:[{type:'text',text:'二'}]}]}]})).toBe('一\t二')
    expect(referenceBlockText({type:'paragraph',children:[{type:'image',src:'https://private',alt:'图片'}]})).toContain('[image：图片]')
    expect(() => referenceBlockText(paragraph('x'.repeat(20001)))).toThrow(/上限/)
  })
  test('copy strips owned anchors without changing reference targets or source', () => {
    const source = [paragraph(), {type:'wiki-link',id:'source',blockId,embedded:true}]
    const copy = removeCopiedBlockIds(source)
    expect(copy[0].$).toBeUndefined(); expect(copy[1].blockId).toBe(blockId); expect(source[0].$.localBlockId).toBe(blockId)
  })
  test('read verifies the current note identity and rejects deleted/template targets', async () => {
    for (const change of [{id:'other'},{is_deleted:true},{is_folder:true},{title:'__tpl__hidden'}]) {
      await expect(readBlockReference(async () => ({...file(),...change}), request)).rejects.toThrow()
    }
  })
  test('transport errors do not reveal raw private diagnostics', async () => {
    await expect(readBlockReference(async () => {throw Error('secret at D:/private')},request)).rejects.toThrow('无法读取来源块')
  })
  test('a stopped read never returns late successful content', async () => {
    let resolve; const controller = new AbortController()
    const run = readBlockReference(() => new Promise(r => resolve=r), request, controller.signal)
    controller.abort(); resolve?.(file()); await expect(run).rejects.toThrow()
  })
  test('shared embed queue caps simultaneous requests at four and cancels queued work', async () => {
    const releases = [], controllers = Array.from({length:6},()=>new AbortController()); let active=0, maximum=0, calls=0
    const api = () => {calls++;active++;maximum=Math.max(maximum,active);return new Promise(r=>releases.push(()=>{active--;r(file())}))}
    const promises=controllers.map(c=>queueBlockReference(api,request,c.signal).then(()=>true,()=>false))
    await vi.waitFor(()=>expect(releases).toHaveLength(4)); controllers[5].abort()
    releases.splice(0).forEach(r=>r()); await vi.waitFor(()=>expect(releases).toHaveLength(1)); releases[0]()
    expect(await Promise.all(promises)).toEqual([true,true,true,true,true,false]); expect(maximum).toBe(4);expect(calls).toBe(5)
  })
  test('navigation carries block identity through the original guarded opener', async () => {
    const context={currentId:'from',workspace:'notes',epoch:1,content:''}
    const openFile=vi.fn(async (id,options)=>{expect(options.blockId).toBe(blockId);await options.readFile(id,{signal:options.signal});return true})
    const nav=createWikiNavigator({getContext:()=>context,openFile,api:async()=>file()})
    expect(await nav.open(request)).toBe(true); expect(openFile).toHaveBeenCalledTimes(1)
  })
  test('navigation refuses missing/ambiguous blocks and does not replace them with whole-note jumps', async () => {
    for(const content of [body(),body(paragraph(),paragraph())]) {
      let selected=false
      const nav=createWikiNavigator({getContext:()=>({currentId:'from',workspace:'notes',epoch:1}),openFile:async(id,o)=>{await o.readFile(id,{signal:o.signal});selected=true;return true},api:async()=>file(content)})
      expect(await nav.open(request)).toBe(false);expect(selected).toBe(false);expect(nav.snapshot().canOpenBody).toBe(false)
    }
  })
  test('block plus heading targeting is rejected rather than falling back',()=>expect(()=>wikiRequest({...request,headingPath:['冲突']})).toThrow(/同时/))
})


test('unknown block children fail instead of silently dropping unsupported content',()=>{
 expect(()=>referenceBlockText({type:'paragraph',children:[{type:'unrecognized-custom-node',content:'cannot lose me'}]})).toThrow(/不支持/)
})


test('the private locator grammar does not rely on Chromium custom-scheme URL parsing',()=>{
 const original=globalThis.URL
 try {
   globalThis.URL=class{constructor(){throw Error('old Chromium custom scheme is opaque')}}
   expect(parseBlockLocator(blockLocator('源/笔记',blockId))).toEqual(request)
   expect(()=>parseBlockLocator('notepad://block/user@host/'+blockId)).toThrow()
 } finally { globalThis.URL=original }
})
