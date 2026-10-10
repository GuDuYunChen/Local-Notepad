// @vitest-environment node
import { test } from 'vitest'
import { registerComparisonExportTests } from '../../scripts/s3-local-comparison-export-cases.mjs'
registerComparisonExportTests(test)
