import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { replaceExactlyAndProveInverse } from './reading-mode-installed-evidence.mjs'
import { LOCAL_EXPORT_VERSION } from './local-export-desktop-evidence.mjs'
import { prepareLocalExportVerifierSources, validateLocalExportInstallerPin } from './local-export-installed-evidence.mjs'
import { BLOCK_REFERENCE_SOURCES, BLOCK_REFERENCE_REPORT, BLOCK_REFERENCE_VERSION, blockReferenceBlob, blockReferenceHash, verifyBlockReferencesReport } from './block-references-evidence.mjs'
export const BLOCK_REFERENCE_INSTALLATION_GATE='installed-app-block-reference-workflow'
export function validateBlockReferencePin(pin){
  validateLocalExportInstallerPin(pin);assert.equal(pin.current.version,LOCAL_EXPORT_VERSION)
  assert.deepEqual(Object.keys(pin.blockReferenceSources||{}).sort(),[...BLOCK_REFERENCE_SOURCES].sort())
  for(const value of Object.values(pin.blockReferenceSources))assert.match(value||'',/^[a-f0-9]{40}$/)
  return true
}
export function prepareBlockReferenceVerifierSources(pin,readSource){
  validateBlockReferencePin(pin)
  for(const name of BLOCK_REFERENCE_SOURCES){const value=readSource('../'+name);assert.equal(typeof value,'string','Missing block-reference source: '+name);assert.equal(blockReferenceBlob(value.replace(/\r\n/g,'\n')),pin.blockReferenceSources[name],'Changed block-reference source: '+name)}
  return prepareLocalExportVerifierSources(pin,readSource).map(item=>{
    if(item.output!=='run-reading-import-generated.mjs')return item
    const pairs=BLOCK_REFERENCE_SOURCES.map(name=>"['../"+name+"',pin.blockReferenceSources["+JSON.stringify(name)+"]]").join(',')
    const additions=[
      ["from './local-export-installed-evidence.mjs'","from './local-export-installed-evidence.mjs'\nimport {extendBlockReferenceInstallation,verifyInstalledBlockReferences,validateGeneratedBlockReferenceSources} from './block-references-installed-evidence.mjs'"],
      ["validateGeneratedLocalExportSources(pin,name=>read('./'+name))","validateGeneratedBlockReferenceSources(pin,name=>read('./'+name))"],
      ['prepared=extendLocalExportInstallation(shortcutPrepared,pin);','exportPrepared=extendLocalExportInstallation(shortcutPrepared,pin),prepared=extendBlockReferenceInstallation(exportPrepared,pin);'],
      ["['./local-export-directory-worker.ps1',pin.localExportDirectoryWorkerBlob]","['./local-export-directory-worker.ps1',pin.localExportDirectoryWorkerBlob],"+pairs],
      ['localExport=await verifyLocalExportInstalledReport(out,report,shortcutManagement,pin,process.env.GITHUB_SHA)','localExport=await verifyLocalExportInstalledReport(out,report,shortcutManagement,pin,process.env.GITHUB_SHA),blocks=verifyInstalledBlockReferences(out,report,pin,process.env.GITHUB_SHA)'],
      ['...localExport.screenshots]','...localExport.screenshots,...blocks.screenshots]'],
      ['localExportChecks:localExport.checks,shortcutManagementChecks:','blockReferenceChecks:blocks.checks,localExportChecks:localExport.checks,shortcutManagementChecks:'],
    ]
    const pinned=replaceExactlyAndProveInverse(item.pinned,additions),changes=[...item.changes,...additions]
    assert.equal(replaceExactlyAndProveInverse(pinned,[...changes].reverse().map(([a,b])=>[b,a])),item.original)
    return{...item,pinned,changes,exportPinned:item.pinned}
  })
}
export function validateGeneratedBlockReferenceSources(pin,readSource){
  for(const item of prepareBlockReferenceVerifierSources(pin,readSource))assert.equal(readSource(item.output).replace(/\r\n/g,'\n'),item.pinned)
  return true
}
export function extendBlockReferenceInstallation(prepared,pin){
  validateBlockReferencePin(pin);assert.ok(prepared.core.includes(`export const PRODUCT_COMMIT = '${pin.product}'`))
  assert.doesNotMatch(prepared.script,/runBlockReferencesDesktop|blockReferenceRun/);assert.doesNotMatch(prepared.core,/installed-app-block-reference-workflow/)
  const anchor="  const finalData=snapshotData();await uninstall('final-uninstall');unchanged(finalData,'final-uninstall');mark('final-uninstall-preserves-data')"
  const addition=`  const blocks=await runBlockReferencesDesktop({executablePath:appExe,out,productCommit:PRODUCT_COMMIT,scope:'installed',ownedRoot:scratch})\n  assert.equal(report.appExits.length,6);assert.equal(report.shortcutManagementRun.processIDs.length,2)\n  const shortcutReport=JSON.parse(readFileSync(path.join(out,'shortcut-management-desktop.json'),'utf8'))
  const exportReport=JSON.parse(readFileSync(path.join(out,'local-export-desktop.json'),'utf8'))
  assert.equal(assertIndependentInstalledModuleSessions(report,shortcutReport,exportReport,blocks),true)\n  for(const key of ['executableSHA256','asarSHA256','backendSHA256'])assert.equal(blocks[key],report.localExportRun.application[key])\n  report.blockReferenceRun={report:'${BLOCK_REFERENCE_REPORT}',sha256:sha(readFileSync(path.join(out,'${BLOCK_REFERENCE_REPORT}'))),processID:blocks.pid};save();mark('${BLOCK_REFERENCE_INSTALLATION_GATE}')\n`
  const exportGate = "mark('installed-app-local-export-workflow')"
  assert.equal(prepared.script.split(exportGate).length, 2, 'The existing export gate must remain exactly once')
  assert.ok(prepared.script.indexOf(exportGate)<prepared.script.indexOf(anchor))
  return {core:replaceExactlyAndProveInverse(prepared.core,[["'installed-app-local-export-workflow',","'installed-app-local-export-workflow', '"+BLOCK_REFERENCE_INSTALLATION_GATE+"',"]]),
    script:"import {runBlockReferencesDesktop} from './run-block-references-desktop.mjs'\nimport {assertIndependentInstalledModuleSessions} from './block-references-installed-evidence.mjs'\n"+replaceExactlyAndProveInverse(prepared.script,[[anchor,addition+anchor]])}
}

