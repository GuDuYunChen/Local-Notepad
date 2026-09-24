// Runs only inside the surrounding script's isolated disposable CI fixture.
// It creates one note in the named fixture folder, never overwrites source notes.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

const [base, folderId] = process.argv.slice(2), endpoint = new URL(base)
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.protocol, 'http:'); assert.ok(folderId)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'notepad-research-smoke-'))
let posts = 0
const request = async (route, init = {}) => {
  assert.ok(route.startsWith('/api/'))
  assert.ok(['GET', 'POST'].includes(init.method || 'GET'))
  if (init.method === 'POST') { assert.ok(route === '/api/files' || /^\/api\/research-notes\/[0-9a-f-]{36}$/.test(route)); assert.equal(JSON.parse(init.body).parent_id, folderId); posts++ }
  const response = await fetch(new URL(route, base), { ...init, headers: { 'Content-Type': 'application/json', Origin: 'null' } })
  assert.ok(response.ok)
  const body = await response.json(); assert.equal(body.code, 0, JSON.stringify(body)); return body.data
}
try {
  const folder = await request('/api/files/' + encodeURIComponent(folderId))
  assert.equal(folder.title, 'Global Search CI Fixture'); assert.equal(folder.is_folder, true)
  const modulePath = path.join(temporary, 'research.mjs')
  await build({ stdin: { contents: `export { createStudyCompilation } from './src/services/studyCompilation.js';
    export { createResearchTaskStore, createResearchTaskService } from './src/services/researchTasks.js';
    export { createCollectionStudyHub } from './src/services/collectionStudyHub.js';
    export { createCollectionStudyStore } from './src/services/collectionStudy.js';
    export { createSearchCollectionStore } from './src/services/searchCollections.js';
    export { memoryStorage } from './src/test/collectionFixtures.js';`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: modulePath })
  const { createResearchTaskStore, createResearchTaskService, createStudyCompilation, createCollectionStudyHub, createCollectionStudyStore, createSearchCollectionStore, memoryStorage } = await import(pathToFileURL(modulePath).href)
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
  // Exercise the exact production idempotent route, not the legacy adapter.
  const locks = () => ({ request: (_name, _options, fn) => Promise.resolve().then(fn) })
  const tasks = createResearchTaskStore({ storage: () => storage, locks })
  let dropResponse = true
  const responseLoss = async (route, init = {}) => {
    const result = await request(route, init)
    if (init.method === 'POST' && dropResponse) { dropResponse = false; throw new Error('fixture: response lost AFTER server commit') }
    return result
  }
  const durable = createResearchTaskService({ store: tasks, request: responseLoss })
  const compiler2 = createStudyCompilation({ hub, sourceStore: source, studyStore: study, request, creationService: durable })
  const durablePreview = await compiler2.prepare(model, model.rows.map(row => row.key), { title: '可查回研究验收', goal: '中断恢复', group: 'status', parentId: folderId })
  await compiler2.saveDraft(durablePreview)
  assert.equal(posts, 1, 'saving a preview must not POST')
  await assert.rejects(compiler2.create(durablePreview), error => error.mayHaveCreated === true)
  assert.equal(posts, 2)
  const pending = tasks.list()[0]; assert.equal(pending.task.phase, 'uncertain')
  // Serialize the local journal to disk and reload into a fresh client instance.
  const journal = []
  for (let i = 0; i < storage.length; i++) { const key = storage.key(i); journal.push([key, storage.getItem(key)]) }
  await writeFile(path.join(temporary, 'tasks.json'), JSON.stringify(journal))
  const reloaded = memoryStorage()
  for (const [key, value] of JSON.parse(await readFile(path.join(temporary, 'tasks.json'), 'utf8'))) reloaded.setItem(key, value)
  const reopenedStore = createResearchTaskStore({ storage: () => reloaded, locks })
  const reopened = createResearchTaskService({ store: reopenedStore, request })
  const checked = await reopened.check(reopenedStore.list()[0])
  assert.equal(posts, 2, 'GET after lost response must not create another file')
  assert.equal(checked.receipt.state, 'available')
  const retried = await reopened.submit(checked.entry)
  assert.equal(retried.receipt.file_id, checked.receipt.file_id); assert.equal(posts, 2)
  const task = reopenedStore.read(retried.entry)
  const route = '/api/research-notes/' + task.id
  const payload = { title: durablePreview.title, content: durablePreview.content, parent_id: folderId }
  const replay = await request(route, { method: 'POST', body: JSON.stringify(payload) })
  assert.equal(replay.file_id, checked.receipt.file_id); assert.equal(replay.payload_sha256, task.payloadSHA256)
  const savedNote = await request('/api/files/' + replay.file_id)
  assert.equal(savedNote.content, durablePreview.content)
  const countResult = await request('/api/files?' + new URLSearchParams({ parent_id: folderId, q: durablePreview.title, size: '200' }))
  assert.equal(countResult.filter(item => item.id === replay.file_id).length, 1)
  // A conflicting body cannot rebind an existing request. No PUT/DELETE here.
  const conflict = await fetch(new URL(route, base), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null' }, body: JSON.stringify({ ...payload, title: '不能替换.md' }) })
  assert.notEqual((await conflict.json()).code, 0)
  const absentId = randomUUID()
  const absent = await request('/api/research-notes/' + absentId)
  assert.equal(absent.found, false); assert.equal(absent.request_id, absentId)
  // URL identity wins over query/body fields. This also catches framework parsing regressions.
  const injected = await fetch(new URL(route + '?requestId=' + absentId, base), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null' }, body: JSON.stringify({ ...payload, requestId: absentId }) })
  const injectionReply = await injected.json(); assert.equal(injectionReply.code, 0)
  assert.equal(injectionReply.data.request_id, task.id); assert.equal((await request('/api/research-notes/' + absentId)).found, false)
  for (let index = 0; index < selected.length; index++) {
    assert.equal((await request('/api/files/' + selected[index].id)).content, originals[index].content)
    const backlinks = await request('/api/files/' + selected[index].id + '/backlinks')
    assert.ok(backlinks.some(link => link.source_id === replay.file_id))
  }
  assert.equal((await study.load(entry, source)).raw, before)
  console.log('Durable research HTTP check passed: explicit draft save, real commit with deliberately lost response, disk-journal reload, GET-only recovery, same-ID replay, conflicting payload rejection, route identity protection, real rich-text/backlink readback and unchanged sources. The local journal adapters are fixtures, not native Electron storage.')
  console.log('Research compilation HTTP smoke passed: first/last-page annotations, one create POST, actual saved rich-text readback, source WikiLinks/backlinks, unchanged source body and saved annotations, repeat-confirm no-op, Markdown disk roundtrip. Reading storage/lock adapters are fixtures, not native persistence.')
} finally { await rm(temporary, { recursive: true, force: true }) }
