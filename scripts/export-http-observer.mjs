import assert from 'node:assert/strict'
import {channel} from 'node:diagnostics_channel'
import {existsSync,writeFileSync,readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {createHash} from 'node:crypto'

const CHANNELS=Object.freeze(['undici:request:create','undici:client:sendHeaders','undici:request:bodySent','undici:request:headers','undici:request:trailers','undici:request:error'])
const METHODS=new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])
const ERRORS=new Set(['AbortError','TimeoutError','TypeError','Error'])
const CODES=new Set(['UND_ERR_ABORTED','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','ECONNRESET','ECONNREFUSED','ETIMEDOUT'])
function routeKind(value){
 if(typeof value!=='string'||value.length>4096)return 'other'
 const p=value.split('?')[0]
 if(['/api/files','/api/upload','/api/health','/api/diagnostics'].includes(p))return p
 if(/^\/api\/files\/[^/]+$/.test(p))return '/api/files/:id'
 return 'other'
}
// Passive subscriptions only. No request/body/header/signal mutation; no network
// request, retry, cancellation or extra wait is performed by this observer.
export function observeExportRequests({channelFor=channel,active,clock=()=>performance.now(),maximum=4096}={}){
 assert.equal(typeof active,'function');assert.equal(typeof clock,'function')
 assert.ok(Number.isSafeInteger(maximum)&&maximum>0&&maximum<=4096)
 const requests=new WeakMap(),events=[];let next=0,dropped=0,observerErrors=0,stopped=false
 const begin=clock(),bindings=[]
 const receive=(name,message)=>{
  try{
   if(stopped)return
   const request=message?.request;if(!request||typeof request!=='object')return
   let state=requests.get(request)
   if(name==='undici:request:create'){
    if(state||!active()||String(request.origin)!=='http://127.0.0.1:27121')return
    state={id:++next,method:METHODS.has(request.method)?request.method:'OTHER',route:routeKind(request.path)};requests.set(request,state)
   }
   if(!state)return
   if(events.length>=maximum){dropped++;return}
   const ms=clock()-begin;if(!Number.isFinite(ms)||ms<0)throw Error('clock')
   const entry={...state,event:name.replace('undici:',''),elapsedMs:Math.round(ms)}
   if(name==='undici:request:headers')entry.status=Number.isInteger(message.response?.statusCode)&&message.response.statusCode>=100&&message.response.statusCode<=599?message.response.statusCode:null
   if(name==='undici:request:error'){
    entry.error=ERRORS.has(message.error?.name)?message.error.name:'OtherError'
    entry.code=CODES.has(message.error?.code)?message.error.code:null
   }
   events.push(entry)
  }catch{observerErrors++} // Never let a synchronous diagnostic listener change the original result.
 }
 for(const name of CHANNELS){const c=channelFor(name),listener=m=>receive(name,m);c.subscribe(listener);bindings.push([c,listener])}
 return{snapshot:()=>({schemaVersion:1,scope:'verifier-local-export-http-metadata-only',activeRequests:next,events:events.map(e=>({...e})),dropped,observerErrors,networkModified:false,extraRequests:0,retries:0}),stop(){if(stopped)return;stopped=true;for(const[c,l]of bindings)c.unsubscribe(l)}}
}

const own=fileURLToPath(import.meta.url),entry=process.argv[1]&&path.basename(process.argv[1])
if(entry==='run-reading-import-generated.mjs'&&process.argv[2]==='run'){
 assert.equal(process.platform,'win32');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted')
 assert.equal(process.env.GITHUB_REPOSITORY,'GuDuYunChen/Local-Notepad');assert.equal(process.env.GITHUB_REF,'refs/heads/ci/local-installation-2f86');assert.match(process.env.GITHUB_SHA||'',/^[a-f0-9]{40}$/)
 const root=path.resolve(path.dirname(own),'..'),out=path.join(root,'test-results/installer-lifecycle'),file=path.join(out,'export-http-observation.json')
 assert.equal(existsSync(file),false,'Refuse to overwrite prior observation')
 const observation=observeExportRequests({active:()=>existsSync(path.join(out,'local-export-desktop.json'))})
 const source=readFileSync(own,'utf8').replace(/\r\n/g,'\n'),sourceBlob=createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex')
 process.once('exit',code=>{
  observation.stop()
  try{writeFileSync(file,JSON.stringify({...observation.snapshot(),verifierCommit:process.env.GITHUB_SHA,runID:process.env.GITHUB_RUN_ID,sourceBlob,exitCode:code,acceptanceClaimed:false},null,2)+'\n',{flag:'wx'})}
  catch{console.error('Export HTTP observation could not be preserved; original lifecycle result unchanged')}
 })
}
