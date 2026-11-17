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
assert.ok([
  '9b9872dc4a08a550c11e7127d2317bff5b0583b378869145fea39e2867eb30a2',
  '1779b317c0b27a29d5f42015726a5df6c8cbfb322e3cb1ec87445e3716fff661',
].includes(sha(mainSource)), 'The behavior control must use actual b3 or this frozen one-line candidate')
assert.equal(sha(sharedSource), '5b819baf8153bc992168ff45c1408f9a53bbf6c57c41631e341fa984813861f9')
const originalCaptureLine = "    const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')"
const fastCaptureLine = originalCaptureLine.replace("{ format: 'png' }", "{ format: 'png', optimizeForSpeed: true }")
assert.equal(runnerSource.split(fastCaptureLine).length, 2, 'Exactly one speed-only PNG capture change is required')
assert.equal(runnerSource.includes(originalCaptureLine), false, 'The candidate must use the unique updated capture call')
assert.equal(sha(runnerSource.replace(fastCaptureLine, originalCaptureLine)), 'eaf27dadcdc8a8544fefb02f78e87ad8ed0e8a853358d7a124a777f3ac6b9091')

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
