// @vitest-environment node
import { test } from 'vitest'
import { registerOfflinePairSummaryTests } from '../../scripts/s3-offline-pair-summary-cases.mjs'
registerOfflinePairSummaryTests(test)
