// @vitest-environment node
import { test } from 'vitest'
import { registerS3ProbeBindingTests } from '../../scripts/s3-probe-binding-cases.mjs'
registerS3ProbeBindingTests(test)
