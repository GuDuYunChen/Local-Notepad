// @vitest-environment node
import { test } from 'vitest'
import { registerLocalOverviewAuthTests } from '../scripts/s3-local-overview-auth-cases.mjs'
registerLocalOverviewAuthTests(test)
