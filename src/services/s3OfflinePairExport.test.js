// @vitest-environment node
import { test } from 'vitest'
import { registerOfflinePairExportTests } from '../../scripts/s3-offline-pair-export-cases.mjs'
registerOfflinePairExportTests(test)
