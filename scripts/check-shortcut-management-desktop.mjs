import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { SHORTCUT_FIXTURE, shortcutManagementNote } from './shortcut-management-desktop-fixture.mjs'
import { SHORTCUT_MANAGEMENT_STORAGE_KEY, assertShortcutManagementConfiguration,
  assertShortcutManagementRefusalVisibility } from './shortcut-management-desktop-evidence.mjs'

const q = JSON.stringify
const hash = value => createHash('sha256').update(value).digest('hex')
const panel = '[data-shortcut-settings="true"]'
const recorder = '[data-shortcut-recorder="true"]'
const row = '[data-shortcut-command="focusMode"]'
const snapshot = content => ({ content, sha256: hash(content) })

// A read-only observer of native input, installed before any settings recorder.
// It never calls a production action, changes a binding or mutates an input.
export async function observeShortcutManagementKeys(evaluate) {
  return evaluate(`(() => {
    if (window.__shortcut101Keys) throw Error('Native shortcut observer already installed');
    window.__shortcut101Keys = [];
    for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
      if (window.__shortcut101Keys.length >= 512) throw Error('Native shortcut observation budget exceeded');
      window.__shortcut101Keys.push({type:event.type,key:event.key,isTrusted:event.isTrusted,
        ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,metaKey:event.metaKey,
        repeat:event.repeat,isComposing:event.isComposing,at:performance.now(),
        recorder:event.target?.getAttribute?.('data-shortcut-recorder')==='true'});
    }, {capture:true, passive:true});
    return true;
  })()`)
}

// Observe the state already presented by the product. Reading text alone cannot
// prove a refusal is visible, and scrolling here would conceal a product defect.
export async function observeShortcutManagementRefusal(evaluate) {
  return evaluate(`(() => {
    const dialog = document.querySelector(${q(panel)});
    const scroll = dialog?.querySelector('.local-shortcuts-scroll');
    const card = dialog?.querySelector('.local-shortcuts-recorder-panel');
    const footer = dialog?.querySelector('.local-shortcuts-footer');
    if (!dialog || !scroll || !card || !footer) return null;
    const rect = node => {
      const r = node.getBoundingClientRect();
      return {left:r.left, top:r.top, right:r.right, bottom:r.bottom};
    };
    const rendered = node => {
      if (!node?.isConnected || !node.getClientRects().length) return false;
      for (let current = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (current.hidden || current.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) ||
          Number(style.opacity) <= 0) return false;
      }
      return true;
    };
    const observe = node => {
      if (!node) return null;
      const r = rect(node);
      return {text:(node.tagName === 'INPUT' ? node.value : node.textContent).trim(), rect:r,
        disabled:Boolean(node.disabled), rendered:rendered(node),
        hitPoints:[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([fx,fy]) => {
          const x=r.left+(r.right-r.left)*fx, y=r.top+(r.bottom-r.top)*fy;
          const hit=document.elementFromPoint(x,y);
          return {x,y,matched:Boolean(hit && (hit===node || node.contains(hit)))};
        })};
    };
    const input = card.querySelector(${q(recorder)});
    const feedback = card.querySelector('#shortcut-recording-feedback[role="alert"]');
    const buttons = Array.from(card.querySelectorAll('.local-shortcuts-recorder-actions button'));
    const cancel = buttons.find(node => node.textContent.trim() === '取消录入');
    const accept = buttons.find(node => ['使用此快捷键','替换冲突快捷键'].includes(node.textContent.trim()));
    const r = rect(scroll), left = r.left + scroll.clientLeft, top = r.top + scroll.clientTop;
    return {
      viewport:{width:window.innerWidth,height:window.innerHeight,devicePixelRatio:window.devicePixelRatio},
      command:card.closest('[data-shortcut-command]')?.getAttribute('data-shortcut-command'),
      commandCount:dialog.querySelectorAll('[data-shortcut-command]').length, focused:document.activeElement===input,
      dialog:rect(dialog), footer:rect(footer), recordingPanel:rect(card),
      scroll:{viewport:{left,top,right:left+scroll.clientWidth,bottom:top+scroll.clientHeight},
        clientWidth:scroll.clientWidth,clientHeight:scroll.clientHeight,scrollWidth:scroll.scrollWidth,
        scrollHeight:scroll.scrollHeight,scrollLeft:scroll.scrollLeft,scrollTop:scroll.scrollTop},
      nodes:{recorder:observe(input),feedback:observe(feedback),cancel:observe(cancel),accept:observe(accept)}
    };
  })()`)
}

