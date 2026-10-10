// @vitest-environment node
import { test } from 'vitest'
import { registerS3ReadProbeTests } from '../../scripts/s3-read-probe-cases.mjs'
registerS3ReadProbeTests(test)
