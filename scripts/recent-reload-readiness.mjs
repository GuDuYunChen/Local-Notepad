import assert from 'node:assert/strict'
// Page.reload acknowledges the command, not the replacement document. A control
// in the outgoing document is not proof that the reloaded application is ready.
export async function verifyRecentNotesAfterReload(driver, context, record) {
  assert.equal(typeof driver, 'function'); assert.equal(typeof record, 'function')
  const { cdp, evaluate, until } = context
  let reloads = 0
  const relay = new Proxy(cdp, { get(target, key) {
    if (key !== 'send') { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value }
    return async (method, params) => {
      if (method !== 'Page.reload') return target.send(method, params)
      assert.equal(++reloads, 1, 'Recent history must perform one real reload, never retry it')
      const before = (await target.send('Page.getFrameTree')).frameTree?.frame
      assert.ok(before?.id && before.loaderId && before.url?.startsWith('file:'), 'Owned renderer document identity is missing')
      const result = await target.send(method, params)
      const after = await until(async () => {
        const frame = (await target.send('Page.getFrameTree')).frameTree?.frame
        if (!frame || frame.id !== before.id || !frame.loaderId || frame.loaderId === before.loaderId || frame.url !== before.url) return false
        const ready = await evaluate(`(()=>{const n=document.querySelector('.workspace-sidebar-nav-item[aria-label="最近访问"]');return Boolean(n&&n.isConnected&&!n.disabled&&document.readyState==='complete'&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0)})()`)
        if (!ready) return false
        const confirmed = (await target.send('Page.getFrameTree')).frameTree?.frame
        return confirmed?.id === frame.id && confirmed.loaderId === frame.loaderId && confirmed.url === before.url ? frame : false
      }, 'Reloaded recent-history entry did not become ready in the new main document', 18000)
      assert.ok(after && after.loaderId !== before.loaderId)
      record({ originalReloadCommands: reloads, mainFrameId: before.id, previousLoader: before.loaderId,
        currentLoader: after.loaderId, sameDocumentURL: true, entryReadyInNewDocument: true, originalClickRetained: true })
      return result
    }
  } })
  await driver({ ...context, cdp: relay })
  assert.equal(reloads, 1, 'The original recent-history reload was not executed')
}
