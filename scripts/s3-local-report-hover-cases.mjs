import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { hasLocalReportFileDrag } from '../src/services/s3LocalReportDrop.mjs'

// Execute the actual component's synchronous handlers without replacing their
// logic. These VM cases are not React or native Chromium integration evidence.
const source = readFileSync(new URL('../src/components/S3LocalOverviewFile.jsx', import.meta.url), 'utf8')
const start = source.indexOf('  const contain = event =>')
const end = source.indexOf('  const drop = event =>', start)
assert.ok(start >= 0 && end > start, 'production hover handler boundaries must exist')
function fixture() {
  const state = { code: 'drop-one-file', dragging: true, calls: [] }
  const dragDepth = { current: 2 }
  const c = { hasLocalReportFileDrag, dragDepth,
    setDropCode(code) { state.code = code }, setDragging(value) { state.dragging = value },
    resetDrag() { dragDepth.current = 0; state.dragging = false },
    revoke() { throw new Error('hover must not abort the current read') },
    setView() { throw new Error('hover must not change the current report') },
  }
  vm.createContext(c)
  vm.runInContext(source.slice(start, end) + '\nglobalThis.handlers = {dragEnter, dragOver, dragLeave}', c)
  const event = transfer => ({ dataTransfer: transfer,
    preventDefault() { state.calls.push('prevent') }, stopPropagation() { state.calls.push('stop') } })
  return { state, dragDepth, run: (name, transfer) => c.handlers[name](event(transfer)) }
}
const protectedTransfer = types => ({ types,
  get files() { throw new Error('hover read protected files') },
  get items() { throw new Error('hover traversed drag items') },
  getData() { throw new Error('hover read private text or URL') },
})
export function registerReportHoverTests(test) {
  for (const type of ['text/plain', 'text/uri-list']) for (const handler of ['dragEnter', 'dragOver']) {
    test(`report hover ${handler} explains ${type} rejection without any drop event`, () => {
      const f = fixture(), transfer = protectedTransfer([type])
      f.run(handler, transfer)
      assert.equal(f.state.code, 'drop-file-required')
      assert.equal(f.state.dragging, false); assert.equal(f.dragDepth.current, 0)
      assert.deepEqual(f.state.calls, ['prevent', 'stop'])
      if (handler === 'dragOver') assert.equal(transfer.dropEffect, 'none')
    })
  }
  for (const handler of ['dragEnter', 'dragOver']) {
    test(`report hover ${handler} fails closed for unavailable metadata before drop`, () => {
      const f = fixture()
      f.run(handler, { get types() { throw new Error('PRIVATE_METADATA') } })
      assert.equal(f.state.code, 'drop-file-required'); assert.equal(f.state.dragging, false)
      assert.deepEqual(f.state.calls, ['prevent', 'stop'])
    })
  }
  test('report hover keeps the original file hint and nested enter/leave accounting', () => {
    const f = fixture(), transfer = protectedTransfer(['Files'])
    f.dragDepth.current = 0; f.state.dragging = false
    f.run('dragEnter', transfer); f.run('dragEnter', transfer); f.run('dragLeave', transfer)
    assert.equal(f.state.dragging, true); assert.equal(f.dragDepth.current, 1)
    f.run('dragOver', transfer); assert.equal(transfer.dropEffect, 'copy')
    f.run('dragLeave', transfer); assert.equal(f.state.dragging, false)
    assert.equal(f.state.code, 'drop-one-file')
  })
  test('report hover stops navigation and parent propagation before inspecting types', () => {
    const f = fixture()
    f.run('dragOver', { get types() { assert.deepEqual(f.state.calls, ['prevent', 'stop']); return ['Files'] } })
    assert.equal(f.state.code, 'drop-one-file')
  })
  test('report hover refusal does not depend on a writable dropEffect property', () => {
    const f = fixture(), transfer = protectedTransfer(['text/plain'])
    Object.defineProperty(transfer, 'dropEffect', { set() { throw new Error('PRIVATE_EFFECT') } })
    assert.doesNotThrow(() => f.run('dragOver', transfer))
    assert.equal(f.state.code, 'drop-file-required')
  })
  test('report hover rejection clears stale highlight but a later file hover still works', () => {
    const f = fixture()
    f.run('dragOver', protectedTransfer(['text/plain']))
    assert.equal(f.dragDepth.current, 0)
    f.run('dragEnter', protectedTransfer(['Files'])); assert.equal(f.dragDepth.current, 1)
    f.run('dragLeave', protectedTransfer(['Files'])); assert.equal(f.state.dragging, false)
    assert.equal(f.state.code, 'drop-file-required')
  })
}
