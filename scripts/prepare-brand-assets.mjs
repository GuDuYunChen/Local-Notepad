import { deflateSync, inflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { APP_ICON_DATA_URL } from '../src/assets/appIconData.js'

export const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const signature = Buffer.from('89504e470d0a1a0a', 'hex')
export function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, content) {
  const name = Buffer.from(type)
  const header = Buffer.alloc(4)
  header.writeUInt32BE(content.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, content])))
  return Buffer.concat([header, name, content, crc])
}
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
// Intentionally accepts only our bounded, 8-bit indexed, noninterlaced source.
// No runtime decoder or dependency is added to the application.
export function decodeBrandPng(png) {
  if (!png.subarray(0, 8).equals(signature)) throw new Error('Invalid brand PNG signature')
  let header, palette, alpha = Buffer.alloc(0), ended = false
  const compressed = []
  for (let offset = 8; offset < png.length;) {
    if (offset + 12 > png.length) throw new Error('Truncated PNG chunk')
    const length = png.readUInt32BE(offset)
    const end = offset + length + 12
    if (end > png.length) throw new Error('Truncated PNG payload')
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, end - 4)
    if (png.readUInt32BE(end - 4) !== crc32(png.subarray(offset + 4, end - 4))) throw new Error('Invalid PNG CRC')
    if (type === 'IHDR') header = data
    if (type === 'PLTE') palette = data
    if (type === 'tRNS') alpha = data
    if (type === 'IDAT') compressed.push(data)
    if (type === 'IEND') { ended = true; if (end !== png.length) throw new Error('Trailing PNG bytes'); break }
    offset = end
  }
  if (!ended || header?.length !== 13 || !palette?.length || palette.length % 3) throw new Error('Incomplete brand PNG')
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4)
  if (!width || !height || width > 512 || height > 512 || header[8] !== 8 || header[9] !== 3 ||
      header[10] || header[11] || header[12]) throw new Error('Unsupported brand PNG format')
  const expected = (width + 1) * height
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected })
  if (raw.length !== expected) throw new Error('Incorrect PNG scanline length')
  const pixels = Buffer.alloc(width * height)
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)]
    if (filter > 4) throw new Error('Unsupported PNG filter')
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const a = x ? pixels[i - 1] : 0, b = y ? pixels[i - width] : 0
      const c = x && y ? pixels[i - width - 1] : 0
      const predict = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]
      const p = pixels[i] = (raw[y * (width + 1) + 1 + x] + predict) & 255
      if (p * 3 + 2 >= palette.length) throw new Error('Invalid PNG palette index')
      rgba[i * 4] = palette[p * 3]
      rgba[i * 4 + 1] = palette[p * 3 + 1]
      rgba[i * 4 + 2] = palette[p * 3 + 2]
      rgba[i * 4 + 3] = p < alpha.length ? alpha[p] : 255
    }
  }
  return { width, height, rgba }
}
// Area downsampling in premultiplied-alpha space avoids black transparency halos.
export function resizeBrandImage(image, size) {
  if (!Number.isInteger(size) || size < 1 || size > image.width || size > image.height) throw new Error('Invalid icon size')
  const output = Buffer.alloc(size * size * 4)
  const sx = image.width / size, sy = image.height / size
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sums = [0, 0, 0], left = x * sx, top = y * sy, right = (x + 1) * sx, bottom = (y + 1) * sy
    let alpha = 0
    for (let iy = Math.floor(top); iy < Math.ceil(bottom); iy++) for (let ix = Math.floor(left); ix < Math.ceil(right); ix++) {
      const weight = (Math.min(right, ix + 1) - Math.max(left, ix)) * (Math.min(bottom, iy + 1) - Math.max(top, iy))
      const i = (iy * image.width + ix) * 4
      const a = image.rgba[i + 3] * weight
      alpha += a
      for (let channel = 0; channel < 3; channel++) sums[channel] += image.rgba[i + channel] * a
    }
    const out = (y * size + x) * 4
    for (let c = 0; c < 3; c++) output[out + c] = alpha ? Math.round(sums[c] / alpha) : 0
    output[out + 3] = Math.round(alpha / (sx * sy))
  }
  return { width: size, height: size, rgba: output }
}
export function encodeRgbaPng({ width, height, rgba }) {
  if (rgba.length !== width * height * 4) throw new Error('Invalid RGBA size')
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  const scanlines = Buffer.alloc(height * (width * 4 + 1))
  for (let row = 0; row < height; row++) rgba.copy(scanlines, row * (width * 4 + 1) + 1, row * width * 4, (row + 1) * width * 4)
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
export function buildBrandAssets(dataUrl = APP_ICON_DATA_URL) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)) throw new Error('Invalid brand data URL')
  const png = Buffer.from(dataUrl.split(',')[1], 'base64')
  const image = decodeBrandPng(png)
  if (image.width !== 256 || image.height !== 256) throw new Error('Brand master must be 256 x 256')
  const images = ICON_SIZES.map(size => encodeRgbaPng(resizeBrandImage(image, size)))
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(images.length, 4)
  let offset = directory.length
  images.forEach((bytes, index) => {
    const entry = 6 + index * 16, size = ICON_SIZES[index]
    directory[entry] = directory[entry + 1] = size === 256 ? 0 : size
    directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(bytes.length, entry + 8); directory.writeUInt32LE(offset, entry + 12)
    offset += bytes.length
  })
  const ico = Buffer.concat([directory, ...images])
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><title>Local-Notepad</title><image width="256" height="256" href="' + dataUrl + '"/></svg>\n'
  return { png, ico, svg, sha256: createHash('sha256').update(png).digest('hex') }
}
export async function prepareBrandAssets(root = fileURLToPath(new URL('..', import.meta.url))) {
  const assets = buildBrandAssets()
  for (const folder of ['build', 'src/public/brand']) {
    const target = path.join(root, folder)
    await mkdir(target, { recursive: true })
    await Promise.all([
      writeFile(path.join(target, 'icon.png'), assets.png),
      writeFile(path.join(target, 'icon.ico'), assets.ico),
      writeFile(path.join(target, 'icon.svg'), assets.svg),
    ])
  }
  return assets
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await prepareBrandAssets()
  console.log('Prepared shared brand PNG/SVG and 9-size Windows ICO (16–256 px).')
}
