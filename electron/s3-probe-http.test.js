// @vitest-environment node
import { test, afterAll } from 'vitest'
import { registerS3ProbeHTTPTests } from '../scripts/s3-probe-http-cases.mjs'
import { registerS3PreviewHTTPTests } from '../scripts/s3-preview-http-cases.mjs'
const fixture = registerS3ProbeHTTPTests(test)
registerS3PreviewHTTPTests(test, fixture)
afterAll(() => fixture.close())
import { verifyS3ProbeBackendContract } from '../scripts/s3-probe-backend-cases.mjs'
test('Node IPC to actual standard-library Go handler contract', async () => {
  await fixture.close() // Hand over the owned port once, before the existing Go fixture.
  await verifyS3ProbeBackendContract()
}, 120000)
