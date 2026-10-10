// @vitest-environment node
import { test } from 'vitest'
import { registerS3LocalOverviewFailureDeadlineTests } from '../../scripts/s3-local-overview-failure-deadline-cases.mjs'
registerS3LocalOverviewFailureDeadlineTests(test)
