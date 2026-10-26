// Deliberately synthetic contract fixtures, never an installer or native acceptance.
import { readFileSync } from 'node:fs'
import { BLOCK_REFERENCE_VERSION, BLOCK_REFERENCE_SOURCES, blockReferenceBlob, blockReferenceHash } from './block-references-evidence.mjs'
import { BLOCK_REFERENCE_CHECKS } from './block-references-desktop-driver.mjs'
import { LOCAL_EXPORT_INSTALLATION_SOURCES } from './local-export-installed-evidence.mjs'
import { SHORTCUT_INSTALLATION_SOURCES } from './shortcut-management-installed-evidence.mjs'
import { READING_SOURCE_KEYS } from './reading-mode-installed-evidence.mjs'
import { blockLocator } from '../src/services/blockReferenceModel.mjs'
export const product='a'.repeat(40), verifier='b'.repeat(40)
export const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n')
export function blockPinFixture(){
 const pin=JSON.parse(source('scripts/reading-mode-installer-pin.json'))
 pin.product=product;pin.current={version:BLOCK_REFERENCE_VERSION,bytes:1001,sha256:blockReferenceHash('synthetic source contract only')}
 pin.currentSource={run:100,artifact:200,name:'local-notepad-windows-'+product,headSha:'c'.repeat(40),branch:'feature/test',repositoryId:1105107817,archiveBytes:5000,archiveSha256:blockReferenceHash('synthetic archive')}
 const names={...LOCAL_EXPORT_INSTALLATION_SOURCES,...SHORTCUT_INSTALLATION_SOURCES,
 'check-local-import-desktop.mjs':'importBlob','local-import-desktop-evidence.mjs':'importEvidenceBlob','local-import-desktop-evidence.node.mjs':'importEvidenceTestsBlob',
 'check-version-history-desktop.mjs':'historyDriverBlob','reading-mode-desktop-evidence.mjs':'readingEvidenceBlob'}
 for(const [file,key] of Object.entries(names))pin[key]=blockReferenceBlob(source('scripts/'+file))
 for(const key of READING_SOURCE_KEYS)if(!pin[key])throw Error('fixture key missing '+key)
 pin.blockReferenceSources=Object.fromEntries(BLOCK_REFERENCE_SOURCES.map(name=>[name,blockReferenceBlob(source(name))]))
 return pin
}
export function blockReportFixture(){
 const pin=blockPinFixture(),blockId='b-'+'c'.repeat(32),id='source-1',dest='destination-1'
 const body=node=>JSON.stringify({root:{type:'root',children:node}})
 const record=(id,content)=>({id,title:'合成笔记',content,updated_at:1700000000,is_deleted:false,is_folder:false})
 const sourceBlock={type:'paragraph',version:1,$:{localBlockId:blockId},children:[{type:'text',version:1,text:'Synthetic fixture, not a native run.'}]}
 const ref=embedded=>({type:'wiki-link',version:1,id,title:'合成笔记',blockId,embedded,sectionPath:[]})
 const screenshots=['block103-source-address.png','block103-reviewed-insertion.png','block103-exact-navigation.png','block103-embedded.png','block103-reading-mode.png','block103-small-window.png','block103-dark-theme.png'].map(filename=>({filename,bytes:2000,sha256:'d'.repeat(64)}))
 const caret=()=>({method:'native-text-click',before:{candidateCount:1,marker:'BLOCK103 destination',x:120,y:180,width:704,height:455},after:{marker:'BLOCK103 destination',collapsed:true,textNode:true,topLevelParagraph:true,editable:true,width:704,height:455}})
 return{pin,report:{schemaVersion:1,module:'2F.103',version:BLOCK_REFERENCE_VERSION,productCommit:product,verifierCommit:verifier,scope:'installed',platform:'win32',runnerEnvironment:'github-hosted',localValidationOnly:false,
 smallWindowCaret:caret(),darkWindowCaret:caret(),complete:true,cleanupComplete:true,syntheticData:true,realBackend:true,bridgeOverridden:false,timerAccelerated:false,forceTerminated:false,
 checks:[...BLOCK_REFERENCE_CHECKS],app:{version:BLOCK_REFERENCE_VERSION,packaged:true},executable:'D:\\owned\\Notepad.exe',executableSHA256:'a'.repeat(64),asarSHA256:'b'.repeat(64),backendSHA256:'c'.repeat(64),pid:3011,
 exit:{pid:3011,code:0,signal:null,normalClose:true},backendStopped:true,verificationScope:'windows-complete',smallWindowEntry:{
 before:{width:704,height:455,sidebarPresent:true,sidebarExpanded:true,entryPresent:true,entryReachable:false,blockedBySidebar:true},
 after:{width:704,height:455,sidebarPresent:true,sidebarExpanded:false,entryPresent:true,entryReachable:true,blockedBySidebar:false},collapsedByClick:true},smallViewport:{width:704,height:455,overflow:false},minimumWindow:{pid:3011,applied:true,width:720,height:520},darkPanel:{theme:'dark',color:'rgb(234, 242, 255)',background:'rgb(27, 35, 48)',surface:'#1b2330',ink:'#eaf2ff'},sourceFiles:{...pin.blockReferenceSources},fixture:{sourceId:id,destinationId:dest,blockId,locator:blockLocator(id,blockId)},
 saved:{source:record(id,body([sourceBlock])),destination:record(dest,body([{type:'paragraph',children:[ref(false)]},ref(true)]))},screenshots}}
}
