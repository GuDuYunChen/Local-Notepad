const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { verifyQueueReport, verifyQueueEvidence, requireCompletedRender, scenes, selectors } = require('./run-sync-conflict-queue-render.cjs')
const sha = 'a'.repeat(40)
const actionLabels = ['对照版本', '采用远端', '保留本机']
const fixture = () => ({ complete: true, platform: 'win32', syntheticRecords: true, realComponents: true,
  backendExercised: false, navigationFocus: true, nativeSearch: true, writes: 0, commit: sha,
  reports: scenes.map(([name, width, count, label]) => ({ name, ready: true, stableSamples: 3, count, label,
    bounds: [20, width - 40, 600], viewport: [width,900], imageSize: [width,900], overflow: 0, writes: 0, activeMarkup: 0,
    colors: selectors.map((selector, i) => ({ selector, finalColor: true, foreground: [36,34,42], background: [255,255,255], ratio: 15.7,
      ...(i >= 9 ? { actionLabel: actionLabels[i-9], enabled: true, antControl: true, fontSize: 14 } : {}) })) })) })
function evidence(t, report = fixture()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-evidence-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(report))
  // Header/trailer fixture only, not a fake claim of decoded/native image pixels.
  for (const [name, width] of scenes) {
    const png = Buffer.alloc(45); Buffer.from('89504e470d0a1a0a','hex').copy(png)
    png.write('IHDR',12); png.writeUInt32BE(width,16); png.writeUInt32BE(900,20); png.write('IEND',37)
    fs.writeFileSync(path.join(dir,name+'.png'),png)
  }
  return dir
}
test('requires all five ordered scenarios and every successful receipt', t => {
  const dir = evidence(t), report = requireCompletedRender({status:0},dir,sha)
  assert.equal(report.reports.length,5)
})
test('the actual green #1247 incomplete artifact is rejected even after child exit zero', t => {
  const old = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/sync-queue-incomplete-report.json')))
  assert.equal(old.complete,false); assert.equal(old.reports.length,1)
  const dir=evidence(t,old)
  assert.throws(()=>requireCompletedRender({status:0},dir,null),/did not finish/)
})
test('complete flag cannot conceal missing or duplicate scenes', () => {
  for (const mutate of [r=>r.reports.pop(),r=>{r.reports[1]=r.reports[0]},r=>r.reports.reverse()]) {
    const r=fixture();mutate(r);assert.throws(()=>verifyQueueReport(r,sha))
  }
})
test('incomplete evidence from any of the five scenes is fatal', () => {
  for(let i=0;i<5;i++) for(const mutate of [r=>{r.ready=false},r=>{r.stableSamples=2},r=>{r.count++},r=>{r.label='wrong'},r=>{r.overflow=2}]) {
    const r=fixture();mutate(r.reports[i]);assert.throws(()=>verifyQueueReport(r,sha))
  }
})
test('missing low-contrast or not-final color probes are rejected', () => {
  for(let i=0;i<selectors.length;i++) for(const mutate of [c=>{c.finalColor=false},c=>{c.ratio=4.49},c=>{c.ratio=NaN},c=>{c.foreground=[]},c=>{c.selector='wrong'}]) {
    const r=fixture();mutate(r.reports[0].colors[i]);assert.throws(()=>verifyQueueReport(r,sha))
  }
  const r=fixture();r.reports[0].colors.pop();assert.throws(()=>verifyQueueReport(r,sha))
})
test('all three actual queue action labels must stay readable, enabled and theme-owned', () => {
  for(let index = 9; index < selectors.length; index++) {
    for(const mutate of [
      color => { color.actionLabel = 'wrong' },
      color => { color.enabled = false },
      color => { delete color.enabled },
      color => { color.antControl = false },
      color => { delete color.antControl },
      color => { color.fontSize = 12 },
      color => { color.fontSize = NaN },
      color => { delete color.fontSize },
    ]) {
      const report = fixture()
      mutate(report.reports[0].colors[index])
      assert.throws(() => verifyQueueReport(report, sha), /contrast evidence is incomplete/)
    }
  }
})
test('a removed native Select probe cannot stand in for actual shared Select text', () => {
  const r=fixture(),probe=r.reports[0].colors.find(color=>color.selector.includes('[data-ui-control="select"]'))
  assert.ok(probe)
  probe.selector='.sync-queue-tools select'
  assert.throws(()=>verifyQueueReport(r,sha),/contrast evidence is incomplete/)
})
test('unverified focus search writes or wrong platform cannot pass', () => {
  for(const field of ['complete','realComponents','navigationFocus','nativeSearch','syntheticRecords']){
    const r=fixture();r[field]=false;assert.throws(()=>verifyQueueReport(r,sha))
  }
  for(const mutate of [r=>{r.writes=1},r=>{r.backendExercised=true},r=>{r.platform='linux'},r=>{r.reports[0].activeMarkup=1},r=>{r.reports[0].writes=1}]){
    const r=fixture();mutate(r);assert.throws(()=>verifyQueueReport(r,sha))
  }
})
test('stale commit cannot satisfy the current run', t => {
  const dir=evidence(t);assert.throws(()=>verifyQueueEvidence(dir,'b'.repeat(40)),/another commit/)
})
test('missing screenshot cannot be replaced by a successful JSON receipt', t => {
  for(const [name] of scenes){const dir=evidence(t);fs.unlinkSync(path.join(dir,name+'.png'));assert.throws(()=>verifyQueueEvidence(dir,sha))}
})
test('empty truncated or incorrectly sized screenshot is rejected', t => {
  for(const mutate of [b=>Buffer.alloc(0),b=>b.subarray(0,25),b=>{b.writeUInt32BE(1,16);return b},b=>{b.writeUInt32BE(1,20);return b},b=>{b.write('nope',37);return b}]){
    const dir=evidence(t),p=path.join(dir,'light-1180.png');fs.writeFileSync(p,mutate(fs.readFileSync(p)));assert.throws(()=>verifyQueueEvidence(dir,sha))
  }
})
test('malformed or missing JSON fails closed',t=>{
  const dir=evidence(t);fs.writeFileSync(path.join(dir,'checks.json'),'{');assert.throws(()=>verifyQueueEvidence(dir,sha))
  fs.unlinkSync(path.join(dir,'checks.json'));assert.throws(()=>verifyQueueEvidence(dir,sha))
})
test('child failure or timeout is not hidden by complete artifacts',t=>{
  const dir=evidence(t)
  for(const child of [null,{status:1},{status:null},{status:0,signal:'SIGTERM'},{status:0,error:new Error('timeout')}]) assert.throws(()=>requireCompletedRender(child,dir,sha),/process failed/)
})
test('report checks do not mutate caller evidence',()=>{
  const r=fixture(),before=JSON.stringify(r);verifyQueueReport(r,sha);assert.equal(JSON.stringify(r),before)
})

