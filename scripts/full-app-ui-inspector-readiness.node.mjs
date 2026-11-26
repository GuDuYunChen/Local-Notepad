import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

// Execute the real nested inspector closure and the real original visibility
// refusal against controlled DOM mount states. This is a readiness regression,
// not a browser/native-input or React scheduling reproduction. The real until
// body uses a logical clock so its original 15000/100 policy can be checked
// without changing production deadlines or sleeping in this contract file.
const sourceRoot = process.env.INSPECTOR_READINESS_SOURCE_ROOT
  ? path.resolve(process.env.INSPECTOR_READINESS_SOURCE_ROOT)
  : fileURLToPath(new URL('../', import.meta.url))
const source = name => readFileSync(path.join(sourceRoot, 'scripts', name), 'utf8')
const mainSource = source('full-app-ui-main-editor.mjs')
const sharedSource = source('full-app-ui-shared.mjs')
const runnerSource = source('run-full-app-ui-installed.mjs')
const sha = value => createHash('sha256').update(value).digest('hex')
// Undo only the reviewed early non-scroll rejection. The result must
// still be the exact ad46 shared source, not a new whole-file allowlist entry.
const filteredScrollOwner = '    if (!/auto|scroll/.test(overflowY)) continue\n    const clientHeight = viewportScrollOwner ? viewport.height : owner.clientHeight\n    if ((!viewportScrollOwner && !rendered(owner)) || owner.scrollHeight <= clientHeight + 1) continue'
const originalScrollOwner = '    const clientHeight = viewportScrollOwner ? viewport.height : owner.clientHeight\n    if ((!viewportScrollOwner && !rendered(owner)) || !/auto|scroll/.test(overflowY) || owner.scrollHeight <= clientHeight + 1) continue'
let sharedIdentitySource = sharedSource
// Undo only the current-observation sibling-position cache, then retain the
// already reviewed owned-motion/diagnostic/scroll source identities below.
const selectorPositionHelper = '  const childPositions = new Map()\n  const childPosition = (parent, child) => {\n    if (!childPositions.has(parent)) {\n      const positions = new Map()\n      for (const [index, sibling] of [...parent.children].entries()) if (!positions.has(sibling)) positions.set(sibling, index + 1)\n      childPositions.set(parent, positions)\n    }\n    return childPositions.get(parent).get(child) ?? 0\n  }\n'
const cachedSelectorPosition = "      parts.unshift(owner.tagName.toLowerCase() + ':nth-child(' + childPosition(owner.parentElement, owner) + ')')"
const originalSelectorPosition = "      parts.unshift(owner.tagName.toLowerCase() + ':nth-child(' + ([...owner.parentElement.children].indexOf(owner) + 1) + ')')"
if (sharedIdentitySource.includes(selectorPositionHelper)) {
  assert.equal(sharedIdentitySource.split(selectorPositionHelper).length, 2, 'Unique reviewed same-observation sibling cache')
  assert.equal(sharedIdentitySource.split(cachedSelectorPosition).length, 2, 'Unique reviewed selector position lookup')
  assert.equal(sharedIdentitySource.includes(originalSelectorPosition), false, 'Only the reviewed position lookup may replace the original enumeration')
  sharedIdentitySource = sharedIdentitySource.replace(selectorPositionHelper, '').replace(cachedSelectorPosition, originalSelectorPosition)
  assert.equal(sha(sharedIdentitySource), 'd2e3ee08e1addde58f79f8b01319ac20e5d409d64a253947dfd657e085bb1d05',
    'The inverse selector-position change must recover the exact owned-motion shared source')
}
// Undo only the reviewed owned-trigger finite-motion prerequisite. Keep the
// original raw-source strategy and recover the exact 668 observer before the
// earlier diagnostic/scroll inverses below; no new whole-file allowlist entry.
const ownedMotionInverse = [
  ['export function observeFullAppOwnedOptionPointer(request, scroll = false, readOwnerMotion) {',
    'export function observeFullAppOwnedOptionPointer(request, scroll = false) {'],
  ["    ownerMotion: visible && inViewport && ownedHit ? readOwnerMotion('[id=' + JSON.stringify(field.id) + ']') : null,\n", ''],
  ['    const sample = await evaluate(`(${observeFullAppOwnedOptionPointer.toString()})(${JSON.stringify(owned)},${shouldScroll},${observeFullAppOwnerMotion.toString()})`)',
    '    const sample = await evaluate(`(${observeFullAppOwnedOptionPointer.toString()})(${JSON.stringify(owned)},${shouldScroll})`)'],
  ['      if (!first.ready || finiteOwnerMotionActive(first.ownerMotion)) return false', '      if (!first.ready) return false'],
]
if (sharedIdentitySource.includes(ownedMotionInverse[0][0])) {
  for (const [current, original] of ownedMotionInverse) {
    assert.equal(sharedIdentitySource.split(current).length, 2, 'Unique reviewed owned-trigger motion change')
    sharedIdentitySource = sharedIdentitySource.replace(current, original)
  }
  assert.equal(sha(sharedIdentitySource), '04a7dcffa5e30b2bf09eeadcd24d6ce29b636f82192565f475b140dcffdfce95',
    'The inverse owned-motion change must recover the exact 668 shared source')
}
// First undo only the single-observation diagnostic cache. The real predicate
// and every other byte must still recover the previously reviewed 2787 source.
const diagnosticPortHelper = '  const diagnosticClientPorts = new Map()\n  const diagnosticClientPort = (node, clip) => {\n    if (!diagnosticClientPorts.has(node)) diagnosticClientPorts.set(node, {\n      left: clip.left + node.clientLeft, top: clip.top + node.clientTop, width: node.clientWidth, height: node.clientHeight,\n    })\n    return { ...diagnosticClientPorts.get(node) }\n  }\n'
const cachedDiagnosticPort = '        clientPort: diagnosticClientPort(parent, clip),'
const originalDiagnosticPort = '        clientPort: { left: clip.left + parent.clientLeft, top: clip.top + parent.clientTop, width: parent.clientWidth, height: parent.clientHeight },'
if (sharedIdentitySource.includes(diagnosticPortHelper)) {
  assert.equal(sharedIdentitySource.split(diagnosticPortHelper).length, 2, 'Unique reviewed single-observation diagnostic cache')
  assert.equal(sharedIdentitySource.split(cachedDiagnosticPort).length, 2, 'Unique reviewed diagnostic client-port call')
  assert.equal(sharedIdentitySource.includes(originalDiagnosticPort), false, 'Only the diagnostic construction may use the new cache')
  sharedIdentitySource = sharedIdentitySource.replace(diagnosticPortHelper, '').replace(cachedDiagnosticPort, originalDiagnosticPort)
  assert.equal(sha(sharedIdentitySource), 'e72e3dc3728e6254c4deaca5a4c12bd9ba9b26980ad6c2a8a0d90c79b05f29a5',
    'The inverse diagnostic change must recover the exact 2787 shared source')
}
if (sharedIdentitySource.includes(filteredScrollOwner)) {
  assert.equal(sharedIdentitySource.split(filteredScrollOwner).length, 2, 'Unique reviewed scroll-owner predicate order')
  assert.equal(sharedIdentitySource.includes(originalScrollOwner), false, 'The candidate must contain only the reviewed predicate order')
  sharedIdentitySource = sharedIdentitySource.replace(filteredScrollOwner, originalScrollOwner)
  assert.equal(sha(sharedIdentitySource), '92bd7f6a2b448247178e456484be08d6a18397b7c1885d77b29c6f1a2ae512bd',
    'The inverse predicate change must recover the exact ad46 shared source')
}
const mainSourceHash = sha(mainSource)
assert.ok([
  '9b9872dc4a08a550c11e7127d2317bff5b0583b378869145fea39e2867eb30a2',
  '1779b317c0b27a29d5f42015726a5df6c8cbfb322e3cb1ec87445e3716fff661',
  'f91c50e63b104aec8567b77ed74c7c64b45ff293ba7ae9fc1c373dcdf5cb4551',
].includes(mainSourceHash), 'The behavior control must use actual b3, the frozen inspector repair or the reviewed decorator candidate')
assert.ok([
  '5b819baf8153bc992168ff45c1408f9a53bbf6c57c41631e341fa984813861f9',
  '7778fcceadf8794e3454a4c426c55f1f67953535d050b7889e25f7d46a0a9c51',
  '92bd7f6a2b448247178e456484be08d6a18397b7c1885d77b29c6f1a2ae512bd',
].includes(sha(sharedIdentitySource)), 'The behavior control must use the frozen shared source or the reviewed capture/keyboard candidate')
// Undo only the reviewed paint-ticket wiring before retaining the original
// whole-runner fingerprint. Every literal must occur exactly once.
const withoutPreparedCapturePaint = text => {
  // Invert only the unique current release declaration before the unchanged
  // reviewed paint/speed identity chain. Executed closures keep the raw source.
  const currentVersion = "const VERSION = '4.249.2'"
  const previousVersion = "const VERSION = '4.249.0'"
  const currentSource = text.replace(/\r\n/g, '\n')
  assert.equal(currentSource.split(currentVersion).length - 1, 1)
  assert.equal(currentSource.split(previousVersion).length - 1, 0)
  text = currentSource.replace(currentVersion, previousVersion)
  assert.equal(text.split(previousVersion).length - 1, 1)
  assert.equal(text.replace(previousVersion, currentVersion), currentSource)
  // The added Table prerequisite is the only other current runner change.
  // Reverse it exactly before checking the unchanged historical fingerprint.
  const currentPrerequisite = "'installed-app-block-reference-workflow', 'installed-app-table-operations-workflow', 'final-uninstall-preserves-data'"
  const previousPrerequisite = "'installed-app-block-reference-workflow', 'final-uninstall-preserves-data'"
  assert.equal(text.split(currentPrerequisite).length - 1, 1)
  assert.equal(text.split(previousPrerequisite).length - 1, 0)
  const withTablePrerequisite = text
  text = text.replace(currentPrerequisite, previousPrerequisite)
  assert.equal(text.replace(previousPrerequisite, currentPrerequisite), withTablePrerequisite)
  const changes = [
  [
    "import { createFullAppCapturePaint } from './full-app-ui-capture-paint.mjs'\n",
    ""
  ],
  [
    "  const capturePaint = createFullAppCapturePaint(() => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'))\n",
    ""
  ],
  [
    "  const capture = async (filename, observeBeforeCapture, paintTicket) => {",
    "  const capture = async (filename, observeBeforeCapture) => {"
  ],
  [
    "    await capturePaint.wait(filename, paintTicket)",
    "    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')"
  ],
  [
    "  capture.preparePaint = capturePaint.prepare\n",
    ""
  ]
]
  const present = text.includes(changes[0][0])
  if (!present) return text
  for (const [current, original] of changes) {
    assert.equal(text.split(current).length - 1, 1, 'Unique reviewed paint-ticket source change')
    text = text.replace(current, original)
  }
  return text
}
const originalCaptureLine = "    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')"
const fastCaptureLine = originalCaptureLine.replace("{ format: 'png' }", "{ format: 'png', optimizeForSpeed: true }")
assert.equal(runnerSource.split(fastCaptureLine).length, 2, 'Exactly one speed-only PNG capture change is required')
assert.equal(runnerSource.includes(originalCaptureLine), false, 'The candidate must use the unique updated capture call')
assert.equal(sha(withoutPreparedCapturePaint(runnerSource).replace(fastCaptureLine, originalCaptureLine)), 'eaf27dadcdc8a8544fefb02f78e87ad8ed0e8a853358d7a124a777f3ac6b9091')
// Keep the real runner bytes for capture/until execution; only the exact
// whole-file identity adapter above may undo its one release declaration.
const releaseIdentitySource = runnerSource.replace(/\r\n/g, '\n')
const releaseFingerprint = value => sha(withoutPreparedCapturePaint(value).replace(fastCaptureLine, originalCaptureLine))
for (const current of [releaseIdentitySource, releaseIdentitySource.replace(/\n/g, '\r\n')]) {
  assert.equal(releaseFingerprint(current), 'eaf27dadcdc8a8544fefb02f78e87ad8ed0e8a853358d7a124a777f3ac6b9091')
  const statement = "const VERSION = '4.249.2'"
  for (const replacement of ['', statement + '\n' + statement,
    "const VERSION = '4.249.0'", "const VERSION = '4.249.3'", "const  VERSION = '4.249.2'"]) {
    const changed = current.replace(statement, replacement)
    assert.notEqual(changed, current)
    assert.throws(() => releaseFingerprint(changed), { code: 'ERR_ASSERTION' })
  }
  const changed = current.replace('const API_BASE =', 'const ALTERED_API_BASE =')
  assert.notEqual(changed, current)
  assert.throws(() => assert.equal(releaseFingerprint(changed),
    'eaf27dadcdc8a8544fefb02f78e87ad8ed0e8a853358d7a124a777f3ac6b9091'), { code: 'ERR_ASSERTION' })
  for (const replacement of ['', "'installed-app-table-operations-workflow', 'installed-app-table-operations-workflow', ", "'unverified-table-workflow', "]) {
    const changed = current.replace("'installed-app-table-operations-workflow', ", replacement)
    assert.notEqual(changed, current)
    assert.throws(() => releaseFingerprint(changed), { code: 'ERR_ASSERTION' })
  }
}

