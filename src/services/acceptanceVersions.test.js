import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACCEPTANCE_VERSION_FIELDS, inspectAcceptanceVersions } from '../../scripts/check-acceptance-versions.mjs'

const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
const release = JSON.parse(read('package.json')).version
describe('complete acceptance release bindings', () => {
  it('checks every active runner and generated release against the manifest', () => {
    expect(inspectAcceptanceVersions(read)).toEqual({ version: release, checks: 13, valid: true, errors: [] })
  })
  it.each(ACCEPTANCE_VERSION_FIELDS)('rejects stale release in %s at %s', (file, anchor) => {
    const result = inspectAcceptanceVersions(name => name === file ? read(name).replace(anchor + release, anchor + '0.0.0') : read(name))
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.file === file && error.anchor === anchor && error.reason === 'release-mismatch')).toBe(true)
  })
  it('reports multiple mismatches together rather than only the first', () => {
    const result = inspectAcceptanceVersions(file => file === 'package.json' ? JSON.stringify({ version: '0.0.0' }) : read(file))
    expect(result.errors.filter(error => error.reason === 'release-mismatch')).toHaveLength(13)
  })
  it('rejects a missing generated-version anchor', () => {
    const [file, anchor] = ACCEPTANCE_VERSION_FIELDS.at(-1)
    const result = inspectAcceptanceVersions(name => name === file ? read(name).replace(anchor, 'REMOVED') : read(name))
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.reason === 'missing-or-ambiguous-anchor')).toBe(true)
  })
  it('rejects duplicate anchors and unavailable sources', () => {
    const [file, anchor] = ACCEPTANCE_VERSION_FIELDS[0]
    expect(inspectAcceptanceVersions(name => name === file ? read(name) + '\n' + anchor + release + "'" : read(name)).valid).toBe(false)
    expect(inspectAcceptanceVersions(name => { if (name === file) throw Error('missing'); return read(name) }).valid).toBe(false)
  })
  it('rejects invalid manifest versions', () => {
    expect(inspectAcceptanceVersions(file => file === 'package.json' ? JSON.stringify({ version: '4.x' }) : read(file)).valid).toBe(false)
  })
})
