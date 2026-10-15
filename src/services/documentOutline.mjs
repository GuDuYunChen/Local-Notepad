// Local, read-only outline model. No text mutation, database or network access.
export const OUTLINE_LIMITS = Object.freeze({blocks:10000,headings:500,title:4000,total:100000,query:200})
const normalize = value => String(value ?? '').trim().replace(/\s+/gu,' ')
export function calculateReadingProgress(top,height,viewport) {
  const number=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0
  const range=Math.max(0,number(height)-number(viewport))
  return range?Math.min(100,Math.round(number(top)/range*100)):100
}
export function getOutlineBreadcrumb(nodes,key) {
  const stack=[]
  for(const node of Array.isArray(nodes)?nodes:[]) {
    if(!node?.isHeading)continue
    while(stack.length&&stack.at(-1).level>=node.level)stack.pop()
    stack.push(node)
    if(node.key===key)return [...stack]
  }
  return []
}
export function findOutlineHeadingForKey(nodes,key) {
  let heading=null
  for(const node of Array.isArray(nodes)?nodes:[]) {
    if(node?.isHeading)heading=node
    if(node?.key===key)return heading
  }
  return null
}
export function getCollapsedOutlineKeys(nodes,keys) {
  const collapsed=keys instanceof Set?keys:new Set(keys||[]), hidden=new Set()
  let level=null
  for(const node of nodes||[]) {
    if(!node)continue
    if(node.isHeading&&level!==null&&node.level<=level)level=null
    if(level!==null)hidden.add(node.key)
    if(node.isHeading&&collapsed.has(node.key)&&level===null)level=node.level
  }
  return hidden
}
export function resolveOutlinePath(nodes,path) {
  if(!Array.isArray(path)||!path.length||path.length>6||path.some(v=>typeof v!=='string'||!normalize(v)))return {status:'missing',heading:null}
  const expected=path.map(normalize),matches=[]
  for(const node of nodes||[]) {
    if(!node?.isHeading)continue
    const parts=getOutlineBreadcrumb(nodes,node.key).map(n=>normalize(n.rawText??n.text))
    if(parts.length===expected.length&&parts.every((v,i)=>v===expected[i]))matches.push(node)
  }
  return {status:matches.length===1?'found':matches.length?'ambiguous':'missing',heading:matches.length===1?matches[0]:null}
}
export function findHeadingByPath(nodes,path) {return resolveOutlinePath(nodes,path).heading}
export function outlineSnapshot(descriptors) {
  if(!Array.isArray(descriptors)||descriptors.length>OUTLINE_LIMITS.blocks)throw Error('正文块超过大纲完整读取上限；未显示部分目录。')
  const keys=new Set();let count=0,total=0
  const nodes=descriptors.map(n=>{
    if(!n||typeof n.key!=='string'||!n.key||keys.has(n.key))throw Error('大纲身份不完整，请重新读取。')
    keys.add(n.key)
    if(!n.isHeading)return Object.freeze({key:n.key,isHeading:false,level:null,text:''})
    if(!Number.isInteger(n.level)||n.level<1||n.level>6||typeof n.text!=='string')throw Error('标题格式无效，未采用这份大纲。')
    if(++count>OUTLINE_LIMITS.headings||n.text.length>OUTLINE_LIMITS.title||(total+=n.text.length)>OUTLINE_LIMITS.total)throw Error('标题数量或长度超过大纲完整读取上限；未显示部分目录。')
    const rawText=normalize(n.text)
    return Object.freeze({key:n.key,isHeading:true,level:n.level,text:rawText||'未命名标题',rawText})
  })
  const headings=nodes.filter(n=>n.isHeading)
  return Object.freeze({nodes:Object.freeze(nodes),headings:Object.freeze(headings)})
}
export function filterOutline(nodes,query,collapsed=new Set()) {
  if(typeof query!=='string'||query.length>OUTLINE_LIMITS.query)throw Error('查找条件最多 200 个字符，请缩短后重试。')
  const needle=normalize(query).toLocaleLowerCase(),hidden=getCollapsedOutlineKeys(nodes,collapsed)
  return nodes.filter(n=>n.isHeading&&(needle?getOutlineBreadcrumb(nodes,n.key).some(p=>p.text.toLocaleLowerCase().includes(needle)):!hidden.has(n.key)))
}
export function expandedOutlineKeys(nodes,collapsed,key) {
  if(!nodes.some(n=>n.key===key))return new Set(collapsed)
  const next=new Set(collapsed)
  for(const parent of collapsed)if(getCollapsedOutlineKeys(nodes,new Set([parent])).has(key))next.delete(parent)
  return next
}
// A timed-out/aborted clipboard write may still finish externally; callers must
// not display a late success or record it as belonging to a different note.
export async function copyOutlineText(text,{navigator:nav=globalThis.navigator,document:doc=globalThis.document,signal,timeout=5000}={}) {
  if(typeof text!=='string'||!text||!Number.isFinite(timeout)||timeout<=0)throw Error('没有有效的可复制内容。')
  if(signal?.aborted)throw Error('复制等待已停止；剪贴板是否已改变未确认。')
  let timer,abort
  const deadline=performance.now()+timeout
  try {
    await new Promise((resolve,reject)=>{
      let done=false
      const end=(fn,value)=>{if(!done){done=true;fn(value)}}
      abort=()=>end(reject,Error('复制等待已停止；剪贴板是否已改变未确认。'))
      signal?.addEventListener('abort',abort,{once:true})
      timer=setTimeout(()=>end(reject,Error('复制超时，未确认成功；请检查剪贴板后重试。')),timeout)
      Promise.resolve().then(()=>{
        if(signal?.aborted)throw Error('复制已停止。')
        if(nav?.clipboard?.writeText)return nav.clipboard.writeText(text)
        if(!doc?.body||typeof doc.execCommand!=='function')throw Error('剪贴板不可用，请检查系统权限后重试。')
        const input=doc.createElement('textarea'),active=doc.activeElement
        input.value=text;input.readOnly=true;input.style.cssText='position:fixed;opacity:0;pointer-events:none';doc.body.append(input)
        try{input.select();if(!doc.execCommand('copy'))throw Error('复制未成功，请检查系统权限后重试。')}
        finally{input.remove();if(active?.isConnected)active.focus?.({preventScroll:true})}
      }).then(()=>performance.now()>=deadline?end(reject,Error('复制超时，未确认成功。')):end(resolve),()=>end(reject,Error('复制未成功，请检查系统权限后重试。')))
    })
    if(signal?.aborted)throw Error('复制等待已停止；剪贴板是否已改变未确认。')
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