function section(text, start, end) {
  assert.equal(text.split(start).length, 2, start)
  const from = text.indexOf(start), to = text.indexOf(end, from + start.length)
  assert.ok(to > from, end)
  return text.slice(from, to)
}
function declaration(prefix) {
  const matches = mainSource.split('\n').filter(line => line.startsWith(prefix))
  assert.equal(matches.length, 1, prefix)
  return matches[0]
}
const inspectorDeclaration = section(mainSource, '  const inspector = async tab => {', '\n  const selectText')
const existsDeclaration = declaration('  const exists = selector => evaluate(')
const presentDeclaration = declaration('  const present = selector => until(')
const hitDeclaration = declaration('  const hit = async selector => {')
const ensureDeclaration = section(sharedSource, 'export function ensureFullAppTargetVisible(', '\nexport function observeFullAppPopup(').replace(/^export /, '')
const untilDeclaration = section(runnerSource, 'async function until(', '\nasync function freePort(')
// The current whole files also contain unrelated decorator-keyboard and
// synchronous capture-read caching changes. Bind every closure actually
// executed below to the exact 8a02d0f source bytes, independently of that
// whole-file allowlist. Keep b3's original panel-only closure as the failing
// behavior control; its original source hash and all eleven cases remain.
for (const [name, actual, expected] of [
  ['inspector', inspectorDeclaration, mainSourceHash === '9b9872dc4a08a550c11e7127d2317bff5b0583b378869145fea39e2867eb30a2'
    ? 'a0abba44fe7f2183ca085c928812d14fa9aa6cff5a7891565e846208bc5442fe'
    : '0f71217e4404ac3d1e5f140423434984cb12a88062b12973dbaf83d886e869d2'],
  ['exists', existsDeclaration, '1c06b9c1898a0f29999480cb208c7281dd1c4bb5315c5eac91aeb961c36b3327'],
  ['present', presentDeclaration, '759872452a2fc7686d11ed842bc7ca21545aca1b05c815120f178cfdb203e15e'],
  ['hit', hitDeclaration, '041e60caee2c6d577c00fadd05709ee4bbf353009e67a10b6b216f1e6fc8496b'],
  ['ensure', ensureDeclaration, '31f6ff1b8e25c9a27c9ffef5ef3a781cf278c22308a7360585c31c0f579c992d'],
  ['until', untilDeclaration, '0b78f43c4329091d3a42b54a009e59834ada2b65d820d972a9822c5957aff196'],
]) assert.equal(sha(actual), expected, 'The executed ' + name + ' closure must retain its original source bytes')
const properties = '#inspector-tab-properties'
const history = '#inspector-tab-history'
const details = 'button[aria-label="笔记详情"]'

