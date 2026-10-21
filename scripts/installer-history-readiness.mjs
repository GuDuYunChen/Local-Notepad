import assert from 'node:assert/strict'

export const HISTORY_TAB_SELECTOR = '#inspector-tab-history'
// Readiness only: no synthetic DOM click, retry-click or production mutation.
export function historyTabReady(document, getStyle) {
  const node = document.querySelector(HISTORY_TAB_SELECTOR)
  if (!node || !node.isConnected || node.disabled || node.getAttribute('aria-disabled') === 'true') return false
  if (document.querySelector('.inspector-panel.inspector-loading')) return false
  const bounds = node.getBoundingClientRect(), style = getStyle(node)
  return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
}
const expression = `(${historyTabReady.toString().replaceAll('HISTORY_TAB_SELECTOR', JSON.stringify(HISTORY_TAB_SELECTOR))})(document, getComputedStyle)`
export async function waitForInstallerHistoryTab({evaluate, until}) {
  // Reuse the original bounded until policy; do not enlarge its timeout.
  await until(() => evaluate(expression), 'History inspector tab has not finished loading')
  assert.equal(await evaluate(expression), true, 'History tab became unavailable before original mouse input')
}
export function prepareInstallerHistoryReadiness(prepared) {
  assert.doesNotMatch(prepared.script, /waitForInstallerHistoryTab|historyTabReadiness/)
  const before = 'async function click(selector) {\n'
  const added = before + `  if (selector === '#inspector-tab-history') await waitForInstallerHistoryTab({evaluate,until})\n`
  const clickEnd = "  for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1})\n}"
  const nextEnd = clickEnd.slice(0,-1) + "  if (selector === '#inspector-tab-history') {report.historyTabReadiness={readyBeforeInput:true,originalMouseInput:true,selector};save()}\n}"
  const once = (text,a,b) => {assert.equal(text.split(a).length,2,'Installer click anchor missing or ambiguous');return text.replace(a,b)}
  const prefix="import {waitForInstallerHistoryTab} from './installer-history-readiness.mjs'\n"
  const script=prefix+once(once(prepared.script,before,added),clickEnd,nextEnd)
  assert.equal(once(once(script.slice(prefix.length),nextEnd,clickEnd),added,before),prepared.script)
  return {core:prepared.core,script}
}
