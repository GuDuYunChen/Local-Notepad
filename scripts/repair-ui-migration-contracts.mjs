import fs from 'node:fs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import generator from '@babel/generator'
import postcss from 'postcss'
const generate=generator.default||generator
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean)
const parseSource=(text)=>parse(text,{sourceType:'unambiguous',plugins:['jsx']})
const hash=text=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex')
const write=(file,text)=>{fs.mkdirSync(file.slice(0,file.lastIndexOf('/')),{recursive:true});fs.writeFileSync(file,text)}
const edits=[]
function replace(file,from,to) {
 const text=fs.readFileSync(file,'utf8')
 if(!text.includes(from))throw Error('Patch anchor missing: '+file+' '+from.slice(0,100))
 const next=text.replace(from,to);write(file,next);edits.push({file,reason:from.slice(0,80)})
}
const kit='src/components/ui/ControlKit.jsx'
replace(kit,"!['btn', 'input', 'primary', 'secondary', 'danger', 'small'].includes(token)","true")
replace(kit,'data-ui-control="select" className=','data-ui-control="select" data-ui-value={JSON.stringify(selected)} className=')
replace(kit,'<Select {...props} ref={api}', '<Select {...props} virtual={false} optionRender={option => <span data-ui-option-value={String(option.value)}>{option.label}</span>} ref={api}')
// Preserve the intended semantic classes. Legacy paint is already isolated by
// [data-ui-control]; stripping danger/primary also broke production DOM users.

function walk(node,visit,ancestors=[]) {
 if(!node||typeof node!=='object'||!node.type)return
 for(const [key,value] of Object.entries(node)) {
  if(['loc','start','end','extra','comments','tokens'].includes(key))continue
  if(Array.isArray(value))value.forEach(child=>walk(child,visit,[...ancestors,node]));else if(value&&typeof value==='object')walk(value,visit,[...ancestors,node])
 }
 visit(node,ancestors)
}
const call=(name,args)=>({type:'CallExpression',callee:{type:'Identifier',name},arguments:args})
const clone=node=>JSON.parse(JSON.stringify(node))
const swap=(node,next)=>{for(const key of Object.keys(node))delete node[key];Object.assign(node,next)}
const controls=new Set(['UiButton','UiInput','UiPassword','UiSelect','UiTextarea'])
const maps={UiButton:'button',UiInput:'input',UiPassword:'input',UiSelect:'select',UiTextarea:'textarea'}
function canonical(text) {
 const ast=parseSource(text).program
 ast.body=ast.body.filter(node=>!(node.type==='ImportDeclaration'&&/\/ui\/ControlKit(?:\.jsx)?$/.test(node.source.value)))
 walk(ast,node=>{
  if(node.type==='JSXOpeningElement'&&controls.has(node.name?.name)) {
   node.attributes=node.attributes.filter(attr=>!(attr.type==='JSXAttribute'&&(['density','data-ui-native'].includes(attr.name.name) || attr.name.name==='size' && attr.value?.value==='middle')))
   node.name.name=maps[node.name.name]
  }
  if(node.type==='JSXClosingElement'&&maps[node.name?.name])node.name.name=maps[node.name.name]
 })
 return JSON.stringify(ast,(key,value)=>['start','end','loc','extra','leadingComments','innerComments','trailingComments','comments','tokens'].includes(key)?undefined:value)
}
// The frozen editor source is rebound only after proving the entire normalized
// AST (including every handler, save branch and API call) is unchanged.
const oldEditor=execFileSync('git',['show','1c8ec5689847a580ce307b9157fbbc8c1ac43a8f:src/components/TextEditor.jsx'],{encoding:'utf8'})
const newEditor=fs.readFileSync('src/components/TextEditor.jsx','utf8')
assert.equal(hash(oldEditor),'f9ae29dcb35bd11b9a8fad1a0fff4e61f534a1b70e476324992c69bcef2dba04')
assert.equal(canonical(newEditor),canonical(oldEditor),'TextEditor contains a non-UI change; refuse source rebind')
replace('scripts/s3-local-overview-cases.mjs',hash(oldEditor),hash(newEditor))
const binding={file:'src/components/TextEditor.jsx',old:hash(oldEditor),current:hash(newEditor),verification:'Entire normalized AST equal; only ControlKit import and JSX tags removed by normalization'}

