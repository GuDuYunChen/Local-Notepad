// Read-only report smoke against the isolated 65-note fixture created by the
// surrounding CI script. Never run against a user's real database.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
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
  console.log('Search result export HTTP smoke passed: real service, 65 notes, 4 pages, final revision check, selected first/last pages, metadata-only default, opt-in Unicode snippets, JSON roundtrip, stale-version rejection; GET only.')
} finally {
  globalThis.fetch = nativeFetch
  delete globalThis.window
  await rm(directory, { recursive: true, force: true })
}
