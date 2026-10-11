// @vitest-environment node
import { test } from 'vitest'
import { registerOfflinePairDirectionTests } from '../../scripts/s3-offline-pair-direction-cases.mjs'
registerOfflinePairDirectionTests(test)
