// @vitest-environment node
import { test } from 'vitest'
import { registerLocalFileFailureDeadlineTests } from '../../scripts/s3-local-file-failure-deadline-cases.mjs'
registerLocalFileFailureDeadlineTests(test)
