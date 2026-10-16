// Verify the complete candidate before tests; never modify source or repository refs.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const base='6a74bc0ab69314b4c032003bbcb29ea7acb4b45a'
const expected={
 'AGENTS.md':'f5ea96d15ea9962f37bf0ede0fc7c748a3222ce7',
 'scripts/check-desktop-save.mjs':'dab058bd11a2e76276be63a52f610dc2f9f20f15',
 'server/internal/controller/file.go':'c10107beb079e6716bd4be3d2008d85470288aa4',
 'server/internal/logic/file.go':'ceae169dc8e4c2f5a978de17ffc86e58f2bed09e',
 'src/App.jsx':'a2c3b9e3819945f40331bda2a51d4dd4599bec3e',
 'src/components/FileList.jsx':'5cefdc77afa12d6069c63be941481d2022a76f43',
 'src/components/WorkspaceSidebar.jsx':'7ba12c88e7ea5658f973d795e62551395d9d1d59',
 'docs/LOCAL_PINNED_NOTES_2F96.md':'b48e96461f1061b50a101e2e9668d79c4bd72fa4',
 'scripts/check-local-pins-desktop.mjs':'7abf0331d1b3a7c1b626e7c2e2b5f68d6a77c588',
 'scripts/local-pins-cases.mjs':'2cfbdb39766675dc5afb18bd3b508aa905e9d6f0',
 'scripts/local-pins.node.mjs':'a341a0619c029d4b9e9e621efe44398070392d06',
 'server/internal/controller/local_pins.go':'409ce1dbf85c0d823faf55b09bf5d39de6199012',
 'server/internal/dao/local_pins.go':'58c616d7393db18e572f6ddac6f04f496cf344ce',
 'server/internal/dao/local_pins_test.go':'39c7b6f65b7fe0071fb5e5ba92ac7b771b15e99c',
 'server/internal/logic/local_pins_legacy_test.go':'f10c81741b2e2deb4ebfa76fbdfe100d8633a255',
 'src/components/FileListPin.legacy-safety.test.jsx':'2170a9b6e0f31ebe358a6b393a89fe3900d582ac',
 'src/components/PinnedNotesPanel.css':'0e7f81cce2a5b62f02584d8270a6ba67377bdf84',
 'src/components/PinnedNotesPanel.jsx':'b389cb1628baeb24e6ed31a8a9ac3ae151941fc3',
 'src/components/PinnedNotesPanel.test.jsx':'10f8f41552b1ced4010766d40631c663e7fe409d',
 'src/services/localPins.mjs':'4d0c809f2646b67a4b0983227d93a2569e34c277',
 'src/services/localPins.test.js':'d6492775593b25996398d8f189e9ab0b92c04b94',
 'package.json':'eb4f7ed2139eb51115119cc420b12bf800137c81',
 'package-lock.json':'5b9d529f0c4e55f2a4b7ff59724aadad35c35576',
 'scripts/pin-journal-boundaries-cases.mjs':'84b8391e0f3ce7ec44677cdf955c3be1e72f3a01',
 'scripts/pin-journal-boundaries.node.mjs':'9ad4b107dc4c7d27e7d684c0f34014ddba85a08a',
 'src/services/localPins.boundaries.test.js':'cae16c4ad33b6c295e82c7185f3b08aab852983b',
 'scripts/pin-recovery-ownership-cases.mjs':'c2538f94b910dfd289cb2a7a92cc40c44b0aaa37',
 'scripts/pin-recovery-ownership.node.mjs':'b18f8a8ba5c833c55c5ed5c10eed7ae5b2a4b6af',
 'src/services/localPins.recovery-ownership.test.js':'286470b4bf64bbf5b19df5a32bea883b1fc3907d',
}
const output='pin-closeout-evidence';mkdirSync(output,{recursive:true})
const records=Object.entries(expected).map(([path,sha])=>{
 const b=readFileSync(path),actual=createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex')
 assert.equal(actual,sha,path)
 return {path,sha,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}
})
const changed=execFileSync('git',['diff','--name-only',base,'HEAD'],{encoding:'utf8'}).trim().split('\n')
const allowed=[...Object.keys(expected),'scripts/check-pins-closeout.mjs','.github/workflows/local-history-2f87.yml']
assert.deepEqual([...changed].sort(),allowed.sort())
const manifest=JSON.parse(readFileSync('package.json')),lock=JSON.parse(readFileSync('package-lock.json'))
assert.equal(manifest.version,'4.229.0');assert.equal(lock.version,'4.229.0');assert.equal(lock.packages[''].version,'4.229.0')
const originalLock=JSON.parse(execFileSync('git',['show',base+':package-lock.json'],{encoding:'utf8',maxBuffer:1048576}))
lock.version=originalLock.version;lock.packages[''].version=originalLock.packages[''].version;assert.deepEqual(lock,originalLock)
writeFileSync(output+'/source-identity.json',JSON.stringify({base,verifier:process.env.GITHUB_SHA,records,dependencyGraphUnchanged:true,productRefUpdated:false},null,2))
console.log('Exact complete candidate verified: '+records.length+' product files; dependency graph unchanged.')
