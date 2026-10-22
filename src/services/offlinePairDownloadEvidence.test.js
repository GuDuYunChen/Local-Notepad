// @vitest-environment node
import { test } from 'vitest'
import { registerOfflineDownloadEvidenceTests } from '../../scripts/offline-pair-download-evidence-cases.mjs'
registerOfflineDownloadEvidenceTests(test)