test('screen-clamped native windows are checked against actual viewport rather than requested size',()=>{
  const r=fixture();r.reports[0].viewport=[1008,681];r.reports[0].imageSize=[1008,681];r.reports[0].bounds=[37,862,1506.5]
  verifyQueueReport(r,sha)
  r.reports[0].imageSize=[1180,900];assert.throws(()=>verifyQueueReport(r,sha))
})

test('native queue action probes anchor the real Ant Design button, not an optional label span', () => {
  assert.deepEqual(selectors.slice(9), [1, 2, 3].map(index =>
    '.sync-conflict-actions>[data-ui-control="button"]:nth-child(' + index + ')'))
})

// Execute the actual serialized Chromium observer with explicit DOM-shaped
// colors. This checks its observation boundary, not a browser layout or PNG.
function inspectButtonText(options = {}) {
  const vm = require('node:vm')
  const source = fs.readFileSync(process.env.NOTEPAD_QUEUE_OBSERVER_SOURCE || path.join(__dirname, 'check-sync-conflict-queue-render.cjs'), 'utf8')
  const start = source.indexOf('function inspectQueue() {'), end = source.indexOf('\napp.whenReady()', start)
  assert.ok(start >= 0 && end > start)
  const rgb = (r, g, b) => `rgb(${r}, ${g}, ${b})`
  const dark = options.dark === true
  const paper = dark ? rgb(27, 35, 48) : rgb(255, 255, 255)
  const ink = dark ? rgb(234, 242, 255) : rgb(36, 34, 42)
  const primary = dark ? rgb(102, 161, 220) : rgb(112, 87, 217)
  const primaryInk = dark ? rgb(0, 0, 0) : rgb(255, 255, 255)
  const css = (color = ink, backgroundColor = 'rgba(0, 0, 0, 0)', fontSize = '14px') => ({ color, backgroundColor, fontSize,
    getPropertyValue: () => ink })
  const root = { parentElement: null, style: css(ink, paper) }
  const captions = selectors.slice(0, 9).map(selector => [selector, { parentElement: root, style: css(), textContent: 'caption' }])
  const buttons = ['对照版本', '采用远端', '保留本机'].map((text, index) => {
    const button = { tagName: options.ownerTag || 'BUTTON', parentElement: root, textContent: text, children: [],
      classList: { contains: name => name === 'ant-btn' && options.antControl !== false },
      disabled: options.disabled === true, matches: value => value === ':disabled' && options.fieldsetDisabled === true,
      getAttribute: name => name === 'data-ui-control' ? (options.foreignOwner ? 'input' : 'button') : name === 'aria-disabled' && options.ariaDisabled ? 'true' : null,
      style: css(index === 2 ? primaryInk : ink, index === 2 ? primary : paper) }
    const leaked = options.captionColor === true && index === 2
    const color = leaked ? (dark ? rgb(184, 199, 220) : rgb(111, 107, 120)) : button.style.color
    const label = { tagName: options.leafTag || 'SPAN', parentElement: button, children: [],
      classList: { contains: name => (name === 'ant-btn-icon' && options.iconLeaf === true) ||
        (name === 'ant-btn-content' && options.forgedContentClass === true) },
      style: css(color, 'rgba(0, 0, 0, 0)', options.captionFont && index === 2 ? '12px' : '14px'), textContent: text }
    if (options.nestedTextLeaf) label.children = [{ ...label, children: [], parentElement: label }]
    if (options.nestedLeaf) {
      const wrapper = { tagName: 'DIV', parentElement: button, children: [label], textContent: text,
        classList: { contains: () => false }, style: css() }
      label.parentElement = wrapper; button.children = [wrapper]
    } else button.children = options.missingLeaf ? [] : [label]
    const descendants = node => node.children.flatMap(child => [child, ...descendants(child)])
    button.querySelector = selector => selector === '.ant-btn-content' ? descendants(button).find(node => node.classList.contains('ant-btn-content')) || null : null
    button.querySelectorAll = selector => selector === 'span' ? descendants(button).filter(node => node.tagName === 'SPAN') : []
    return button
  })
  const targets = new Map([...captions, ...selectors.slice(9).map((selector, index) => [selector, buttons[index]])])
  const queue = { querySelector: selector => selector === '.sync-queue-count' ? { ...targets.get(selector), textContent: '匹配 25 / 当前列表 25 条 · 显示 1–10' } : options.missingLabel && selector === selectors[11] ? null : targets.get(selector),
    querySelectorAll: selector => selector === '[data-conflict-id]' ? Array(10).fill({}) : [],
    getBoundingClientRect: () => ({ left: 20, width: 1140, height: 600 }) }
  let current = [0, 0, 0, 0], fill = [0, 0, 0, 1]
  const parse = value => {
    if (value === '#fff') return [255, 255, 255, 1]
    const match = /^rgba?\(([^)]+)\)$/.exec(value)
    assert.ok(match, 'Explicit color fixture is missing: ' + value)
    const values = match[1].split(',').map(Number); return [values[0], values[1], values[2], values[3] ?? 1]
  }
  const context = { set fillStyle(value) { fill = parse(value) }, clearRect() { current = [0, 0, 0, 0] },
    fillRect() {
      const alpha = fill[3] + current[3] * (1 - fill[3])
      current = [...fill.slice(0, 3).map((n, i) => alpha ? (n * fill[3] + current[i] * current[3] * (1 - fill[3])) / alpha : 0), alpha]
    }, getImageData() { return { data: [...current.slice(0, 3).map(Math.round), Math.round(current[3] * 255)] } } }
  const document = { querySelector: selector => selector === '.sync-conflict-queue' ? queue : null,
    documentElement: { scrollWidth: 1180 }, createElement: tag => { assert.equal(tag, 'canvas'); return { getContext: () => context } } }
  return vm.runInNewContext('(' + source.slice(start, end).trim() + ')()', { document,
    getComputedStyle: node => node.style, innerWidth: 1180, innerHeight: 900, window: { __queueWrites: 0 } }, { timeout: 1000 })
}

