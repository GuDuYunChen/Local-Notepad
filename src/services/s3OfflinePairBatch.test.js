// @vitest-environment node
import { test } from 'vitest'
import { registerOfflinePairBatchTests } from '../../scripts/s3-offline-pair-batch-cases.mjs'
registerOfflinePairBatchTests(test)