function fixture({ initial = 'ready', tabs = ['properties'], panel = 'properties',
  extra = '', zero = false, activate = true, onSleep = null, onEnsure = null,
  onOpen = null, clickError = null } = {}) {
  const dom = new JSDOM('<!doctype html><button aria-label="笔记详情">详情</button><div id="mount"></div>', { runScripts: 'outside-only' })
  const { window } = dom, { document } = window
  const mount = document.getElementById('mount')
  const record = { clock: 0, sleeps: [], waits: [], ensures: [], clicks: [], frames: 0, order: [] }
  const rect = (width = 100, height = 30) => ({ x: 10, y: 10, left: 10, top: 10, right: 10 + width, bottom: 10 + height, width, height })
  window.Element.prototype.getBoundingClientRect = function () {
    return this.closest('[hidden],[data-zero]') ? rect(0, 0) : rect()
  }
  window.Element.prototype.scrollIntoView = function () { throw Error('This readiness fixture must not require a scroll repair') }
  Object.defineProperty(window.performance, 'now', { value: () => record.clock })
  const mountLoading = () => { mount.innerHTML = '<aside class="inspector-panel inspector-loading">正在加载…</aside>' }
  const mountReady = ({ names = tabs, activePanel = panel, suffix = extra, zeroSize = zero } = {}) => {
    mount.innerHTML = '<aside class="inspector-panel" aria-label="笔记详情"><div class="inspector-tabs" role="tablist">' +
      names.map(name => `<button id="inspector-tab-${name}" role="tab" aria-controls="inspector-panel-${name}"${zeroSize ? ' data-zero' : ''}>${name}</button>`).join('') +
      '</div>' + (activePanel ? `<div id="inspector-panel-${activePanel}" role="tabpanel"></div>` : '') + suffix + '</aside>'
  }
  if (initial === 'loading') mountLoading()
  else if (initial === 'ready') mountReady()
  else assert.equal(initial, 'closed')
  let context
  window.sleep = async milliseconds => {
    record.sleeps.push(milliseconds); record.clock += milliseconds
    if (onSleep) await onSleep(context, milliseconds)
  }
  const originalUntil = window.eval('(' + untilDeclaration + ')')
  const until = (check, label, budget) => {
    record.waits.push({ label, explicitBudget: budget })
    return budget === undefined ? originalUntil(check, label) : originalUntil(check, label, budget)
  }
  const originalEnsure = window.eval('(' + ensureDeclaration + ')')
  const shared = { ensureVisible: async selector => {
    record.ensures.push(selector); record.order.push('ensure:' + selector)
    if (onEnsure) await onEnsure(context, selector)
    originalEnsure(selector, () => true, () => ({ bounds: { left: 0, top: 0, right: 704, bottom: 455 }, local: () => ({ x: false, y: false }) }))
    record.frames++; record.order.push('frame')
  } }
  const click = async selector => {
    record.clicks.push(selector); record.order.push('click:' + selector)
    if (clickError) throw clickError
    if (selector === details) {
      if (onOpen) await onOpen(context)
      else mountLoading()
    } else if (activate) {
      const name = selector.slice('#inspector-tab-'.length)
      const body = document.querySelector('.inspector-panel [role="tabpanel"]')
      if (body) body.id = 'inspector-panel-' + name
    }
  }
  const evaluate = async expression => window.eval(expression)
  const create = window.eval('(function(evaluate,until,shared,click){const q=JSON.stringify;\n' +
    [existsDeclaration, presentDeclaration, hitDeclaration, inspectorDeclaration].join('\n') + '\nreturn inspector})')
  const inspector = create(evaluate, until, shared, click)
  context = { document, record, mountReady, mountLoading, run: tab => inspector(tab), close: () => window.close() }
  return context
}
async function withFixture(options, check) {
  const value = fixture(options)
  try { await check(value) } finally { value.close() }
}
const originalRefusal = /Missing or ambiguous actual scroll target/
const oneClick = selector => ['ensure:' + selector, 'frame', 'click:' + selector]

