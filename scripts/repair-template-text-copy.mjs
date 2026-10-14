import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const blob=b=>createHash('sha1').update('blob '+Buffer.byteLength(b)+'\0').update(b).digest('hex')
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unexpected source anchor');return s.replace(a,b)}
const names={
 'src/services/templateLibrary.mjs':'478c296662b01c6521e4d6b84ef9fd20b1ae1bdf',
 'src/components/TemplateLibrary.jsx':'8d610b6c16df3d0b6473672c415a747fd52c5a38',
 'src/components/TemplateLibrary.test.jsx':'efe5e00939fffebe6b587b4d20dd2c36ec439c42',
}
const source={};for(const[file,hash]of Object.entries(names)){source[file]=fs.readFileSync(file,'utf8');assert.equal(blob(source[file]),hash,file)}
fs.writeFileSync('src/services/templateLibrary.mjs',once(source['src/services/templateLibrary.mjs'],"if (!object(doc?.root) || !Array.isArray(doc.root.children)) return null","if (!object(doc?.root) || !Array.isArray(doc.root.children)) return content"))
fs.writeFileSync('src/components/TemplateLibrary.jsx',once(source['src/components/TemplateLibrary.jsx'],"  const selectedText = selected ? extractLexicalText(selected.content) : ''","  const selectedPlain = selected ? editableTemplateText(selected.content) : ''\n  const selectedText = selectedPlain === null ? extractLexicalText(selected.content) : selectedPlain"))
fs.writeFileSync('src/components/TemplateLibrary.test.jsx',source['src/components/TemplateLibrary.test.jsx']+`
test('independent text copy preserves every blank line and boundary space',async()=>{
 const text='  \\n\\n保留空行🙂\\n\\n末尾  \\n'
 await mount({id:'preserve',title:'保真模板',content:text})
 expect(host.querySelector('[aria-label="模板正文预览"]').textContent).toBe(text)
 await click('从预览创建文本笔记')
 expect(JSON.parse(writes()[0][1].body).content).toBe(textTemplateDocument(text))
 expect(onCreated).not.toHaveBeenCalled()
})
test('legacy literal JSON remains editable text instead of a blank rich preview',async()=>{
 const text='{"topic":"周报","done":false}'
 templates=[row({title:'JSON文本',content:text})]
 await mount();await click('编辑')
 expect(host.querySelector('[aria-label="模板正文"]').value).toBe(text)
 expect(host.querySelector('[aria-label="模板正文"]').disabled).toBe(false)
 await click('保存模板');expect(templates[0].content).toBe(textTemplateDocument(text))
})
`)
const agents=fs.readFileSync('AGENTS.md','utf8');fs.writeFileSync('AGENTS.md',once(agents,'2F.89 / 4.222.0','2F.89 / 4.222.1'))
const doc=fs.readFileSync('docs/LOCAL_TEMPLATE_LIBRARY_2F89.md','utf8')
fs.writeFileSync('docs/LOCAL_TEMPLATE_LIBRARY_2F89.md',once(doc,'2F.89 / 4.222.0','2F.89 / 4.222.1')+'\n## Text fidelity repair / 4.222.1\n\nReproduced the existing general text extractor trimming leading/trailing spaces and collapsing empty paragraphs when creating a template copy. Canonical text templates now use lossless paragraph decoding for both preview and the exact new-note payload. Legacy non-Lexical JSON stays literal editable text. Rich-template text-only extraction remains explicitly labeled and never rewrites the original rich body. Added actual React creation and legacy-edit regressions, preserving byte-equality serializer and original editor/receipt assertions. Same module, no cloud features or schema changes.\n')
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));assert.equal(lock.version,'4.222.0')
execFileSync('npm',['run','version:patch'],{stdio:'inherit'})
const next=JSON.parse(fs.readFileSync('package-lock.json','utf8'));assert.equal(next.version,'4.222.1');assert.equal(next.packages[''].version,'4.222.1');next.version=lock.version;next.packages[''].version=lock.packages[''].version;assert.deepEqual(next,lock)
execFileSync('git',['diff','--check'],{stdio:'inherit'})
