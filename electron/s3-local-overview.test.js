// @vitest-environment node
import { test } from 'vitest'
import { registerS3LocalOverviewTests } from '../scripts/s3-local-overview-cases.mjs'
registerS3LocalOverviewTests(test)
