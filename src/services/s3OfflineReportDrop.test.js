// @vitest-environment node
import { test } from 'vitest'
import { registerOfflineReportDropTests } from '../../scripts/s3-offline-report-drop-cases.mjs'
registerOfflineReportDropTests(test)
