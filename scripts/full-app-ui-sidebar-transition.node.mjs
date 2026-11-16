import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { ensureNavigationSidebar } from './full-app-ui-navigation.mjs'

// Deterministic DOM/CDP scheduling model. This does not reproduce or establish
// the time of the incomplete Windows run, and is not a native browser test.
function sidebarModel(options = {}) {
  const state = { collapsed: options.collapsed ?? true, width: options.width ?? 704,
    loading: false, missingTree: false, frames: 0, ticks: 0 }
  const clicks = [], waits = [], observers = [], listenerErrors = [], mutations = []
  const report = options.report ?? { fullAppUi: {} }
  let saves = 0, currentOwner, initialOwner
  const listeners = new Map()
  const makeOwner = () => {
    const expand = { disabled: false, getBoundingClientRect: () => ({ width: state.collapsed && !state.hiddenExpand ? 40 : 0, height: 40 }),
      contains: target => target === expand, getAttribute: key => key === 'aria-label' ? '展开侧边栏' : null }
    const library = { querySelector: selector => selector === '.tree-list' ? (state.missingTree ? null : {})
      : selector === ':scope > .placeholder' ? (state.loading ? {} : null) : null }
    const owner = {
      classList: { contains: name => name === 'collapsed' && state.collapsed },
      getAttribute: name => name === 'class' ? 'workspace-sidebar' + (state.collapsed ? ' collapsed' : '') : null,
      querySelector: selector => selector === '.file-list' ? (state.collapsed ? null : library)
        : selector === 'button[aria-label="展开侧边栏"]' ? (state.collapsed ? expand : null) : null,
      addEventListener(type, listener, capture) {
        assert.equal(type, 'click'); assert.equal(capture, true)
        if (options.installListenerError) throw options.installListenerError
        listeners.set(listener, { owner, type })
      },
      removeEventListener(type, listener, capture) {
        assert.equal(type, 'click'); assert.equal(capture, true)
        if (options.removeListenerError) { listenerErrors.push(options.removeListenerError); throw options.removeListenerError }
        listeners.delete(listener)
      }, expand,
    }
    return owner
  }
  currentOwner = initialOwner = makeOwner()
  const document = {
    querySelector(selector) {
      if (selector === '.workspace-sidebar') return options.absent ? null : currentOwner
      if (selector === '.workspace-sidebar [aria-label="展开侧边栏"]') {
        options.beforeInitialSelector?.(model)
        return state.collapsed ? currentOwner.expand : null
      }
      if (selector === '.workspace-sidebar [aria-label="折叠侧边栏"]') return state.collapsed ? null : {}
      if (selector === '.file-list') return currentOwner.querySelector('.file-list')
      throw Error('Unexpected model selector: ' + selector)
    },
  }
  class ModelMutationObserver {
    constructor(callback) {
      if (options.constructError) throw options.constructError
      this.callback = callback; this.records = []; this.active = false; this.disconnectCalls = 0; observers.push(this)
    }
    observe(owner, configuration) {
      assert.equal(owner, initialOwner)
      assert.equal(configuration.attributes, true)
      assert.deepEqual([...configuration.attributeFilter], ['class'])
      assert.equal(configuration.attributeOldValue, true)
      if (options.observeError) throw options.observeError
      this.active = true
    }
    takeRecords() { const records = this.records; this.records = []; return records }
    disconnect() {
      this.disconnectCalls++
      if (options.disconnectError) throw options.disconnectError
      this.active = false; this.records = []
    }
  }
  const mutate = collapsed => {
    const oldValue = currentOwner.getAttribute('class')
    state.collapsed = collapsed
    if (oldValue === currentOwner.getAttribute('class')) return
    const record = { target: currentOwner, type: 'attributes', attributeName: 'class', oldValue }
    mutations.push({ oldValue, collapsed })
    for (const observer of observers) if (observer.active) observer.records.push(record)
  }
  const flush = () => {
    for (const observer of observers) if (observer.active && observer.records.length) observer.callback(observer.takeRecords())
  }
  const clickEvent = (target, trusted) => {
    for (const [listener, entry] of listeners) if (entry.owner === currentOwner) listener({ type: 'click', target, isTrusted: trusted })
  }
  const context = {
    report, matrix: { theme: 'light', viewport: { width: state.width, height: 455 } },
    save() { saves++; if (options.saveError) throw options.saveError },
    async evaluate(expression) {
      if (expression.endsWith(',"dispose")')) options.beforeDispose?.(model)
      const value = await runInNewContext(expression, {
        document, innerWidth: state.width,
        MutationObserver: options.observerMissing ? undefined : ModelMutationObserver,
        performance: { now: () => ++state.ticks },
        requestAnimationFrame: callback => {
          state.frames++; options.onPaint?.(model, state.frames); flush(); callback(); return state.frames
        },
      })
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
    },
    async click(selector) {
      clicks.push(selector)
      const number = clicks.length
      options.beforeClick?.(model, number)
      if (options.failedClick === number) throw options.clickError
      const expand = selector.includes('展开侧边栏')
      const target = options.wrongClickTarget && number === 1 ? {} : currentOwner.expand
      if (expand && !options.noClickEvent) clickEvent(target, options.untrustedClick !== number)
      if (!options.noExpansion) mutate(!expand)
      if (options.earlyCollapse && number === 1) mutate(true)
      if (options.secondCollapse && number === 2) mutate(true)
      options.afterClick?.(model, number)
      // Both class changes can belong to a single callback batch. oldValue is
      // needed to recover the intermediate expanded value from final collapsed.
      flush()
    },
    async until(check, label, ...budgetArguments) {
      waits.push({ label, budgetArguments })
      const phase = label === 'Actual sidebar did not change expansion state' ? 'expansion' : 'library'
      for (let poll = 0; poll < 8; poll++) {
        options.beforePoll?.(model, phase, poll); flush()
        if (await check()) return true
      }
      throw Error(label)
    },
  }
  const model = { state, context, clicks, waits, observers, listeners, document, report, mutations,
    mutate, flush, replaceOwner: () => { currentOwner = makeOwner() },
    saves: () => saves, initialOwner, listenerErrors }
  return model
}

