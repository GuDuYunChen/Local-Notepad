const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
const { verifyRasterWitness } = require('./sync-clock-raster-evidence.cjs')
const phases = ['unread','filtered','query-restored','empty','stale','failed','failure-restored','retry']
const names = ['export-light','export-dark','export-narrow']
function verifyExportScene(scene) {
  assert.ok(names.includes(scene.name)); assert.deepEqual(scene.frames.map(f=>f.phase),phases)
  scene.frames.forEach((f,i)=>{
    assert.equal(f.requests,[0,1,1,1,3,3,3,3][i]); assert.equal(f.downloads,[0,1,1,1,2,2,2,3][i])
    assert.equal(f.query,i===0?'':i===3?'PRIVATE_QUERY':'abc')
    assert.deepEqual(f.ids,i===0||i===3?[]:['h5']); assert.equal(f.disabled,i===0||i===3)
    assert.equal(f.mutations,0);assert.equal(f.networkRequests,0);assert.equal(f.navigationCalls,0)
    assert.equal(f.controlsVisible,true);assert.equal(f.overflow<=1,true);assert.equal(f.guidanceUnchanged,true)
    assert.equal(f.rasterCode,names.indexOf(scene.name)*phases.length+i+1);assert.ok(f.stable>=2)
    assert.equal(f.rawErrorVisible,false);assert.equal(f.domDownloadLinks,0)
    if([1,4,7].includes(i))assert.match(f.feedback,/已请求下载 1 条.*尚未确认落盘/)
    else if(i===5)assert.match(f.feedback,/未能发起下载/)
    else assert.equal(f.feedback,'', 'No new action: prior export feedback must stay cleared')
  })
  assert.equal(scene.downloads.length,3)
  scene.downloads.forEach((d,i)=>{
    assert.equal(d.state,'completed');assert.match(d.requestedFilename,/^Local-Notepad-冲突历史-[0-9TZ.-]+\.json$/)
    assert.equal(d.filename,scene.name+'-'+i+'.json');assert.equal(d.json.format,'local-notepad-conflict-history');assert.equal(d.json.version,1)
    assert.equal(d.json.scope.type,'loaded-filtered-history');assert.equal(d.json.scope.loadedCount,i===0?5:6)
    assert.equal(d.json.scope.exportedCount,1);assert.equal(d.json.scope.hasUnreadOlderRecords,i===0)
    assert.equal(d.json.scope.currentRemoteStateVerified,false);assert.equal(d.json.scope.sourceState,i===0?'ready':'error')
    assert.deepEqual(d.json.filters,{recordStatus:'all',objectType:'all',outcome:'all',textFilterApplied:true})
    assert.deepEqual(d.json.records.map(r=>r.id),['h5']);assert.equal(d.json.records[0].currentTitle,'星图研究 ＡＢＣ')
    assert.equal(d.json.records[0].outcome,'当时保留本机版本')
    assert.deepEqual(Object.keys(d.json.records[0]),['id','itemID','kind','currentTitle','createdAtUTC','completedAtUTC','status','resolution','outcome'])
    assert.ok(!JSON.stringify(d.json).includes('PRIVATE_'))
    if(i>0)assert.match(d.json.notices.join(''),/最近读取失败/)
  })
  return true
}
function verifyExportReport(dir,commit) {
  const report=JSON.parse(fs.readFileSync(path.join(dir,'checks.json'),'utf8'))
  assert.equal(report.commit,commit);assert.equal(report.platform,'win32');assert.equal(report.complete,true)
  assert.equal(report.actualBrowserDownload,true);assert.equal(report.syntheticRecords,true)
  assert.deepEqual(report.scenes.map(s=>s.name),names)
  for(const scene of report.scenes){verifyExportScene(scene)
    for(const f of scene.frames){assert.equal(f.filename,scene.name+'-'+f.phase+'.png')
      const bytes=fs.readFileSync(path.join(dir,f.filename));assert.equal(bytes.length,f.bytes)
      assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256)
      assert.equal(bytes.readUInt32BE(16),f.width);assert.equal(bytes.readUInt32BE(20),f.height)
      verifyRasterWitness(bytes,f.rasterCode)
    }
    for(const d of scene.downloads){const bytes=fs.readFileSync(path.join(dir,d.filename));assert.equal(bytes.length,d.bytes)
      assert.equal(createHash('sha256').update(bytes).digest('hex'),d.sha256);assert.deepEqual(JSON.parse(bytes),d.json)
    }
  }
  return report
}
module.exports={phases,names,verifyExportScene,verifyExportReport}
