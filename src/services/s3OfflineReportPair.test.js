// @vitest-environment node
import { test } from 'vitest'
import { registerOfflinePairTests } from '../../scripts/s3-offline-report-pair-cases.mjs'
registerOfflinePairTests(test)
