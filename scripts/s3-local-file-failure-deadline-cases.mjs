import assert from 'node:assert/strict'
import { readLocalOverviewFile } from '../src/services/s3LocalOverviewFile.mjs'
import { reportFixture } from './s3-local-overview-file-cases.mjs'

const raw = new TextEncoder().encode(JSON.stringify(reportFixture()))
const invalidUTF8 = () => { const bytes = raw.slice(); bytes[0] = 0xff; return bytes.buffer }
function fixture(kind, atAfterResult) {
  const state = { at: 100, reads: 0, aborts: 0, timers: new Map(), resultReads: 0 }
  const reader = {
    get result() {
      state.resultReads++; state.at = atAfterResult
      return kind === 'wrong-type' ? 'PRIVATE_RESULT' : kind === 'wrong-length' ? new ArrayBuffer(1) : invalidUTF8()
    },
    readAsArrayBuffer() { state.reads++ },
    abort() { state.aborts++ },
  }
  const options = { readerFactory: () => reader, clock: () => state.at,
    schedule: fn => { state.timers.set(1, fn); return 1 }, cancel: id => state.timers.delete(id) }
  return { state, reader, options, file: { size: raw.byteLength } }
}

export function registerLocalFileFailureDeadlineTests(test) {
  for (const kind of ['wrong-type', 'wrong-length', 'invalid-utf8']) {
    for (const [label, at, expected] of [
      ['before deadline', 5099, kind === 'invalid-utf8' ? 'encoding' : 'read'],
      ['at deadline', 5100, 'timeout'],
      ['after deadline', 5101, 'timeout'],
      ['invalid clock', NaN, 'read'],
      ['backwards clock', 99, 'read'],
    ]) test(`local file failure ${kind} ${label} obeys absolute deadline`, async () => {
      const h = fixture(kind, at)
      const pending = readLocalOverviewFile(h.file, h.options)
      const late = h.reader.onload
      late()
      await assert.rejects(pending, error => error.code === expected && !error.message.includes('PRIVATE'))
      assert.equal(h.state.reads, 1); assert.equal(h.state.resultReads, 1)
      assert.equal(h.state.aborts, 1); assert.equal(h.state.timers.size, 0)
      assert.equal(h.reader.onload, null); assert.equal(h.reader.onerror, null); assert.equal(h.reader.onabort, null)
      late(); assert.equal(h.state.resultReads, 1, 'settled callbacks must not read again')
    })
  }
  test('local file cancellation during result acquisition wins and keeps its first receipt', async () => {
    const h = fixture('wrong-length', 5101), controller = new AbortController()
    const descriptor = Object.getOwnPropertyDescriptor(h.reader, 'result')
    Object.defineProperty(h.reader, 'result', { get() { controller.abort(); return descriptor.get.call(h.reader) } })
    const pending = readLocalOverviewFile(h.file, { ...h.options, signal: controller.signal })
    h.reader.onload()
    await assert.rejects(pending, error => error.code === 'aborted')
    assert.equal(h.state.aborts, 1); assert.equal(h.state.timers.size, 0)
  })
}
