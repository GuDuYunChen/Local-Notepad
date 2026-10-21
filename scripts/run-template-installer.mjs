import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {assertHostedWindows,validateLifecycleReport} from './installer-lifecycle-core.mjs'
import {validateShortcutCompletion,gitBlob} from './installer-shell-core.mjs'
import {PRODUCT,DAILY_BLOB,HISTORY_BLOB,TEMPLATE_BLOB,prepareTemplateInstallation,validateInstalledTemplates} from './template-installed-evidence.mjs'
assertHostedWindows(process.env,process.platform)
const out=path.resolve('test-results/installer-lifecycle');mkdirSync(out,{recursive:true})
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8').replace(/\r\n/g,'\n')
const preparedFile=new URL('./check-windows-installer-lifecycle.templates.mjs',import.meta.url)
if(process.argv[2]==='prepare'){
 const core=read('./installer-lifecycle-core.mjs'),original=read('./check-windows-installer-lifecycle.mjs')
 assert.equal(gitBlob(read('./check-template-library-desktop.mjs')),TEMPLATE_BLOB)
 assert.equal(gitBlob(read('./check-daily-notes-desktop.mjs')),DAILY_BLOB)
 assert.equal(gitBlob(read('./check-version-history-desktop.mjs')),HISTORY_BLOB)
 const prepared=prepareTemplateInstallation(core,original)
 assert.equal(existsSync(preparedFile),false)
 for(const[name,text]of Object.entries({originalCore:core,originalVerifier:original,preparedCore:prepared.core,preparedVerifier:prepared.script}))writeFileSync(path.join(out,name+'.txt'),text,{flag:'wx'})
 writeFileSync(new URL('./installer-lifecycle-core.mjs',import.meta.url),prepared.core)
 writeFileSync(preparedFile,prepared.script,{flag:'wx'})
 writeFileSync(path.join(out,'template-verifier-source.json'),JSON.stringify({productCommit:PRODUCT,verifierCommit:process.env.GITHUB_SHA,originalCore:gitBlob(core),originalVerifier:gitBlob(original),preparedCore:gitBlob(prepared.core),preparedVerifier:gitBlob(prepared.script),daily:DAILY_BLOB,history:HISTORY_BLOB,templates:TEMPLATE_BLOB,productionModified:false},null,2))
}else if(process.argv[2]==='run'){
 const reportFile=path.join(out,'installation.json')
 try{
  await import(preparedFile.href)
  const report=JSON.parse(readFileSync(reportFile,'utf8'))
  const daily=JSON.parse(readFileSync(path.join(out,'daily-notes.json'),'utf8'))
  const history=JSON.parse(readFileSync(path.join(out,'version-history.json'),'utf8'))
  const templates=JSON.parse(readFileSync(path.join(out,'template-library.json'),'utf8'))
  validateLifecycleReport(report);validateShortcutCompletion(report);validateInstalledTemplates(report,daily,history,templates,process.env.GITHUB_SHA)
  for(const image of [...daily.screenshots,...history.screenshots,...templates.screenshots]){const b=readFileSync(path.join(out,image.filename));assert.equal(b.length,image.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),image.sha256)}
  writeFileSync(path.join(out,'template-installation-accepted.json'),JSON.stringify({complete:true,productCommit:PRODUCT,verifierCommit:process.env.GITHUB_SHA,installer:report.installers.current,templateChecks:templates.checks,dailyChecks:daily.checks,historyChecks:history.checks,installationChecks:report.checks,screenshotsVerified:true,scope:'hosted Windows current-user silent NSIS'},null,2))
 }catch(error){if(existsSync(reportFile)){const r=JSON.parse(readFileSync(reportFile,'utf8'));r.complete=false;r.error=String(error.stack||error);writeFileSync(reportFile,JSON.stringify(r,null,2))}throw error}
}else throw Error('Expected prepare or run')
