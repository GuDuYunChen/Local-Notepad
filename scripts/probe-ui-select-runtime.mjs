import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
// Diagnostic only: exercise the locked real component through DOM events.
// No React-handler access, native-select substitute, or modified product files.
const file = 'src/test/ui-select-runtime-probe.test.jsx'
const out = 'test-results/ui-select-runtime'
if (fs.existsSync(file)) throw Error('Refuse to replace an existing source test')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(file, `import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { it, expect, vi } from 'vitest'
import { UiSelect } from '../components/ui/ControlKit'
import UiThemeProvider from '../components/ui/UiThemeProvider'
import { openUiSelect } from './uiControlDriver'
it('diagnoses actual Select open, portal ownership and option event timing', async () => {
 globalThis.IS_REACT_ACT_ENVIRONMENT = true
 const host = document.createElement('div');document.body.append(host);const root = createRoot(host)
 const changes=[]
 function Fixture(){ const [value,setValue]=useState('a');return <UiThemeProvider><UiSelect aria-label="probe" value={value} onChange={e=>{changes.push(e.target.value);setValue(e.target.value)}} options={[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]}/></UiThemeProvider> }
 const snapshot = phase => console.log('SELECT_PROBE',JSON.stringify({phase,html:host.innerHTML.slice(0,10000),lists:[...document.querySelectorAll('[role="listbox"]')].map(n=>({id:n.id,html:n.outerHTML.slice(0,6000),parent:n.parentElement?.className})),options:[...document.querySelectorAll('[data-ui-option-value]')].map(n=>({value:n.dataset.uiOptionValue,parent:n.parentElement?.className})),changes}))
 try {
  await act(async()=>{root.render(<Fixture/>);await new Promise(r=>setTimeout(r,20))})
  snapshot('mounted')
  const input=host.querySelector('[role="combobox"]');expect(input).not.toBeNull()
  try { await act(async()=>{await openUiSelect(input)}) } catch(error) {console.log('SELECT_PROBE_DRIVER_ERROR',error.message)}
  snapshot('after-synchronous-driver')
  await act(async()=>{await new Promise(r=>setTimeout(r,30))})
  snapshot('after-asynchronous-portal-turn')
  if(input.getAttribute('aria-expanded')!=='true') {
   await act(async()=>{input.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}));await new Promise(r=>setTimeout(r,30))})
   snapshot('after-user-mousedown')
  }
  await vi.waitFor(async()=>{await act(async()=>{await Promise.resolve()});expect(input.getAttribute('aria-expanded')).toBe('true')},{timeout:1000})
  const option=[...document.querySelectorAll('[data-ui-option-value]')].find(n=>n.dataset.uiOptionValue==='b')
  expect(option).toBeTruthy()
  await act(async()=>{option.click();await new Promise(r=>setTimeout(r,20))})
  expect(changes).toEqual(['b']);snapshot('selected')
 } finally {await act(async()=>root.unmount());host.remove();delete globalThis.IS_REACT_ACT_ENVIRONMENT}
})
`)
let status = 1
try {
 const result = spawnSync('npx', ['--no-install','vitest','run','--root=.',file,'--reporter=verbose'], {encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024})
 fs.writeFileSync(out+'/probe.log',(result.stdout||'')+'\n'+(result.stderr||''))
 console.log((result.stdout||'').replace(/\u001b\[[0-9;]*m/g,''))
 console.log((result.stderr||'').replace(/\u001b\[[0-9;]*m/g,'').split(/\r?\n/).slice(-15).join('\n'))
 console.log('SELECT_PROBE_VERSIONS', JSON.stringify({node:process.version,antd:JSON.parse(fs.readFileSync('node_modules/antd/package.json')).version,select:JSON.parse(fs.readFileSync('node_modules/@rc-component/select/package.json')).version}))
 status=result.status??1
} finally {fs.unlinkSync(file)}
process.exitCode=status
