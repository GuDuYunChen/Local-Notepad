// @vitest-environment node
import { test } from 'vitest'
import { registerOfflineBatchDropTests } from '../../scripts/s3-offline-batch-drop-cases.mjs'
registerOfflineBatchDropTests(test)