function controls(context) {
  const { evaluate, cdp, until, click, report, save, processID, api } = context
  const settle = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
  const focus = () => evaluate('Boolean(document.querySelector(".focus-mode"))')
  const raw = () => evaluate(`localStorage.getItem(${q(SHORTCUT_MANAGEMENT_STORAGE_KEY)})`)
  const body = () => api('/api/files/' + report.editor.noteID).then(file => file.content)
  const key = async (label, name, code, modifiers = 0) => {
    const cursor = await evaluate('window.__shortcut101Keys.length')
    const action = { label, key: name, modifiers, processID, beforeFocus: await focus(),
      explicitNativeInputs: 1, events: [] }
    report.actions.push(action); save()
    try {
      for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', {
        type, key: name, code: /^F\d+$/.test(name) ? name : 'Key' + name.toUpperCase(),
        windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers,
      })
      await settle()
      action.afterFocus = await focus()
      action.events = await evaluate(`window.__shortcut101Keys.slice(${cursor})`)
      save(); return action
    } catch (error) {
      action.error = String(error?.message || error)
      try { action.events = await evaluate(`window.__shortcut101Keys.slice(${cursor})`) } catch {}
      save(); throw error // Never replay an uncertain native input.
    }
  }
  const named = (text, selector = panel + ' button') => click({ selector, text })
  const opened = () => until(() => evaluate(`Boolean(document.querySelector(${q(panel)}))`), 'Shortcut settings did not open')
  const closed = () => until(() => evaluate(`!document.querySelector(${q(panel)})`), 'Shortcut settings did not close')
  const close = async () => { await click(panel + ' [aria-label="关闭快捷键设置"]'); await closed() }
  const help = async suffix => { await key('help-' + suffix, 'F1', 112); await opened() }
  const edit = async () => {
    await click('[data-shortcut-edit="focusMode"]')
    await until(() => evaluate(`document.activeElement?.matches(${q(recorder)})`), 'Shortcut recorder did not receive real focus')
  }
  const text = async (selector, value) => {
    await click(selector)
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', {
      type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
    })
    if (value) await cdp.send('Input.insertText', { text: value })
    else for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', {
      type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
    })
    await until(() => evaluate(`document.querySelector(${q(selector)})?.value===${q(value)}`), 'Native settings text input did not settle')
  }
  const openNote = async () => {
    await evaluate("window.dispatchEvent(new Event('library:refresh'))")
    await until(() => evaluate(`Boolean(document.querySelector('[data-file-id="${report.editor.noteID}"]'))`), 'Shortcut fixture missing from real library')
    await click(`[data-file-id="${report.editor.noteID}"]`)
    await until(() => evaluate(`document.querySelector('.editor-input[contenteditable="true"]')?.innerText.includes(${q(SHORTCUT_FIXTURE.body)})`), 'Shortcut fixture did not load into actual editor')
    await until(() => evaluate("!document.querySelector('.save-state')"), 'Shortcut fixture unexpectedly dirty before native editing')
  }
  return { key, focus, raw, body, named, opened, closed, close, help, edit, text, openNote, settle }
}

