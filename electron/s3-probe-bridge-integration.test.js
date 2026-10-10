// @vitest-environment node
import { test } from 'vitest'
import { registerS3ProbeBridgeTests } from '../scripts/s3-probe-bridge-cases.mjs'
registerS3ProbeBridgeTests(test)
