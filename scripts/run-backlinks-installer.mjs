import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {assertHostedWindows,validateLifecycleReport} from './installer-lifecycle-core.mjs'
import {validateShortcutCompletion,gitBlob} from './installer-shell-core.mjs'
import {PRODUCT,DAILY_BLOB,HISTORY_BLOB,TEMPLATE_BLOB,validateInstalledTemplates} from './template-installed-evidence.mjs'
import {validateInstalledQuick} from './quick-installed-evidence.mjs'
import {validateInstalledNoteTags} from './note-tags-installed-evidence.mjs'
import {prepareBacklinkInstallation,validateInstalledBacklinks} from './backlinks-installed-evidence.mjs'
assertHostedWindows(process.env,process.platform)
const pin=JSON.parse(readFileSync(new URL('./backlinks-installer-pin.json',import.meta.url),'utf8'));assert.equal(PRODUCT,pin.product);assert.equal(TEMPLATE_BLOB,pin.templateBlob)
const out=path.resolve('test-results/installer-lifecycle');mkdirSync(out,{recursive:true})
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8').replace(/\r\n/g,'\n')
const preparedFile=new URL('./check-windows-installer-lifecycle.backlinks.mjs',import.meta.url)
if(process.argv[2]==='prepare'){
 const core=read('./installer-lifecycle-core.mjs'),original=read('./check-windows-installer-lifecycle.mjs')
 for(const[file,sha]of [['./check-template-library-desktop.mjs',TEMPLATE_BLOB],['./check-daily-notes-desktop.mjs',DAILY_BLOB],['./check-version-history-desktop.mjs',HISTORY_BLOB],['./check-quick-switcher-desktop.mjs',pin.quickBlob],['./check-note-tags-desktop.mjs',pin.tagsBlob],['./check-backlinks-desktop.mjs',pin.backlinksBlob]])assert.equal(gitBlob(read(file)),sha)
 const prepared=prepareBacklinkInstallation(core,original,pin);assert.equal(existsSync(preparedFile),false)
 for(const[name,text]of Object.entries({originalCore:core,originalVerifier:original,preparedCore:prepared.core,preparedVerifier:prepared.script}))writeFileSync(path.join(out,name+'.txt'),text,{flag:'wx'})
 writeFileSync(new URL('./installer-lifecycle-core.mjs',import.meta.url),prepared.core);writeFileSync(preparedFile,prepared.script,{flag:'wx'})
 writeFileSync(path.join(out,'backlinks-verifier-source.json'),JSON.stringify({productCommit:PRODUCT,verifierCommit:process.env.GITHUB_SHA,originalCore:gitBlob(core),originalVerifier:gitBlob(original),preparedCore:gitBlob(prepared.core),preparedVerifier:gitBlob(prepared.script),quick:pin.quickBlob,noteTags:pin.tagsBlob,templates:TEMPLATE_BLOB,backlinks:pin.backlinksBlob,productionModified:false},null,2))
}else if(process.argv[2]==='run'){
 const reportFile=path.join(out,'installation.json')
 try{
  await import(preparedFile.href)
  const json=f=>JSON.parse(readFileSync(path.join(out,f),'utf8'))
  const report=json('installation.json'),daily=json('daily-notes.json'),history=json('version-history.json'),templates=json('template-library.json'),quick=json('quick-switcher.json'),tags=json('note-tags.json'),backlinks=json('backlinks.json')
  validateLifecycleReport(report);validateShortcutCompletion(report);validateInstalledTemplates(report,daily,history,templates,process.env.GITHUB_SHA);validateInstalledQuick(report,quick,pin,process.env.GITHUB_SHA);validateInstalledNoteTags(report,tags,pin,process.env.GITHUB_SHA);validateInstalledBacklinks(report,backlinks,pin,process.env.GITHUB_SHA)
  for(const image of [...daily.screenshots,...history.screenshots,...templates.screenshots,...quick.screenshots,...tags.screenshots,...backlinks.screenshots]){assert.equal(path.basename(image.filename),image.filename);const b=readFileSync(path.join(out,image.filename));assert.equal(b.length,image.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),image.sha256)}
  writeFileSync(path.join(out,'backlinks-installation-accepted.json'),JSON.stringify({complete:true,productCommit:PRODUCT,verifierCommit:process.env.GITHUB_SHA,installer:report.installers.current,backlinkChecks:backlinks.checks,tagChecks:tags.checks,quickChecks:quick.checks,templateChecks:templates.checks,dailyChecks:daily.checks,historyChecks:history.checks,installationChecks:report.checks,screenshotsVerified:true,scope:'hosted Windows current-user silent NSIS'},null,2))
 }catch(error){if(existsSync(reportFile)){const r=JSON.parse(readFileSync(reportFile,'utf8'));r.complete=false;r.error=String(error.stack||error);writeFileSync(reportFile,JSON.stringify(r,null,2))}throw error}
}else throw Error('Expected prepare or run')
