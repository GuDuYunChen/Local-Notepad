import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createFullAppUiShared } from './full-app-ui-shared.mjs'
import { settingsRoutes, prepareSettings, verifySettingsPages } from './full-app-ui-settings.mjs'
import { offlineSettingsRoutes, prepareOfflineSettings, verifyOfflineSettingsPages } from './full-app-ui-offline-settings.mjs'
import { projectsRoutes, prepareProjects, verifyProjectsPages } from './full-app-ui-projects.mjs'
import { researchRoutes, prepareResearch, verifyResearchPages } from './full-app-ui-research.mjs'
import { mainEditorRoutes, prepareMainEditor, verifyMainEditorPages } from './full-app-ui-main-editor.mjs'
import { FULL_APP_MATRIX, validateFullAppUiLedger, validateFullAppUiEvidence } from './full-app-ui-evidence.mjs'

const q = JSON.stringify
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const syncOnly = settings => Object.fromEntries(Object.entries(settings).filter(([name]) => /^(sync_|s3_)/.test(name)).sort(([a], [b]) => a.localeCompare(b)))
const groups = {
  settings: [{ routes: settingsRoutes, prepare: prepareSettings, run: verifySettingsPages },
    { routes: offlineSettingsRoutes, prepare: prepareOfflineSettings, run: verifyOfflineSettingsPages }],
  projects: [{ routes: projectsRoutes, prepare: prepareProjects, run: verifyProjectsPages }],
  research: [{ routes: researchRoutes, prepare: prepareResearch, run: verifyResearchPages }],
  editor: [{ routes: mainEditorRoutes, prepare: prepareMainEditor, run: verifyMainEditorPages }],
}

