// @vitest-environment node
import { test } from 'vitest'
import { registerOfflinePairOrderTests } from '../../scripts/s3-offline-pair-order-cases.mjs'
registerOfflinePairOrderTests(test)
