// Complete same-module acceptance coverage before first product promotion.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
const read=p=>fs.readFileSync(p,'utf8'),blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,'Exact lifecycle anchor mismatch');return s.replace(a,b)}
const component='src/components/QuickSwitcher.jsx';let s=read(component)
assert.equal(blob(s),'4f91ea250677ba442529c7500f8d69ec38a3be46')
s=replace(s,"setNotice('已停止打开，未切换笔记。'); inputRef.current?.focus()", "setNotice('已停止打开，未切换笔记。'); window.setTimeout(() => { if (alive.current && !choosing.current) inputRef.current?.focus() }, 0)")
fs.writeFileSync(component,s)
const native='scripts/check-quick-switcher-desktop.mjs';s=read(native);assert.equal(blob(s),'f642a267cc7405faac3d3abf8fbb53caa3165ca2')
s=replace(s,"'Target retry unavailable');await key('Enter',13)","'Target retry unavailable');await click('.quick-switcher [role=option]:enabled')")
fs.writeFileSync(native,s)
const tests='src/components/QuickSwitcher.lifecycle.test.jsx';s=read(tests);assert.equal(blob(s),'1b64c406562a35b666d79e225d5c997c932830c6')
s+=`\ntest('navigation changes before a late target arrives cancel that old opening',async()=>{const epoch={current:1};await mount({navigationEpoch:epoch});let release;api.mockReturnValue(new Promise(r=>release=r));await result();epoch.current=2;await mount({navigationEpoch:epoch});await act(async()=>release(note()));expect(props.onSelectFile).not.toHaveBeenCalled();expect(host.textContent).toContain('页面已切换')})
test('navigation ref changes are checked even before a new render',async()=>{const epoch={current:1};await mount({navigationEpoch:epoch});let release;api.mockReturnValue(new Promise(r=>release=r));await result();epoch.current=2;await act(async()=>release(note()));expect(props.onSelectFile).not.toHaveBeenCalled();expect(props.onClose).not.toHaveBeenCalled()})
test('old App confirmation becomes invalid after another navigation',async()=>{const epoch={current:1};await mount({navigationEpoch:epoch});await result();const consent=props.onSelectFile.mock.calls[0][1];epoch.current=2;expect(consent.shouldSelect()).toBe(false);await mount({navigationEpoch:epoch});await act(async()=>consent.afterSelect());expect(props.onClose).not.toHaveBeenCalled();expect(host.querySelector('.quick-switcher-overlay').style.visibility).not.toBe('hidden')})
test('stop restores input focus only after it has become enabled',async()=>{await mount();api.mockReturnValue(new Promise(()=>{}));await result();button('关闭').focus();await click('停止打开');await advance(1);expect(host.querySelector('input').disabled).toBe(false);expect(document.activeElement).toBe(host.querySelector('input'))})
test('focus scheduled by stop cannot steal focus after close and unmount',async()=>{await mount();api.mockReturnValue(new Promise(()=>{}));await result();await click('停止打开');const outside=document.createElement('button');document.body.append(outside);try{await act(async()=>root.render(null));outside.focus();await advance(1);expect(document.activeElement).toBe(outside)}finally{outside.remove()}})
`
fs.writeFileSync(tests,s)
console.log('Five navigation and focus cases added; native retry uses an actual mouse click on the refreshed result.')
