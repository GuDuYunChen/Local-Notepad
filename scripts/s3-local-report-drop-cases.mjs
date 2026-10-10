import assert from 'node:assert/strict'
import { hasLocalReportFileDrag as has, selectLocalReportDrop as select } from '../src/services/s3LocalReportDrop.mjs'
export function registerLocalReportDropTests(test) {
  test('report drop hover uses only types, never protected files or contents', () => {
    let reads = 0
    assert.equal(has({ types: ['Files'], get files() { reads++; throw Error('PRIVATE') } }), true)
    assert.equal(reads, 0)
    for (const types of [[], ['text/plain'], ['text/uri-list']]) assert.equal(has({ types }), false)
  })
  test('report drop invalid metadata is a fixed refusal without private errors', () => {
    for (const transfer of [null, {}, { get files() { throw Error('PRIVATE_PATH') } }]) {
      assert.deepEqual(select(transfer), { code: 'drop-unavailable', file: null })
    }
    assert.equal(has({ get types() { throw Error('PRIVATE') } }), false)
  })
  test('report drop selects the sole file without reading names, paths or bytes', () => {
    const file = { get name() { throw Error('PRIVATE') }, get size() { throw Error('not read here') } }
    const result = select({ files: [file] }); assert.equal(result.file, file)
    assert.equal(result.code, 'drop-selected'); assert.ok(Object.isFrozen(result))
  })
  test('report drop rejects multiple files before obtaining an individual file', () => {
    const files = { length: 2, get 0() { throw Error('must not read') } }
    assert.deepEqual(select({ files }), { code: 'drop-one-file', file: null })
  })
  test('report drop text and URL payloads never become files or network requests', () => {
    const transfer = { files: [], getData() { throw Error('must not fetch text') } }
    assert.equal(select(transfer).code, 'drop-file-required')
  })
  test('report drop rejects directory entries without traversal', () => {
    let calls = 0
    const entry = { isDirectory: true, createReader() { throw Error('must not traverse') } }
    const result = select({ files: [{}], items: [{ kind: 'file', webkitGetAsEntry() { calls++; return entry } }] })
    assert.equal(result.code, 'drop-directory'); assert.equal(calls, 1)
  })
  test('report drop accepts a file entry and browsers without entry metadata', () => {
    const file = new Blob(['{}'])
    for (const items of [undefined, [], [{ kind: 'file' }], [{ kind: 'file', webkitGetAsEntry: () => null }],
      [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }]]) assert.equal(select({ files: [file], items }).file, file)
  })
  test('report drop entry exceptions do not expose paths or start file reads', () => {
    const result = select({ files: [{}], items: [{ kind: 'file', webkitGetAsEntry() { throw Error('PRIVATE_FOLDER') } }] })
    assert.deepEqual(result, { code: 'drop-unavailable', file: null })
  })
  test('report drop ignores textual metadata accompanying one genuine file', () => {
    const file = {}
    assert.equal(select({ files: [file], items: [{ kind: 'string', get webkitGetAsEntry() { throw Error('do not read') } }] }).file, file)
  })
  test('report drop invalid file-list length never coerces or indexes payloads', () => {
    for (const length of [undefined, NaN, -1, 1.5, '1', Infinity]) assert.equal(select({ files: { length } }).code, 'drop-unavailable')
    assert.equal(select({ files: { length: 1 } }).code, 'drop-unavailable')
  })
  test('report drop refuses oversized or invalid item metadata without enumeration', () => {
    for (const length of [17, -1, 0.5, '1']) {
      assert.equal(select({ files: [{}], items: { length, get 0() { throw Error('not indexed') } } }).code, 'drop-unavailable')
    }
  })
  test('report drop leaves byte size and encoding checks to the unchanged reader', () => {
    const file = new Blob(['x'.repeat(4097)])
    assert.equal(select({ files: [file] }).file, file)
    assert.equal(file.size, 4097)
  })
}
