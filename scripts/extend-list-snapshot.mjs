import assert from 'node:assert/strict'
import fs from 'node:fs'
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Snapshot guard anchor mismatch');return s.replace(a,b)}
const helper='scripts/repair-list-refresh.mjs'
let s=fs.readFileSync(helper,'utf8')
s=once(s,'assert.equal(report.numTotalTests,5)','assert.equal(report.numTotalTests,6)')
s=once(s,'    const query = listContextRef.current.q','    const query = listContextRef.current.q\n    const selectedAtStart = listContextRef.current.selectedId')
s=once(s,'      setItems(normalizedList)\n      const current = listContextRef.current',`      const current = listContextRef.current
      // A pre-navigation snapshot cannot prove the new selection was deleted.
      // Read again once under its own identity; never navigate using old data.
      if (current.selectedId && current.selectedId !== selectedAtStart &&
          !normalizedList.some(item => item.id === current.selectedId)) {
        void load()
        return
      }
      setItems(normalizedList)`)
s=once(s,'Five actual React tests cover','Six actual React tests cover')
fs.writeFileSync(helper,s)
const test='src/components/FileListRefreshOwnership.test.jsx'
fs.appendFileSync(test,`\ntest('pre-navigation list missing the new note triggers a fresh read instead of deletion fallback',async()=>{
 const read=deferred();listAllFiles.mockReturnValueOnce(read.promise);await render(null)
 await act(async()=>host.querySelector('[data-select-daily]').click());await flush()
 const calls=listAllFiles.mock.calls.length
 await act(async()=>read.resolve([oldNote]));await flush()
 expect(listAllFiles.mock.calls.length).toBe(calls+1)
 expect(host.querySelector('[data-current]').textContent).toBe(daily.id)
 expect(host.querySelector('[data-title]').textContent).toBe(daily.title)
 expect(host.querySelector('[data-file-id="daily-note"]')).toBeTruthy()
 expect(host.querySelector('[data-dirty]').textContent).toBe('false')
})
`)
