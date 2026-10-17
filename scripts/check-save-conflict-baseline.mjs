import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
// Keep the prior implementation exact. A failed import or timeout is NOT a
// reproduction of the stale acknowledged-cache defect.
const baseline='8480c91d293fbdb1f565da2d710536b1edefd4dd'
const file='src/components/TextEditor.jsx',bytes=readFileSync(file)
const output='test-results/save-recovery/acknowledged-cache-baseline.json'
mkdirSync('test-results/save-recovery',{recursive:true})
try {
 const old=spawnSync('git',['show',baseline+':'+file])
 assert.equal(old.status,0);writeFileSync(file,old.stdout)
 const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--root=.',
  'src/components/EditorSaveConflict.test.jsx','-t','a successful save and its delayed cache timer',
  '--reporter=json','--outputFile='+output],{encoding:'utf8',timeout:60000})
 writeFileSync(output+'.log',run.stdout+run.stderr)
 assert.equal(run.error,undefined);assert.equal(run.status,1)
 const report=JSON.parse(readFileSync(output,'utf8'))
 const failed=report.testResults.flatMap(f=>f.assertionResults).filter(a=>a.status==='failed')
 assert.equal(failed.length,1)
 assert.match(failed[0].title,/^a successful save and its delayed cache timer/)
 assert.match(failed[0].failureMessages.join(''),/expected .* to be null/s)
 console.log('Confirmed exact 4.189.1 acknowledged-cache regression; import errors/timeouts are not accepted.')
} finally {writeFileSync(file,bytes);assert.ok(readFileSync(file).equals(bytes))}
