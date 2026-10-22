// @vitest-environment node
import { test } from 'vitest'
import { registerReportHoverTests } from '../../scripts/s3-local-report-hover-cases.mjs'
registerReportHoverTests(test)
