// Separate scope: the ordinary four-group zero-sync driver stays unchanged.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createFullAppUiShared } from './full-app-ui-shared.mjs'
import { localSyncLabRoutes, prepareLocalSyncLab, verifyLocalSyncLabPages } from './full-app-ui-local-sync-lab.mjs'
import { FULL_APP_MATRIX, validateFullAppUiLedger, validateFullAppUiEvidence } from './full-app-ui-evidence.mjs'
import { captureSyncPlan } from '../src/services/syncPlanView.mjs'

const q = JSON.stringify
const sha = value => createHash('sha256').update(q(value)).digest('hex')
const readPaths = new Set(['/api/settings', '/api/diagnostics', '/api/files', '/api/tags', '/api/folders',
  '/api/sync/status', '/api/sync/activity', '/api/sync/conflicts', '/api/sync/conflicts/history'])
export function classifyLocalSyncLabRequest(request) {
  const url = new URL(request.url)
  if (['file:', 'data:', 'blob:'].includes(url.protocol)) return 'asset'
  if (url.origin !== 'http://127.0.0.1:27121') throw Error('Local-lab matrix refuses an external request: ' + url.origin)
  const method = request.method
  if (method === 'GET' && (readPaths.has(url.pathname) || /^\/api\/files\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname))) return 'read'
  const body = (() => { try { return JSON.parse(request.postData || '') } catch { return null } })()
  if (method === 'POST' && url.pathname === '/api/sync/plan' && !url.search && body && typeof body === 'object' && Object.keys(body).length === 0 && !Array.isArray(body)) return 'plan'
  if (method === 'PUT' && url.pathname === '/api/settings' && !url.search && body && Object.keys(body).length === 1 && ['light', 'dark'].includes(body.theme)) return 'theme'
  throw Error('Local-lab matrix refuses method/path/body: ' + method + ' ' + url.pathname)
}

export function validateLocalSyncLabPlan(raw, seed) {
  const snapshot = captureSyncPlan(raw, 'preview')
  assert.equal(snapshot.detailState, 'complete'); assert.equal(snapshot.needsInit, true)
  assert.deepEqual(snapshot.counts, { uploads: 21, downloads: 0, conflicts: 0, noops: 0 })
  assert.equal(raw.store_id, ''); assert.equal(raw.revision, ''); assert.equal(raw.generation, 0)
  assert.deepEqual([...raw.items.map(item => item.id)].sort(), [...seed.noteIDs].sort())
  for (const item of raw.items) {
    assert.equal(item.action, 'upload'); assert.equal(item.base_hash, ''); assert.equal(item.remote_hash, '')
    assert.equal(item.local_hash, seed.records.find(record => record.itemID === item.id)?.local)
  }
  return snapshot
}

