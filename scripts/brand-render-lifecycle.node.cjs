const { test } = require('node:test')
const { registerBrandLifecycleTests } = require('./brand-render-lifecycle-cases.cjs')
registerBrandLifecycleTests(test)