test('inspector waits for its requested tab while the shipped Suspense fallback already matches the panel', async () => {
  await withFixture({ initial: 'loading', onSleep: value => value.mountReady() }, async value => {
    await value.run('properties')
    assert.deepEqual(value.record.clicks, [properties])
    assert.deepEqual(value.record.order, oneClick(properties))
    assert.deepEqual(value.record.sleeps, [100])
    assert.equal(value.record.clock, 100)
    assert.ok(value.record.waits.every(wait => wait.explicitBudget === undefined))
  })
})

test('already mounted properties retains one target click and its original content-panel wait', async () => {
  await withFixture({}, async value => {
    await value.run('properties')
    assert.deepEqual(value.record.order, oneClick(properties))
    assert.deepEqual(value.record.sleeps, [])
    assert.equal(value.record.waits.length, 2)
    assert.equal(value.record.waits[1].label, 'Actual editor UI missing: #inspector-panel-properties')
  })
})

test('opening a closed inspector emits one details click then waits before the requested tab click', async () => {
  await withFixture({ initial: 'closed', onSleep: value => value.mountReady() }, async value => {
    await value.run('properties')
    assert.deepEqual(value.record.clicks, [details, properties])
    assert.deepEqual(value.record.order, [...oneClick(details), ...oneClick(properties)])
    assert.deepEqual(value.record.sleeps, [100])
  })
})

