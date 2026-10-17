const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),{createHash}=require('node:crypto')
const {verifyKeyboardScene,verifyKeyboardReport}=require('./sync-clock-keyboard-evidence.cjs')
const names=['keyboard-light','keyboard-dark','keyboard-narrow']
function scene(name='keyboard-light'){
 const phases=['temporary','saved','repeated','cleared','restored','read-failed','recovered']
 const keys=[['Tab',false],[' ',false],['Tab',false],['Enter',false],['Tab',false],['Tab',false],['Enter',false],['Enter',false],['Tab',false],[' ',false],['Tab',true],['Enter',false],['Tab',true],['Enter',false],['Enter',false],['Enter',false]]
 return {name,frames:phases.map((phase,i)=>({phase,mode:i===6?'utc':'local',stored:i===0||i===6?'utc':i===3?null:'local',
 focusedAction:['restore','save','save','clear','restore','restore','restore'][i],liveStable:true,controlsLinked:true,focusOutline:true,feedbackVisible:true,
 open:true,actionsVisible:true,controlsVisible:true,summaryVisible:true,otherKeyPreserved:true,otherUTC:true,
 liveRole:'status',livePolite:'polite',liveAtomic:'true',messageSerial:i,error:i===5?'read':'',
 feedback:i===0?'':i===1||i===2?'本次已回读确认：已记住本机时区':i===3?'本次已回读确认：时间偏好已清除':i===5?'未能读取已保存的时间偏好':'已读取保存记录',
 trustedKeys:keys.slice(0,[5,7,8,10,14,15,16][i]).map(([key,shift])=>({key,shift,trusted:true})),
 mutations:[['set','local'],['set','local'],['remove'],['set','local']].slice(0,[0,1,2,3,4,4,4][i]),requests:0,navigationCalls:0,privateText:false,
 iso:['2026-09-27T09:05:00.000Z','2026-09-27T09:06:40.000Z'],counts:['0','0'],guidance:'unchanged',
 rasterCode:1+names.indexOf(name)*7+i,rasterSamples:2,stableSamples:3,overflow:0,colors:Array.from({length:5},()=>({final:true,ratio:7})),viewport:{width:560,height:681}}))}
}
function reject(changes){for(const change of changes){const s=scene();change(s.frames[1],s);assert.throws(()=>verifyKeyboardScene(s))}}
test('accepts exact native-key sequences and seven outcomes in all layouts',()=>names.forEach(n=>verifyKeyboardScene(scene(n))))
test('rejects synthetic key events, lost focus, missing keys and duplicate native actions',()=>reject([
 f=>f.trustedKeys[0].trusted=false,f=>f.trustedKeys.pop(),f=>f.focusedAction='clear',f=>f.focusOutline=false,f=>f.mutations.push(['set','local'])]))
test('rejects replaced live regions, repeated stale messages and falsely confirmed failure',()=>reject([
 f=>f.liveStable=false,f=>f.controlsLinked=false,f=>f.livePolite='assertive',f=>f.liveAtomic='false',f=>f.messageSerial=0,
 (f,s)=>s.frames[5].feedback='本次已回读确认：已记住本机时区']))
test('rejects hidden controls, altered instants, IO, unrelated data loss and unreadable captures',()=>reject([
 f=>f.actionsVisible=false,f=>f.feedbackVisible=false,f=>f.iso[0]='changed',f=>f.requests++,f=>f.navigationCalls++,f=>f.otherUTC=false,
 f=>f.otherKeyPreserved=false,f=>f.privateText=true,f=>f.colors[0].ratio=1,f=>f.stableSamples=2,f=>f.overflow=12]))
const crc=b=>{let v=0xffffffff;for(const n of b){v^=n;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0)}return (v^0xffffffff)>>>0}
function png(code=1){
  const chunk=(name,b)=>{const t=Buffer.from(name),size=Buffer.alloc(4),c=Buffer.alloc(4);size.writeUInt32BE(b.length);c.writeUInt32BE(crc(Buffer.concat([t,b])));return Buffer.concat([size,t,b,c])}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(560);ihdr.writeUInt32BE(681,4);ihdr[8]=8;ihdr[9]=2
  const pixels=Buffer.alloc((560*3+1)*681)
  for(let y=0;y<4;y++)for(let x=0;x<32;x++){const rgb=((code>>>(x/4|0))&1)?[221,238,255]:[17,34,51];for(let c=0;c<3;c++)pixels[y*(560*3+1)+1+x*3+c]=rgb[c]}
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])
}

