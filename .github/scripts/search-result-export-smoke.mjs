// Read-only report smoke against the isolated 65-note fixture created by the
// surrounding CI script. Never run against a user's real database.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const [base, folderId] = process.argv.slice(2)
const endpoint = new URL(base)
assert.equal(endpoint.protocol, 'http:')
assert.equal(endpoint.hostname, '127.0.0.1')
assert.ok(folderId)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const directory = await mkdtemp(path.join(os.tmpdir(), 'notepad-search-report-'))
const nativeFetch = globalThis.fetch
try {
  const outfile = path.join(directory, 'report.mjs')
  await build({ entryPoints: [path.join(root, 'src/services/searchResultExport.js')], bundle: true, platform: 'node', format: 'esm', outfile })
  const { collectSearchResultReport, serializeSearchResultReport } = await import(pathToFileURL(outfile).href)
  globalThis.window = { __API_BASE__: base }
  globalThis.fetch = (url, init = {}) => {
    assert.equal(new URL(url).origin, endpoint.origin)
    assert.equal(init.method || 'GET', 'GET')
    return nativeFetch(url, { ...init, headers: { ...init.headers, Origin: 'null' } })
  }
  const filters = { query: '检索验收词', folderId, sort: 'title' }
  const response = await globalThis.fetch(base + '/api/search?' + new URLSearchParams({ q: filters.query, folder_id: folderId, sort: 'title', size: '20' }))
  const initial = (await response.json()).data
  assert.equal(initial.total, 65)
  const report = await collectSearchResultReport(filters, initial, { mode: 'all' })
  assert.equal(report.count, 65)
  assert.equal(new Set(report.items.map(item => item.id)).size, 65)
  assert.equal(report.items.at(-1).title, '检索样例 064.md')
  assert.ok(report.items.every(item => !Object.hasOwn(item, 'snippets') && !Object.hasOwn(item, 'content')))
  const selected = [report.items[1], report.items.at(-1)].map((item, index) => ({ id: item.id, page: index ? 4 : 1, contentSHA256: item.contentSHA256 }))
  const subset = await collectSearchResultReport(filters, initial, { mode: 'selected', selection: selected, includeSnippets: true })
  assert.equal(subset.count, 2)
  assert.deepEqual(subset.items.map(item => item.id), selected.map(item => item.id))
  assert.equal(subset.items[0].snippets[0].match, filters.query)
  const markdown = serializeSearchResultReport(subset, 'markdown')
  assert.ok(markdown.includes('2 篇 / 范围内 65 篇'))
  assert.ok(markdown.includes('检索验收词'))
  const jsonFile = path.join(directory, 'complete.json')
  await writeFile(jsonFile, serializeSearchResultReport(report, 'json'))
  assert.equal(JSON.parse(await readFile(jsonFile, 'utf8')).items.length, 65)
  await assert.rejects(collectSearchResultReport(filters, { ...initial, revision: '0'.repeat(64) }, { mode: 'all' }))
  const collectionModule = path.join(directory, 'collections.mjs')
  await build({ entryPoints: [path.join(root, 'src/services/searchCollections.js')], bundle: true, platform: 'node', format: 'esm', outfile: collectionModule })
  const { createSearchCollectionStore, checkSearchCollection, readSearchCollection } = await import(pathToFileURL(collectionModule).href)
  // File-backed isolated test storage verifies serialized records survive a fresh
  // service instance. It is not a claim about browser/Electron localStorage.
  const storagePath = path.join(directory, 'collection-storage')
  fs.mkdirSync(storagePath)
  const diskStorage = () => ({
    get length() { return fs.readdirSync(storagePath).length },
    key: index => { const name = fs.readdirSync(storagePath)[index]; return name ? decodeURIComponent(name) : null },
    getItem: key => { const file = path.join(storagePath, encodeURIComponent(key)); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null },
    setItem: (key, value) => fs.writeFileSync(path.join(storagePath, encodeURIComponent(key)), value, { flag: 'wx' }),
    removeItem: key => fs.unlinkSync(path.join(storagePath, encodeURIComponent(key))),
  })
  const shelf = createSearchCollectionStore({ storage: diskStorage, createId: () => 'fixture-collection' })
  shelf.save('65篇检索资料', report)
  const reopened = createSearchCollectionStore({ storage: diskStorage }).list()
  assert.equal(reopened.entries[0].collection.report.count, 65)
  const checked = await checkSearchCollection(reopened.entries[0].collection)
  assert.equal(checked.counts.unchanged, 65)
  const raw = shelf.export(reopened.entries[0])
  assert.equal(readSearchCollection(raw).report.items.at(-1).id, report.items.at(-1).id)
  assert.ok(!raw.includes('"snippets"') && !raw.includes('"content"'))
  const historical = structuredClone(reopened.entries[0].collection)
  historical.report.items[0].title = '历史标题'
  historical.report.items[1].contentSHA256 = '0'.repeat(64)
  historical.report.items[2].id = 'missing-fixture-record'
  const drift = await checkSearchCollection(historical)
  assert.deepEqual(drift.counts, { unchanged: 62, body: 1, metadata: 1, outside: 1 })
  assert.equal(drift.otherMatches, 1)
  assert.equal(shelf.list().entries[0].raw, reopened.entries[0].raw)
  const readingModule = path.join(directory, 'collection-reading.mjs')
  await build({ entryPoints: [path.join(root, 'src/services/collectionReading.js')], bundle: true, platform: 'node', format: 'esm', outfile: readingModule })
  const { createCollectionReadingContext, stepCollectionReading, restoreCollectionReading } = await import(pathToFileURL(readingModule).href)
  const reading = createCollectionReadingContext(reopened.entries[0], checked, { query: '', status: 'all' }, report.items[7].id)
  assert.equal(reading.queue.length, 65)
  const next = stepCollectionReading(reading, 1, shelf)
  assert.equal(next.documentId, report.items[8].id)
  assert.equal(restoreCollectionReading(next, shelf).page, 2)
  const reviewModule = path.join(directory, 'collection-review.mjs')
  await build({ entryPoints: [path.join(root, 'src/services/collectionReviewReport.js')], bundle: true, platform: 'node', format: 'esm', outfile: reviewModule })
  const { serializeCollectionReviewReport } = await import(pathToFileURL(reviewModule).href)
  const review = serializeCollectionReviewReport(historical, drift.currentReport, 'json')
  const reviewFile = path.join(directory, 'review.json')
  await writeFile(reviewFile, review.text)
  const reviewRead = JSON.parse(await readFile(reviewFile, 'utf8'))
  assert.equal(reviewRead.rows.length, 65)
  assert.equal(reviewRead.additional.length, 1)
  assert.deepEqual(reviewRead.counts, { historical: 65, unchanged: 62, body: 1, metadata: 1, outside: 1, additional: 1 })
  assert.ok(!review.text.includes('"snippets"') && !review.text.includes('"raw"'))
  assert.ok(serializeCollectionReviewReport(historical, drift.currentReport, 'markdown').text.includes('历史标题'))
  assert.equal(shelf.list().entries[0].raw, reopened.entries[0].raw)
  const studyModule = path.join(directory, 'collection-study.mjs')
  await build({ entryPoints: [path.join(root, 'src/services/collectionStudy.js')], bundle: true, platform: 'node', format: 'esm', outfile: studyModule })
  const { createCollectionStudyStore, COLLECTION_STUDY_PREFIX, nextUnreadCollectionItem } = await import(pathToFileURL(studyModule).href)
  // Disk adapter and lock queue are test fixtures; this is not browser Web Locks
  // or Electron restart validation. Source records remain create-only.
  const studyStorage = () => ({ ...diskStorage(), setItem: (key, value) => {
    assert.ok(key.startsWith(COLLECTION_STUDY_PREFIX))
    fs.writeFileSync(path.join(storagePath, encodeURIComponent(key)), value)
  } })
  let studyTail = Promise.resolve()
  const studyLocks = { request: (_name, _options, callback) => { const next = studyTail.then(callback); studyTail = next.catch(() => {}); return next } }
  const study = createCollectionStudyStore({ storage: studyStorage, locks: () => studyLocks })
  const sourceEntry = reopened.entries[0], studyOptions = { sourceStore: shelf }
  const blankStudy = await study.load(sourceEntry, shelf)
  const firstStudy = await study.saveNote(blankStudy, report.items[0].id, 'read', '已读，保留中文与换行\n😀', studyOptions)
  const finalStudy = await study.saveNote(firstStudy, report.items.at(-1).id, 'revisit', '跨页待复看', studyOptions)
  assert.equal(finalStudy.data.bookmark.id, report.items.at(-1).id)
  assert.equal(nextUnreadCollectionItem(finalStudy).id, report.items[1].id)
  const reopenedStudy = await createCollectionStudyStore({ storage: studyStorage }).load(sourceEntry, shelf)
  assert.deepEqual(reopenedStudy.data, finalStudy.data)
  await assert.rejects(study.bookmark(firstStudy, report.items[1].id, studyOptions), /其他操作/)
  const studyBackupPath = path.join(directory, 'reading-records.json')
  await writeFile(studyBackupPath, study.export(finalStudy, shelf))
  const studyPreview = study.prepareImport(finalStudy, await readFile(studyBackupPath, 'utf8'), shelf)
  const importedStudy = await study.import(finalStudy, studyPreview, studyOptions)
  assert.deepEqual(importedStudy.data.records, finalStudy.data.records)
  assert.equal(shelf.readUnchanged(sourceEntry), sourceEntry.raw)
  console.log('Collection study smoke passed: real 65-note report, explicit manual marks, last-note bookmark, Unicode annotations, fresh disk read, stale-save rejection and backup import; lock/storage adapters, not browser persistence.')
  console.log('Collection reading/review smoke passed: 65-ID queue, cross-page return, complete fresh report, actual JSON disk roundtrip, no history/body writes. UI navigation is separately tested.')
  console.log('Search collection HTTP smoke passed: 65 notes, 4-page current inspection, file-backed metadata roundtrip, synthetic historical body/title/outside differences, unchanged stored history; GET only. Browser persistence not exercised.')
  console.log('Search result export HTTP smoke passed: real service, 65 notes, 4 pages, final revision check, selected first/last pages, metadata-only default, opt-in Unicode snippets, JSON roundtrip, stale-version rejection; GET only.')
} finally {
  globalThis.fetch = nativeFetch
  delete globalThis.window
  await rm(directory, { recursive: true, force: true })
}
