import test from 'node:test'
import { registerS3ProbeHTTPTests } from './s3-probe-http-cases.mjs'
registerS3ProbeHTTPTests(test)
import { verifyS3ProbeBackendContract } from './s3-probe-backend-cases.mjs'
test('Node IPC to actual standard-library Go handler contract', { timeout: 120000 }, async t => {
  const result = await verifyS3ProbeBackendContract()
  t.diagnostic(JSON.stringify(result))
})
