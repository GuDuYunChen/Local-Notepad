import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { focusSyncCurrentGuidance } from '../src/services/syncHelpReturn.mjs'
function fixture() {
  const calls = [], doc = { activeElement: null }
  const root = { isConnected: true, matches: s => s === '[data-sync-section="overview"]', closest: () => null,
    querySelector: selector => { calls.push(['query', selector]); return target } }
  const target = { isConnected: true, tagName: 'DIV', parentElement: root, ownerDocument: doc,
    closest: selector => selector === '[data-sync-section="overview"]' ? root : null,
    getAttribute: key => ({ tabindex: '-1', role: 'region' })[key],
    focus: options => { calls.push(['focus', options]); doc.activeElement = target },
    scrollIntoView: options => calls.push(['scroll', options]) }
  return { root, target, calls, doc }
}
test('returns to the current region, never a sync button, with instant scroll', () => {
  const f = fixture(); assert.equal(focusSyncCurrentGuidance(f.root), true)
  assert.equal(f.doc.activeElement, f.target)
  assert.deepEqual(f.calls, [['query','[data-sync-guidance]'],['focus',{preventScroll:true}],['scroll',{block:'start',behavior:'instant'}]])
})
for (const input of [null, undefined, false, 3, {}, 'private']) test(`malformed root ${String(input)} fails closed`, () => {
  assert.equal(focusSyncCurrentGuidance(input), false)
})
test('detached, hidden, inert and foreign roots cannot direct focus', () => {
  for (const change of [f=>{f.root.isConnected=false},f=>{f.root.matches=()=>false},f=>{f.root.closest=()=>({})}]) {
    const f=fixture();change(f);assert.equal(focusSyncCurrentGuidance(f.root),false);assert.deepEqual(f.calls,[])
  }
})
test('missing, nested, hidden, executable and foreign targets are rejected', () => {
  for (const change of [f=>{f.root.querySelector=()=>null},f=>{f.target.isConnected=false},f=>{f.target.parentElement={}},
    f=>{f.target.closest=()=>({})},f=>{f.target.getAttribute=()=>null},f=>{f.target.getAttribute=k=>k==='role'?'region':'0'},
    ...['BUTTON','INPUT','A','SUMMARY','TEXTAREA'].map(tag=>f=>{f.target.tagName=tag})]) {
    const f=fixture();change(f);assert.equal(focusSyncCurrentGuidance(f.root),false)
    assert.equal(f.calls.some(([kind])=>kind==='focus'||kind==='scroll'),false)
  }
})
test('failed or throwing focus never scrolls or activates an alternative', () => {
  for (const focus of [()=>{},()=>{throw new Error('missing target')}]) {
    const f=fixture();f.target.focus=focus;assert.equal(focusSyncCurrentGuidance(f.root),false)
    assert.deepEqual(f.calls,[['query','[data-sync-guidance]']])
  }
})
test('focus-time detachment or reparenting does not scroll another overview', () => {
  for (const change of [f=>{f.target.isConnected=false},f=>{f.root.isConnected=false},f=>{f.target.parentElement={}},f=>{f.target.closest=()=>({})}]) {
    const f=fixture();f.target.focus=()=>{f.doc.activeElement=f.target;change(f)}
    assert.equal(focusSyncCurrentGuidance(f.root),false);assert.deepEqual(f.calls,[['query','[data-sync-guidance]']])
  }
})
test('scroll failure is contained with no retry', () => {
  const f=fixture();f.target.scrollIntoView=()=>{f.calls.push(['throw']);throw new Error('scroll failed')}
  assert.equal(focusSyncCurrentGuidance(f.root),false);assert.equal(f.calls.filter(([c])=>c==='query').length,1)
})
test('repeated return reads the currently rendered target rather than caching a snapshot', () => {
  const f=fixture();assert.equal(focusSyncCurrentGuidance(f.root),true)
  const second=fixture();f.root.querySelector=()=>second.target
  assert.equal(focusSyncCurrentGuidance(f.root),false);assert.equal(second.doc.activeElement,null)
})
test('return code has no disclosure, persistence, network, callback or click capability', () => {
  const s=readFileSync(new URL('../src/services/syncHelpReturn.mjs',import.meta.url),'utf8')
  assert.doesNotMatch(s,/\.open\s*=|\bfetch\s*\(|\bapi\s*\(|\.click\s*\(|localStorage|sessionStorage|electronAPI|clipboard|setTimeout|setInterval|innerHTML|onResolve/)
})
test('return visibility follows the native disclosure with scoped CSS and no forced open', () => {
  const css=readFileSync(new URL('../src/components/SyncHelpReturn.css',import.meta.url),'utf8')
  assert.match(css,/\.sync-overview > \.sync-help-return\{display:none\}/)
  assert.match(css,/\[data-sync-help\]\[open\] \+ \.sync-help-return\{display:flex/)
  assert.doesNotMatch(css,/!important|#[a-f0-9]{3,8}\b|scroll-behavior:smooth/)
})
