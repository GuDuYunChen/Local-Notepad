import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateShortcutRecords,validateShortcutCompletion,replaceUnique,prepareShellVerifiedLifecycle,SHELL_READER,SHORTCUT_PROBE } from './installer-shell-core.mjs'
const expected='D:\\test\\中文 安装目录\\记事本.exe'
const link=()=>({path:'C:\\Users\\runneradmin\\Desktop\\记事本.lnk',target:expected,reader:'Shell.Application',wshTarget:''})
test('valid native Shell target is not invalidated by an empty WSH property',()=>assert.equal(validateShortcutRecords([link()],expected),true))
test('both readers can agree on a complete Unicode and space target',()=>assert.equal(validateShortcutRecords([{...link(),wshTarget:expected}],expected),true))
for(const [name,change] of [ ['empty native target',{target:''}], ['relative target',{target:'记事本.exe'}], ['truncated target',{target:'D:\\test\\中文\\记事本.exe'}], ['wrong executable',{target:expected+'-other'}], ['conflicting WSH target',{wshTarget:'D:\\other.exe'}], ['non-native reader',{reader:'stub'}], ['missing reader',{reader:undefined}], ['non-link file',{path:'C:\\file.txt'}], ['relative link',{path:'test.lnk'}] ])
 test('refuses '+name,()=>assert.throws(()=>validateShortcutRecords([{...link(),...change}],expected)))
test('absent and duplicate shortcuts are refused',()=>{assert.throws(()=>validateShortcutRecords([],expected));assert.throws(()=>validateShortcutRecords([link(),link()],expected))})
test('empty WSH cannot pass by resolving empty text to the working directory',()=>assert.throws(()=>validateShortcutRecords([{...link(),target:''}],process.cwd())))
test('verifier refuses unknown or incomplete source instead of weakening assertions',()=>assert.throws(()=>prepareShellVerifiedLifecycle('async function shellLinks() {}')))
test('source changes require one exact anchor',()=>{assert.equal(replaceUnique('one before two','before','after'),'one after two');assert.throws(()=>replaceUnique('before before','before','after'));assert.throws(()=>replaceUnique('other','before','after'))})
const complete=()=>({complete:true,shortcutLaunch:{complete:true,pid:987,code:0,nativeClose:true,backendStopped:true,target:expected},snapshots:[{links:[link()]}],appExits:[{pid:987,code:0,viaShortcut:true,nativeClose:true}]})
test('acceptance requires actual shortcut process closure evidence',()=>assert.equal(validateShortcutCompletion(complete()),true))
for(const key of ['complete','nativeClose','backendStopped','code','pid'])test('rejects missing shortcut '+key,()=>{const r=complete();delete r.shortcutLaunch[key];assert.throws(()=>validateShortcutCompletion(r))})
test('a different process exit does not complete the shortcut scenario',()=>{const r=complete();r.appExits[0].pid++;assert.throws(()=>validateShortcutCompletion(r))})
test('native shortcut probe launches .lnk and keeps real close/process assertions',()=>{assert.match(SHELL_READER,/\$item.GetLink/);assert.match(SHORTCUT_PROBE,/Start-Process -FilePath \$env:NP_TEST_LINK -PassThru/);assert.match(SHORTCUT_PROBE,/windowSession.close\(selectDesktopMainWindow/);assert.match(SHORTCUT_PROBE,/assert.equal\(result.code,0\)/)})
