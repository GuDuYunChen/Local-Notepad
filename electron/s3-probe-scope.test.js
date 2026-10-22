// @vitest-environment node
import { test } from 'vitest'
import { registerS3ProbeScopeTests } from '../scripts/s3-probe-scope-cases.mjs'
registerS3ProbeScopeTests(test)
