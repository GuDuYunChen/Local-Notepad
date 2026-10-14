// The legacy root is inline-flex. Use a scoped vertical editor layout instead
// of relying on component stylesheet import ordering; preserve all controls.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex')
const read=(p,sha)=>{const s=readFileSync(p,'utf8');assert.equal(blob(s),sha,p);return s}
const css='src/components/TagSelector.css',test='src/components/TagSelector.test.jsx',native='scripts/check-note-tags-desktop.mjs'
writeFileSync(css,read(css,'6cbd3ce67bc5f91d68cf6f5698ed404b35d2bded')+'\n/* Replace the old inline tag trigger layout only for the current note editor. */\n.inspector-panel .tag-selector.note-tags { display:block; width:100%; margin-right:0; }\n')
writeFileSync(test,"import {readFileSync} from 'node:fs'\nimport {URL as NodeURL} from 'node:url'\n"+read(test,'8fd540e758a5ec47c67f51b1e5f0a4ac9b40388f')+"\ntest('full note-tag editor replaces the old inline trigger layout',()=>{const css=readFileSync(new NodeURL('./TagSelector.css',import.meta.url),'utf8');expect(css).toContain('.inspector-panel .tag-selector.note-tags { display:block; width:100%; margin-right:0; }')})\n")
const s=read(native,'26af81d9c66d45e977ad7a89bc4027338b6ebcb3'),a="  mark('properties-entry-reads-current-note-tags')"
assert.equal(s.split(a).length,2)
writeFileSync(native,s.replace(a,"  assert.equal(await evaluate(\"getComputedStyle(document.querySelector('.note-tags')).display\"),'block','Tag editor must not use legacy inline trigger layout')\n"+a))
