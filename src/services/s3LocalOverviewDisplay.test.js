// @vitest-environment node
import { test } from 'vitest'
import { registerLocalComparisonDisplayTests } from '../../scripts/s3-local-overview-display-cases.mjs'
registerLocalComparisonDisplayTests(test)
