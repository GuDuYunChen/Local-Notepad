// Complete the reproduced integration fix against the legacy global cascade.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const expected={
 'src/components/VersionHistory.css':'314a8ff53a4229e5e42c8d5079abfe9ba64242ab',
 'src/components/VersionHistory.test.jsx':'da237a71de5ff5fcd151b35d9baf7d9807b11750',
 'docs/LOCAL_VERSION_HISTORY_2F87.md':'527f3747bb91cf4d05674310aff3d503e29e56c1',
 'AGENTS.md':'21595fc5ce4e730ff8944b008aea39a160152642',
}
const sources={};for(const[file,hash]of Object.entries(expected)){sources[file]=fs.readFileSync(file,'utf8');assert.equal(blob(sources[file]),hash,file)}
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2);return s.replace(a,b)}
const css='\n/* This module replaces the old compact history layout; leave the inspector\n   body as the scroll owner and preserve room for the real reference notice. */\n.inspector-panel .inspector-body > .version-history { display: block; min-height: 0; max-height: none; overflow: visible; padding: 12px 14px var(--history-bottom-clearance, 16px) !important; }\n.inspector-panel .version-history .version-list { max-height: 260px !important; }\n.inspector-panel .version-history .version-preview pre { max-height: 360px !important; font-size: 13px !important; }\n'
fs.writeFileSync('src/components/VersionHistory.css',sources['src/components/VersionHistory.css']+css)
const tests=`\ntest('history root defeats legacy important padding and nested height constraints',()=>{
 const css=readFileSync(new NodeURL('./VersionHistory.css',import.meta.url),'utf8')
 const root=css.split('.inspector-panel .inspector-body > .version-history {')[1]?.split('}')[0]
 expect(root).toBeTruthy()
 for(const rule of ['display: block','min-height: 0','max-height: none','overflow: visible','padding: 12px 14px var(--history-bottom-clearance, 16px) !important'])expect(root).toContain(rule)
})
test('history retains bounded list and readable preview despite old inspector overrides',()=>{
 const css=readFileSync(new NodeURL('./VersionHistory.css',import.meta.url),'utf8')
 expect(css).toContain('.inspector-panel .version-history .version-list { max-height: 260px !important; }')
 expect(css).toContain('.inspector-panel .version-history .version-preview pre { max-height: 360px !important; font-size: 13px !important; }')
})
`
fs.writeFileSync('src/components/VersionHistory.test.jsx',"import { readFileSync } from 'node:fs'\nimport { URL as NodeURL } from 'node:url'\n"+sources['src/components/VersionHistory.test.jsx']+tests)
fs.writeFileSync('AGENTS.md',replace(sources['AGENTS.md'],'Current local module: 2F.87 / 4.220.1','Current local module: 2F.87 / 4.220.2'))
const doc=replace(sources['docs/LOCAL_VERSION_HISTORY_2F87.md'],'# 2F.87 / 4.220.1','# 2F.87 / 4.220.2')+'\n## Global-layout integration completion / 4.220.2\n\nThe first clearance patch88a22aa/4.220.1 still failed native hit testing because legacy .inspector-panel .version-history important padding and flex/min/max-height rules overrode it. The final scoped selector explicitly replaces only the old history layout: inspector-body owns outer scrolling, list and preview remain bounded, measured bottom padding wins the legacy important rule. Actual Chromium with production component and captured full global styles reproduced baseline12px/flex/280px/intercepted-click and verified corrected104px/block/no-max-height plus one actual save-button click in both themes at1008px and390px. Its API/editor were layout fixtures, not a production backend. Two additional source-style regression contracts retain these integration overrides. Full current-source Windows and installation gates still required. No save/Go/Electron/installer/schema or dependency-graph changes.\n'
fs.writeFileSync('docs/LOCAL_VERSION_HISTORY_2F87.md',doc)
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));assert.equal(lock.version,'4.220.1');assert.equal(lock.packages[''].version,'4.220.1')
execFileSync('npm',['run','version:patch'],{stdio:'inherit'})
const updated=JSON.parse(fs.readFileSync('package-lock.json','utf8'));assert.equal(updated.version,'4.220.2');assert.equal(updated.packages[''].version,'4.220.2');updated.version=lock.version;updated.packages[''].version=lock.packages[''].version;assert.deepEqual(updated,lock)
execFileSync('node',['scripts/check-app-version.mjs','--previous-version=4.220.1'],{stdio:'inherit'});execFileSync('git',['diff','--check'],{stdio:'inherit'})
