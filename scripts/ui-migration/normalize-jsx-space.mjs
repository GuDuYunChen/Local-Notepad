import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
const reportPath='docs/quality/ui-migration-2f116.json'
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'))
const changed=[]
function walk(node, visit) {
  if(!node || typeof node!=='object' || !node.type)return
  visit(node)
  for(const [key,value] of Object.entries(node)) {
    if(['loc','start','end','extra','comments','tokens'].includes(key))continue
    if(Array.isArray(value))value.forEach(child=>walk(child,visit));else if(value && typeof value==='object')walk(value,visit)
  }
}
for(const item of report.changed) {
  if(!/\.[jt]sx?$/.test(item.file))continue
  let text=fs.readFileSync(item.file,'utf8')
  const ast=parse(text,{sourceType:'module',plugins:['jsx',...(/\.tsx?$/.test(item.file)?['typescript']:[])]}), edits=[]
  walk(ast,node=>{
    if(node.type!=='JSXOpeningElement')return
    const tokens=[node.name,...node.attributes]
    for(let i=0;i<tokens.length;i++) {
      const start=tokens[i].end, end=i+1<tokens.length?tokens[i+1].start:node.end
      const whitespace=text.slice(start,end),match=whitespace.match(/^[\t ]+(?=\r?\n)/)
      if(match)edits.push({start,end:start+match[0].length})
    }
  })
  for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+text.slice(edit.end)
  if(edits.length){parse(text,{sourceType:'module',plugins:['jsx']});fs.writeFileSync(item.file,text);item.sha256=createHash('sha256').update(text).digest('hex');changed.push({file:item.file,syntaxWhitespaceEdits:edits.length})}
}
report.syntaxWhitespace=changed
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n')
console.log('UI_SYNTAX_WHITESPACE '+JSON.stringify(changed))
