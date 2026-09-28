import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deviceSyncTimeZone, syncClockDisplay } from '../src/services/syncClock.mjs'
const a = '2024-11-03T08:30:00.123Z', b = '2024-11-03T09:30:00.456Z'
test('UTC is exact, immutable and does not consult Intl or the current clock', () => {
  const original = Intl.DateTimeFormat
  Intl.DateTimeFormat = function () { throw new Error('must not be consulted') }
  try {
    const view = syncClockDisplay(a,b)
    assert.equal(view.lastSuccess.text,a);assert.equal(view.readAt.text,b);assert.equal(view.mode,'utc');assert.equal(view.fallback,false)
    assert.ok(Object.isFrozen(view));assert.ok(Object.isFrozen(view.lastSuccess));assert.ok(Object.isFrozen(view.readAt))
  } finally { Intl.DateTimeFormat = original }
})
for(const [zone,iso,expected] of [
  ['Asia/Shanghai','2024-12-31T23:59:59.123Z','2025-01-01 07:59:59.123 GMT+08:00'],
  ['Pacific/Honolulu','2024-01-01T01:02:03.004Z','2023-12-31 15:02:03.004 GMT-10:00'],
  ['Asia/Kathmandu',a,'2024-11-03 14:15:00.123 GMT+05:45'],
  ['Australia/Adelaide','2024-01-01T01:02:03.004Z','2024-01-01 11:32:03.004 GMT+10:30'],
  ['UTC','2024-02-29T00:00:00.000Z','2024-02-29 00:00:00.000 GMT'],
  ['America/New_York','2024-03-10T06:59:59.000Z','2024-03-10 01:59:59.000 GMT-05:00'],
  ['America/New_York','2024-03-10T07:00:00.000Z','2024-03-10 03:00:00.000 GMT-04:00'],
]) test(`converts ${zone} ${iso} without rounding the instant`,()=>{
  const v=syncClockDisplay(iso,iso,zone);assert.equal(v.mode,'local');assert.equal(v.lastSuccess.text,expected)
  assert.equal(v.lastSuccess.iso,iso);assert.deepEqual(v.lastSuccess,v.readAt)
})
test('DST repeated hour remains distinguishable by offset on each timestamp',()=>{
  const v=syncClockDisplay(a,b,'America/Los_Angeles')
  assert.equal(v.lastSuccess.text,'2024-11-03 01:30:00.123 GMT-07:00')
  assert.equal(v.readAt.text,'2024-11-03 01:30:00.456 GMT-08:00')
})
test('absent records never become epoch dates or a fresh success',()=>{
  for(const zone of [null,'Asia/Shanghai']){
    const v=syncClockDisplay('尚无记录','尚无记录',zone)
    assert.deepEqual(v.lastSuccess,{text:'尚无记录',iso:''});assert.deepEqual(v.readAt,v.lastSuccess)
  }
})
test('invalid dates and private values are not echoed or coerced',()=>{
  for(const value of [null,undefined,0,false,{},[],{toString(){throw new Error('coerced')}},'PRIVATE_<script>','2024-02-30T00:00:00.000Z','2024-01-01','2024-01-01T00:00:00+08:00','2024-01-01T24:00:00.000Z']){
    const v=syncClockDisplay(value,value,'Asia/Shanghai')
    assert.deepEqual(v.lastSuccess,{text:'未知',iso:''});assert.deepEqual(v.readAt,v.lastSuccess)
    assert.doesNotMatch(JSON.stringify(v),/PRIVATE|<script>/)
  }
})
test('unsupported or hostile zones fail to explicit UTC, never echo raw input',()=>{
  for(const zone of ['',{},[],false,3,'constructor','__proto__','PRIVATE_ZONE','<img src=x>','X'.repeat(101)]){
    const v=syncClockDisplay(a,b,zone)
    assert.equal(v.mode,'utc');assert.equal(v.fallback,true);assert.equal(v.timeZone,'UTC');assert.equal(v.lastSuccess.text,a)
  }
})
test('device timezone failure does not crash or invent a location',()=>{
  const original=Intl.DateTimeFormat
  try {
    Intl.DateTimeFormat=function(){throw new Error('PRIVATE_TZ')};assert.equal(deviceSyncTimeZone(),'')
    assert.equal(syncClockDisplay(a,b,'Asia/Shanghai').fallback,true)
    Intl.DateTimeFormat=function(){return {resolvedOptions:()=>({timeZone:'PRIVATE_<script>'})}};assert.equal(deviceSyncTimeZone(),'')
  } finally {Intl.DateTimeFormat=original}
})
test('device timezone detection is independent from any record',()=>{
  const original=Intl.DateTimeFormat
  try {Intl.DateTimeFormat=function(){return {resolvedOptions:()=>({timeZone:'Asia/Shanghai'})}};assert.equal(deviceSyncTimeZone(),'Asia/Shanghai')}
  finally {Intl.DateTimeFormat=original}
})
test('formatter exceptions or missing parts keep both timestamps in UTC',()=>{
  const original=Intl.DateTimeFormat
  for(const formatToParts of [()=>{throw new Error('PRIVATE')},()=>[],()=>[{type:'year',value:'PRIVATE'}]]){
    try{
      Intl.DateTimeFormat=function(){return {resolvedOptions:()=>({timeZone:'UTC'}),formatToParts}}
      const v=syncClockDisplay(a,b,'UTC');assert.equal(v.fallback,true);assert.equal(v.lastSuccess.text,a);assert.equal(v.readAt.text,b)
      assert.doesNotMatch(JSON.stringify(v),/PRIVATE/)
    }finally{Intl.DateTimeFormat=original}
  }
})
test('calendar boundary uses UTC instead of guessing an era or rolled-over year',()=>{
  for(const iso of ['0000-01-01T00:00:00.000Z','9999-12-31T23:59:59.999Z']){
    const v=syncClockDisplay(iso,b,'Asia/Shanghai');assert.equal(v.fallback,true);assert.equal(v.lastSuccess.text,iso);assert.equal(v.readAt.text,b)
  }
})
test('A-B-A timezone changes cannot alter the source instants or infer freshness',()=>{
  const first=syncClockDisplay(a,b,'Asia/Shanghai');syncClockDisplay(a,b,'America/Los_Angeles')
  assert.deepEqual(syncClockDisplay(a,b,'Asia/Shanghai'),first)
  assert.equal(syncClockDisplay(a,b).lastSuccess.text,a)
  assert.doesNotMatch(JSON.stringify(first),/实时|完成|刚刚|分钟前|成功/)
})
test('display code has no synchronization, storage, clock, timer or geolocation capability',()=>{
  for(const file of ['../src/services/syncClock.mjs','../src/components/SyncOverviewTimes.jsx']){
    const s=readFileSync(new URL(file,import.meta.url),'utf8')
    assert.doesNotMatch(s,/\bfetch\s*\(|\bapi\s*\(|localStorage|sessionStorage|electronAPI|clipboard|Date\.now|setTimeout|setInterval|navigator\.geolocation|dangerouslySetInnerHTML/)
  }
})
test('extended canonical UTC dates remain exact even when local conversion is unavailable',()=>{
  for(const iso of ['+010000-01-01T00:00:00.000Z','+275760-09-13T00:00:00.000Z']){
    assert.equal(syncClockDisplay(iso,iso).lastSuccess.text,iso)
    const v=syncClockDisplay(iso,b,'UTC');assert.equal(v.mode,'utc');assert.equal(v.fallback,true);assert.equal(v.lastSuccess.iso,iso)
  }
})
