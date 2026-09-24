// Runs only inside the surrounding script's isolated disposable CI fixture.
// It creates one note in the named fixture folder, never overwrites source notes.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const [base, folderId] = process.argv.slice(2), endpoint = new URL(base)
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.protocol, 'http:'); assert.ok(folderId)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'notepad-research-smoke-'))
let posts = 0
const request = async (route, init = {}) => {
  assert.ok(route.startsWith('/api/'))
  assert.ok(['GET', 'POST'].includes(init.method || 'GET'))
  if (init.method === 'POST') { assert.equal(route, '/api/files'); assert.equal(JSON.parse(init.body).parent_id, folderId); posts++ }
  const response = await fetch(new URL(route, base), { ...init, headers: { 'Content-Type': 'application/json', Origin: 'null' } })
  assert.ok(response.ok)
  const body = await response.json(); assert.equal(body.code, 0, JSON.stringify(body)); return body.data
}
try {
  const folder = await request('/api/files/' + encodeURIComponent(folderId))
  assert.equal(folder.title, 'Global Search CI Fixture'); assert.equal(folder.is_folder, true)
  const modulePath = path.join(temporary, 'research.mjs')
  await build({ stdin: { contents: `export { createStudyCompilation } from './src/services/studyCompilation.js';
    export { createCollectionStudyHub } from './src/services/collectionStudyHub.js';
    export { createCollectionStudyStore } from './src/services/collectionStudy.js';
    export { createSearchCollectionStore } from './src/services/searchCollections.js';
    export { memoryStorage } from './src/test/collectionFixtures.js';`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: modulePath })
  const { createStudyCompilation, createCollectionStudyHub, createCollectionStudyStore, createSearchCollectionStore, memoryStorage } = await import(pathToFileURL(modulePath).href)
  const first = await request('/api/search?' + new URLSearchParams({ q: '检索验收词', folder_id: folderId, sort: 'title', size: '20' }))
  const last = await request('/api/search?' + new URLSearchParams({ q: '检索验收词', folder_id: folderId, sort: 'title', size: '20', page: '4', revision: first.revision }))
  assert.equal(first.total, 65)
  const selected = [first.items[0], last.items.at(-1)]
  const originals = await Promise.all(selected.map(item => request('/api/files/' + encodeURIComponent(item.id))))
  const report = { format: 'local-notepad-search-results', version: 1, exportedAt: new Date().toISOString(), mode: 'selected', includeSnippets: false,
    scope: { criteria: { query: '检索验收词', source: 'all', folderId, since: 0, pinned: false, matchCase: false, sort: 'title' }, revision: first.revision, total: 65, pages: 4, pageSize: 20, totalOccurrences: first.total_occurrences, scanned: first.scanned, unsupported: first.unsupported, folderLabel: 'CI Fixture' },
    count: 2, exportedBodyOccurrences: selected.reduce((sum, item) => sum + item.body_count, 0),
    items: selected.map(item => ({ id: item.id, title: item.title, folderPath: item.folder_path, updatedAt: item.updated_at, pinned: item.is_pinned, titleMatch: item.title_match, bodyOccurrences: item.body_count, contentSHA256: item.content_sha256 })) }
  const storage = memoryStorage(), source = createSearchCollectionStore({ storage: () => storage })
  source.save('研究来源', report); const entry = source.list().entries[0]
  const study = createCollectionStudyStore({ storage: () => storage, locks: () => ({ request: (_name, _options, fn) => Promise.resolve().then(fn) }) })
  let snapshot = await study.load(entry, source)
  for (const item of selected) snapshot = await study.saveNote(snapshot, item.id, 'revisit', '人工观察：此处需要再次核对。\n中文😀', { sourceStore: source })
  const before = snapshot.raw
  const hub = createCollectionStudyHub({ storage: () => storage, sourceStore: source, studyStore: study })
  const model = await hub.load(), compilation = createStudyCompilation({ hub, sourceStore: source, studyStore: study, request })
  const preview = await compilation.prepare(model, model.rows.map(row => row.key), { title: '研究笔记写入验收', goal: '核对来源', group: 'collection', parentId: folderId })
  assert.equal(posts, 0)
  const created = await compilation.create(preview)
  const repeated = await compilation.create(preview); assert.equal(repeated.id, created.id); assert.equal(posts, 1)
  const actual = await request('/api/files/' + encodeURIComponent(created.id)); assert.equal(actual.content, preview.content)
  const links = JSON.parse(actual.content).root.children.flatMap(node => node.children || []).filter(node => node.type === 'wiki-link')
  assert.deepEqual(links.map(link => link.id), selected.map(item => item.id))
  for (let index = 0; index < selected.length; index++) {
    const unchanged = await request('/api/files/' + encodeURIComponent(selected[index].id))
    assert.equal(unchanged.content, originals[index].content)
    const backlinks = await request('/api/files/' + encodeURIComponent(selected[index].id) + '/backlinks')
    assert.ok(backlinks.some(link => link.source_id === created.id))
  }
  assert.equal((await study.load(entry, source)).raw, before); assert.equal(source.readUnchanged(entry), entry.raw)
  await writeFile(path.join(temporary, 'research.md'), preview.markdown)
  assert.equal(await readFile(path.join(temporary, 'research.md'), 'utf8'), preview.markdown)
  console.log('Research compilation HTTP smoke passed: first/last-page annotations, one create POST, actual saved rich-text readback, source WikiLinks/backlinks, unchanged source body and saved annotations, repeat-confirm no-op, Markdown disk roundtrip. Reading storage/lock adapters are fixtures, not native persistence.')
} finally { await rm(temporary, { recursive: true, force: true }) }