function files(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clock-keyboard-evidence-')),commit='a'.repeat(40)
 const r={commit,platform:'win32',complete:true,realOverview:true,nativeKeyboard:true,syntheticRecords:true,backendExercised:false,scenes:names.map(scene)}
 for(const s of r.scenes)for(const f of s.frames){const b=png(f.rasterCode);f.png=s.name+'-'+f.phase+'.png';f.bytes=b.length;f.sha256=createHash('sha256').update(b).digest('hex');fs.writeFileSync(path.join(dir,f.png),b)}
 const save=()=>fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify(r));save()
 try{fn(dir,commit,r,save)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('requires all twenty-one images and the exact complete native commit',()=>files((d,c,r,save)=>{
 assert.equal(verifyKeyboardReport(d,c).scenes.length,3)
 for(const change of [r=>r.complete=false,r=>r.commit='b'.repeat(40),r=>r.nativeKeyboard=false,r=>r.platform='linux',r=>r.scenes.pop()]){
 const original=structuredClone(r);change(r);save();assert.throws(()=>verifyKeyboardReport(d,c));Object.assign(r,original)}
}))
test('rejects absent, tampered or resized screenshots',()=>{
 files((d,c,r)=>{fs.unlinkSync(path.join(d,r.scenes[0].frames[0].png));assert.throws(()=>verifyKeyboardReport(d,c))})
 files((d,c,r)=>{fs.appendFileSync(path.join(d,r.scenes[0].frames[0].png),'bad');assert.throws(()=>verifyKeyboardReport(d,c))})
 files((d,c,r,save)=>{r.scenes[0].frames[0].viewport.width++;save();assert.throws(()=>verifyKeyboardReport(d,c))})
})
test('rejects earlier-phase pixels even when byte counts and image hashes are renewed',()=>files((d,c,r,save)=>{
 const f=r.scenes[0].frames[1],b=png(1);f.bytes=b.length;f.sha256=createHash('sha256').update(b).digest('hex')
 fs.writeFileSync(path.join(d,f.png),b);save();assert.throws(()=>verifyKeyboardReport(d,c),/raster phase marker/)
}))

const { clockKeyboardEvents } = require('./sync-clock-keyboard-input.cjs')
test('Enter sends a carriage-return char between keyDown and keyUp',()=>{
 assert.deepEqual(clockKeyboardEvents('Return'),[
  {type:'keyDown',keyCode:'Return',modifiers:[]},
  {type:'char',keyCode:'\r',modifiers:[]},
  {type:'keyUp',keyCode:'Return',modifiers:[]},
 ])
})
test('Space completes its char sequence while Tab and Shift-Tab remain navigation-only',()=>{
 assert.deepEqual(clockKeyboardEvents('Space').map(e=>[e.type,e.keyCode]),[['keyDown','Space'],['char',' '],['keyUp','Space']])
 assert.deepEqual(clockKeyboardEvents('Tab',true),[{type:'keyDown',keyCode:'Tab',modifiers:['shift']},{type:'keyUp',keyCode:'Tab',modifiers:['shift']}])
 assert.deepEqual(clockKeyboardEvents('Tab').map(e=>e.type),['keyDown','keyUp'])
})
test('input helper rejects unsupported keys and cannot navigate or mutate the DOM',()=>{
 for(const key of ['Enter','A','',null,{},'constructor'])assert.throws(()=>clockKeyboardEvents(key))
 assert.throws(()=>clockKeyboardEvents('Tab','shift'))
 const source=fs.readFileSync(require.resolve('./sync-clock-keyboard-input.cjs'),'utf8')
 assert.doesNotMatch(source,/\.click\(|document\.|window\.|fetch\(|setTimeout/)
})
