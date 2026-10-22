// @vitest-environment node
import { test } from 'vitest'
import { registerLocalReportDropTests } from '../../scripts/s3-local-report-drop-cases.mjs'
registerLocalReportDropTests(test)
