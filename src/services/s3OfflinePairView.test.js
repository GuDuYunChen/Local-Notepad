// @vitest-environment node
import { test } from 'vitest'
import { registerOfflinePairViewTests } from '../../scripts/s3-offline-pair-view-cases.mjs'
registerOfflinePairViewTests(test)
