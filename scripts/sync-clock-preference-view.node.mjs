import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { syncClockPreferenceView as view } from '../src/services/syncClockPreferenceView.mjs'
for (const mode of ['local', 'utc']) test(`same ${mode} is only a last-observed agreement`, () => {
  const v = view(mode, mode); assert.match(v.summary, /上次核对/); assert.match(v.detail, /上次核对/); assert.ok(Object.isFrozen(v))
})
for (const [current, saved] of [['local','utc'],['utc','local']]) test(`${current} temporary choice is distinct from ${saved}`, () => {
  const v = view(current,saved); assert.match(v.detail,/仅为本次显示/); assert.match(v.detail,/本机时区/); assert.match(v.detail,/UTC/)
})
test('empty records are explicit and do not represent persistent current selection', () => {
  assert.match(view('local',null).detail,/未记住选择，下次打开默认 UTC/)
})
test('unknown storage suppresses all saved claims', () => {
  const v=view('local','local',true);assert.match(v.summary,/未确认/);assert.doesNotMatch(v.detail,/一致|已记住/)
})
test('timezone fallback explains actual UTC without erasing saved local intent', () => {
  const v=view('local','local',false,true);assert.match(v.summary,/本机时区/);assert.match(v.detail,/实际显示 UTC/);assert.doesNotMatch(v.detail,/一致/)
})
test('unknown strings and hostile objects cannot escape fixed copy', () => {
  for(const value of ['PRIVATE_<script>', '__proto__', 'constructor', 1, {}, null]){
    assert.doesNotMatch(JSON.stringify(view(value,value)),/PRIVATE|<script>|__proto__|constructor/)
  }
})
test('comparison has no time, persistence or synchronization capability', () => {
  const s=readFileSync(new URL('../src/services/syncClockPreferenceView.mjs',import.meta.url),'utf8')
  assert.doesNotMatch(s,/localStorage|fetch\s*\(|Date\.|setTimeout|setInterval|electronAPI|clipboard/)
})
