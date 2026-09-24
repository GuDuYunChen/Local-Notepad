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
    const entry = source.list().entries[0]
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
    return { records: saved.data.records.length, bookmark: saved.data.bookmark.id, secure: isSecureContext, locks: !!navigator.locks }
  })()`)
  console.log('STUDY_NATIVE_OK:' + phase + ' ' + JSON.stringify(result))
  window.webContents.session.flushStorageData()
  window.destroy(); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