test('every conflict action label is a mandatory contrast probe after the original nine captions', () => {
  assert.equal(selectors.length, 12)
  for (let index = 0; index < 3; index++) assert.equal(selectors[9 + index],
    `.sync-conflict-actions>[data-ui-control="button"]:nth-child(${index + 1})`)
  const r = fixture(); r.reports[0].colors.splice(9)
  assert.throws(() => verifyQueueReport(r, sha), /contrast evidence is incomplete/)
})

test('serialized observer measures enabled button labels against their own root and painted background', () => {
  for (const dark of [false, true]) {
    const sample = inspectButtonText({ dark })
    assert.equal(sample.ready, true); assert.equal(sample.colors.length, 12)
    const r = fixture(); r.reports[0].colors = sample.colors; verifyQueueReport(r, sha)
    for (const probe of sample.colors.slice(9)) {
      assert.equal(probe.button.enabled, true); assert.equal(probe.button.labelColor, probe.button.rootColor)
      assert.equal(probe.button.labelFontSize, probe.button.rootFontSize); assert.ok(probe.ratio >= 4.5)
    }
  }
})

test('serialized observer rejects the actual light and dark caption-color leakage captured in run42665502026', () => {
  for (const dark of [false, true]) {
    const sample = inspectButtonText({ dark, captionColor: true, captionFont: true })
    assert.equal(sample.ready, true)
    const primary = sample.colors[11]
    assert.equal(primary.finalColor, false)
    assert.ok(primary.ratio > (dark ? 1.5 : .9) && primary.ratio < (dark ? 1.7 : 1.2))
    const r = fixture(); r.reports[0].colors = sample.colors
    assert.throws(() => verifyQueueReport(r, sha), /contrast evidence is incomplete/)
  }
})