const clean = model => {
  assert.ok(model.observers.every(observer => !observer.active && observer.disconnectCalls === 1))
  assert.equal(model.listeners.size, 0)
  assert.deepEqual(Object.keys(model.document), ['querySelector'])
}
const twoDefaultWaits = model => {
  assert.deepEqual(model.waits, [
    { label: 'Actual sidebar did not change expansion state', budgetArguments: [] },
    { label: 'Actual navigation surface missing: .file-list', budgetArguments: [] },
  ])
}

test('early native expansion and re-collapse before the first poll permits one evidenced correction', async () => {
  const model = sidebarModel({ earlyCollapse: true })
  await ensureNavigationSidebar(model.context, true)
  assert.equal(model.clicks.length, 2); assert.equal(model.state.collapsed, false); assert.equal(model.state.frames, 2)
  twoDefaultWaits(model); clean(model)
  const receipt = model.report.fullAppUi.navigationSidebarEarlyCorrection
  assert.equal(receipt.complete, true); assert.equal(receipt.earlyCorrectionUsed, true)
  assert.equal(receipt.observation.initialTrustedClicks, 1); assert.equal(receipt.observation.correctiveTrustedClicks, 1)
  assert.equal(receipt.observation.mutationCollapseAfterExpansion, true)
  assert.ok(receipt.observation.transitions.some(row => row.from === false && row.to === true && row.source === 'mutation'))
  assert.equal(model.saves(), 1)
})

test('an initially expanded owner may correct one observed pre-poll collapse without an initial click', async () => {
  const model = sidebarModel({ collapsed: false, beforePoll: (m, phase, poll) => {
    if (phase === 'expansion' && poll === 0) m.mutate(true)
  } })
  await ensureNavigationSidebar(model.context, true)
  assert.equal(model.clicks.length, 1); twoDefaultWaits(model); clean(model)
  const receipt = model.report.fullAppUi.navigationSidebarEarlyCorrection
  assert.equal(receipt.observation.entryCollapsed, false)
  assert.equal(receipt.observation.initialAttempted, false)
  assert.equal(receipt.observation.initialTrustedClicks, 0)
  assert.equal(receipt.observation.correctiveTrustedClicks, 1)
})

test('an acknowledged click without an actual expanded transition is never retried', async () => {
  const model = sidebarModel({ noExpansion: true })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 1); assert.equal(model.waits.length, 1); clean(model)
})

test('missing observer API refuses the new early correction path', async () => {
  const model = sidebarModel({ observerMissing: true, earlyCollapse: true })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 1); assert.equal(model.observers.length, 0); clean(model)
})

test('an unowned expansion after a collapsed entry cannot substitute for the initial trusted click', async () => {
  const model = sidebarModel({ beforeInitialSelector: m => { m.mutate(false); m.flush() },
    beforePoll: (m, phase, poll) => { if (phase === 'expansion' && poll === 0) m.mutate(true) } })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 0); clean(model)
})