test('a never-mounted requested tab keeps the original 15000ms deadline and dispatches no input', async () => {
  await withFixture({ initial: 'loading' }, async value => {
    let failure
    try { await value.run('properties') } catch (error) { failure = error }
    assert.ok(failure)
    assert.equal(value.record.clock, 15000)
    assert.equal(value.record.sleeps.length, 150)
    assert.ok(value.record.sleeps.every(milliseconds => milliseconds === 100))
    assert.equal(failure.message, 'Actual editor UI missing: #inspector-tab-properties')
    assert.deepEqual(value.record.ensures, [])
    assert.deepEqual(value.record.clicks, [])
    assert.equal(value.record.waits.length, 1)
    assert.equal(value.record.waits[0].explicitBudget, undefined)
  })
})

test('a zero-size requested tab retains the original scroll-target refusal without a click', async () => {
  await withFixture({ zero: true }, async value => {
    await assert.rejects(value.run('properties'), originalRefusal)
    assert.deepEqual(value.record.ensures, [properties])
    assert.deepEqual(value.record.clicks, [])
    assert.deepEqual(value.record.sleeps, [])
    assert.equal(value.record.frames, 0)
  })
})

test('two visible requested tabs retain the original ambiguity refusal without retry', async () => {
  await withFixture({ extra: '<button id="inspector-tab-properties">duplicate</button>' }, async value => {
    await assert.rejects(value.run('properties'), originalRefusal)
    assert.deepEqual(value.record.ensures, [properties])
    assert.deepEqual(value.record.clicks, [])
    assert.deepEqual(value.record.sleeps, [])
    assert.equal(value.record.frames, 0)
  })
})

