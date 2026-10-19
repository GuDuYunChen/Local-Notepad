import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { readingModeDesktopFixture, READING_FIXTURE_TEXT as text } from './reading-mode-desktop-fixture.bundle.mjs'

// Exercise the actual application node constructors and Lexical serializer.
// The bundle is rebuilt from production sources before this suite and native CI.
test('canonical reading fixture round-trips deterministically with each guarded decorator', () => {
  const content = readingModeDesktopFixture()
  assert.equal(readingModeDesktopFixture(), content)
  const children = JSON.parse(content).root.children
  assert.deepEqual(children.map(node => node.type), [
    'heading', 'paragraph', 'todo', 'callout', 'toggle', 'code-block', 'formula', 'image', 'image-grid', 'attachment', 'paragraph',
  ])
  const node = type => children.find(item => item.type === type)
  assert.equal(node('heading').children[0].text, text.heading)
  assert.equal(node('paragraph').children[0].text, text.body)
  assert.equal(node('todo').text, text.todo); assert.equal(node('todo').checked, false)
  assert.equal(node('callout').text, text.callout)
  assert.equal(node('toggle').title, text.toggleTitle); assert.equal(node('toggle').content, text.toggleContent)
  assert.equal(node('toggle').collapsed, false)
  assert.equal(node('code-block').code, text.code); assert.equal(node('code-block').language, 'javascript')
  assert.equal(node('formula').expression, text.formula); assert.equal(node('formula').displayMode, true)
  assert.equal(node('image').caption, text.caption)
  assert.equal(node('image').width, 48); assert.equal(node('image').height, 48)
  assert.equal(node('image-grid').items.length, 1)
  assert.equal(node('image-grid').items[0].caption, text.gridCaption)
  assert.equal(node('image-grid').columns, 1)
  assert.equal(node('attachment').name, '阅读模式附件.png')
  assert.equal(node('attachment').mime, 'image/png')
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

test('all native media targets use one valid decodable PNG permitted by the existing image policy', () => {
  const children = JSON.parse(readingModeDesktopFixture()).root.children
  const picture = children.find(node => node.type === 'image')
  const grid = children.find(node => node.type === 'image-grid').items[0]
  const attachment = children.find(node => node.type === 'attachment')
  assert.match(picture.src, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)
  for (const src of [picture.originalSrc, grid.src, grid.originalSrc, attachment.src]) assert.equal(src, picture.src)
  const bytes = Buffer.from(picture.src.split(',')[1], 'base64')
  assert.equal(bytes.length, attachment.size)
  assert.equal(bytes.length, 77)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  const chunks = []; let offset = 8
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    assert.ok(offset + length + 12 <= bytes.length, 'Truncated PNG chunk')
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + length)), bytes.readUInt32BE(offset + 8 + length), type + ' CRC')
    chunks.push({ type, data }); offset += length + 12
  }
  assert.equal(offset, bytes.length)
  assert.deepEqual(chunks.map(chunk => chunk.type), ['IHDR', 'IDAT', 'IEND'])
  const header = chunks[0].data
  assert.equal(header.readUInt32BE(0), 8); assert.equal(header.readUInt32BE(4), 8)
  assert.equal(header[8], 8); assert.equal(header[9], 2)
  assert.deepEqual([...header.subarray(10)], [0, 0, 0])
  const scanlines = inflateSync(chunks[1].data)
  assert.equal(scanlines.length, 8 * (1 + 8 * 3))
  for (let row = 0; row < 8; row++) assert.ok(scanlines[row * 25] <= 4, 'Invalid PNG scanline filter')
})
