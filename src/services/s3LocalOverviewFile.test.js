// @vitest-environment node
import { test } from 'vitest'
import { registerLocalOverviewFileTests } from '../../scripts/s3-local-overview-file-cases.mjs'
registerLocalOverviewFileTests(test)
