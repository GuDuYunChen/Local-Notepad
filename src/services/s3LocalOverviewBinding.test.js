// @vitest-environment node
import { test } from 'vitest'
import { registerS3LocalOverviewBindingTests } from '../../scripts/s3-local-overview-binding-cases.mjs'
registerS3LocalOverviewBindingTests(test)
