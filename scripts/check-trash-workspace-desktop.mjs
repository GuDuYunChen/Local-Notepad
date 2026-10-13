import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { desktopNote } from './desktop-save-fixture.mjs'

// Called only by the existing owned Windows packaged-app test. Real App,
// preload, Go and SQLite remain intact; all destructive actions use new fixtures.
export async function verifyTrashWorkspaceDesktop({ evaluate, click, cdp, until, api, out, noteIDs }) {
  assert.equal(process.platform, 'win32')
  const report = { complete: false, commit: process.env.GITHUB_SHA || '', platform: process.platform,
    realPackagedApp: true, realBackend: true, syntheticData: true, checks: [], screenshots: [] }
  const save = () => writeFileSync(path.join(out, 'trash-workspace.json'), JSON.stringify(report, null, 2) + '\n')
  const mark = name => { report.checks.push(name); save() }
  save()
  const originals = await Promise.all(noteIDs.map(id => api('/api/files/' + id)))
  const root = '[trash-2F86] '
  const create = (title, extra = {}) => api('/api/files', { method: 'POST', body: JSON.stringify({ title: root + title, content: desktopNote('本地回收站', title), ...extra }) })
  const deleted = async title => { const item = await create(title); await api('/api/files/' + item.id, { method: 'DELETE' }); return item }
  const list = () => api('/api/files/trash')
  const has = async id => (await list()).some(row => row.id === id)
  const waitReady = () => until(() => evaluate("!!document.querySelector('[data-trash-workspace]') && !!document.querySelector('.trash-toolbar-actions .btn:not(:disabled)') && !document.querySelector('.trash-workspace-body > [role=status]')"), 'Trash view did not settle', 18000)
  const button = async (name, scope = '[data-trash-workspace]') => {
    assert.equal(await evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(scope)});const ns=[...p?.querySelectorAll('button')||[]].filter(n=>n.textContent.trim()===${JSON.stringify(name)});if(ns.length!==1||ns[0].disabled)return false;ns[0].setAttribute('data-trash-test-click','');return true})()`), true, 'Missing enabled trash control: ' + name)
    try { await click('[data-trash-test-click]') }
    finally { await evaluate("document.querySelector('[data-trash-test-click]')?.removeAttribute('data-trash-test-click')") }
  }
  const input = async (selector, value) => {
    await click(selector)
    for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'a', windowsVirtualKeyCode: 65, modifiers: 2 })
    await cdp.send('Input.insertText', { text: value })
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), value)
  }
  const open = async () => {
    await click('[aria-label="更多功能"]')
    assert.equal(await evaluate("(()=>{const n=[...document.querySelectorAll('[role=menuitem]')].find(n=>n.textContent.trim()==='回收站');if(!n)return false;n.setAttribute('data-trash-menu','');return true})()"), true)
    await click('[data-trash-menu]')
    await until(() => evaluate("!!document.querySelector('[data-trash-workspace]')"), 'Original trash entry did not open the module')
  }
  const row = id => '[data-trash-id="' + id + '"]'
  const confirm = async action => {
    await until(() => evaluate("!!document.querySelector('.trash-workspace-dialog')"), 'No in-app confirmation')
    if (action === 'delete') {
      assert.equal(await evaluate("document.querySelector('.trash-workspace-dialog .danger').disabled"), true)
      await input('[aria-label="输入永久删除确认"]', '永久删除')
      await button('确认永久删除', '.trash-workspace-dialog')
    } else await button('确认恢复', '.trash-workspace-dialog')
    await until(() => evaluate("!document.querySelector('.trash-workspace-dialog') && !!document.querySelector('.trash-workspace-report') && !document.querySelector('.trash-workspace-report [data-status=sending]') && ![...document.querySelectorAll('.trash-workspace-report button')].some(n=>n.textContent.includes('停止后续'))"), 'Operation did not finish with a report', 18000)
    await waitReady()
  }
  const capture = async name => {
    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    writeFileSync(path.join(out, name), bytes)
    report.screenshots.push({ filename: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); save()
  }
  let blocked = false
  try {
    const folder = await create('目录', { content: '', is_folder: true })
    const child = await create('目录正文.md', { parent_id: folder.id })
    const good = await deleted('可恢复.md')
    const conflict = await deleted('同名冲突.md')
    const replacement = await create('同名冲突.md')
    await api('/api/files/' + folder.id, { method: 'DELETE' })
    await cdp.send('Network.setBlockedURLs', { urls: ['http://127.0.0.1:27121/api/files/trash'] }); blocked = true
    await open()
    await until(() => evaluate("document.querySelector('[data-trash-workspace] [role=alert]')?.textContent.includes('读取回收站失败')"), 'Read failure was not explicit')
    assert.equal(await evaluate("document.querySelector('.trash-empty')===null"), true)
    await cdp.send('Network.setBlockedURLs', { urls: [] }); blocked = false
    await button('重新读取'); await waitReady()
    await until(() => evaluate(`!!document.querySelector(${JSON.stringify(row(folder.id))})`), 'Fixture folder is missing')
    mark('original-menu-read-failure-not-empty-manual-refresh')

    await input('[aria-label="查找已删除项目"]', '不存在的本地测试标题')
    assert.equal(await evaluate("document.querySelector('[data-trash-workspace]').textContent.includes('没有匹配的项目')"), true)
    assert.equal(await evaluate("document.querySelector('.trash-empty')===null"), true)
    await button('清除筛选'); mark('title-filter-no-match-is-not-empty-trash')

    await button('恢复', row(folder.id)); assert.equal(await has(folder.id), true)
    await button('取消', '.trash-workspace-dialog'); assert.equal(await has(folder.id), true)
    await button('恢复', row(folder.id)); await confirm('restore')
    assert.equal(await has(folder.id), false)
    assert.equal((await api('/api/files/' + child.id)).content, child.content)
    assert.equal((await api('/api/files/' + child.id)).parent_id, folder.id)
    mark('cancel-is-no-write-and-folder-restore-preserves-child-content')

    // Selection insertion order intentionally puts the rejected target first.
    await click(row(conflict.id) + ' input[type=checkbox]'); await click(row(good.id) + ' input[type=checkbox]')
    await button('恢复所选'); await confirm('restore')
    assert.equal(await evaluate("document.querySelector('.trash-workspace-report [data-status=unconfirmed]')!==null"), true)
    assert.equal(await evaluate("document.querySelectorAll('.trash-workspace-report [data-status=not-started]').length"), 1)
    assert.equal(await has(conflict.id), true); assert.equal(await has(good.id), true)
    mark('real-sqlite-name-conflict-stops-rest-of-batch')
    await click('[aria-label="返回笔记"]'); await open(); await waitReady()
    assert.equal(await evaluate("document.querySelector('.trash-workspace-report [data-status=unconfirmed]')!==null"), true)
    assert.equal(await has(good.id), true); mark('navigation-retains-unconfirmed-report-without-replay')

    await button('收起记录', '.trash-workspace-report')
    assert.equal(await evaluate("document.querySelector('.trash-workspace-report')===null"), true)
    const historyLabel = await evaluate("document.querySelector('.trash-workspace-history-toggle').getAttribute('aria-label')")
    assert.equal(await evaluate("(()=>{const n=document.querySelector('.trash-workspace-history-toggle');n.setAttribute('data-trash-history-test','');return true})()"), true)
    await click('[data-trash-history-test]')
    assert.equal(await evaluate("document.querySelector('.trash-workspace-history [data-history-status=unconfirmed]')!==null"), true)
    assert.equal(await has(good.id), true); assert.equal(await has(conflict.id), true)
    mark('collapse-keeps-the-unknown-receipt-reachable-without-replay')

    await api('/api/files/' + replacement.id, { method: 'PUT', body: JSON.stringify({ title: root + '同名已移开.md' }) })
    await button('恢复', row(conflict.id)); await confirm('restore')
    assert.equal((await api('/api/files/' + conflict.id)).content, conflict.content)
    assert.equal(await has(good.id), true); mark('explicit-retry-after-real-conflict-resolution')

    assert.equal(await evaluate("document.querySelector('.trash-workspace-history [data-history-status=unconfirmed]')!==null"), true)
    assert.equal(await evaluate("document.querySelector('.trash-workspace-history-toggle').getAttribute('aria-label')"), historyLabel)
    mark('new-success-does-not-rewrite-the-historical-unknown-outcome')

    await button('永久删除', row(good.id))
    assert.equal(await evaluate("document.querySelector('.trash-workspace-dialog .danger').disabled"), true)
    await button('取消', '.trash-workspace-dialog'); assert.equal(await has(good.id), true)
    await button('永久删除', row(good.id)); await confirm('delete')
    assert.equal(await has(good.id), false)
    const missing = await fetch('http://127.0.0.1:27121/api/files/' + good.id + '/restore', {
      method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(3000),
    })
    assert.notEqual((await missing.json()).code, 0, 'Permanently deleted fixture remained restorable')
    mark('typed-delete-confirmation-real-permanent-delete-and-missing-restore-refusal')

    const first = await deleted('清理快照.md')
    await button('刷新'); await waitReady(); await until(() => evaluate(`!!document.querySelector(${JSON.stringify(row(first.id))})`), 'Snapshot fixture missing')
    await button('清空回收站')
    const later = await deleted('确认后新增.md')
    await confirm('delete')
    assert.equal(await has(first.id), false); assert.equal(await has(later.id), true)
    mark('empty-trash-is-bounded-to-confirmed-root-snapshot')
    await capture('trash-workspace-result.png')
    await button('永久删除', row(later.id)); await confirm('delete')
    assert.equal(await evaluate("document.querySelector('.trash-empty')!==null"), true)
    mark('verified-empty-result-after-all-confirmed-fixtures-complete')
    await capture('trash-workspace-empty.png')
    await click('[aria-label="返回笔记"]')
    assert.deepEqual(await Promise.all(noteIDs.map(id => api('/api/files/' + id))), originals)
    mark('preexisting-save-fixtures-and-original-editor-data-unchanged')
    report.complete = true
  } catch (error) {
    report.failure = 'Native local trash workflow assertion failed; see job log'
    throw error
  } finally {
    if (blocked) await cdp.send('Network.setBlockedURLs', { urls: [] })
    report.finishedAt = new Date().toISOString(); save()
  }
}
