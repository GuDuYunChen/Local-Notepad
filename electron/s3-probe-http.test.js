// @vitest-environment node
import { test } from 'vitest'
import { registerS3ProbeHTTPTests } from '../scripts/s3-probe-http-cases.mjs'
registerS3ProbeHTTPTests(test)
import { verifyS3ProbeBackendContract } from '../scripts/s3-probe-backend-cases.mjs'
test('Node IPC to actual standard-library Go handler contract', async () => {
  await verifyS3ProbeBackendContract()
}, 120000)
