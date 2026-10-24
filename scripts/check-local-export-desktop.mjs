import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { localExportDesktopDocument } from './local-export-desktop-fixture.bundle.mjs'
import { LOCAL_EXPORT_FIXTURE as F } from './local-export-desktop-values.mjs'
import { exportSHA256, validateExportFeedbackVisibility } from './local-export-desktop-evidence.mjs'

const q = JSON.stringify, panel = '[data-local-export-workspace]'
const itemSelector = id => '[data-local-export-item=' + q(id) + ']'
const fixtureUploadNames = ['export102-a.png', 'export102-b.png', 'export102.txt']
const fixtureUploadMessages = new Set([
  'OK', '请选择文件', '文件大小超过限制 (100MB)', '文件读取失败', '服务端错误: 无法创建上传目录', '保存文件失败',
  '不支持的文件类型: .png', '不支持的文件类型: .txt',
  '文件内容类型不匹配: application/octet-stream', '文件内容类型不匹配: text/plain',
  '文件内容类型不匹配: text/plain; charset=utf-8', '文件内容类型不匹配: text/html; charset=utf-8',
])
function fixtureUploadEvidence(name, httpStatus = null, result = null) {
  return { name, httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
    code: Number.isSafeInteger(result?.code) && result.code >= 0 && result.code <= 65535 ? result.code : null,
    message: result === null ? 'RESPONSE_JSON_UNAVAILABLE' : fixtureUploadMessages.has(result?.message) ? result.message : 'UNRECOGNIZED_SERVER_MESSAGE' }
}
export function localExportDirectoryInventory(directory) {
  const files = []
  const walk = current => {
    for (const name of readdirSync(current).sort()) {
      const filename = path.join(current, name), stat = lstatSync(filename)
      assert.equal(stat.isSymbolicLink(), false)
      if (stat.isDirectory()) walk(filename)
      else {
        assert.equal(stat.isFile(), true)
        const bytes = readFileSync(filename)
        files.push({ filename: path.relative(directory, filename).replaceAll('\\', '/'), bytes: bytes.length,
          sha256: exportSHA256(bytes), mtimeMs: stat.mtimeMs })
      }
    }
  }
  walk(directory); return files
}
export async function observeLocalExportView(evaluate) {
  return evaluate(`(() => {
    const root=document.querySelector(${q(panel)});if(!root)return null;
    return {phase:root.dataset.phase,state:root.dataset.state,items:[...root.querySelectorAll('[data-local-export-item]')].map(node=>({
      id:node.dataset.localExportItem,status:node.dataset.status,title:node.querySelector('.export-item-heading strong')?.textContent||'',
      path:node.querySelector('.export-item-path')?.textContent||'',preview:node.querySelector('pre')?.textContent||'',
      bytes:node.dataset.outputBytes===undefined?null:Number(node.dataset.outputBytes),sha256:node.dataset.outputSha256||null,
      message:node.querySelector(':scope > .export-error,:scope > .export-item-message')?.textContent||'',
      warnings:[...node.querySelectorAll('.export-warnings li')].map(n=>n.textContent)
    }))};
  })()`)
}
export async function observeLocalExportFeedback(evaluate, feedback, controls) {
  return evaluate(`(() => {
    const read=selector=>{
      const node=document.querySelector(selector);if(!node)return null;
      const r=node.getBoundingClientRect();let rendered=Boolean(node.getClientRects().length);
      for(let p=node;p;p=p.parentElement){const s=getComputedStyle(p);if(p.hidden||p.getAttribute('aria-hidden')==='true'||s.display==='none'||['hidden','collapse'].includes(s.visibility)||Number(s.opacity)<=0)rendered=false;}
      return {text:node.textContent.trim(),disabled:Boolean(node.disabled),rendered,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},
        hitPoints:[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([fx,fy])=>{const x=r.left+r.width*fx,y=r.top+r.height*fy,h=document.elementFromPoint(x,y);return{x,y,matched:Boolean(h&&(h===node||node.contains(h)))}})};
    };
    return{viewport:{width:window.innerWidth,height:window.innerHeight},feedback:read(${q(feedback)}),controls:${q(controls)}.map(read)};
  })()`)
}

