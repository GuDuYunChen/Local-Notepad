const test = require('node:test'), assert = require('node:assert/strict')
const { verifyHelpNavigationScene } = require('./sync-help-navigation-evidence.cjs')
function scene() {
  const base = { requests: 0, navigationCalls: 0, otherOverviewOpen: false, activeMarkup: 0,
    stableSamples: 3, overflow: 0, colors: Array.from({ length: 10 }, () => ({ final: true, ratio: 7 })), readOnlyHelp: true }
  return { name: 'recovery-narrow', retainedAfterUpdate: true,
    before: { ...base, helpOpen: false, openTopics: [] },
    after: { ...base, helpOpen: true, openTopics: ['recovery'], focusedTopic: 'recovery' } }
}
test('accepts complete semantic scene metadata (not a PNG/render substitute)', () => assert.doesNotThrow(() => verifyHelpNavigationScene(scene())))
test('rejects unexercised, wrong or cross-instance navigation', () => {
  for (const change of [s=>s.after.helpOpen=false,s=>s.after.openTopics=['operations'],s=>s.after.focusedTopic='',s=>s.after.otherOverviewOpen=true,s=>s.retainedAfterUpdate=false]) {
    const s=scene();change(s);assert.throws(()=>verifyHelpNavigationScene(s))
  }
})
test('rejects side effects and omitted read-only boundaries', () => {
  for (const change of [s=>s.after.requests=1,s=>s.after.navigationCalls=1,s=>s.after.activeMarkup=1,s=>s.after.readOnlyHelp=false,s=>s.after.extra='NAV_PRIVATE']) {
    const s=scene();change(s);assert.throws(()=>verifyHelpNavigationScene(s))
  }
})
test('rejects unstable or unreadable evidence and initially auto-opened help', () => {
  for (const change of [s=>s.after.stableSamples=2,s=>s.after.overflow=8,s=>s.after.colors[0].ratio=2,s=>s.before.helpOpen=true]) {
    const s=scene();change(s);assert.throws(()=>verifyHelpNavigationScene(s))
  }
})
