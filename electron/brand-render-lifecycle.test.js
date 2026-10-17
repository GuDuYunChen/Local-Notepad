// @vitest-environment node
import { test } from 'vitest'
import cases from '../scripts/brand-render-lifecycle-cases.cjs'
cases.registerBrandLifecycleTests(test)