export async function refreshLocalExportLibrary({ evaluate, click, until }, requiredSelector, label) {
  const ready = () => evaluate(`(() => {
    const sidebar=document.querySelector('.workspace-sidebar');
    return Boolean(sidebar&&!sidebar.classList.contains('collapsed')&&
      sidebar.querySelector('.file-list .tree-list')&&sidebar.querySelector(${q(requiredSelector)}));
  })()`)
  await evaluate("window.dispatchEvent(new Event('library:refresh'))")
  let expansionRequested = false
  return until(async () => {
    // The tree is absent while the actual FileList read is pending. Frames
    // only settle its rendered result, including App's narrow-window selection.
    if (await ready()) {
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
      if (await ready()) return true
    }
    if (!expansionRequested && await evaluate("Boolean(document.querySelector('.workspace-sidebar.collapsed button[aria-label=\"展开侧边栏\"]'))")) {
      // Never replay an uncertain native click; its rejection propagates
      // through the original bounded until without becoming a later success.
      expansionRequested = true
      await click('button[aria-label="展开侧边栏"]')
    }
    return false
  }, label)
}

export async function verifyLocalExportDesktop(context) {
  const { report, save, mark, api, evaluate, click, cdp, until, capture, directorySession,
    binding, ownedRoot, dataDirectory, requests } = context
  const view = () => observeLocalExportView(evaluate)
  const settle = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
  const key = async (name, code, modifiers = 0) => {
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', {
      type, key: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers,
    })
  }
  const waitView = (count, state) => until(async () => {
    const value = await view()
    return value?.items.length === count && value.state === state && !['running', 'cancelling', 'choosing'].includes(value.phase) ? value : null
  }, 'Local export result did not settle as ' + state)
  const close = async () => {
    await click(panel + ' [aria-label="关闭导出工作台"]')
    await until(() => evaluate(`!document.querySelector(${q(panel)})`), 'Export workbench did not close')
  }
  const visibility = async (feedback, controls) => {
    await settle(); const result = await observeLocalExportFeedback(evaluate, feedback, controls)
    validateExportFeedbackVisibility(result); return result
  }
  const open = async (title, count, format) => {
    await refreshLocalExportLibrary({ evaluate, click, until }, 'button[aria-label="更多笔记操作"]', 'Original export library missing')
    await click('button[aria-label="更多笔记操作"]'); await click('[data-local-export-entry]')
    await until(() => evaluate("document.querySelector('#selector-dialog-title')?.textContent==='选择导出内容'"), 'Original export selection dialog missing')
    // Real selection controls clear any selection retained by the file list.
    const all = await evaluate("document.querySelector('.selector-toolbar button')?.textContent.trim()")
    if (all === '全选') await click({ selector: '.selector-toolbar button', text: '全选' })
    await click({ selector: '.selector-toolbar button', text: '取消全选' })
    // React owns the controlled selection state. Wait for the clear to commit
    // before toggling the folder; otherwise a stale checked prop can turn the
    // next click into a deselection on a fast installed-app run.
    await until(() => evaluate("document.querySelector('.selector-toolbar .selector-counter')?.textContent.trim() === '已选择 0 项' && [...document.querySelectorAll('.selector-tree input[type=\\\"checkbox\\\"]')].every(input => !input.checked)"),
      'Original export selection did not clear')
    const selectionSelector = '.selector-tree .tree-item[title=' + q(title) + '] input[type="checkbox"]'
    await click(selectionSelector)
    await until(() => evaluate(`(() => {
      const checkbox = document.querySelector(${q(selectionSelector)})
      const counter = document.querySelector('.selector-toolbar .selector-counter')?.textContent.trim()
      return checkbox?.checked === true && counter !== '已选择 0 项'
    })()`), 'Original export folder selection did not settle')
    await click({ selector: '.selector-modal-footer button', text: '下一步' })
    await until(() => evaluate(`Boolean(document.querySelector(${q(panel)}))`), 'Original export workbench missing')
    if (format === 'docx') await click(panel + ' input[value="docx"]')
    await click('[data-local-export-prepare]')
    return waitView(count, 'prepared')
  }
  const destination = async (label, cancel = false) => {
    const directory = cancel ? undefined : path.join(ownedRoot, 'exports', label)
    if (directory) mkdirSync(directory, { recursive: true })
    await click('[data-local-export-choose]')
    await until(() => directorySession.inspect(binding), 'Owned native directory picker missing')
    const result = cancel ? await directorySession.cancel(binding) : await directorySession.choose(binding, directory)
    report.directoryActions.push({ binding: structuredClone(binding), ...(directory ? { directory } : {}), result }); save()
    await until(() => evaluate(`!document.querySelector('[data-local-export-choose]')?.disabled`), 'Native directory result not returned to original workbench')
    return directory
  }
  const completedFiles = value => value.items.filter(item => item.status === 'succeeded').map(item => {
    const stat = lstatSync(item.path); assert.equal(stat.isFile(), true); assert.equal(stat.isSymbolicLink(), false)
    const bytes = readFileSync(item.path)
    assert.equal(bytes.length, item.bytes); assert.equal(exportSHA256(bytes), item.sha256)
    return { id: item.id, path: item.path, bytes: bytes.length, sha256: exportSHA256(bytes), mtimeMs: stat.mtimeMs }
  }).sort((a, b) => a.id.localeCompare(b.id))
  const batchRoot = directory => {
    const names = readdirSync(directory); assert.equal(names.length, 1); assert.ok(names[0].startsWith('Notepad-export-'))
    return path.join(directory, names[0])
  }
  const uploads = path.join(dataDirectory, 'uploads')
  const upload = async (name, bytes, type) => {
    const evidence = report.fixtureUploads ??= []
    assert.ok(Array.isArray(evidence) && evidence.length < fixtureUploadNames.length, 'Export fixture upload limit')
    assert.equal(name, fixtureUploadNames[evidence.length], 'Unexpected export fixture upload order')
    const receipt = { ...fixtureUploadEvidence(name), message: 'NO_RESPONSE' }
    evidence.push(receipt); save()
    const failure = () => 'Export fixture upload failed: ' + q(receipt)
    const data = new FormData(); data.append('file', new Blob([bytes], { type }), name)
    let response
    try {
      response = await fetch('http://127.0.0.1:27121/api/upload', { method: 'POST', body: data, headers: { Origin: 'null' }, signal: AbortSignal.timeout(4000) })
    } catch {
      receipt.message = 'REQUEST_FAILED'; save(); throw new Error(failure())
    }
    Object.assign(receipt, fixtureUploadEvidence(name, response.status), { message: 'RESPONSE_NOT_READ' }); save()
    assert.equal(response.status, 200, failure())
    const result = await response.json().catch(() => null)
    Object.assign(receipt, fixtureUploadEvidence(name, response.status, result)); save()
    // AssertionError can append actual values even with a custom message.
    assert.ok(Number.isSafeInteger(result?.code) && result.code >= 0 && result.code <= 65535, failure())
    assert.equal(result.code, 0, failure())
    assert.match(result.data.url, /^\/uploads\/[^/\\]+$/)
    const filename = path.join(uploads, decodeURIComponent(result.data.url.slice('/uploads/'.length)))
    assert.deepEqual(readFileSync(filename), bytes)
    return { url: result.data.url, filename, bytes: bytes.length, sha256: exportSHA256(bytes) }
  }
  const png = Buffer.from(F.pngBase64, 'base64')
  const imageA = await upload('export102-a.png', png, 'image/png'), imageB = await upload('export102-b.png', png, 'image/png')
  const attachment = await upload('export102.txt', Buffer.from(F.attachment), 'text/plain')
  const expectedBodies = new Map()
  const create = async value => {
    const result = await api('/api/files', { method: 'POST', body: JSON.stringify(value) })
    assert.match(result.id, /^[a-zA-Z0-9-]+$/)
    if (!value.is_folder) expectedBodies.set(result.id, value.content)
    return result
  }
  const folder = await create({ title: 'EXPORT102 文档集合', is_folder: true })
  const note = await create({ title: 'EXPORT102 原文.md', parent_id: folder.id,
    content: localExportDesktopDocument({ image: imageA.url, attachment: attachment.url }) })
  const frozen = await create({ title: 'EXPORT102 重名.md', parent_id: folder.id,
    content: localExportDesktopDocument({ image: imageA.url, attachment: attachment.url }) })
  // Full sibling titles stay unique; both extensions map to the same export stem.
  const failing = await create({ title: 'EXPORT102 重名.txt', parent_id: folder.id,
    content: localExportDesktopDocument({ image: imageB.url, attachment: attachment.url }) })
  const cancellationFolder = await create({ title: 'EXPORT102 取消后继续', is_folder: true })
  for (let i = 0; i < 100; i++) await create({ title: 'EXPORT102 Batch ' + String(i + 1).padStart(3, '0') + '.md',
    parent_id: cancellationFolder.id, content: localExportDesktopDocument({ body: F.body + ' batch ' + i }) })
  await refreshLocalExportLibrary({ evaluate, click, until }, '[data-file-id="' + folder.id + '"]', 'Export fixture folder missing')
  if (await evaluate(`document.querySelector('[data-file-id="${folder.id}"]')?.getAttribute('aria-expanded')==='false'`)) await click('[data-file-id="' + folder.id + '"]')
  await click('[data-file-id="' + note.id + '"]')
  await until(() => evaluate(`document.querySelector('.editor-input')?.innerText.includes(${q(F.body)})&&!document.querySelector('.save-state')`), 'Canonical export note not clean in actual editor')
  report.fixture = { folderID: folder.id, noteID: note.id, frozenID: frozen.id, failingID: failing.id,
    cancellationFolderID: cancellationFolder.id, documents: expectedBodies.size, imageA, imageB, attachment }
  mark('actual-app-and-canonical-synthetic-documents')
  const mutationCursor = requests().length
  report.dirty = { startedAt: Date.now(), databaseBefore: (await api('/api/files/' + note.id)).content, explicitNativeInputs: 1 }
  await evaluate(`(() => {window.__export102Input=[];document.addEventListener('input',event=>{if(event.target?.closest?.('.editor-input'))window.__export102Input.push({isTrusted:event.isTrusted,type:event.inputType,data:event.data})},{capture:true,passive:true});return true})()`)
  await click('.editor-input[contenteditable="true"]'); await key('End', 35, 2)
  await cdp.send('Input.insertText', { text: F.dirty })
  // Do not begin with whitespace: Chromium may normalize a leading space at
  // a contenteditable boundary. Wait for the actual marker first, then verify
  // that it was trusted input and has not reached the persistent note API.
  await until(() => evaluate(`document.querySelector('.editor-input')?.innerText.includes(${q(F.dirty)})`), 'Actual unsaved draft text did not reach Lexical')
  report.dirty.trustedInput = await evaluate(`window.__export102Input.some(event=>event.isTrusted===true&&event.data===${q(F.dirty)})`)
  assert.equal(report.dirty.trustedInput, true, 'Unsaved draft was not produced by native trusted input')
  report.dirty.databaseAfterInput = (await api('/api/files/' + note.id)).content
  assert.equal(report.dirty.databaseAfterInput, report.dirty.databaseBefore, 'Draft was persisted before export preview')
  report.preview = await open(folder.title, 3, 'markdown'); report.entries = ['more-notes', 'selector', 'workbench']
  mark('original-entry-selection-and-preview')
  assert.ok(report.preview.items.every(item => !item.preview.includes(F.dirty)))
  mark('unsaved-editor-draft-excluded')
  await capture('local-export-preview.png')
  await destination('unused', true); report.afterDirectoryCancel = await view()
  assert.deepEqual(report.afterDirectoryCancel, report.preview)
  report.visibility = { directoryCancel: await visibility('[data-local-export-feedback]', ['[data-local-export-choose]', '[data-local-export-status]']) }
  mark('native-directory-cancel-retains-preview')
  const markdownDirectory = await destination('markdown'); mark('native-directory-selection-owned')
  const changedBody = localExportDesktopDocument({ body: F.frozen, image: imageA.url, attachment: attachment.url })
  await api('/api/files/' + frozen.id, { method: 'PUT', body: JSON.stringify({ content: changedBody }) })
  expectedBodies.set(frozen.id, changedBody)
  report.frozen = { originalPreviewIncludesOldBody: report.preview.items.find(item => item.id === frozen.id).preview.includes(F.body),
    databaseAfterPreviewIncludesNewBody: (await api('/api/files/' + frozen.id)).content.includes(F.frozen) }
  await click('[data-local-export-start]'); report.markdown = await waitView(3, 'completed')
  await capture('local-export-markdown.png')
  assert.equal(new Set(report.markdown.items.map(item => item.path.toLowerCase())).size, 3)
  mark('markdown-relative-assets-and-name-collisions')
  const frozenOutput = readFileSync(report.markdown.items.find(item => item.id === frozen.id).path, 'utf8')
  report.frozen.exportContainsOldBody = frozenOutput.includes('EXPORT102 saved body')
  report.frozen.exportContainsNewBody = frozenOutput.includes(F.frozen)
  assert.equal(report.frozen.exportContainsOldBody, true); assert.equal(report.frozen.exportContainsNewBody, false)
  mark('frozen-preview-excludes-later-body-change')
  await close()
  report.dirty.afterExportIncludesDraft = await evaluate(`document.querySelector('.editor-input')?.innerText.includes(${q(F.dirty)})`)
  report.dirty.databaseAfter = (await api('/api/files/' + note.id)).content
  report.dirty.rendererWrites = requests().slice(mutationCursor).filter(item => /\/api\/files(?:\/|$)/.test(item.path)).length
  report.dirty.finishedAt = Date.now()
  assert.equal(report.dirty.databaseAfter, report.dirty.databaseBefore); assert.equal(report.dirty.rendererWrites, 0)
  assert.ok(report.dirty.finishedAt - report.dirty.startedAt < 30000)
  await click('.editor-input[contenteditable="true"]'); await key('z', 90, 2)
  await until(() => evaluate(`!document.querySelector('.editor-input')?.innerText.includes(${q(F.dirty)})&&!document.querySelector('.save-state')`), 'Undo did not preserve original clean editor after export')
  report.dirty.undoRestoredOriginal = true; save()

  await open(folder.title, 3, 'markdown'); const partialDirectory = await destination('partial')
  const held = imageB.filename + '.export102-held'; renameSync(imageB.filename, held)
  try {
    const response = await fetch('http://127.0.0.1:27121' + imageB.url, { signal: AbortSignal.timeout(4000) })
    report.failure = { realHTTPStatus: response.status }; await response.body?.cancel(); assert.equal(response.status, 404)
    await click('[data-local-export-start]'); report.partial = await waitView(3, 'partial')
    const row = report.partial.items.find(item => item.id === failing.id); assert.equal(row.status, 'failed')
    const root = batchRoot(partialDirectory), relative = row.path.replaceAll('\\', '/')
    const files = localExportDirectoryInventory(root)
    report.failure.failedDocumentAbsent = !files.some(item => item.filename === relative)
    const assetFolder = relative.replace(/\.md$/, '_assets/')
    report.failure.failedAssetsAbsent = !files.some(item => item.filename.startsWith(assetFolder))
    report.failure.successfulFilesBeforeRetry = completedFiles(report.partial)
    await evaluate(`document.querySelector(${q(itemSelector(failing.id) + ' > .export-error')})?.scrollIntoView({block:'center'})`)
    report.visibility.partial = await visibility(itemSelector(failing.id) + ' > .export-error', ['[data-local-export-retry]', '[data-local-export-status]'])
    await capture('local-export-partial.png'); mark('real-missing-asset-partial-failure')
  } finally { renameSync(held, imageB.filename) }
  report.failure.restoredOriginalAssetBytes = readFileSync(imageB.filename).equals(png)
  await click('[data-local-export-retry]'); report.retry = await waitView(3, 'completed')
  const successfulIDs = new Set(report.failure.successfulFilesBeforeRetry.map(item => item.id))
  report.failure.successfulFilesAfterRetry = completedFiles(report.retry).filter(item => successfulIDs.has(item.id))
  assert.deepEqual(report.failure.successfulFilesAfterRetry, report.failure.successfulFilesBeforeRetry)
  mark('retry-only-failed-preserves-successful-files'); await close()

  await open(folder.title, 3, 'docx'); await destination('word')
  await click('[data-local-export-start]'); report.word = await waitView(3, 'completed')
  await capture('local-export-word.png'); mark('word-body-table-image-and-attachment'); await close()

  await open(cancellationFolder.title, 100, 'docx'); const cancellationDirectory = await destination('cancelled')
  await click('[data-local-export-start]'); await click('[data-local-export-cancel]')
  report.cancelled = await waitView(100, 'cancelled')
  report.cancellation = { filesAtSettled: localExportDirectoryInventory(batchRoot(cancellationDirectory)),
    successfulFilesBeforeContinue: completedFiles(report.cancelled) }
  report.visibility.cancelled = await visibility('[data-local-export-feedback]', ['[data-local-export-continue]', '[data-local-export-status]'])
  await capture('local-export-cancelled.png')
  await sleep(800)
  await click('[data-local-export-status]')
  await until(() => evaluate("!document.querySelector('[data-local-export-status]')?.disabled"), 'Cancelled status could not be retrieved')
  report.cancellation.filesAfterObservation = localExportDirectoryInventory(batchRoot(cancellationDirectory))
  assert.deepEqual(report.cancellation.filesAfterObservation, report.cancellation.filesAtSettled)
  assert.deepEqual(await view(), report.cancelled)
  report.cancellation.confirmedStableWithoutLateFiles = true
  mark('actual-cancel-settles-without-late-files')
  await click('[data-local-export-continue]'); report.continued = await waitView(100, 'completed')
  const beforeContinue = new Set(report.cancellation.successfulFilesBeforeContinue.map(item => item.id))
  report.cancellation.successfulFilesAfterContinue = completedFiles(report.continued).filter(item => beforeContinue.has(item.id))
  assert.deepEqual(report.cancellation.successfulFilesAfterContinue, report.cancellation.successfulFilesBeforeContinue)
  await capture('local-export-continued.png'); mark('continue-only-unfinished-documents')
  await click('[data-local-export-reveal]')
  await until(() => evaluate("document.querySelector('[data-local-export-feedback]')?.textContent.includes('已请求打开导出文件夹')"), 'Reveal action was not confirmed by the original workbench')
  report.reveal = { visibleRequestedFeedback: true }; mark('reveal-requests-export-directory'); await close()
  for (const [id, content] of expectedBodies) assert.equal((await api('/api/files/' + id)).content, content)
  report.originalNotesUnchanged = true
  report.rendererMutationRequests = requests().slice(mutationCursor).filter(item => /\/api\/files(?:\/|$)/.test(item.path))
  assert.equal(report.rendererMutationRequests.length, 0)
  mark('original-note-bodies-and-editor-protection')
  return { exportDirectory: path.join(ownedRoot, 'exports'), filesBeforeExit: localExportDirectoryInventory(path.join(ownedRoot, 'exports')) }
}