// A Windows PID is reusable after process exit. Prove disjoint native sessions by
// chronological, successful teardown instead of assuming PID uniqueness forever.
export function assertIndependentInstalledModuleSessions(installation,shortcuts,localExport,blocks){
  const time=(value,label)=>{const parsed=Date.parse(value);assert.ok(Number.isFinite(parsed),'Invalid native session time: '+label);return parsed}
  const completed=(report,label)=>{
    assert.equal(report.complete,true,label+' incomplete')
    assert.equal(report.cleanupComplete,true,label+' cleanup incomplete')
    assert.equal(report.forceTerminated,false,label+' force-terminated')
  }
  assert.equal(installation.appExits.length,6)
  for(const exit of installation.appExits){assert.equal(exit.code,0);assert.equal(exit.signal,null);assert.equal(exit.nativeClose,true)}
  for(const [name,report] of [['shortcuts',shortcuts],['localExport',localExport],['blocks',blocks]])completed(report,name)
  assert.equal(shortcuts.launches.length,2);assert.equal(shortcuts.exits.length,2)
  assert.deepEqual(shortcuts.launches.map(item=>item.pid),installation.shortcutManagementRun.processIDs)
  for(let i=0;i<2;i++){assert.equal(shortcuts.exits[i].pid,shortcuts.launches[i].pid);assert.equal(shortcuts.exits[i].code,0);assert.equal(shortcuts.exits[i].signal,null);assert.equal(shortcuts.exits[i].nativeClose,true);assert.equal(shortcuts.exits[i].backendStopped,true)}
  assert.equal(localExport.launch.pid,installation.localExportRun.processID)
  assert.equal(localExport.exit.pid,localExport.launch.pid);assert.equal(localExport.exit.code,0);assert.equal(localExport.exit.signal,null);assert.equal(localExport.exit.nativeClose,true);assert.equal(localExport.exit.backendStopped,true)
  assert.equal(blocks.exit.pid,blocks.pid);assert.equal(blocks.exit.code,0);assert.equal(blocks.exit.signal,null);assert.equal(blocks.exit.normalClose,true);assert.equal(blocks.backendStopped,true)
  const shortcutStart=time(shortcuts.startedAt,'shortcuts start'),shortcutEnd=time(shortcuts.finishedAt,'shortcuts finish')
  const exportStart=time(localExport.startedAt,'export start'),exportEnd=time(localExport.finishedAt,'export finish')
  const blockStart=time(blocks.startedAt,'blocks start'),blockEnd=time(blocks.completedAt,'blocks finish')
  assert.ok(shortcutStart<=shortcutEnd && shortcutEnd<=exportStart,'Shortcut session must exit before export starts')
  assert.ok(exportStart<=exportEnd && exportEnd<=blockStart,'Export session must exit before block-reference session starts')
  assert.ok(blockStart<=blockEnd,'Block-reference session completion precedes its start')
  return true
}
export function verifyInstalledBlockReferences(directory,installation,pin,verifier){
  validateBlockReferencePin(pin)
  assert.equal(installation.complete,true);assert.equal(installation.cleanupComplete,true);assert.equal(installation.forceTerminated,false)
  assert.equal(installation.productCommit,pin.product);assert.equal(installation.verifierCommit,verifier)
  assert.equal(installation.blockReferenceRun.report,BLOCK_REFERENCE_REPORT)
  assert.equal(blockReferenceHash(readFileSync(path.join(directory,BLOCK_REFERENCE_REPORT))),installation.blockReferenceRun.sha256)
  const report=verifyBlockReferencesReport(directory,{commit:pin.product,verifier,scope:'installed',sources:pin.blockReferenceSources})
  assert.equal(installation.blockReferenceRun.processID,report.pid)
  assert.equal(installation.appExits.length,6);assert.equal(installation.dataComparisons.length,6);for(const c of installation.dataComparisons)assert.equal(c.equal,true)
  const shortcuts=JSON.parse(readFileSync(path.join(directory,'shortcut-management-desktop.json'),'utf8'))
  const localExport=JSON.parse(readFileSync(path.join(directory,'local-export-desktop.json'),'utf8'))
  assert.equal(assertIndependentInstalledModuleSessions(installation,shortcuts,localExport,report),true)
  for(const key of ['executable','executableSHA256','asarSHA256','backendSHA256'])assert.equal(report[key],installation.localExportRun.application[key])
  assert.equal(installation.checks.filter(c=>c===BLOCK_REFERENCE_INSTALLATION_GATE).length,1)
  assert.ok(installation.checks.indexOf(BLOCK_REFERENCE_INSTALLATION_GATE)>installation.checks.indexOf('installed-app-local-export-workflow'))
  assert.ok(installation.checks.indexOf(BLOCK_REFERENCE_INSTALLATION_GATE)<installation.checks.indexOf('final-uninstall-preserves-data'))
  return report
}
