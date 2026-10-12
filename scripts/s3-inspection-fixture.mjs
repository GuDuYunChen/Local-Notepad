// Isolated S3-shaped HTTP origin for native acceptance. It never contacts a cloud.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
export const FIXTURE_ID = 'INSPECTIONTESTONLY'
export const FIXTURE_SECRET = 'NOT_A_REAL_SECRET_2F85/+='
export const FIXTURE_TOKEN = 'NOT_A_REAL_TOKEN_2F85/+='
export const FIXTURE_PREFIX = '研究/e\u0301'
export const FIXTURE_KEY = '中文 空格/%2F/片段.json'
export const FIXTURE_BUCKET = 'inspection-test'
export const FIXTURE_REGION = 'us-east-1'
const hash = value => createHash('sha256').update(value).digest('hex')
const mac = (key, value) => createHmac('sha256', key).update(value).digest()
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
export const FIXTURE_PATH = '/' + [FIXTURE_BUCKET, ...FIXTURE_PREFIX.split('/'), ...FIXTURE_KEY.split('/')].map(encode).join('/')
export function verifyFixtureRequest(req, body, expectedHost) {
  assert.equal(req.method, 'GET', 'Fixture permits only GET')
  assert.equal(req.url, FIXTURE_PATH, 'Object key or prefix was rewritten')
  assert.equal(body.length, 0, 'GET carried a body')
  assert.equal(req.headers.host, expectedHost, 'Unexpected destination')
  const digest = req.headers['x-amz-content-sha256'], date = req.headers['x-amz-date']
  assert.equal(digest, hash(''), 'Unexpected payload hash')
  assert.match(date || '', /^\d{8}T\d{6}Z$/)
  assert.equal(req.headers['x-amz-security-token'], FIXTURE_TOKEN)
  // HTTP list separators allow optional SP/HTAB. Do not alter the signed
  // values or accept CR/LF, duplicate fields, missing headers or a bad HMAC.
  const authorization = /^AWS4-HMAC-SHA256 Credential=([^,\s]+)[ \t]*,[ \t]*SignedHeaders=([^,\s]+)[ \t]*,[ \t]*Signature=([a-f0-9]{64})$/.exec(req.headers.authorization || '')
  assert.ok(authorization, 'Missing signature')
  const scope = date.slice(0, 8) + '/' + FIXTURE_REGION + '/s3/aws4_request'
  assert.equal(authorization[1], FIXTURE_ID + '/' + scope)
  const names = authorization[2].split(';')
  assert.deepEqual(names, [...new Set(names)].sort())
  for (const name of ['host', 'x-amz-content-sha256', 'x-amz-date', 'x-amz-security-token']) assert.ok(names.includes(name))
  const headers = names.map(name => { assert.equal(typeof req.headers[name], 'string'); return name + ':' + req.headers[name].trim().replace(/\s+/g, ' ') + '\n' }).join('')
  const canonical = ['GET', FIXTURE_PATH, '', headers, names.join(';'), digest].join('\n')
  const signingKey = mac(mac(mac(mac('AWS4' + FIXTURE_SECRET, date.slice(0, 8)), FIXTURE_REGION), 's3'), 'aws4_request')
  const expected = mac(signingKey, ['AWS4-HMAC-SHA256', date, scope, hash(canonical)].join('\n'))
  assert.ok(timingSafeEqual(expected, Buffer.from(authorization[3], 'hex')), 'Signature does not cover the exact object')
}
export async function createInspectionFixture() {
  let mode = 'empty', host = '', requests = 0, verified = 0, failure = null
  const held = new Set(), sockets = new Set(), modes = []
  const server = createServer((req, res) => {
    requests++; const selected = mode; modes.push(selected)
    const chunks = []; let bytes = 0
    req.on('data', chunk => { bytes += chunk.length; if (bytes <= 1024) chunks.push(chunk); else req.destroy() })
    req.on('error', () => { failure ||= new Error('Fixture request transport failed') })
    req.on('end', () => {
      try { verifyFixtureRequest(req, Buffer.concat(chunks), host); verified++ }
      catch { failure ||= new Error('Fixture request signature, target or method verification failed'); res.writeHead(400); res.end(); return }
      if (selected === 'hold') { held.add(res); res.once('close', () => held.delete(res)); return }
      if (selected === 'denied') { res.writeHead(403); res.end('denied'); return }
      if (selected === 'not-found') { res.writeHead(404); res.end(); return }
      if (selected === 'redirect') { res.writeHead(302, { Location: 'http://' + host + '/must-not-follow' }); res.end(); return }
      if (selected === 'server-error') { res.writeHead(503); res.end(); return }
      if (selected === 'encoding') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end('not-gzip'); return }
      const body = selected === 'empty' ? Buffer.alloc(0) : Buffer.from('synthetic-object')
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length }); res.end(body)
    })
  })
  server.requestTimeout = 12000; server.headersTimeout = 12000
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  host = '127.0.0.1:' + server.address().port
  return {
    endpoint: 'http://' + host,
    setMode(next) { assert.ok(['empty', 'good', 'denied', 'not-found', 'redirect', 'server-error', 'encoding', 'hold'].includes(next)); mode = next },
    counts: () => ({ requests, verified, held: held.size, modes: [...modes] }),
    verify() { if (failure) throw failure; assert.equal(verified, requests) },
    release() { for (const res of held) res.end('late-object'); held.clear() },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) },
  }
}
