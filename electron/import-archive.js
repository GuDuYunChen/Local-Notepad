import { inflateRawSync } from 'node:zlib'
import { LOCAL_IMPORT_LIMITS as LIMIT, LocalImportError } from './import-policy.js'

const invalid = () => { throw new LocalImportError('invalid-document', 'Office 压缩结构无效或不受支持，请在原程序中另存后重试') }
const tooLarge = () => { throw new LocalImportError('too-large', 'Office 解压内容超过安全读取上限，请拆分文档或移除大型嵌入资源后重试') }

// V8 heap limits do not cover every native inflate buffer. Verify actual
// decompression with a hard output cap before an Office library sees the ZIP.
// The declared ZIP sizes alone are not a bound on a dishonest deflate stream.
export function inspectOfficeArchive(buffer) {
  let end = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break }
  }
  if (end < 0) invalid()
  const entries = buffer.readUInt16LE(end + 10), bytes = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16)
  if (buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0 || buffer.readUInt16LE(end + 8) !== entries ||
      !entries || entries === 0xffff || start + bytes !== end || bytes > 4 * 1024 * 1024) invalid()
  if (entries > LIMIT.archiveEntries) tooLarge()
  let cursor = start, total = 0
  const names = new Set(), regions = []
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) invalid()
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10)
    const compressed = buffer.readUInt32LE(cursor + 20), expanded = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32)
    const local = buffer.readUInt32LE(cursor + 42), next = cursor + 46 + nameLength + extraLength + commentLength
    if (!nameLength || next > end || buffer.readUInt16LE(cursor + 34) !== 0 || (flags & 1) || ![0, 8].includes(method) ||
        local + 30 > start || compressed === 0xffffffff || expanded === 0xffffffff) invalid()
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength)
    const identity = name.toString('hex')
    if (names.has(identity)) invalid()
    names.add(identity)
    if (expanded > LIMIT.archiveEntryBytes || total + expanded > LIMIT.archiveBytes) tooLarge()
    if (buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) invalid()
    const localNameLength = buffer.readUInt16LE(local + 26), localExtraLength = buffer.readUInt16LE(local + 28)
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed
    if (dataEnd > start || localNameLength !== nameLength || !buffer.subarray(local + 30, local + 30 + localNameLength).equals(name)) invalid()
    regions.push([local, dataEnd])
    const input = buffer.subarray(dataStart, dataEnd)
    let output
    if (method === 0) output = input
    else {
      try { output = inflateRawSync(input, { maxOutputLength: LIMIT.archiveEntryBytes }) }
      catch (error) { if (error?.code === 'ERR_BUFFER_TOO_LARGE') tooLarge(); invalid() }
    }
    if (output.length !== expanded) invalid()
    total += output.length
    if (total > LIMIT.archiveBytes) tooLarge()
    cursor = next
  }
  if (cursor !== end) invalid()
  regions.sort((a, b) => a[0] - b[0])
  for (let i = 1; i < regions.length; i++) if (regions[i][0] < regions[i - 1][1]) invalid()
  return { entries, expandedBytes: total }
}