export async function verifyFullAppUiDesktop(context) {
  const { evaluate, click, cdp, until, api, resize, report, save, group } = context
  for (const name of ['evaluate', 'click', 'until', 'api', 'capture', 'resize', 'save']) assert.equal(typeof context[name], 'function', 'Actual native context is required: ' + name)
  assert.equal(typeof cdp?.onEvent, 'function'); assert.equal(typeof cdp?.send, 'function')
  const ledger = JSON.parse(readFileSync(new URL('./full-app-ui-routes.json', import.meta.url), 'utf8'))
  validateFullAppUiLedger(ledger)
  const modules = groups[group]; assert.ok(modules, 'Unknown actual-page group')
  const routes = modules.flatMap(module => module.routes)
  assert.deepEqual(routes, ledger.groups[group].routes, 'Driver cannot replace the independently reviewed route/state ledger')
  const ui = report.fullAppUi = { schemaVersion: 1, scope: 'installed-actual-app-page-matrix', group,
    complete: false, matrix: structuredClone(FULL_APP_MATRIX), routes: structuredClone(routes),
    setup: {}, scenes: [], focus: [], popups: [], windows: [], externalRequests: [], forbiddenRequests: [], runtimeErrors: [],
    notesUnchanged: false, syncSettingsUnchanged: false }
  save()
  const detach = cdp.onEvent(event => {
    if (event.method === 'Runtime.exceptionThrown') ui.runtimeErrors.push({ text: String(event.params.exceptionDetails?.text || 'Renderer exception'), details: event.params.exceptionDetails?.exception?.description || null })
    if (event.method !== 'Network.requestWillBeSent') return
    const request = event.params.request, url = new URL(request.url)
    if (/^(https?|wss?):$/.test(url.protocol) && url.origin !== 'http://127.0.0.1:27121') ui.externalRequests.push({ origin: url.origin, pathname: url.pathname, method: request.method })
    if (url.origin !== 'http://127.0.0.1:27121') return
    const mutation = /^(POST|PUT|PATCH|DELETE)$/.test(request.method)
    const forbidden = (/^\/api\/(sync|s3)(\/|$)/.test(url.pathname) && mutation) ||
      /^\/api\/sync\/(?:check|probe|run|preview|rebind|initialize)(\/|$)/.test(url.pathname)
    if (forbidden) ui.forbiddenRequests.push({ pathname: url.pathname, method: request.method })
  })
  try {
    const settings = await api('/api/settings'), syncBefore = syncOnly(settings)
    assert.notEqual(settings.sync_enabled, true); assert.notEqual(settings.sync_auto_enabled, true)
    assert.ok(!settings.sync_endpoint && !settings.sync_username && !settings.sync_password && !settings.sync_password_set,
      'The actual-page matrix requires a fresh credential-free synthetic profile')
    ui.syncBeforeSHA256 = hash(syncBefore)
    await cdp.send('Network.enable')
    await evaluate(`(() => {
      if (window.__fullAppUiEvents) throw Error('Refusing an existing UI trace');
      window.__fullAppUiEvents=[];window.__fullAppUiTraceTruncated=false;
      for(const type of ['click','keydown','mouseover','change'])document.addEventListener(type,event=>{
        if(window.__fullAppUiEvents.length>=200000){window.__fullAppUiTraceTruncated=true;return;}
        const field=event.target,option=type==='click'?field.closest?.('[role="option"]'):null;
        const marker=option?.querySelector('[data-ui-option-value]');
        window.__fullAppUiEvents.push({type,key:event.key||null,trusted:event.isTrusted,time:performance.now(),
          tag:field.tagName,id:field.id||null,role:field.getAttribute?.('role')||null,
          fileCount:field.tagName==='INPUT'&&field.type==='file'?field.files?.length||0:null,
          option:marker?{listboxId:option.closest('[role="listbox"]')?.id,value:marker.getAttribute('data-ui-option-value')}:null});
      },true);return true;
    })()`)

    // Setup is explicit and local. Production UI controls still create their
    // own collection, annotation and draft records; no React/storage state is injected.
    const setupWindow = await resize({ width: 1280, height: 800 }, { phase: 'setup' })
    assert.equal(setupWindow.nativeWindow, true); assert.deepEqual(setupWindow.viewport, { width: 1280, height: 800 })
    const setupContext = { ...context, routes, setup: {}, matrix: { theme: await evaluate('document.documentElement.dataset.theme'), viewport: setupWindow.viewport }, windowReceipt: setupWindow }
    setupContext.shared = createFullAppUiShared(setupContext)
    const noteIDs = new Set()
    for (const module of modules) {
      const created = await module.prepare(setupContext)
      assert.ok(created && typeof created === 'object')
      for (const id of created.noteIDs || []) { assert.match(String(id), /^[A-Za-z0-9_-]+$/); assert.equal(noteIDs.has(String(id)), false, 'Modules must not share a fixture note by accident'); noteIDs.add(String(id)) }
      for (const [key, value] of Object.entries(created)) {
        if (key === 'noteIDs') continue
        assert.equal(Object.hasOwn(setupContext.setup, key), false, 'Synthetic setup namespace collided: ' + key)
        setupContext.setup[key] = value
      }
      setupContext.setup.noteIDs = [...noteIDs]; ui.setup = setupContext.setup; save()
    }
    assert.ok(noteIDs.size, 'Actual-page matrix must have owned synthetic documents')
    const notesBefore = await Promise.all([...noteIDs].map(id => api('/api/files/' + encodeURIComponent(id))))
    ui.setup.notesBeforeSHA256 = hash(notesBefore); save()
    for (const matrix of FULL_APP_MATRIX) {
      await setupContext.shared.closeSearch(); await setupContext.shared.closeSettings()
      const windowReceipt = await resize(matrix.viewport)
      assert.equal(windowReceipt.nativeWindow, true); assert.deepEqual(windowReceipt.requested, matrix.viewport); assert.deepEqual(windowReceipt.viewport, matrix.viewport)
      ui.windows.push({ ...matrix, ...windowReceipt }); save()
      const ctx = { ...context, routes, setup: setupContext.setup, matrix, windowReceipt }
      ctx.shared = createFullAppUiShared(ctx)
      await ctx.shared.openSettings()
      if (await evaluate('document.documentElement.dataset.theme') !== matrix.theme) await click('.settings-panel [aria-label="切换主题"]')
      await until(() => evaluate(`document.documentElement.dataset.theme===${q(matrix.theme)}`), 'Actual theme control did not set the requested theme')
      await ctx.shared.closeSettings()
      for (const module of modules) {
        await module.run(ctx)
        assert.deepEqual(ui.externalRequests, [], 'Actual App attempted an external request')
        assert.deepEqual(ui.forbiddenRequests, [], 'Appearance verification attempted sync or remote business work')
        assert.deepEqual(ui.runtimeErrors, [], 'Actual App reported a renderer exception')
      }
      ui.lastCompletedMatrix = structuredClone(matrix); save()
    }
    const notesAfter = await Promise.all([...noteIDs].map(id => api('/api/files/' + encodeURIComponent(id))))
    assert.deepEqual(notesAfter, notesBefore, 'Page appearance work changed an existing synthetic source note')
    ui.notesUnchanged = true; ui.notesAfterSHA256 = hash(notesAfter)
    const syncAfter = syncOnly(await api('/api/settings'))
    assert.deepEqual(syncAfter, syncBefore, 'Page appearance work changed sync/remote configuration')
    ui.syncSettingsUnchanged = true; ui.syncAfterSHA256 = hash(syncAfter)
    assert.equal(await evaluate('window.__fullAppUiTraceTruncated'), false)
    ui.events = await evaluate('window.__fullAppUiEvents')
    assert.ok(ui.events.some(event => event.type === 'click' && event.trusted))
    assert.ok(ui.events.some(event => event.type === 'keydown' && event.key === 'Tab' && event.trusted))
    ui.complete = true; save()
    validateFullAppUiEvidence(ui, ledger)
  } catch (error) {
    ui.complete = false; ui.error = { name: error.name, message: error.message, stack: error.stack, actual: error.actual, expected: error.expected, operator: error.operator }; save(); throw error
  } finally { detach() }
  return ui
}