export async function verifyShortcutManagementBeforeRestart(context) {
  const { report, mark, save, api, evaluate, click, cdp, until, capture, requests } = context
  const ui = controls(context)
  report.storage = { key: SHORTCUT_MANAGEMENT_STORAGE_KEY, initial: await ui.raw() }
  assert.equal(report.storage.initial, null, 'This workflow requires its own empty Chromium profile')
  const file = await api('/api/files', { method: 'POST', body: JSON.stringify({
    title: SHORTCUT_FIXTURE.title, content: shortcutManagementNote(),
  }) })
  assert.match(file.id || '', /^[a-zA-Z0-9-]+$/)
  report.editor = { noteID: file.id, before: snapshot((await api('/api/files/' + file.id)).content) }
  assert.deepEqual(JSON.parse(report.editor.before.content), JSON.parse(shortcutManagementNote()))
  await ui.openNote(); mark('actual-app-and-synthetic-document')
  const initialNoteCount = await evaluate('document.querySelectorAll("[data-file-id]").length')
  const initialRequestCount = requests().length

  await click('[aria-label="更多功能"]')
  await ui.named('快捷键', '.workspace-sidebar-more-menu [role="menuitem"]'); await ui.opened()
  report.entries = ['more']
  report.search = { initialCount: await evaluate(`document.querySelectorAll(${q(panel + ' [data-shortcut-command]')}).length`) }
  assert.equal(report.search.initialCount, 15)
  await ui.text('[data-shortcut-search="true"]', '专注')
  report.search.filteredCount = await evaluate(`document.querySelectorAll(${q(panel + ' [data-shortcut-command]')}).length`)
  report.search.filteredCommand = await evaluate(`document.querySelector(${q(panel + ' [data-shortcut-command]')})?.getAttribute('data-shortcut-command')`)
  assert.equal(report.search.filteredCount, 1); assert.equal(report.search.filteredCommand, 'focusMode')
  await ui.text('[data-shortcut-search="true"]', '')
  report.search.restoredCount = await evaluate(`document.querySelectorAll(${q(panel + ' [data-shortcut-command]')}).length`)
  assert.equal(report.search.restoredCount, 15)
  await capture('shortcut-management-entry.png'); await ui.close()
  await click('[aria-label="更多功能"]'); await ui.named('设置', '.workspace-sidebar-more-menu [role="menuitem"]')
  await until(() => evaluate("Boolean(document.querySelector('.settings-panel'))"), 'Settings entry did not open')
  await ui.named('管理', '.settings-panel .settings-row button'); await ui.opened()
  report.entries.push('settings'); await ui.close()
  await click('.settings-panel [aria-label="返回笔记"]'); await ui.openNote()
  await ui.help('first'); report.entries.push('help'); mark('existing-panel-entries-and-search')

  await ui.edit(); await ui.key('record-reserved-save', 's', 83, 2)
  const alertText = () => evaluate(`Array.from(document.querySelectorAll(${q(panel + ' [role="alert"]')})).map(n=>n.textContent).join(${q('\n')})`)
  report.refusals = {}
  const visibleRefusal = async (kind, expectedText) => {
    const value = await alertText()
    const observation = await observeShortcutManagementRefusal(evaluate)
    report.refusals[kind + 'Visibility'] = observation; save()
    assertShortcutManagementRefusalVisibility(observation, kind)
    assert.equal(observation.nodes.feedback.text, value.trim())
    return value.includes(expectedText) && value
  }
  report.refusals.reservedText = await until(() => visibleRefusal('reserved', '保存'), 'Reserved save key was not visibly refused')
  await ui.named('取消录入')
  await ui.edit(); await ui.key('record-conflict', 'k', 75, 2)
  report.refusals.conflictText = await until(() => visibleRefusal('conflict', '快速切换笔记'), 'Conflicting quick-switch key was not visibly identified')
  report.refusals.storageUnchanged = (await ui.raw()) === report.storage.initial
  assert.equal(report.refusals.storageUnchanged, true)
  await capture('shortcut-management-conflict.png')
  const conflictImage = report.screenshots.find(item => item.filename === 'shortcut-management-conflict.png')
  assert.ok(conflictImage, 'Conflict screenshot must have its original byte receipt')
  report.refusals.conflictScreenshot = { ...conflictImage, before: report.refusals.conflictVisibility,
    after: await observeShortcutManagementRefusal(evaluate) }; save()
  assertShortcutManagementRefusalVisibility(report.refusals.conflictScreenshot.after, 'conflict')
  assert.deepEqual(report.refusals.conflictScreenshot.after, report.refusals.conflictScreenshot.before,
    'Conflict feedback or its visible controls changed while the screenshot was captured')
  await ui.named('取消录入')
  mark('reserved-and-conflicting-keys-refused')
  report.recording = {
    backgroundFocusUnchanged: await ui.focus() === false,
    backgroundNoteCountUnchanged: await evaluate('document.querySelectorAll("[data-file-id]").length') === initialNoteCount,
    bodyUnchanged: await ui.body() === report.editor.before.content,
    writeRequests: requests().length - initialRequestCount,
  }
  assert.deepEqual(report.recording, { backgroundFocusUnchanged: true, backgroundNoteCountUnchanged: true, bodyUnchanged: true, writeRequests: 0 })
  mark('recording-isolates-background-commands')

  await ui.edit(); await ui.key('record-cancel', 'j', 74, 3)
  await ui.named('取消录入'); await ui.close()
  report.storage.afterCancel = await ui.raw(); assert.equal(report.storage.afterCancel, report.storage.initial)
  await ui.key('cancel-original-on', 'F11', 122); assert.equal(await ui.focus(), true)
  await ui.key('cancel-original-off', 'F11', 122); assert.equal(await ui.focus(), false)
  mark('cancel-does-not-apply')

  await ui.help('apply'); await ui.edit(); await ui.key('record-apply', 'j', 74, 3)
  await ui.named('使用此快捷键')
  assert.equal(await ui.raw(), report.storage.initial, 'Recording a candidate must not persist it')
  await click('[data-shortcut-apply="true"]')
  report.storage.applied = await until(async () => {
    const value = await ui.raw()
    try { assertShortcutManagementConfiguration(value, SHORTCUT_FIXTURE.binding); return value } catch { return false }
  }, 'Applied shortcut configuration was not exactly persisted')
  assert.equal(await evaluate(`document.querySelector(${q(row)})?.textContent.includes('J')`), true)
  await capture('shortcut-management-applied.png'); await ui.close()
  mark('custom-binding-applied-and-persisted')
  await ui.key('applied-old-inactive', 'F11', 122); assert.equal(await ui.focus(), false)
  await ui.key('applied-new-on', 'j', 74, 3); assert.equal(await ui.focus(), true)
  await ui.key('applied-new-off', 'j', 74, 3); assert.equal(await ui.focus(), false)
  mark('old-binding-inactive-new-binding-once')

  // TextEditor's real interval starts on mount, not on the first edit. Leave
  // the clean note through the existing settings entry and return so its real
  // editor mounts afresh before this short dirty round. No timer is replaced.
  await click('[aria-label="更多功能"]'); await ui.named('设置', '.workspace-sidebar-more-menu [role="menuitem"]')
  await until(() => evaluate("Boolean(document.querySelector('.settings-panel')) && !document.querySelector('.editor-input[contenteditable=\"true\"]')"), 'Settings did not unmount the clean text editor')
  const editorRemountedAt = Date.now()
  await click('.settings-panel [aria-label="返回笔记"]'); await ui.openNote()
  assert.equal(await ui.body(), report.editor.before.content)
  await click('.editor-input[contenteditable="true"]')
  for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', {
    type, key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2,
  })
  await cdp.send('Input.insertText', { text: SHORTCUT_FIXTURE.savedMarker })
  await until(() => evaluate(`document.querySelector('.editor-input')?.innerText.includes(${q(SHORTCUT_FIXTURE.savedMarker)})`), 'Native shortcut test edit did not reach Lexical')
  assert.equal(await ui.body(), report.editor.before.content, 'Isolation check must start with a genuinely unpersisted edit')
  const beforeAlt = requests().length
  await ui.key('isolated-alt-save', 's', 83, 3)
  report.editor.afterAltSave = snapshot(await ui.body())
  report.editor.altSaveWriteRequests = requests().length - beforeAlt
  assert.equal(report.editor.afterAltSave.content, report.editor.before.content)
  assert.equal(report.editor.altSaveWriteRequests, 0, 'Mod+Alt+S also triggered the fixed save shortcut')
  const beforeSave = requests().length
  await ui.key('actual-fixed-save', 's', 83, 2)
  const saved = await until(async () => {
    const value = await ui.body()
    try { assert.deepEqual(JSON.parse(value), JSON.parse(shortcutManagementNote(true))); return value } catch { return false }
  }, 'The original fixed save did not persist the exact intended Lexical body')
  await until(() => evaluate("!document.querySelector('.save-state')"), 'Fixed save did not settle')
  report.editor.afterSave = snapshot(saved)
  await until(() => requests().slice(beforeSave).length === 1 && requests().slice(beforeSave)[0].status === 200, 'Actual fixed-save HTTP receipt missing')
  report.editor.fixedSaveRequests = requests().slice(beforeSave)
  assert.equal(JSON.parse(report.editor.fixedSaveRequests[0].postData).content, saved)
  report.editor.shortDirtyRound = { via: 'settings-return', editorRemountedAt, savedAt: Date.now() }
  assert.ok(report.editor.shortDirtyRound.savedAt - editorRemountedAt < 30000, 'The fixed-save observation exceeded the real autosave interval')
  report.storage.beforeRestart = await ui.raw(); assert.equal(report.storage.beforeRestart, report.storage.applied)
  mark('editor-and-fixed-save-preserved'); save()
}