test('one visible tab and a hidden duplicate preserve the original positive-dimensions filtering', async () => {
  await withFixture({ extra: '<button id="inspector-tab-properties" hidden>hidden duplicate</button>' }, async value => {
    await value.run('properties')
    assert.deepEqual(value.record.order, oneClick(properties))
    assert.deepEqual(value.record.sleeps, [])
  })
})

test('a tab disappearing after readiness keeps the first real visibility error and is not replayed', async () => {
  await withFixture({ onEnsure: (value, selector) => value.document.querySelector(selector).remove() }, async value => {
    await assert.rejects(value.run('properties'), originalRefusal)
    assert.deepEqual(value.record.ensures, [properties])
    assert.deepEqual(value.record.clicks, [])
    assert.deepEqual(value.record.sleeps, [])
    assert.equal(value.record.waits.length, 1)
  })
})

test('a visible properties tab cannot satisfy readiness for the requested history tab', async () => {
  await withFixture({ tabs: ['properties'], onSleep: value => value.mountReady({ names: ['properties', 'history'] }) }, async value => {
    await value.run('history')
    assert.deepEqual(value.record.clicks, [history])
    assert.deepEqual(value.record.order, oneClick(history))
    assert.deepEqual(value.record.sleeps, [100])
    assert.equal(value.document.querySelector('#inspector-panel-history')?.getAttribute('role'), 'tabpanel')
  })
})

test('a missing requested content panel retains the original post-click wait and deadline', async () => {
  await withFixture({ tabs: ['properties', 'history'], activate: false }, async value => {
    await assert.rejects(value.run('history'), /Actual editor UI missing: #inspector-panel-history/)
    assert.deepEqual(value.record.order, oneClick(history))
    assert.equal(value.record.waits.length, 2)
    assert.equal(value.record.clock, 15000)
    assert.equal(value.record.sleeps.length, 150)
    assert.ok(value.record.waits.every(wait => wait.explicitBudget === undefined))
  })
})

test('an original click failure remains primary and never causes another wait or click', async () => {
  const failure = new Error('original-pointer-failure')
  await withFixture({ clickError: failure }, async value => {
    await assert.rejects(value.run('properties'), error => error === failure)
    assert.deepEqual(value.record.order, oneClick(properties))
    assert.equal(value.record.waits.length, 1)
    assert.deepEqual(value.record.sleeps, [])
  })
})
