// @vitest-environment node
import { test } from 'vitest'
import { registerOfflinePairScopeTests } from '../../scripts/s3-offline-pair-scope-cases.mjs'
registerOfflinePairScopeTests(test)
