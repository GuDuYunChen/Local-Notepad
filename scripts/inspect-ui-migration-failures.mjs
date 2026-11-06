import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parse } from '@babel/parser'
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean)
const strip=s=>s.replace(/\x1b\[[0-9;]*m/g,'')
const root='prior-evidence/test-results/ui-complete-migration'
for(const name of ['original-ui','electron','editor','full-vitest']) {
 const raw=strip(fs.readFileSync(path.join(root,name+'.log'),'utf8')), lines=raw.split(/\r?\n/)
 const rows=[]
 for(let i=0;i<lines.length;i++) if(/^\s*FAIL\s/.test(lines[i])) {
  let end=i+1;while(end<lines.length&&!/^\s*FAIL\s/.test(lines[end])&&!lines[end].includes('⎯['))end++
  const body=lines.slice(i+1,end)
  const error=body.find(line=>/Error:/.test(line))||''
  const location=body.find(line=>/^\s*❯\s/.test(line))||''
  rows.push({test:lines[i].trim(),error:error.slice(0,220),location:location.trim()})
 }
 console.log('FAILURE_INDEX '+name+' '+JSON.stringify(rows))
 console.log('SUITE_TOTAL '+name+' '+JSON.stringify(lines.filter(line=>/^\s*(Test Files|Tests|Duration)\s/.test(line))))
}
function walk(node,visit,ancestors=[]) {
 if(!node||typeof node!=='object'||!node.type)return
 visit(node,ancestors)
 for(const [key,value] of Object.entries(node)) {
  if(['loc','start','end','extra','comments','tokens'].includes(key))continue
  if(Array.isArray(value))value.forEach(child=>walk(child,visit,[...ancestors,node]));else if(value&&typeof value==='object')walk(value,visit,[...ancestors,node])
 }
}
const selectors=[],drivers=[],bindings=[]
for(const file of files.filter(file=>/^(src|scripts|electron)\//.test(file)&&/\.(jsx?|mjs)$/.test(file))) {
 const text=fs.readFileSync(file,'utf8'), ast=parse(text,{sourceType:'unambiguous',plugins:['jsx']})
 walk(ast,(node,ancestors)=>{
  if(node.type==='StringLiteral' && /select|combobox/.test(node.value)) {
   const parent=ancestors.at(-1)
   if(parent?.type==='CallExpression' && ['querySelector','querySelectorAll','closest','matches'].includes(parent.callee.property?.name)) selectors.push({file,line:node.loc.start.line,selector:node.value})
  }
  if(node.type==='VariableDeclarator' && ['change','select','setValue','input','choose','setSelect','setField'].includes(node.id?.name) && /HTMLSelectElement|dispatchEvent/.test(text.slice(node.start,node.end)))drivers.push({file,line:node.loc.start.line,code:text.slice(node.start,node.end).slice(0,1100)})
  if(node.type==='FunctionDeclaration' && /HTMLSelectElement|dispatchEvent/.test(text.slice(node.start,node.end)) && /^(change|select|setValue|input|choose|setSelect|setField)$/.test(node.id?.name))drivers.push({file,line:node.loc.start.line,code:text.slice(node.start,node.end).slice(0,1100)})
 })
 if(/f9ae29dcb35bd11b9a8fad1a0fff4e61f534a1b70e476324992c69bcef2dba04/.test(text))bindings.push(file)
}
console.log('PRODUCTION_SELECTORS '+JSON.stringify(selectors.filter(row=>! /\.(test|spec)\./.test(row.file))))
console.log('TEST_SELECT_DRIVERS '+JSON.stringify(drivers))
console.log('FROZEN_BINDINGS '+JSON.stringify(bindings))
fs.mkdirSync('test-results/ui-failure-inspection',{recursive:true})
fs.writeFileSync('test-results/ui-failure-inspection/analysis.json',JSON.stringify({selectors,drivers,bindings},null,2))
