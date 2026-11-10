import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import postcss from 'postcss'

// One transaction over the complete tracked production tree, not regex replacement
// of JSX. Existing event expressions, state, API calls and test assertions survive.
const root = process.cwd()
const run = (...args) => execFileSync('git', args, { encoding:'utf8' }).trim()
const before = run('rev-parse', 'HEAD')
const tracked = execFileSync('git', ['ls-files','-z'], { encoding:'utf8' }).split('\0').filter(Boolean)
const production = tracked.filter(file => file.startsWith('src/') && /\.(jsx?|tsx?|mjs)$/.test(file) && !/(?:^|\/)(?:test|tests|__tests__|fixtures)\//.test(file) && !/\.(?:test|spec)\./.test(file) && !file.startsWith('src/components/ui/'))
const exceptionTypes = new Set(['checkbox','radio','file','range','color','hidden','image','button','submit','reset'])
const mapping = { button:'UiButton', input:'UiInput', select:'UiSelect', textarea:'UiTextarea' }
const source = new Map(), changes = [], retained = [], migrated = [], classNames = new Set(['btn','input','ui-control','pinned-control'])
const parseSource = (text,file) => parse(text, { sourceType:'unambiguous', plugins:['jsx', ...(/\.tsx?$/.test(file) ? ['typescript'] : [])] })
function walk(node, visit, ancestors=[]) {
  if (!node || typeof node !== 'object' || !node.type) return
  if (visit(node,ancestors) === false) return
  const next=[...ancestors,node]
  for (const [key,value] of Object.entries(node)) {
    if (['loc','start','end','extra','comments','tokens'].includes(key)) continue
    if (Array.isArray(value)) value.forEach(child=>walk(child,visit,next)); else if (value && typeof value==='object') walk(value,visit,next)
  }
}
const tag = node => node?.type==='JSXIdentifier' ? node.name : ''
const attr = (node,name) => node.attributes.find(item=>item.type==='JSXAttribute' && item.name.name===name)
function literal(value) {
  if (!value) return undefined
  if (value.value===null) return true
  const node=value.value?.type==='JSXExpressionContainer' ? value.value.expression : value.value
  return ['StringLiteral','BooleanLiteral','NumericLiteral'].includes(node?.type) ? node.value : undefined
}
function optionException(node,file) {
  const type=literal(attr(node,'type')) || 'text', classes=String(literal(attr(node,'className')) || '')
  if (tag(node.name)==='input' && exceptionTypes.has(type)) return type
  if (tag(node.name)==='textarea' && (/(?:code-textarea|source-textarea|markdown-source)/.test(classes) || /(?:CodeBlockNode|MarkdownSourcePlugin)\.[jt]sx?$/.test(file))) return 'code-editor-textarea'
  if (tag(node.name)==='button' && (/Table(?:ColumnResize|Reorder)Plugin/.test(file) || attr(node,'draggable'))) return 'editor-pointer-handle'
  return null
}
function apply(text,edits,file) {
  const ordered=edits.sort((a,b)=>b.start-a.start || b.end-a.end)
  let end=text.length
  for (const edit of ordered) {
    if (edit.end>end) throw Error('Overlapping source edits: '+file)
    text=text.slice(0,edit.start)+edit.text+text.slice(edit.end); end=edit.start
  }
  return text
}
for (const file of production) {
  const original=fs.readFileSync(file,'utf8'), ast=parseSource(original,file), edits=[], used=new Set(), imported=new Set()
  let lastImport=0
  for (const statement of ast.program.body) if(statement.type==='ImportDeclaration') {
    lastImport=Math.max(lastImport,statement.end)
    if (/\/ui\/ControlKit(?:\.jsx)?$/.test(statement.source.value)) for(const item of statement.specifiers) imported.add(item.local.name)
  }
  walk(ast,(node,ancestors)=>{
    if(node.type!=='JSXElement') return
    const open=node.openingElement, name=tag(open.name)
    // Previous partial migration left an inert second selector. It is not a
    // compatibility or test path and must not ship alongside the real Select.
    if(file==='src/components/SearchCollectionsPanel.jsx' && ['select','UiSelect'].includes(name) && literal(attr(open,'hidden'))===true && literal(attr(open,'aria-hidden'))==='true') {
      edits.push({start:node.start,end:node.end,text:''}); return false
    }
    const component=mapping[name] || (Object.values(mapping).includes(name) || name==='UiPassword' ? name : null)
    if(!component) return
    const reason=mapping[name] ? optionException(open,file) : null
    if(reason) {
      retained.push({file,line:open.loc.start.line,tag:name,reason})
      if(!attr(open,'data-ui-native')) edits.push({start:open.name.end,end:open.name.end,text:' data-ui-native="'+reason+'"'})
      return
    }
    const classes=String(literal(attr(open,'className'))||'').split(/\s+/).filter(Boolean)
    classes.forEach(value=>classNames.add(value))
    const target=name==='input' && literal(attr(open,'type'))==='password' ? 'UiPassword' : component
    if(mapping[name]) {
      edits.push({start:open.name.start,end:open.name.end,text:target})
      if(node.closingElement) edits.push({start:node.closingElement.name.start,end:node.closingElement.name.end,text:target})
    }
    used.add(target); migrated.push({file,line:open.loc.start.line,from:name,to:target})
    const formRow=ancestors.some(parent=>parent.type==='JSXElement' && /(?:tools|filters?|controls|actions)/.test(String(literal(attr(parent.openingElement,'className'))||'')))
    if(!attr(open,'size') && !attr(open,'density')) {
      if(file.includes('/Editor/')) edits.push({start:open.name.end,end:open.name.end,text:' density="compact"'})
      else if(formRow) edits.push({start:open.name.end,end:open.name.end,text:' size="middle"'})
    }
  })
  const missing=[...used].filter(name=>!imported.has(name))
  if(missing.length) edits.push({start:lastImport,end:lastImport,text:'\nimport { '+missing.sort().join(', ')+' } from \'~/components/ui/ControlKit\'\n'})
  let updated=apply(original,edits,file)
  if(file==='src/components/SearchCollectionsPanel.jsx') updated=updated.replace('value={selected?.key || undefined}',"value={selected?.key || ''}")
  // No global framework reset: it would also alter user-authored editor content.
  if(file==='src/main.jsx') {
    updated=updated.replace(/^import ['"]antd\/dist\/reset\.css['"];?\r?\n/gm,'')
    updated=updated.replace(/^import ['"]\.\/components\/ui\/control-kit\.css['"];?\r?\n/gm,'')
    if(!updated.includes("import UiThemeProvider from './components/ui/UiThemeProvider'")) updated="import UiThemeProvider from './components/ui/UiThemeProvider'\n"+updated
    if(!updated.includes('<UiThemeProvider>')) {
      if(!updated.includes('<DndProvider') || !updated.includes('</DndProvider>')) throw Error('Application provider anchor missing')
      updated=updated.replace('<DndProvider','<UiThemeProvider><DndProvider').replace('</DndProvider>','</DndProvider></UiThemeProvider>')
    }
    updated += "\nimport './components/ui/control-kit.css'\n"
  }
  parseSource(updated,file)
  if(updated!==original) source.set(file,updated)
}

// Separate legacy control paint from layout. The zero-specificity guard prevents
// those declarations from painting Ant Design roots or their internal elements;
// special native inputs retain their original styles. No !important escalation.
function splitSelectors(text) {
  const parts=[];let start=0,depth=0,quote=''
  for(let i=0;i<text.length;i++) { const c=text[i]; if(quote){if(c==='\\'){i++;continue}if(c===quote)quote='';continue}if(c==='"'||c==="'"){quote=c;continue}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;if(c===','&&depth===0){parts.push(text.slice(start,i));start=i+1} }
  parts.push(text.slice(start));return parts.map(s=>s.trim())
}
function lastCompound(selector) {
  let start=0,depth=0,quote=''
  for(let i=0;i<selector.length;i++){const c=selector[i];if(quote){if(c==='\\'){i++;continue}if(c===quote)quote='';continue}if(c==='"'||c==="'"){quote=c;continue}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;if(depth===0&&/[\s>+~]/.test(c))start=i+1}
  return selector.slice(start)
}
const guard=':where(:not([data-ui-control], [data-ui-control] *, .ant-btn, .ant-input, .ant-input-affix-wrapper, .ant-select, .ant-select *))'
const cssChanges=[]
for(const file of tracked.filter(file=>file.startsWith('src/') && file.endsWith('.css') && !file.startsWith('src/components/ui/'))) {
  const original=fs.readFileSync(file,'utf8'), sheet=postcss.parse(original,{from:file}); let count=0
  const rules=[];sheet.walkRules(rule=>rules.push(rule))
  for(const rule of rules) {
    if(rule.selector.includes('[data-ui-control]'))continue
    const selected=splitSelectors(rule.selector), control=selected.filter(selector=>{
      const tail=lastCompound(selector)
      return /(?:^|[^\w-])(?:button|input|select|textarea)(?![\w-])/.test(tail) || [...tail.matchAll(/\.([\w-]+)/g)].some(match=>classNames.has(match[1]))
    })
    if(!control.length)continue
    const paint=(rule.nodes||[]).filter(node=>node.type==='decl' && /^(?:background(?:-.+)?|border(?:-.+)?|box-shadow|outline(?:-.+)?|height|min-height|max-height|padding(?:-.+)?|font(?:-size|-family)?|line-height|color|caret-color|text-shadow|transform)$/.test(node.prop))
    if(!paint.length)continue
    const preserved=selected.filter(selector=>!control.includes(selector))
    const clone=rule.clone({selector:[...preserved,...control.map(selector=>{
      // Place the guard before a pseudo-element, never after it.
      const index=selector.indexOf('::');return index<0?selector+guard:selector.slice(0,index)+guard+selector.slice(index)
    })].join(',\n')})
    clone.removeAll();paint.forEach(decl=>clone.append(decl.clone()))
    paint.forEach(decl=>decl.remove());rule.after(clone);if(!rule.nodes.length)rule.remove();count++
  }
  if(count){const text=sheet.toString();postcss.parse(text,{from:file});source.set(file,text);cssChanges.push({file,rules:count})}
}

for(const [template,destination] of [
  ['ControlKit.template.jsx','src/components/ui/ControlKit.jsx'],['UiThemeProvider.template.jsx','src/components/ui/UiThemeProvider.jsx'],['control-kit.template.css','src/components/ui/control-kit.css']]) {
  const text=fs.readFileSync('scripts/ui-migration/'+template,'utf8')
  if(destination.endsWith('.jsx'))parseSource(text,destination);else postcss.parse(text)
  source.set(destination,text)
}
// Preflight the complete result before writing any source file.
const remaining=[]
for(const file of production) walk(parseSource(source.get(file)??fs.readFileSync(file,'utf8'),file),node=>{
  if(node.type==='JSXOpeningElement' && mapping[tag(node.name)] && !optionException(node,file))remaining.push({file,line:node.loc.start.line,tag:tag(node.name)})
})
if(remaining.length)throw Error('Unmigrated eligible controls: '+JSON.stringify(remaining.slice(0,10)))
for(const [file,text] of source){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);changes.push({file,sha256:createHash('sha256').update(text).digest('hex')})}
const summary={schemaVersion:1,baseCommit:before,sourceMigrationComplete:true,visualAcceptance:false,testsExecuted:false,productionFiles:production.length,
  controlLocations:migrated.length,changedFiles:changes.length,retainedNative:retained.length,remainingEligibleControls:remaining.length,cssFiles:cssChanges.length}
const report={summary,changed:changes,controls:migrated,retainedNative:retained,css:cssChanges,remaining}
fs.mkdirSync('docs/quality',{recursive:true});fs.writeFileSync('docs/quality/ui-migration-2f116.json',JSON.stringify(report,null,2)+'\n')
console.log('UI_MIGRATION_SUMMARY '+JSON.stringify(summary))
console.log('UI_MIGRATION_FILES '+JSON.stringify(changes.map(item=>item.file)))
