import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { blockPinFixture, source } from './block-references-test-fixture.mjs'
import { BLOCK_REFERENCE_SOURCES } from './block-references-evidence.mjs'
import { replaceExactlyAndProveInverse } from './reading-mode-installed-evidence.mjs'
import { extendShortcutManagementInstallation } from './shortcut-management-installed-evidence.mjs'
import { extendLocalExportInstallation } from './local-export-installed-evidence.mjs'
import { BLOCK_REFERENCE_INSTALLATION_GATE, validateBlockReferencePin, prepareBlockReferenceVerifierSources, validateGeneratedBlockReferenceSources, extendBlockReferenceInstallation } from './block-references-installed-evidence.mjs'
const read=name=>source('scripts/'+name)
test('block source pins cover all product and runner files independently',()=>{
 const pin=blockPinFixture();assert.equal(validateBlockReferencePin(pin),true)
 for(const name of BLOCK_REFERENCE_SOURCES){const p=structuredClone(pin);delete p.blockReferenceSources[name];assert.throws(()=>validateBlockReferencePin(p));assert.throws(()=>prepareBlockReferenceVerifierSources(pin,n=>read(n)+(n==='../'+name?'\n// changed':'')))}
})
test('prepared runner preserves every original validator and reverses exactly',()=>{
 const pin=blockPinFixture(),generated=prepareBlockReferenceVerifierSources(pin,read);assert.equal(generated.length,6)
 for(const item of generated){assert.equal(replaceExactlyAndProveInverse(item.pinned,[...item.changes].reverse().map(([a,b])=>[b,a])),item.original)}
 const supplied=name=>generated.find(i=>i.output===name)?.pinned??read(name)
 assert.equal(validateGeneratedBlockReferenceSources(pin,supplied),true)
 for(const item of generated)assert.throws(()=>validateGeneratedBlockReferenceSources(pin,n=>supplied(n)+(n===item.output?'\n// changed':'')))
 const runner=generated.find(i=>i.output==='run-reading-import-generated.mjs').pinned
 for(const term of ['validateLifecycleReport(report)','validateShortcutCompletion(report)','verifyLocalExportInstalledReport(', 'verifyInstalledBlockReferences(', '...localExport.screenshots,...blocks.screenshots]', 'blockReferenceChecks:blocks.checks'])assert.ok(runner.includes(term),term)
})
for(const ending of ['LF','CRLF'])test('complete '+ending+' preparation keeps all 28 previous gates and adds the 29th',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'blocks103-install-contract-'))
 try{
  const scripts=path.join(directory,'scripts');cpSync(fileURLToPath(new URL('.',import.meta.url)),scripts,{recursive:true})
  for(const name of BLOCK_REFERENCE_SOURCES.filter(n=>!n.startsWith('scripts/'))){const target=path.join(directory,name);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,source(name))}
  symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(directory,'node_modules'),'junction')
  const checkout=folder=>{for(const entry of readdirSync(folder,{withFileTypes:true})){const f=path.join(folder,entry.name);if(entry.isDirectory())checkout(f);else if(/\.(?:mjs|cjs|js|jsx|ps1)$/.test(entry.name)){const v=readFileSync(f,'utf8').replace(/\r\n/g,'\n');writeFileSync(f,ending==='CRLF'?v.replace(/\n/g,'\r\n'):v)}}};checkout(scripts)
  const read=n=>readFileSync(path.join(scripts,n),'utf8').replace(/\r\n/g,'\n'),pin=blockPinFixture(),generated=prepareBlockReferenceVerifierSources(pin,read)
  for(const item of generated)writeFileSync(path.join(scripts,item.output),item.pinned)
  const module=name=>import(pathToFileURL(path.join(scripts,name)).href)
  const{prepareLocalImportValidatorPin}=await module('pin-reading-import-generated.mjs'),inherited=prepareLocalImportValidatorPin(pin,read)
  writeFileSync(path.join(scripts,'template-installed-evidence.mjs'),inherited.after)
  for(const item of inherited.generated)writeFileSync(path.join(scripts,item.output),item.pinned)
  const{prepareOutlineInstallation}=await module('document-outline-installed-evidence.mjs')
  const{extendGraphInstallation}=await module('import-graph-validator.mjs'),{extendPinsInstallation}=await module('import-pins-validator.mjs'),{extendRecentInstallation}=await module('import-recent-validator.mjs'),{prepareInstallerHistoryReadiness}=await module('installer-history-readiness.mjs'),{extendWikiInstallation}=await module('import-wiki-validator.mjs'),{extendLocalImportInstallation}=await module('reading-import-validator.mjs'),{extendReadingModeInstallation}=await module('reading-mode-installed-evidence.mjs')
  const old=prepareOutlineInstallation(read('installer-lifecycle-core.mjs'),read('check-windows-installer-lifecycle.mjs'),pin)
  const reading=extendReadingModeInstallation(extendLocalImportInstallation(extendWikiInstallation(prepareInstallerHistoryReadiness(extendRecentInstallation(extendPinsInstallation(extendGraphInstallation(old,pin),pin),pin)),pin),pin),pin)
  const previous=extendLocalExportInstallation(extendShortcutManagementInstallation(reading,pin),pin),final=extendBlockReferenceInstallation(previous,pin)
  writeFileSync(path.join(scripts,'previous-core.mjs'),previous.core);writeFileSync(path.join(scripts,'block-core.mjs'),final.core)
  const previousCore=await module('previous-core.mjs'),core=await module('block-core.mjs')
  assert.equal(previousCore.REQUIRED_CHECKS.length,28);assert.equal(core.REQUIRED_CHECKS.length,29)
  assert.deepEqual(core.REQUIRED_CHECKS.filter(c=>c!==BLOCK_REFERENCE_INSTALLATION_GATE),previousCore.REQUIRED_CHECKS)
  assert.deepEqual(core.RELEASES,{previous:pin.previous,current:pin.current});assert.equal(core.PRODUCT_COMMIT,pin.product)
  const call='await runBlockReferencesDesktop('
  assert.equal(final.script.split(call).length,2);assert.ok(final.script.indexOf(call)>final.script.indexOf("mark('installed-app-local-export-workflow')"));assert.ok(final.script.indexOf(call)<final.script.indexOf('const finalData=snapshotData()'))
  for(const call of ['await runLocalExportLifecycle(','await runShortcutManagementLifecycle(','await verifyReadingModeDesktop(','await verifyLocalImportRestart('])assert.equal(final.script.split(call).length,2)
  assert.ok(final.script.includes("assert.equal(observedDirectory,legacyTarget.split(' ')[0],'Old directory truncation was not reproduced')"));assert.ok(final.core.includes(previousCore.LEGACY_DEFECT.sha256))
  assert.throws(()=>extendBlockReferenceInstallation(final,pin))
  assert.throws(()=>extendBlockReferenceInstallation({...previous,script:previous.script.replace("mark('installed-app-local-export-workflow')","mark('removed-export')")},pin))
  writeFileSync(path.join(scripts,'blocks-install.mjs'),final.script)
  for(const file of ['blocks-install.mjs','run-reading-import-generated.mjs']){const checked=spawnSync(process.execPath,['--check',path.join(scripts,file)],{encoding:'utf8',timeout:10000});assert.ifError(checked.error);assert.equal(checked.status,0,checked.stderr)}
 }finally{rmSync(directory,{recursive:true,force:true})}
})
test('installed workflow retains original budgets, preparation rosters and native entry',()=>{
 const w=source('.github/workflows/local-installation-2f86.yml')
 assert.equal(w.match(/timeout-minutes:\s*(\d+)/)[1],'20')
 assert.ok(w.includes('scripts/block-references-evidence.node.mjs scripts/block-references-installed-evidence.node.mjs'))
 assert.ok(w.includes('run: node scripts/run-reading-mode-installer.mjs run'))
 assert.ok(w.includes('local-export-preparation-contracts.tap scripts/local-export-desktop-evidence.node.mjs scripts/local-export-installed-evidence.node.mjs'))
})
