import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { verifyFixtureRequest, createInspectionFixture, FIXTURE_PATH, FIXTURE_ID, FIXTURE_SECRET, FIXTURE_TOKEN } from './s3-inspection-fixture.mjs'
const sha = x => createHash('sha256').update(x).digest('hex')
const hmac = (k, x) => createHmac('sha256', k).update(x).digest()
function signed(host = '127.0.0.1:12345') {
  const date = '20261012T000000Z', scope = '20261012/us-east-1/s3/aws4_request'
  const headers = { host, 'x-amz-content-sha256': sha(''), 'x-amz-date': date, 'x-amz-security-token': FIXTURE_TOKEN }
  const names = Object.keys(headers).sort()
  const canonical = `GET\n${FIXTURE_PATH}\n\n${names.map(n => n + ':' + headers[n] + '\n').join('')}\n${names.join(';')}\n${sha('')}`
  let key = Buffer.from('AWS4' + FIXTURE_SECRET)
  for (const part of scope.split('/')) key = hmac(key, part)
  const signature = hmac(key, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha(canonical)}`).toString('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${FIXTURE_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
  return { method: 'GET', url: FIXTURE_PATH, headers }
}
export function registerInspectionFixtureTests(test) {
registerInspectionSeparatorTests(test)
test('fixture independently verifies signed UTF-8 prefix/key including literal percent', () => {
  assert.ok(FIXTURE_PATH.includes('%252F'))
  verifyFixtureRequest(signed(), Buffer.alloc(0), '127.0.0.1:12345')
})
for (const [name, change] of [
  ['write method', r => { r.method = 'PUT' }],
  ['changed key', r => { r.url += 'x' }],
  ['decoded percent', r => { r.url = r.url.replace('%252F', '%2F') }],
  ['different host', r => { r.headers.host = 'evil.example' }],
  ['unsigned request', r => { delete r.headers.authorization }],
  ['tampered signature', r => { r.headers.authorization = r.headers.authorization.replace(/.$/, r.headers.authorization.endsWith('0') ? '1' : '0') }],
  ['wrong token', r => { r.headers['x-amz-security-token'] = 'wrong' }],
  ['wrong payload digest', r => { r.headers['x-amz-content-sha256'] = '0'.repeat(64) }],
]) test('fixture refuses ' + name, () => {
  const request = signed(); change(request)
  assert.throws(() => verifyFixtureRequest(request, Buffer.alloc(0), '127.0.0.1:12345'))
})
test('fixture refuses a GET with a body', () => assert.throws(() => verifyFixtureRequest(signed(), Buffer.from('body'), '127.0.0.1:12345')))
test('real local HTTP fixture handles empty/success/failure and closes owned connections', async () => {
  const fixture = await createInspectionFixture()
  try {
    const req = signed(new URL(fixture.endpoint).host)
    for (const [mode, status, length] of [['empty', 200, 0], ['good', 200, 16], ['denied', 403, 6], ['not-found', 404, 0], ['redirect', 302, 0], ['server-error', 503, 0]]) {
      fixture.setMode(mode)
      const response = await fetch(fixture.endpoint + FIXTURE_PATH, { headers: req.headers, redirect: 'manual', signal: AbortSignal.timeout(1000) })
      assert.equal(response.status, status); assert.equal((await response.arrayBuffer()).byteLength, length)
    }
    fixture.verify(); assert.equal(fixture.counts().requests, 6)
  } finally { await fixture.close() }
})

}

// Keep the original spaced-header cases. Production Go signRead emits commas
// without a following space; separators are not part of the signed message.
export function registerInspectionSeparatorTests(test) {
  for (const [label, separator] of [['compact', ','], ['tab', ',\t'], ['OWS', ' \t, \t']]) {
    test('fixture verifies unchanged signature with ' + label + ' authorization separators', () => {
      const request = signed()
      request.headers.authorization = request.headers.authorization.replaceAll(', ', separator)
      verifyFixtureRequest(request, Buffer.alloc(0), '127.0.0.1:12345')
    })
  }
  test('compact authorization still rejects a changed signature, scope, fields and CRLF', () => {
    const original = signed().headers.authorization.replaceAll(', ', ',')
    for (const authorization of [
      original.replace(/.$/, original.endsWith('0') ? '1' : '0'),
      original.replace('/us-east-1/', '/us-west-2/'),
      original.replace(',SignedHeaders=', ',Credential=duplicate,SignedHeaders='),
      original + ',Signature=' + '0'.repeat(64),
      original.replace(',SignedHeaders=', ',\r\nSignedHeaders='),
      original.replace('host;', 'host;host;'),
    ]) {
      const request = signed(); request.headers.authorization = authorization
      assert.throws(() => verifyFixtureRequest(request, Buffer.alloc(0), '127.0.0.1:12345'))
    }
  })
  test('real HTTP fixture accepts production compact separators without bypassing HMAC', async () => {
    const fixture = await createInspectionFixture()
    try {
      const request = signed(new URL(fixture.endpoint).host)
      request.headers.authorization = request.headers.authorization.replaceAll(', ', ',')
      const response = await fetch(fixture.endpoint + FIXTURE_PATH, { headers: request.headers, redirect: 'manual', signal: AbortSignal.timeout(1000) })
      assert.equal(response.status, 200)
      assert.equal((await response.arrayBuffer()).byteLength, 0)
      fixture.verify(); assert.equal(fixture.counts().requests, 1)
    } finally { await fixture.close() }
  })
}
