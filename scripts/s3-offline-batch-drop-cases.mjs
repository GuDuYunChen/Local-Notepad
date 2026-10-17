import assert from 'node:assert/strict'
import { selectOfflineBatchDrop as select, createOfflineBatchDrop } from '../src/services/s3OfflineBatchDrop.mjs'
const file = size => ({ size, get name() { throw Error('PRIVATE_NAME') }, get path() { throw Error('PRIVATE_PATH') } })
const transfer = (files = [file(1), file(4096)]) => ({ types: ['Files'], files })
function fixture(active = true) {
  const state = { active, accepted: [], messages: [], highlights: [], steps: [] }
  const handlers = createOfflineBatchDrop({ isActive: () => state.active,
    onFiles: files => state.accepted.push(files), onFeedback: code => state.messages.push(code), onHighlight: value => state.highlights.push(value) })
  const event = (dataTransfer = transfer()) => ({ dataTransfer,
    preventDefault() { state.steps.push('prevent') }, stopPropagation() { state.steps.push('stop') } })
  return { state, handlers, event }
}
export function registerOfflineBatchDropTests(test) {
  test('batch drop captures exactly two files in native order without names or contents', () => {
    const t = transfer(), out = select(t)
    assert.deepEqual(out.files, t.files); assert.notEqual(out.files, t.files)
    assert.ok(Object.isFrozen(out) && Object.isFrozen(out.files))
    t.files.reverse(); assert.notEqual(out.files[0], t.files[0])
  })
  test('batch drop rejects all other counts without inspecting file payloads', () => {
    for (const length of [0, 1, 3, 100000, undefined, '2', -1, 2.5]) {
      const files = { length, get 0() { throw Error('must not inspect') } }
      assert.equal(select(transfer(files)).code, 'batch-count')
    }
  })
  test('batch drop enforces both nonempty 4 KiB budgets before admission', () => {
    for (const size of [0, -1, 4097, NaN, Infinity, '1', 1.5]) for (const side of [0, 1]) {
      const files = [file(1), file(1)]; files[side] = file(size)
      assert.equal(select(transfer(files)).code, 'batch-size')
    }
  })
  test('batch drop refuses directory metadata on either side without traversing', () => {
    for (const side of [0, 1]) {
      const t = transfer();t.items = [0,1].map(i => ({ kind: 'file', webkitGetAsEntry() {
        return { isDirectory: i === side, createReader() { throw Error('must not traverse') } }
      } }))
      assert.equal(select(t).code, 'batch-directory')
    }
  })
  test('batch drop supports absent optional directory metadata without inventing files', () => {
    for (const items of [undefined, null, [], [{kind:'file'}]]) {
      const t = transfer();t.items = items;assert.equal(select(t).code, 'batch-selected')
    }
    assert.equal(select(transfer([null, file(1)])).code, 'batch-size')
  })
  test('batch drop metadata errors are fixed refusals with no exception disclosure', () => {
    for (const key of ['files', 'items']) {
      const t = transfer();Object.defineProperty(t,key,{get(){throw Error('PRIVATE')}})
      const out=select(t);assert.deepEqual(out,{code:'batch-unavailable',files:null})
    }
    for(const length of [-1,17,'2',NaN]) { const t=transfer();t.items={length};assert.equal(select(t).code,'batch-unavailable') }
  })
  test('batch drop rejects text and links before accessing file payloads', () => {
    for (const types of [[], ['text/plain'], ['text/uri-list']]) {
      const t={types,get files(){throw Error('must not inspect')}}
      assert.equal(select(t).code,'batch-file-required')
    }
  })
  test('batch drag hover reads types only and updates refusal without waiting for drop', () => {
    const f=fixture();const t={types:['Files'],get files(){throw Error('payload')},get items(){throw Error('items')}}
    f.handlers.enter(f.event(t));f.handlers.over(f.event(t))
    assert.equal(t.dropEffect,'copy');assert.equal(f.state.accepted.length,0);assert.equal(f.state.highlights.at(-1),true)
    t.types=['text/plain'];f.handlers.over(f.event(t));assert.equal(t.dropEffect,'none')
    assert.equal(f.state.messages.at(-1),'batch-file-required');assert.equal(f.state.highlights.at(-1),false)
  })
  test('batch drag contains every event before metadata inspection, even when inactive', () => {
    for (const active of [true,false]) for (const kind of ['enter','over','leave','end','drop']) {
      const f=fixture(active); const e=f.event()
      Object.defineProperty(e,'dataTransfer',{get(){assert.deepEqual(f.state.steps,['prevent','stop']);return transfer()}})
      f.handlers[kind](e);assert.deepEqual(f.state.steps,['prevent','stop'])
      if(!active)assert.deepEqual(f.state.accepted,[])
    }
  })
  test('batch drag nested hover clears only after leaving outer boundary or finishing', () => {
    const f=fixture();f.handlers.enter(f.event());f.handlers.enter(f.event());f.handlers.leave(f.event())
    assert.equal(f.state.highlights.at(-1),true);f.handlers.leave(f.event());assert.equal(f.state.highlights.at(-1),false)
    f.handlers.enter(f.event());f.handlers.end(f.event());assert.equal(f.state.highlights.at(-1),false)
  })
  test('batch drag admission calls the owned reader path once and retains exact native order', () => {
    const f=fixture(),t=transfer();f.handlers.drop(f.event(t))
    assert.deepEqual(f.state.accepted,[t.files]);assert.equal(f.state.messages.at(-1),'')
  })
  test('batch drag rejected drops do not call the reader path or cancel existing work', () => {
    for(const t of [transfer([]),transfer([file(1)]),transfer([file(1),file(5000)]),{types:['text/plain']}]) {
      const f=fixture();f.handlers.drop(f.event(t));assert.equal(f.state.accepted.length,0);assert.notEqual(f.state.messages.at(-1),'')
    }
  })
  test('batch drag revoked during metadata inspection never delivers files', () => {
    const f=fixture(),t=transfer();Object.defineProperty(t,'items',{get(){f.state.active=false;return []}})
    f.handlers.drop(f.event(t));assert.deepEqual(f.state.accepted,[])
  })
  test('batch drag revoked during feedback never delivers files', () => {
    let calls=0,active=true
    const h=createOfflineBatchDrop({isActive:()=>active,onFiles(){calls++},onHighlight(){},onFeedback(){active=false}})
    h.drop({dataTransfer:transfer(),preventDefault(){},stopPropagation(){}});assert.equal(calls,0)
  })
}
