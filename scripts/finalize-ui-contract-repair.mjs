import fs from 'node:fs'
import { parse } from '@babel/parser'
const file='scripts/repair-ui-migration-contracts.mjs'
let text=fs.readFileSync(file,'utf8')
const old="['density','data-ui-native'].includes(attr.name.name)"
if(!text.includes(old))throw Error('Canonical UI attribute anchor missing')
text=text.replace(old,"(['density','data-ui-native'].includes(attr.name.name) || attr.name.name==='size' && attr.value?.value==='middle')")
text=text.replace("if(!/[\\w$.]+\\s*\\(/.test(before[i][1])&&before[i][1]!==after[i][1])", "if(/^(?:\\[)?(?:[\\s,\\[\\]{}:0-9.\\-]|true|false|null|undefined|\"[^\"]*\"|'[^']*')*(?:\\])?$/.test(before[i][1])&&before[i][1]!==after[i][1])")
parse(text,{sourceType:'module'});fs.writeFileSync(file,text)
