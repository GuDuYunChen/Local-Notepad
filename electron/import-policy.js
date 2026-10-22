// One budget for native selection, worker conversion and IPC delivery.
export const LOCAL_IMPORT_LIMITS = Object.freeze({
  files: 20, fileBytes: 50 * 1024 * 1024, contentBytes: 2 * 1024 * 1024,
  batchContentBytes: 2 * 1024 * 1024, fileTimeoutMs: 15000, batchTimeoutMs: 60000,
  sheets: 20, rows: 10000, columns: 200, cells: 200000,
  archiveEntries: 5000, archiveEntryBytes: 16 * 1024 * 1024, archiveBytes: 64 * 1024 * 1024,
})
export const LOCAL_IMPORT_EXTENSIONS = Object.freeze(['.docx', '.doc', '.xlsx', '.xls', '.md', '.txt'])
export class LocalImportError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LocalImportError'
    this.code = code
  }
}
