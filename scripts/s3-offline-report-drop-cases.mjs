import assert from 'node:assert/strict'
import { createOfflineReportDrop } from '../src/services/s3OfflineReportDrop.mjs'

function fixture() {
  const state = { active: true, files: [], feedback: [], highlights: [] }
  const handlers = createOfflineReportDrop({ isActive: () => state.active,
    onFile: file => state.files.push(file), onFeedback: code => state.feedback.push(code),
    onHighlight: value => state.highlights.push(value) })
  const event = transfer => ({ dataTransfer: transfer, prevented: 0, stopped: 0,
    preventDefault() { this.prevented++ }, stopPropagation() { this.stopped++ } })
  return { state, handlers, event }
}
const transfer = files => ({ types: ['Files'], files })
export function registerOfflineReportDropTests(test) {
  test('offline drop construction performs no reads or feedback', () => {
    const { state, handlers } = fixture()
    assert.deepEqual(state.files, []); assert.deepEqual(state.feedback, [])
    assert.ok(Object.isFrozen(handlers))
  })
  test('offline drop hover inspects types only and contains events before metadata access', () => {
    const { state, handlers, event } = fixture(); let e
    const data = { get types() { assert.equal(e.prevented, 1); assert.equal(e.stopped, 1); return ['Files'] },
      get files() { throw Error('must not read files during hover') }, get items() { throw Error('must not read items during hover') } }
    e = event(data); handlers.enter(e); e = event(data); handlers.over(e)
    assert.equal(data.dropEffect, 'copy'); assert.equal(state.highlights.at(-1), true); assert.equal(state.files.length, 0)
  })
  test('offline drop text hover updates refusal without relying on a drop event', () => {
    const { state, handlers, event } = fixture()
    const text = { types: ['text/plain'], getData() { throw Error('must not read text') } }
    handlers.enter(event(text)); handlers.over(event(text))
    assert.equal(state.feedback.at(-1), 'drop-file-required'); assert.equal(text.dropEffect, 'none')
    assert.equal(state.highlights.at(-1), false); assert.equal(state.files.length, 0)
  })
  test('offline drop nested enters do not clear highlight on the first child leave', () => {
    const { state, handlers, event } = fixture(); const e = () => event(transfer([]))
    handlers.enter(e()); handlers.enter(e()); handlers.leave(e())
    assert.equal(state.highlights.at(-1), true); handlers.leave(e()); assert.equal(state.highlights.at(-1), false)
    handlers.leave(e()); handlers.enter(e()); handlers.end(e()); assert.equal(state.highlights.at(-1), false)
  })
  for (const [name, data, code] of [
    ['empty', transfer([]), 'drop-file-required'],
    ['multiple', transfer([{}, {}]), 'drop-one-file'],
    ['directory', { ...transfer([{}]), items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }] }, 'drop-directory'],
    ['text', { types: ['text/plain'], files: [] }, 'drop-file-required'],
    ['missing', undefined, 'drop-file-required'],
    ['unreadable', { types: ['Files'], get files() { throw Error('PRIVATE') } }, 'drop-unavailable'],
  ]) test(`offline drop refuses ${name} without selecting a file`, () => {
    const { state, handlers, event } = fixture(); const e = event(data); handlers.drop(e)
    assert.equal(e.prevented, 1); assert.equal(e.stopped, 1)
    assert.equal(state.feedback.at(-1), code); assert.equal(state.files.length, 0); assert.equal(state.highlights.at(-1), false)
  })
  test('offline drop forwards exactly one native File object and does not read its properties', () => {
    const { state, handlers, event } = fixture()
    const file = new Proxy({}, { get() { throw Error('must leave file validation to the bounded reader') } })
    handlers.drop(event(transfer([file])))
    assert.equal(state.files.length, 1); assert.equal(state.files[0], file); assert.equal(state.feedback.at(-1), '')
  })
  test('offline drop revoked scope does not even reflect transfer metadata', () => {
    const { state, handlers, event } = fixture(); state.active = false
    const data = new Proxy({}, { get() { throw Error('stale metadata read') } })
    for (const method of ['enter', 'over', 'leave', 'end', 'drop']) {
      const e = event(data); handlers[method](e); assert.equal(e.prevented, 1); assert.equal(e.stopped, 1)
    }
    assert.equal(state.files.length, 0); assert.equal(state.feedback.length, 0)
  })
  test('offline drop rechecks scope after native metadata selection', () => {
    const { state, handlers, event } = fixture()
    const data = { types: ['Files'], get files() { state.active = false; return [{}] } }
    handlers.drop(event(data)); assert.equal(state.files.length, 0); assert.equal(state.feedback.length, 0)
  })
  test('offline drop sides have independent selection and hover state', () => {
    const a = fixture(), b = fixture(), fileA = {}, fileB = {}
    a.handlers.enter(a.event(transfer([]))); b.handlers.drop(b.event(transfer([fileB])))
    assert.equal(a.state.highlights.at(-1), true); assert.deepEqual(a.state.files, [])
    a.handlers.drop(a.event(transfer([fileA])))
    assert.equal(a.state.files[0], fileA); assert.equal(b.state.files[0], fileB)
  })
}
