// @vitest-environment node
import { test } from 'vitest'
import { registerLocalComparisonTests } from '../../scripts/s3-local-overview-comparison-cases.mjs'
registerLocalComparisonTests(test)