export async function verifyShortcutManagementAfterRestart(context) {
  const { report, mark, save, evaluate, click, capture } = context
  const ui = controls(context)
  report.storage.afterRestart = await ui.raw(); assert.equal(report.storage.afterRestart, report.storage.applied)
  assertShortcutManagementConfiguration(report.storage.afterRestart, SHORTCUT_FIXTURE.binding)
  await ui.openNote()
  report.editor.afterRestart = snapshot(await ui.body())
  assert.equal(report.editor.afterRestart.content, report.editor.afterSave.content)
  await ui.help('restart')
  assert.equal(await evaluate(`document.querySelector(${q(row)})?.textContent.includes('J')`), true)
  await capture('shortcut-management-restarted.png'); await ui.close()
  await ui.key('restart-new-on', 'j', 74, 3); assert.equal(await ui.focus(), true)
  await ui.key('restart-new-off', 'j', 74, 3); assert.equal(await ui.focus(), false)
  mark('persisted-binding-restored-and-executed')

  await ui.help('reset-cancel'); await ui.named('全部恢复默认')
  assert.equal(await ui.raw(), report.storage.applied)
  await click(panel + ' [aria-label="关闭快捷键设置"]')
  await ui.named('放弃修改并关闭'); await ui.closed()
  report.storage.afterResetCancel = await ui.raw(); assert.equal(report.storage.afterResetCancel, report.storage.applied)
  await ui.key('reset-cancel-new-on', 'j', 74, 3); assert.equal(await ui.focus(), true)
  await ui.key('reset-cancel-new-off', 'j', 74, 3); assert.equal(await ui.focus(), false)
  mark('cancelled-reset-keeps-custom-binding')

  await ui.help('reset-apply'); await click('[data-shortcut-reset="focusMode"]')
  await click('[data-shortcut-apply="true"]')
  report.storage.defaults = await ui.raw(); assertShortcutManagementConfiguration(report.storage.defaults, 'F11')
  await capture('shortcut-management-defaults.png'); await ui.close()
  await ui.key('default-original-on', 'F11', 122); assert.equal(await ui.focus(), true)
  await ui.key('default-original-off', 'F11', 122); assert.equal(await ui.focus(), false)
  await ui.key('default-old-custom-inactive', 'j', 74, 3); assert.equal(await ui.focus(), false)
  report.editor.final = snapshot(await ui.body()); assert.equal(report.editor.final.content, report.editor.afterSave.content)
  mark('default-binding-restored-and-executed'); save()
}
