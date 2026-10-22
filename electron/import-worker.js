import { parentPort, workerData } from 'node:worker_threads'
import { parseLocalImportFile } from './import-parser.js'
import { LocalImportError } from './import-policy.js'

parseLocalImportFile(workerData.filePath).then(result => {
  parentPort.postMessage({ ok: true, result })
}).catch(error => {
  parentPort.postMessage({ ok: false,
    code: error instanceof LocalImportError ? error.code : 'invalid-document',
    message: error instanceof LocalImportError ? error.message : '文档解析失败，请另存后重试' })
}).finally(() => parentPort.close())
