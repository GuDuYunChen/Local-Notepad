import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { BLOCK_REFERENCE_CHECKS } from './block-references-desktop-driver.mjs'
import { blockLocator, findReferenceBlock, validBlockId } from '../src/services/blockReferenceModel.mjs'
export const BLOCK_REFERENCE_VERSION = '4.236.0'
export const BLOCK_REFERENCE_REPORT = 'block-references.json'
export const BLOCK_REFERENCE_SOURCES = Object.freeze([
  'scripts/block-references-desktop-driver.mjs', 'scripts/run-block-references-desktop.mjs', 'scripts/block-references-evidence.mjs',
  'src/services/blockReferenceModel.mjs', 'src/services/blockReferences.mjs',
  'src/components/Editor/plugins/BlockReferencePlugin.jsx', 'src/components/Editor/plugins/BlockReferences.css',
  'src/components/Editor/utils/blockReferenceState.js', 'src/components/Editor/nodes/BlockEmbedView.jsx',
  'src/components/Editor/nodes/WikiLinkNode.jsx', 'src/components/Editor/nodes/WikiLinkView.jsx',
  'src/components/Editor/nodes/CodeBlockNode.jsx', 'src/components/Editor/plugins/BlockHandlePlugin.jsx',
  'src/components/Editor/Editor.jsx', 'src/services/wikiNavigation.mjs', 'src/hooks/useGuardedNoteOpener.js', 'src/App.jsx',
  'src/services/markdownSource.js', 'electron/local-export-document.js', 'src/utils/lexicalText.js',
  'src/components/Editor/utils/referenceUtils.js',
])
export const blockReferenceHash = value => createHash('sha256').update(value).digest('hex')
export const blockReferenceBlob = value => createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex')
export function validateBlockReferencesReport(report,{commit,verifier=commit,scope='packaged',sources}={}) {
  assert.match(commit||'',/^[a-f0-9]{40}$/);assert.match(verifier||'',/^[a-f0-9]{40}$/)
  assert.equal(report.schemaVersion,1);assert.equal(report.module,'2F.103');assert.equal(report.version,BLOCK_REFERENCE_VERSION)
  assert.equal(report.productCommit,commit);assert.equal(report.verifierCommit,verifier);assert.equal(report.scope,scope)
  assert.equal(report.platform,'win32');assert.equal(report.runnerEnvironment,'github-hosted');assert.equal(report.localValidationOnly,false)
  assert.equal(report.verificationScope,'windows-complete')
  assert.equal(report.smallViewport.overflow,false);assert.ok(report.smallViewport.width>=640&&report.smallViewport.width<=720&&report.smallViewport.height>=400)
  assert.equal(report.minimumWindow.pid,report.pid);assert.equal(report.minimumWindow.applied,true);assert.equal(report.minimumWindow.width,720);assert.equal(report.minimumWindow.height,520)
  assert.equal(report.darkPanel.theme,'dark');assert.notEqual(report.darkPanel.color,report.darkPanel.background)
  for(const field of ['complete','cleanupComplete','syntheticData','realBackend'])assert.equal(report[field],true,field)
  for(const field of ['bridgeOverridden','timerAccelerated','forceTerminated'])assert.equal(report[field],false,field)
  assert.equal(report.error,undefined);assert.equal(report.cleanupError,undefined)
  assert.deepEqual(report.checks,BLOCK_REFERENCE_CHECKS)
  assert.equal(report.app.version,BLOCK_REFERENCE_VERSION);assert.equal(report.app.packaged,true)
  for(const field of ['executableSHA256','asarSHA256','backendSHA256'])assert.match(report[field]||'',/^[a-f0-9]{64}$/,field)
  assert.ok(path.win32.isAbsolute(report.executable||''));assert.ok(Number.isSafeInteger(report.pid)&&report.pid>0)
  assert.deepEqual(report.exit,{pid:report.pid,code:0,signal:null,normalClose:true});assert.equal(report.backendStopped,true)
  assert.deepEqual(Object.keys(report.sourceFiles).sort(),[...BLOCK_REFERENCE_SOURCES].sort())
  for(const digest of Object.values(report.sourceFiles))assert.match(digest,/^[a-f0-9]{40}$/)
  assert.deepEqual(report.sourceFiles,sources,'Native checks must bind the independently pinned current sources')
  assert.ok(validBlockId(report.fixture.blockId));assert.notEqual(report.fixture.sourceId,report.fixture.destinationId)
  assert.equal(report.fixture.locator,blockLocator(report.fixture.sourceId,report.fixture.blockId))
  assert.equal(report.saved.source.id,report.fixture.sourceId);assert.equal(report.saved.destination.id,report.fixture.destinationId)
  assert.equal(report.saved.source.is_deleted,false);assert.equal(report.saved.destination.is_deleted,false)
  assert.equal(report.saved.source.is_folder,false);assert.equal(report.saved.destination.is_folder,false)
  findReferenceBlock(report.saved.source.content,report.fixture.blockId)
  const walk=node=>[node,...(node.children||[]).flatMap(walk)]
  const refs=walk(JSON.parse(report.saved.destination.content).root).filter(n=>n.type==='wiki-link'&&n.id===report.fixture.sourceId&&n.blockId===report.fixture.blockId)
  assert.equal(refs.length,2);assert.equal(refs.filter(n=>n.embedded===true).length,1);assert.equal(refs.filter(n=>n.embedded===false).length,1)
  assert.deepEqual(report.screenshots.map(s=>s.filename),['block103-source-address.png','block103-reviewed-insertion.png','block103-exact-navigation.png','block103-embedded.png','block103-reading-mode.png','block103-small-window.png','block103-dark-theme.png'])
  for(const image of report.screenshots){assert.equal(path.basename(image.filename),image.filename);assert.ok(image.bytes>1000);assert.match(image.sha256,/^[a-f0-9]{64}$/)}
  return true
}
export function verifyBlockReferencesReport(directory,expected) {
  const report=JSON.parse(readFileSync(path.join(directory,BLOCK_REFERENCE_REPORT),'utf8'))
  validateBlockReferencesReport(report,expected)
  for(const image of report.screenshots){const location=path.join(directory,image.filename);assert.equal(lstatSync(location).isSymbolicLink(),false);const bytes=readFileSync(location);assert.equal(bytes.length,image.bytes);assert.equal(blockReferenceHash(bytes),image.sha256);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(bytes.readUInt32BE(16)>=640&&bytes.readUInt32BE(20)>=400)}
  return report
}
