import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const baseline = '0b66c7e6a902129cd2ead4da75f5d1bf96a9d9de'
const files = ['src/App.jsx','src/components/TextEditor.jsx','src/services/editorQuit.mjs']
const saved = files.map(file => [file, readFileSync(file)])
mkdirSync('test-results/save-recovery',{recursive:true})
try {
  for (const file of files) {
    const result=spawnSync('git',['show',baseline+':'+file])
    assert.equal(result.status,0,'Exact old source required: '+file)
    writeFileSync(file,result.stdout)
  }
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--root=.','src/AppSaveRecovery.test.jsx','-t','Ctrl\\+S commits|structural changes are included','--reporter=json','--outputFile=test-results/save-recovery/baseline.json'],{encoding:'utf8',timeout:60000})
  writeFileSync('test-results/save-recovery/baseline.log',run.stdout+run.stderr)
  assert.equal(run.error,undefined);assert.equal(run.status,1)
  const report=JSON.parse(readFileSync('test-results/save-recovery/baseline.json','utf8'))
  const failed=report.testResults.flatMap(f=>f.assertionResults).filter(a=>a.status==='failed')
  assert.equal(failed.length,2)
  assert.ok(failed.some(a=>a.title.startsWith('Ctrl+S commits')))
  assert.ok(failed.some(a=>a.title.startsWith('structural changes are included')))
  assert.ok(failed.every(a=>/expected .* to be/.test(a.failureMessages.join(''))))
  console.log('Confirmed two real old-App regressions: structural Ctrl+S and interval autosave do not persist the changed body.')
} finally {
  for(const [file,bytes] of saved){writeFileSync(file,bytes);assert.ok(readFileSync(file).equals(bytes))}
}