export async function verifyLocalSyncLabDesktop(context) {
  const { evaluate, click, cdp, until, api, resize, report, save, group } = context
  assert.equal(group, 'local-sync-lab')
  for (const name of ['evaluate', 'click', 'until', 'api', 'capture', 'resize', 'save']) assert.equal(typeof context[name], 'function')
  const ledger = JSON.parse(readFileSync(new URL('./full-app-ui-routes.json', import.meta.url), 'utf8'))
  validateFullAppUiLedger(ledger); assert.deepEqual(ledger.groups[group].routes, localSyncLabRoutes)
  const seed = report.localSyncLabSeed; assert.equal(seed?.complete, true)
  assert.equal(seed.seedDigest, sha({ after: seed.after, records: seed.records }))
  const ui = report.fullAppUi = { schemaVersion: 1, scope: 'installed-actual-app-page-matrix', group, complete: false,
    matrix: structuredClone(FULL_APP_MATRIX), routes: structuredClone(localSyncLabRoutes), setup: {}, scenes: [], focus: [], popups: [], windows: [],
    externalRequests: [], forbiddenRequests: [], runtimeErrors: [], notesUnchanged: false, syncSettingsUnchanged: false,
    localSyncLab: { seedDigest: seed.seedDigest, requests: [], allowedPlanRequests: [], viewReceipts: [], initialTheme: seed.settingsBefore.theme,
      themeRestored: false, logicalSnapshotRequiredAfterNormalExit: true, noSyncExecution: true } }
  save()
  const planRequests = new Map(), pendingResponses = new Set()
  const detach = cdp.onEvent(event => {
    if (event.method === 'Runtime.exceptionThrown') ui.runtimeErrors.push({ text: String(event.params.exceptionDetails?.text || 'Renderer exception'), details: event.params.exceptionDetails?.exception?.description || null })
    if (event.method === 'Network.requestWillBeSent') {
      const request = event.params.request
      try {
        const kind = classifyLocalSyncLabRequest(request), url = new URL(request.url)
        const record = { requestId: event.params.requestId, kind, method: request.method, pathname: url.pathname, search: url.search,
          ...(request.postData === undefined ? {} : { body: request.postData }) }
        ui.localSyncLab.requests.push(record)
        if (kind === 'plan') { ui.localSyncLab.allowedPlanRequests.push(record); planRequests.set(record.requestId, record) }
      } catch (error) {
        const url = new URL(request.url), record = { origin: url.origin, pathname: url.pathname, method: request.method, error: String(error.message) }
        ;(url.origin === 'http://127.0.0.1:27121' ? ui.forbiddenRequests : ui.externalRequests).push(record)
      }
    }
    if (event.method === 'Network.loadingFinished' && planRequests.has(event.params.requestId)) {
      const record = planRequests.get(event.params.requestId)
      const work = (async () => {
        const response = await cdp.send('Network.getResponseBody', { requestId: record.requestId })
        const bytes = response.base64Encoded ? Buffer.from(response.body, 'base64') : Buffer.from(response.body)
        const envelope = JSON.parse(bytes.toString('utf8')); assert.equal(envelope.code, 0)
        record.responseBytes = bytes.length; record.responseText = bytes.toString('utf8')
        record.responseSHA256 = createHash('sha256').update(bytes).digest('hex'); record.response = envelope.data
        record.snapshot = validateLocalSyncLabPlan(envelope.data, seed); record.complete = true; save()
      })().catch(error => { record.error = String(error.message); ui.runtimeErrors.push({ text: 'Actual plan response failed strict seed validation', details: String(error.stack) }); save() })
      pendingResponses.add(work); work.finally(() => pendingResponses.delete(work))
    }
  })
  try {
    await cdp.send('Network.enable')
    await evaluate(`(() => {
      if(window.__fullAppUiEvents)throw Error('Refusing an existing UI trace');
      window.__fullAppUiEvents=[];window.__fullAppUiTraceTruncated=false;
      for(const type of ['click','keydown','mouseover','change'])document.addEventListener(type,event=>{
        if(window.__fullAppUiEvents.length>=200000){window.__fullAppUiTraceTruncated=true;return;}
        const field=event.target,option=type==='click'?field.closest?.('[role="option"]'):null,marker=option?.querySelector('[data-ui-option-value]');
        window.__fullAppUiEvents.push({type,key:event.key||null,trusted:event.isTrusted,time:performance.now(),tag:field.tagName,id:field.id||null,role:field.getAttribute?.('role')||null,
          buttonText:type==='click'?field.closest?.('button')?.textContent.trim().slice(0,80)||null:null,
          fileCount:field.tagName==='INPUT'&&field.type==='file'?field.files?.length||0:null,
          option:marker?{listboxId:option.closest('[role="listbox"]')?.id,value:marker.getAttribute('data-ui-option-value')}:null});
      },true);return true;
    })()`)
    const setupWindow = await resize({ width: 1280, height: 800 }, { phase: 'setup' })
    assert.equal(setupWindow.nativeWindow, true); assert.deepEqual(setupWindow.viewport, { width: 1280, height: 800 })
    const setupContext = { ...context, routes: localSyncLabRoutes, setup: {}, matrix: { theme: await evaluate('document.documentElement.dataset.theme'), viewport: setupWindow.viewport }, windowReceipt: setupWindow }
    setupContext.shared = createFullAppUiShared(setupContext)
    setupContext.setup = await prepareLocalSyncLab(setupContext); ui.setup = setupContext.setup
    const settingsBefore = await api('/api/settings'), notesBefore = setupContext.setup.localSyncLab.files
    assert.equal(settingsBefore.theme, seed.settingsBefore.theme)
    ui.syncBeforeSHA256 = sha(settingsBefore); ui.setup.notesBeforeSHA256 = sha(notesBefore); save()
    for (const matrix of FULL_APP_MATRIX) {
      await setupContext.shared.closeSettings()
      const windowReceipt = await resize(matrix.viewport)
      assert.equal(windowReceipt.nativeWindow, true); assert.deepEqual(windowReceipt.requested, matrix.viewport); assert.deepEqual(windowReceipt.viewport, matrix.viewport)
      ui.windows.push({ ...matrix, ...windowReceipt }); save()
      const ctx = { ...context, routes: localSyncLabRoutes, setup: setupContext.setup, matrix, windowReceipt }
      ctx.shared = createFullAppUiShared(ctx)
      await ctx.shared.openSettings()
      if (await evaluate('document.documentElement.dataset.theme') !== matrix.theme) await click('.settings-panel [aria-label="切换主题"]')
      await until(() => evaluate(`document.documentElement.dataset.theme===${q(matrix.theme)}`), 'Actual lab theme did not change')
      await verifyLocalSyncLabPages(ctx)
      assert.deepEqual(ui.externalRequests, []); assert.deepEqual(ui.forbiddenRequests, []); assert.deepEqual(ui.runtimeErrors, [])
      ui.lastCompletedMatrix = structuredClone(matrix); save()
    }
    // Restore through the same real UI so the final all-table snapshot can be
    // identical, including theme. No field is filtered from the DB comparison.
    await setupContext.shared.openSettings()
    if (await evaluate('document.documentElement.dataset.theme') !== settingsBefore.theme) await click('.settings-panel [aria-label="切换主题"]')
    await until(async () => q(await api('/api/settings')) === q(settingsBefore), 'Actual UI did not restore all original settings')
    await setupContext.shared.closeSettings(); ui.localSyncLab.themeRestored = true
    await Promise.all([...pendingResponses])
    assert.equal(ui.localSyncLab.allowedPlanRequests.length, FULL_APP_MATRIX.length)
    assert.ok(ui.localSyncLab.allowedPlanRequests.every(item => item.complete === true))
    assert.deepEqual(ui.externalRequests, []); assert.deepEqual(ui.forbiddenRequests, []); assert.deepEqual(ui.runtimeErrors, [])
    const notesAfter = await Promise.all(seed.noteIDs.map(id => api('/api/files/' + encodeURIComponent(id))))
    assert.deepEqual(notesAfter, notesBefore); ui.notesUnchanged = true; ui.notesAfterSHA256 = sha(notesAfter)
    assert.deepEqual(await api('/api/settings'), settingsBefore); ui.syncSettingsUnchanged = true; ui.syncAfterSHA256 = sha(settingsBefore)
    const trace = await evaluate('({events:window.__fullAppUiEvents,truncated:window.__fullAppUiTraceTruncated})')
    assert.equal(trace.truncated, false)
    const previews = trace.events.filter(event => event.type === 'click' && event.buttonText === '预演同步')
    assert.equal(previews.length, FULL_APP_MATRIX.length); assert.ok(previews.every(event => event.trusted))
    assert.equal(trace.events.some(event => event.type === 'click' && ['执行同步', '确认处理此冲突', '检查连接', '重新绑定远端'].includes(event.buttonText)), false)
    ui.localSyncLab.trustedPreviewClicks = previews; ui.events = trace.events
    ui.complete = true; save(); validateFullAppUiEvidence(ui, ledger)
  } catch (error) {
    ui.complete = false; ui.error = { name: error.name, message: String(error.message), actual: error.actual, expected: error.expected, operator: error.operator, stack: String(error.stack) }; save(); throw error
  } finally { detach() }
  return ui
}
