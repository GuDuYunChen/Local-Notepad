// @vitest-environment node
import { test } from 'vitest'
import { registerLocalOverviewReportTests } from '../../scripts/s3-local-overview-report-cases.mjs'
registerLocalOverviewReportTests(test)
