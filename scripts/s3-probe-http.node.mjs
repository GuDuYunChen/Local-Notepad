import test, { after } from 'node:test'
import { registerS3ProbeHTTPTests } from './s3-probe-http-cases.mjs'
import { registerS3PreviewHTTPTests } from './s3-preview-http-cases.mjs'
const fixture = registerS3ProbeHTTPTests(test)
registerS3PreviewHTTPTests(test, fixture)
after(() => fixture.close())
import { verifyS3ProbeBackendContract } from './s3-probe-backend-cases.mjs'
test('Node IPC to actual standard-library Go handler contract', { timeout: 120000 }, async t => {
  await fixture.close() // Hand over the owned port once, before the existing Go fixture.
  const result = await verifyS3ProbeBackendContract()
  t.diagnostic(JSON.stringify(result))
})
