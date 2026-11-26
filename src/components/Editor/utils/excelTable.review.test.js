import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readExcelTableRows } from './excelTable'

function bytes(sheet) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'First')
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
}

describe('Excel table independent range review', () => {
  it.each(['A1', 'B2', 'A10002'])('reads a complete one-cell used range starting at %s without inventing leading rows', address => {
    const data = bytes({ [address]: { t: 's', v: 'preserved value' }, '!ref': address })
    expect(readExcelTableRows(XLSX, data)).toEqual([['preserved value']])
  })

  it('preserves used-range offsets, false, zero and internal blank cells', () => {
    const sheet = { B3: { t: 'n', v: 0 }, D3: { t: 'b', v: false }, B4: { t: 's', v: 'tail' }, '!ref': 'B3:D4' }
    expect(readExcelTableRows(XLSX, bytes(sheet))).toEqual([['0', '', 'false'], ['tail', '', '']])
  })

  it('refuses a real inflated sparse range before returning partial content', () => {
    const sheet = { A1: { t: 's', v: 'first' }, B2001: { t: 's', v: 'last' }, '!ref': 'A1:B2001' }
    expect(() => readExcelTableRows(XLSX, bytes(sheet))).toThrow(/4000|超过/)
  })
})