test('a hidden expansion button refuses an otherwise evidenced early correction', async () => {
  const model = sidebarModel({ earlyCollapse: true, afterClick: (m, number) => { if (number === 1) m.state.hiddenExpand = true } })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('transition overflow is rejected and retains only the fixed diagnostic capacity', async () => {
  const model = sidebarModel({ afterClick: m => { for (let index = 0; index < 12; index++) m.mutate(index % 2 === 0) } })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /sidebar transition observation overflow/)
  assert.equal(model.clicks.length, 1); clean(model)
  assert.equal(model.report.fullAppUi.navigationSidebarFailure.observation.transitions.length, 8)
  assert.equal(model.report.fullAppUi.navigationSidebarFailure.observation.overflow, true)
  assert.equal(model.saves(), 1)
})

test('synthetic initial click cannot qualify a pre-poll correction', async () => {
  const model = sidebarModel({ earlyCollapse: true, untrustedClick: 1 })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('a different button click cannot qualify the observed early expansion', async () => {
  const model = sidebarModel({ earlyCollapse: true, wrongClickTarget: true })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('a missing native click event cannot be replaced by dispatch completion', async () => {
  const model = sidebarModel({ earlyCollapse: true, noClickEvent: true })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('wide-window early collapse never receives a corrective click', async () => {
  const model = sidebarModel({ width: 1008, earlyCollapse: true })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('replaced sidebar owner is refused even if the replacement is expanded', async () => {
  const model = sidebarModel({ beforePoll: (m, phase, poll) => {
    if (phase === 'expansion' && poll === 0) m.replaceOwner()
  } })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /sidebar.*owner|owner.*sidebar/i)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('a second collapse cannot consume a third native pointer expansion', async () => {
  const model = sidebarModel({ earlyCollapse: true, secondCollapse: true })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 2); clean(model)
})

test('an uncertain initial native click is propagated without replay', async () => {
  const failure = Error('uncertain original native click')
  const model = sidebarModel({ failedClick: 1, clickError: failure })
  await assert.rejects(ensureNavigationSidebar(model.context, true), error => error === failure)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('an uncertain corrective click consumes its sole allowance and propagates', async () => {
  const failure = Error('uncertain corrective native click')
  const model = sidebarModel({ earlyCollapse: true, failedClick: 2, clickError: failure })
  await assert.rejects(ensureNavigationSidebar(model.context, true), error => error === failure)
  assert.equal(model.clicks.length, 2); clean(model)
})

test('a synthetic corrective click is rejected even when expanded state is visible', async () => {
  const model = sidebarModel({ earlyCollapse: true, untrustedClick: 2 })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /trusted.*corrective|corrective.*trusted/i)
  assert.equal(model.clicks.length, 2); clean(model)
})

test('observer construction failure is not treated as an unsupported API', async () => {
  const failure = Error('observer constructor failure')
  const model = sidebarModel({ constructError: failure })
  await assert.rejects(ensureNavigationSidebar(model.context, true), error => error === failure)
  assert.equal(model.clicks.length, 0); clean(model)
})

test('observe installation failure is retained and its allocated observer is disposed', async () => {
  const failure = Error('observe installation failure')
  const model = sidebarModel({ observeError: failure })
  await assert.rejects(ensureNavigationSidebar(model.context, true), error => error === failure)
  assert.equal(model.clicks.length, 0); clean(model)
})

test('click listener installation failure is retained without falling back', async () => {
  const failure = Error('listener installation failure')
  const model = sidebarModel({ installListenerError: failure })
  await assert.rejects(ensureNavigationSidebar(model.context, true), error => error === failure)
  assert.equal(model.clicks.length, 0); clean(model)
})

test('observer disposal failure cannot produce a successful navigation result', async () => {
  const failure = Error('observer disconnect failure')
  const model = sidebarModel({ disconnectError: failure })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /observer disconnect failure/)
  assert.equal(model.observers[0].disconnectCalls, 1)
  assert.equal(model.listeners.size, 0)
  assert.deepEqual(Object.keys(model.document), ['querySelector'])
})

test('listener disposal failure cannot silently pass after the observer disconnects', async () => {
  const failure = Error('click listener removal failure')
  const model = sidebarModel({ removeListenerError: failure })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /click listener removal failure/)
  assert.equal(model.observers[0].active, false)
  assert.deepEqual(Object.keys(model.document), ['querySelector'])
})

test('the complete tree/loading and double-paint requirement still decides readiness', async () => {
  const model = sidebarModel({ earlyCollapse: true, afterClick: (m, number) => { if (number === 2) m.state.loading = true } })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual navigation surface missing: \.file-list/)
  assert.equal(model.clicks.length, 2); assert.equal(model.state.frames, 0); twoDefaultWaits(model); clean(model)
})

test('post-paint collapse uses the same sole correction allowance', async () => {
  const model = sidebarModel({ earlyCollapse: true, onPaint: (m, frame) => { if (frame === 2) m.mutate(true) } })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual navigation surface missing: \.file-list/)
  assert.equal(model.clicks.length, 2); assert.equal(model.state.frames, 2); clean(model)
})

test('original sampled late-collapse path remains available without observer APIs', async () => {
  const model = sidebarModel({ observerMissing: true, beforePoll: (m, phase, poll) => {
    if (phase === 'library' && poll === 0) m.mutate(true)
  } })
  await ensureNavigationSidebar(model.context, true)
  assert.equal(model.clicks.length, 2); assert.equal(model.state.frames, 2); twoDefaultWaits(model); clean(model)
  assert.equal(model.report.fullAppUi.navigationSidebarEarlyCorrection, undefined)
})

test('explicit collapse keeps its original single wait and needs no observer', async () => {
  const model = sidebarModel({ collapsed: false, constructError: Error('must not install on collapse') })
  await ensureNavigationSidebar(model.context, false)
  assert.deepEqual(model.clicks, ['.workspace-sidebar [aria-label="折叠侧边栏"]'])
  assert.deepEqual(model.waits, [{ label: 'Actual sidebar did not change expansion state', budgetArguments: [] }])
  assert.equal(model.observers.length, 0); clean(model)
})

test('diagnostics retain one first early receipt and one bounded failure slot without per-poll saves', async () => {
  const report = { fullAppUi: {} }
  const first = sidebarModel({ report, earlyCollapse: true })
  await ensureNavigationSidebar(first.context, true)
  const retained = report.fullAppUi.navigationSidebarEarlyCorrection
  assert.ok(retained); assert.ok(retained.observation.transitions.length <= 8); assert.equal(first.saves(), 1)
  const second = sidebarModel({ report, earlyCollapse: true })
  await ensureNavigationSidebar(second.context, true)
  assert.equal(report.fullAppUi.navigationSidebarEarlyCorrection, retained); assert.equal(second.saves(), 0)
  const failed = sidebarModel({ report, noExpansion: true })
  await assert.rejects(ensureNavigationSidebar(failed.context, true))
  assert.equal(report.fullAppUi.navigationSidebarEarlyCorrection, retained)
  assert.equal(report.fullAppUi.navigationSidebarFailure.complete, false)
  assert.ok(report.fullAppUi.navigationSidebarFailure.observation.transitions.length <= 8)
  assert.equal(failed.saves(), 1)
  assert.ok(JSON.stringify(report.fullAppUi).length < 6000)
  clean(first); clean(second); clean(failed)
})

test('a transition before initial arming cannot authorize replay of a later click that never expanded', async () => {
  const model = sidebarModel({ noExpansion: true, beforeInitialSelector: m => {
    m.mutate(false); m.mutate(true); m.flush()
  } })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('an armed but pre-click transition cannot authorize replay after the trusted click never expands', async () => {
  const model = sidebarModel({ noExpansion: true, beforeClick: (m, number) => {
    if (number === 1) { m.mutate(false); m.mutate(true); m.flush() }
  } })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual sidebar did not change expansion state/)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('owner replacement between final ready read and disposal is rejected after cleanup', async () => {
  const model = sidebarModel({ beforeDispose: m => m.replaceOwner() })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /sidebar.*owner|owner.*sidebar/i)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('pending transition overflow first drained during disposal is rejected after cleanup', async () => {
  const model = sidebarModel({ beforeDispose: m => {
    for (let index = 0; index < 12; index++) m.mutate(index % 2 === 0)
  } })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /sidebar transition observation overflow/)
  assert.equal(model.clicks.length, 1); clean(model)
  assert.equal(model.report.fullAppUi.navigationSidebarFailure.observation.transitions.length, 8)
  assert.equal(model.report.fullAppUi.navigationSidebarFailure.observation.overflow, true)
})

test('a last-moment collapse cannot pass when the disposal snapshot is no longer ready', async () => {
  const model = sidebarModel({ beforeDispose: m => m.mutate(true) })
  await assert.rejects(ensureNavigationSidebar(model.context, true), /Actual navigation surface missing: \.file-list/)
  assert.equal(model.clicks.length, 1); clean(model)
})

test('diagnostic save failure preserves the original native input failure as well', async () => {
  const original = Error('uncertain original native input')
  const saveError = Error('failure receipt persistence failed')
  const model = sidebarModel({ failedClick: 1, clickError: original, saveError })
  await assert.rejects(ensureNavigationSidebar(model.context, true), error => error instanceof AggregateError &&
    error.errors.includes(original) && error.errors.includes(saveError))
  assert.equal(model.clicks.length, 1); assert.equal(model.saves(), 1); clean(model)
})
