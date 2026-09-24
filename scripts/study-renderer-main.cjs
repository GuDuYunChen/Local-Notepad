// Launched only by check-study-renderer.mjs with an isolated temporary profile.
const { app, BrowserWindow } = require('electron')
const [profile, page, phase] = process.argv.slice(2)
if (!profile || !page || !['write', 'read'].includes(phase)) throw new Error('Invalid native study fixture arguments')
app.setPath('userData', profile)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  await window.loadFile(page)
  const result = await window.webContents.executeJavaScript(`(async () => {
    if (!isSecureContext || !navigator.locks || !crypto.subtle) throw new Error('Native file-page storage capabilities unavailable')
    const source = StudyNative.createSearchCollectionStore({ createId: () => 'native-study-fixture' })
    if (${JSON.stringify(phase)} === 'write') {
      const items = Array.from({length: 65}, (_, i) => ({ id: 'native-' + i, title: '合成资料 ' + i, folderPath: '验收', updatedAt: 1, pinned: false, titleMatch: false, bodyOccurrences: 0, contentSHA256: 'a'.repeat(64) }))
      source.save('原生阅读验收', { format: 'local-notepad-search-results', version: 1, exportedAt: '2026-09-24T09:00:00.000Z', mode: 'all', includeSnippets: false,
        scope: { criteria: { query: '', source: 'all', folderId: '', pinned: false, matchCase: false, since: 0, sort: 'title' }, revision: 'b'.repeat(64), total: 65, pages: 4, pageSize: 20, totalOccurrences: 0, scanned: 65, unsupported: 0, folderLabel: '验收' }, count: 65, exportedBodyOccurrences: 0, items })
    }
    const entry = source.list().entries.find(item => item.collection?.id === 'native-study-fixture')
    if (!entry || entry.collection.report.count !== 65) throw new Error('Collection was not retained')
    const study = StudyNative.createCollectionStudyStore()
    let saved = await study.load(entry, source)
    if (${JSON.stringify(phase)} === 'write') {
      const initial = saved
      saved = await study.saveNote(saved, 'native-64', 'revisit', '批注保留中文与换行\\n😀', { sourceStore: source })
      let rejected = false
      try { await study.bookmark(initial, 'native-1', { sourceStore: source }) } catch { rejected = true }
      if (!rejected) throw new Error('Stale write was not rejected')
    }
    if (saved.data.bookmark.id !== 'native-64' || saved.data.records[0].status !== 'revisit' || saved.data.records[0].note !== '批注保留中文与换行\\n😀') throw new Error('Saved reading data differ')
    const backup = study.export(saved, source)
    const preview = study.prepareImport(saved, backup, source)
    saved = await study.import(saved, preview, { sourceStore: source })
    if (source.readUnchanged(entry) !== entry.raw) throw new Error('Source collection changed')
    const packages = StudyNative.createCollectionPackageService({ sourceStore: source, studyStore: study })
    if (${JSON.stringify(phase)} === 'write') {
      const raw = await packages.exportPackage(entry)
      localStorage.setItem('native-package-fixture', raw)
      const first = await packages.prepareImport(raw), second = await packages.prepareImport(raw)
      const results = await Promise.allSettled([packages.confirmImport(first), packages.confirmImport(second)])
      if (results[0].status !== 'fulfilled' || results[1].status !== 'rejected') throw new Error('Concurrent restore failed to reject stale preview')
    }
    const packagePreview = await packages.prepareImport(localStorage.getItem('native-package-fixture'))
    if (packagePreview.action !== 'existing') throw new Error('Restored pair not retained or was duplicated')
    await packages.confirmImport(packagePreview)
    const restoredEntry = source.list().entries.find(item => item.collection?.id === packagePreview.collection.id)
    const paired = await study.load(restoredEntry, source)
    if (paired.data.bookmark.id !== 'native-64' || paired.data.records[0].note !== saved.data.records[0].note || source.list().entries.length !== 2) throw new Error('Restored pair differs after restart')
    const hub = StudyNative.createCollectionStudyHub({ sourceStore: source, studyStore: study })
    const aggregate = await hub.load()
    if (aggregate.rows.length !== 130 || aggregate.counts.notes !== 2 || aggregate.issues.length) throw new Error('Native study hub coverage differs')
    const selected = StudyNative.selectCollectionStudyHub(aggregate, { notesOnly: true })
    if (selected.total !== 2 || new Set(selected.rows.map(row => row.key)).size !== 2) throw new Error('Hub merged separate annotations')
    const readingList = JSON.parse(hub.export(aggregate, { notesOnly: true }, 'json').text)
    if (readingList.count !== 2 || !readingList.items.every(item => item.note === saved.data.records[0].note)) throw new Error('Native hub export lost annotations')
    const located = hub.locate(aggregate, selected.rows[0].key)
    if (located.documentId !== 'native-64') throw new Error('Native hub mapped wrong note')
    const currentStudy = await study.load(entry, source)
    const changedBookmark = await study.bookmark(currentStudy, 'native-0', { sourceStore: source })
    let staleHubRejected = false
    try { hub.export(aggregate, {}, 'json') } catch { staleHubRejected = true }
    if (!staleHubRejected) throw new Error('Native hub exported stale storage')
    await study.bookmark(changedBookmark, 'native-64', { sourceStore: source })
    const batchHub = StudyNative.createCollectionStudyHub({ sourceStore: source, studyStore: study })
    const batch = StudyNative.createCollectionStudyBatch({ hub: batchHub, sourceStore: source, studyStore: study })
    const beforeBatch = await batchHub.load()
    const batchKeys = beforeBatch.rows.filter(row => row.id === 'native-0').map(row => row.key)
    if (${JSON.stringify(phase)} === 'read' && beforeBatch.rows.filter(row => row.id === 'native-0').some(row => row.status !== 'revisit')) throw new Error('Batch manual status was not retained by a fresh process')
    const firstBatch = await batch.prepare(beforeBatch, batchKeys, 'read')
    const competingBatch = await batch.prepare(beforeBatch, batchKeys, 'revisit')
    const batchResults = await Promise.all([batch.apply(firstBatch), batch.apply(competingBatch)])
    if (batchResults[0].changed !== 2 || batchResults[1].changed !== 0) throw new Error('Concurrent native batch did not protect saved statuses')
    const undone = await batch.undo(batchResults[0])
    if (undone.restored !== 2 || undone.remaining) throw new Error('Native batch undo failed')
    const persistModel = await batchHub.load()
    const persistBatch = await batch.prepare(persistModel, batchKeys, 'revisit')
    await batch.apply(persistBatch)
    const finished = await batchHub.load()
    if (finished.rows.filter(row => row.id === 'native-0').some(row => row.status !== 'revisit') || finished.counts.notes !== 2) throw new Error('Native batch altered notes or lost statuses')
    for (const sourceEntry of source.list().entries) {
      const check = await study.load(sourceEntry, source)
      if (check.data.bookmark.id !== 'native-64' || check.data.records.find(row => row.id === 'native-64').note !== saved.data.records[0].note) throw new Error('Native batch changed annotations or bookmarks')
    }
    const compiler = StudyNative.createStudyCompilation({ hub: batchHub, sourceStore: source, studyStore: study,
      request: () => { throw new Error('Native compiler preview must not contact a backend') } })
    const research = await compiler.prepare(finished, finished.rows.filter(row => row.note).map(row => row.key),
      { title: '原生研究预览', goal: '检查配套恢复后的批注', parentId: '', group: 'collection' })
    if (research.count !== 2 || !research.content.includes('批注保留中文与换行') || research.groups.length !== 2) throw new Error('Native research preview lost provenance or annotations')
    const loadedResearch = JSON.parse(research.content)
    const researchLinks = loadedResearch.root.children.flatMap(node => node.children || []).filter(node => node.type === 'wiki-link')
    if (researchLinks.length !== 2 || researchLinks.some(node => node.id !== 'native-64')) throw new Error('Native research links differ')
    return { researchCompilation: true, batchStatuses: true, studyHub: true, pairedRestore: true, records: saved.data.records.length, bookmark: saved.data.bookmark.id, secure: isSecureContext, locks: !!navigator.locks }
  })()`)
  console.log('STUDY_NATIVE_OK:' + phase + ' ' + JSON.stringify(result))
  window.webContents.session.flushStorageData()
  window.destroy(); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
