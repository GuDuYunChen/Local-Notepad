// @vitest-environment node
import { test } from 'vitest'
import { registerInspectionFixtureTests } from '../scripts/s3-inspection-fixture-cases.mjs'
registerInspectionFixtureTests(test)
