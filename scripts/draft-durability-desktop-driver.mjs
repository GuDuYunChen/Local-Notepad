import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { refreshLocalExportLibrary } from './check-local-export-desktop.mjs'
import { blockReferenceFixture } from './block-references-desktop-driver.mjs'
import { DRAFT_CASES, draftHash } from './draft-durability-desktop-evidence.mjs'
const q = JSON.stringify
const textOf = body => {
  const visit = node => typeof node?.text === 'string' ? node.text : (node?.children || []).map(visit).join('')
  return visit(JSON.parse(body).root)
}
// Observe a different, real read-only transaction, not the module's memory map.
// Refuse to create a missing database merely to manufacture an observation.
export const draftMirrorExpression = id => `(async()=>{
  if(!(await indexedDB.databases()).some(db=>db.name==='local-notepad-editor-drafts'))return null;
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('local-notepad-editor-drafts',1);let db;
    request.onerror=()=>reject(request.error);
    request.onupgradeneeded=()=>{request.transaction.abort();reject(Error('Observer refused to create the draft store'))};
    request.onsuccess=()=>{
      db=request.result;const tx=db.transaction('drafts','readonly');let value=null;
      const read=tx.objectStore('drafts').get(${q(id)});
      read.onsuccess=()=>{value=read.result||null};
      tx.oncomplete=()=>{db.close();resolve(value)};
      tx.onabort=()=>{db.close();reject(tx.error||Error('Observer transaction aborted'))};
    };
  });
})()`
export async function verifyDraftDurabilityDesktop(ctx) {
  const { api, evaluate, click, until, capture, report, save } = ctx
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['rawKeyDown', 'keyUp']) await ctx.cdp().send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code, modifiers })
  }
  const readMirror = id => evaluate(draftMirrorExpression(id))
  const body = id => api('/api/files/' + encodeURIComponent(id))
  const clean = () => until(() => evaluate("!document.querySelector('.workspace-save-chip.dirty,.save-state')"), 'Save receipt was not confirmed')
  const open = async (note, expected) => {
    const selector = '[data-file-id=' + q(note.id) + ']'
    // Reuse the reviewed responsive entry path; never alter React state.
    await refreshLocalExportLibrary({ evaluate, click, until }, selector, 'Draft fixture is not listed')
    await click(selector)
    await until(() => evaluate(`document.querySelector('.workspace-title-button')?.textContent===${q(note.title)}&&Boolean(document.querySelector('.editor-input[contenteditable="true"]'))`), 'Draft editor is not ready')
    if (expected !== undefined) await until(() => evaluate(`document.querySelector('.editor-input')?.textContent===${q(expected)}`), 'Recovered editor body differs from the committed mirror')
  }
  const phase = value => { report.phase = value; save() }
  phase('initial-launch'); await ctx.start()
  for (const name of DRAFT_CASES) {
    phase(name + ':create-and-open')
    const initial = 'DRAFT104 ' + name + ' baseline ' + (name === 'large-draft' ? 'x'.repeat(1024 * 1024 + 128) : '')
    const note = await api('/api/files', { method: 'POST', body: q({ title: 'DRAFT104 ' + name + ' ' + randomUUID().slice(0, 8) + '.md', content: blockReferenceFixture(initial) }) })
    await open(note, initial); await clean()
    const before = await body(note.id), requestIndex = ctx.requestCount()
    const item = { name, noteId: note.id, databaseBefore: draftHash(before.content) }
    if (name === 'local-storage-quota') {
      item.quota = await evaluate(`(()=>{
        let n=0,last='';
        for(const size of [524288,32768,2048,128,8,1])for(let count=0;count<100;count++){
          try{localStorage.setItem('__draft104_quota_'+n,'q'.repeat(size));n++}
          catch(error){last=error.name;break}
        }
        let refused=false;try{localStorage.setItem('__draft104_quota_probe','x')}catch(error){last=error.name;refused=true}
        if(!refused)throw Error('Browser quota was not exhausted');
        return {keys:n,error:last};
      })()`)
      assert.equal(item.quota.error, 'QuotaExceededError')
    }
    if (name === 'storage-denial-retry') {
      await evaluate(`(()=>{
        const descriptor=Object.getOwnPropertyDescriptor(window,'localStorage'),transaction=IDBDatabase.prototype.transaction;
        window.__draft104RestoreStorage=()=>{Object.defineProperty(window,'localStorage',descriptor);IDBDatabase.prototype.transaction=transaction};
        window.__draft104Errors=0;window.addEventListener('editor:draft-persistence-error',()=>window.__draft104Errors++);
        Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Isolated acceptance fault','SecurityError')}});
        IDBDatabase.prototype.transaction=function(){throw new DOMException('Isolated acceptance fault','QuotaExceededError')};
      })()`)
    }
    phase(name + ':trusted-input')
    await evaluate("window.__draft104Input=[];document.addEventListener('input',event=>{if(event.target?.closest?.('.editor-input'))window.__draft104Input.push({trusted:event.isTrusted,data:event.data})},{capture:true,passive:true})")
    await click('.editor-input[contenteditable="true"]'); await key('End', 35, 2)
    const suffix = ' DRAFT104-UNSAVED-' + randomUUID()
    await ctx.cdp().send('Input.insertText', { text: suffix })
    await until(() => evaluate(`document.querySelector('.editor-input')?.textContent===${q(initial + suffix)}`), 'Trusted input did not produce the intended unsaved draft')
    item.trustedInput = await evaluate(`window.__draft104Input.some(event=>event.trusted===true&&event.data===${q(suffix)})`)
    assert.equal(item.trustedInput, true)
    if (name === 'storage-denial-retry') {
      phase(name + ':failure-and-retry')
      await until(() => evaluate("document.querySelector('[data-draft-persistence-warning]')?.textContent.includes('关闭或崩溃后可能无法恢复')"), 'Memory-only warning is missing')
      await capture('draft104-storage-warning.png')
      const count = await evaluate('window.__draft104Errors')
      await click('[data-draft-persistence-warning] button')
      await until(() => evaluate(`window.__draft104Errors>${count}`), 'Denied retry was not observed at the storage boundary')
      assert.equal(await evaluate("Boolean(document.querySelector('[data-draft-persistence-warning]'))"), true)
      await evaluate('window.__draft104RestoreStorage();delete window.__draft104RestoreStorage')
      await click('[data-draft-persistence-warning] button')
      await until(() => evaluate("!document.querySelector('[data-draft-persistence-warning]')"), 'Successful cache retry did not clear its warning')
      item.denial = { storageBoundaryFaultInjection: true, realOSFailure: false, warningSeen: true, deniedRetryObserved: true, restoredRetryObserved: true }
    }
    phase(name + ':observe-committed-mirror')
    const mirror = await until(async () => {
      const value = await readMirror(note.id)
      return value?.content && textOf(value.content) === initial + suffix ? value : false
    }, 'The real IndexedDB transaction did not commit the current draft')
    assert.equal(mirror.id, note.id); assert.equal(mirror.recovery?.id, note.id)
    item.draft = draftHash(mirror.content); item.draftLength = mirror.content.length; item.committedMirrorObserved = true
    item.localHasNewDraft = await evaluate(`(()=>{try{return JSON.parse(localStorage.getItem('editor:cache:'+${q(note.id)})||'null')?.content===${q(mirror.content)}}catch{return false}})()`)
    if (name === 'large-draft') { assert.ok(item.draftLength > 1024 * 1024); assert.equal(item.localHasNewDraft, false) }
    if (name === 'local-storage-quota') assert.equal(item.localHasNewDraft, false)
    assert.equal(draftHash((await body(note.id)).content), item.databaseBefore, 'The draft was already saved; this would not prove crash recovery')
    phase(name + ':crash'); item.crashedPid = await ctx.crash()
    if (name === 'storage-denial-retry') await ctx.reinstallWithRetainedDraft()
    phase(name + ':restart-and-recover'); await ctx.start(); item.restartedPid = ctx.pid()
    await open(note, initial + suffix)
    item.restoredDOMEqual = true
    const restored = await readMirror(note.id)
    assert.equal(restored?.content, mirror.content); item.restoredMirrorEqual = true
    item.databaseBeforeSave = draftHash((await body(note.id)).content)
    assert.equal(item.databaseBeforeSave, item.databaseBefore)
    item.bodyWritesBeforeExplicitSave = ctx.bodyWritesSince(requestIndex, note.id)
    assert.equal(item.bodyWritesBeforeExplicitSave, 0, 'Recovery unexpectedly submitted the draft')
    await capture('draft104-' + name + '.png')
    if (name === 'local-storage-quota') await evaluate(`(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('__draft104_quota_'))localStorage.removeItem(key)})()`)
    phase(name + ':explicit-save'); await click('.editor-input[contenteditable="true"]'); await key('s', 83, 2); await clean()
    const saved = await until(async () => {
      const value = await body(note.id); return value.content === mirror.content ? value : false
    }, 'Explicit Ctrl+S did not commit the recovered draft')
    item.databaseAfterSave = draftHash(saved.content)
    await until(async () => (await readMirror(note.id)) === null, 'Confirmed save did not remove the persistent mirror')
    item.mirrorRemovedAfterSave = true; report.cases.push(item); save()
    if (name === 'normal') {
      await ctx.crash(); await ctx.start(); await open(note, initial + suffix); await clean()
      assert.equal((await body(note.id)).content, mirror.content)
      assert.equal(await readMirror(note.id), null)
      report.savedDraftDoesNotResurrect = true; save()
    }
  }
  phase('normal-final-close'); await ctx.closeNormally()
}