test('serialized observer rejects font-only metadata leakage even after text color is restored', () => {
  const sample = inspectButtonText({ captionFont: true })
  assert.ok(sample.colors[11].ratio >= 4.5); assert.equal(sample.colors[11].finalColor, false)
  const r = fixture(); r.reports[0].colors = sample.colors
  assert.throws(() => verifyQueueReport(r, sha), /contrast evidence is incomplete/)
})

test('serialized observer refuses missing, foreign, disabled and inherited-disabled button owners', () => {
  for (const options of [{ missingLabel: true }, { ownerTag: 'DIV' }, { foreignOwner: true },
    { disabled: true }, { fieldsetDisabled: true }, { ariaDisabled: true }]) assert.equal(inspectButtonText(options).ready, false)
})


test('serialized observer refuses non-Ant Design roots even with correct shared metadata and label text', () => {
  assert.equal(inspectButtonText({ antControl: false }).ready, false)
})

test('serialized observer requires a real owned direct text leaf instead of substituting the root', () => {
  const cases = [
    ['missing leaf', { missingLeaf: true }],
    ['icon span', { iconLeaf: true }],
    ['nested span', { nestedLeaf: true }],
    ['outer span instead of its text leaf', { nestedTextLeaf: true }],
    ['non-span with optional content class', { leafTag: 'DIV', forgedContentClass: true }],
  ]
  const observed = cases.map(([name, options]) => [name, inspectButtonText(options).ready])
  assert.deepEqual(observed, cases.map(([name]) => [name, false]))
})