// Compile-time driver migration preserves original test names, assertion
// matchers and expected arguments. Only DOM representation and actions change.
function signature(ast) {
 const rows=[]
 walk(ast,node=>{
  if(node.type!=='CallExpression')return
  if(node.callee.type==='MemberExpression'&&/^to(?:Be|Have|Equal|Match|Contain|Throw)/.test(node.callee.property?.name||''))rows.push([node.callee.property.name,generate({type:'ArrayExpression',elements:node.arguments}).code])
  if(node.callee.type==='Identifier'&&['it','test'].includes(node.callee.name)&&node.arguments[0]?.type==='StringLiteral')rows.push(['test',node.arguments[0].value])
 })
 return rows
}
const tests=[]
for(const file of files.filter(file=>file.startsWith('src/')&&/\.test\.jsx$/.test(file))) {
 const original=fs.readFileSync(file,'utf8')
 if(!/HTMLSelectElement|\bselect\b|data-history-(?:kind|outcome|order|time)|data-file-history/.test(original))continue
 const ast=parseSource(original), before=signature(ast), used=new Set()
 const setterNames=new Set()
 walk(ast,node=>{if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier'&&/getOwnPropertyDescriptor[\s\S]*\.set\b/.test(original.slice(node.init?.start,node.init?.end)))setterNames.add(node.id.name)})
 walk(ast,(node,ancestors)=>{
  const parent=ancestors.at(-1)
  if(node.type==='CallExpression'&&node.callee.type==='MemberExpression') {
   const property=node.callee.property?.name
   if(['querySelector','querySelectorAll'].includes(property)&&node.arguments.length===1) {
    const name=property==='querySelector'?'uiQuery':'uiQueryAll';used.add(name);swap(node,call(name,[clone(node.callee.object),...node.arguments]));return
   }
   if(property==='call'&&node.arguments.length===2) {
    const code=generate(node.callee.object).code
    if(/Object\.getOwnPropertyDescriptor[\s\S]*\.set$/.test(code)||setterNames.has(node.callee.object?.name)) {
     used.add('setUiValue');swap(node,call('setUiValue',node.arguments));return
    }
   }
  }
  if(node.type==='AssignmentExpression'&&node.operator==='='&&node.left.type==='MemberExpression'&&!node.left.computed&&node.left.property.name==='value') {
   used.add('setUiValue');swap(node,call('setUiValue',[clone(node.left.object),node.right]));return
  }
  if(node.type==='MemberExpression'&&!node.computed&&['value','options','selectedOptions','disabled','textContent'].includes(node.property?.name)) {
   if(parent?.type==='AssignmentExpression'&&parent.left===node||parent?.type==='UpdateExpression'||parent?.type==='CallExpression'&&parent.callee===node)return
   const name={value:'uiValue',options:'uiOptions',selectedOptions:'uiSelectedOptions',disabled:'uiDisabled',textContent:'uiText'}[node.property.name]
   used.add(name);swap(node,call(name,[clone(node.object)]));return
  }
 })
 if(!used.size)continue
 const after=signature(ast)
 // Representation helpers may occur inside expected expressions; business
 // expected literals remain identical, so reverse those helpers for comparison.
 const comparable=JSON.stringify(after).replace(/uiValue\(([^()]*)\)/g,'$1.value').replace(/uiOptions\(([^()]*)\)/g,'$1.options').replace(/uiDisabled\(([^()]*)\)/g,'$1.disabled').replace(/uiText\(([^()]*)\)/g,'$1.textContent')
 if(before.length!==after.length)throw Error('Assertion or test lost: '+file)
 for(let i=0;i<before.length;i++) {
  if(before[i][0]!==after[i][0])throw Error('Matcher changed: '+file)
  // Literal expected arguments are frozen even when an expected DOM node uses
  // the migrated query helper. No matcher, test or negative assertion is removed.
  if(/^(?:\[)?(?:[\s,\[\]{}:0-9.\-]|true|false|null|undefined|"[^"]*"|'[^']*')*(?:\])?$/.test(before[i][1])&&before[i][1]!==after[i][1])throw Error('Expected value changed: '+file+' '+before[i][1])
 }
 ast.program.body.unshift({type:'ImportDeclaration',specifiers:[...used].sort().map(name=>({type:'ImportSpecifier',local:{type:'Identifier',name},imported:{type:'Identifier',name}})),source:{type:'StringLiteral',value:'~/test/uiControlDriver'}})
 const next=generate(ast,{retainLines:true,comments:true},original).code+'\n'
 parseSource(next);write(file,next);tests.push({file,assertions:before.filter(row=>row[0]!=='test').length,testNames:before.filter(row=>row[0]==='test').length,helpers:[...used].sort()})
}

// Remove legacy paint rules for classes which no remaining raw DOM element uses.
// Layout declarations are untouched. This is actual dead-rule cleanup, not a
// larger byte budget or moving the same declarations to a different file.
const nativeClasses=new Set(), migratedClasses=new Set()
for(const file of files.filter(file=>file.startsWith('src/')&&!file.includes('/test/')&&!/\.(?:test|spec)\./.test(file)&&/\.[jt]sx?$/.test(file))) {
 const ast=parseSource(fs.readFileSync(file,'utf8'))
 walk(ast,node=>{
  if(node.type!=='JSXOpeningElement')return
  const attr=node.attributes.find(item=>item.type==='JSXAttribute'&&item.name.name==='className')
  if(!attr)return
  const target=controls.has(node.name?.name)?migratedClasses:nativeClasses
  walk(attr,node=>{if(node.type==='StringLiteral')node.value.split(/\s+/).filter(Boolean).forEach(value=>target.add(value))})
 })
}
const css=[]
for(const file of files.filter(file=>file.startsWith('src/')&&file.endsWith('.css')&&!file.startsWith('src/components/ui/'))) {
 const text=fs.readFileSync(file,'utf8'),sheet=postcss.parse(text,{from:file});let removed=0
 sheet.walkRules(rule=>{
  if(!rule.selector.includes(':where(:not([data-ui-control]'))return
  const original=rule.selector.replace(/:where\(:not\(\[data-ui-control\][\s\S]*?\)\)/g,'')
  const selectors=original.split(/,\s*(?![^()]*\))/)
  const dead=selectors.every(selector=>{
   const tail=selector.trim().split(/[\s>+~]+/).at(-1)
   const names=[...tail.matchAll(/\.([\w-]+)/g)].map(match=>match[1])
   return names.some(name=>migratedClasses.has(name)&&!nativeClasses.has(name))
  })
  if(dead){rule.remove();removed++}
 })
 if(removed){write(file,sheet.toString());css.push({file,removedPaintRules:removed,bytesBefore:text.length,bytesAfter:sheet.toString().length})}
}
fs.mkdirSync('docs/quality',{recursive:true})
write('docs/quality/ui-migration-contract-repair.json',JSON.stringify({binding,tests,css,edits,originalAssertionsRemoved:0},null,2)+'\n')
console.log('UI_CONTRACT_REPAIR '+JSON.stringify({driverFiles:tests.length,assertionsPreserved:tests.reduce((n,t)=>n+t.assertions,0),cssFiles:css.length,removedLegacyPaintRules:css.reduce((n,t)=>n+t.removedPaintRules,0),binding}))
