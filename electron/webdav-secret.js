import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const WEBDAV_SECRET_FILENAME = 'webdav-password.bin'
const MAX_SECRET_BYTES = 4096

async function optionalLstat(fsApi, target) {
  try { return await fsApi.lstat(target) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function safeStorageState(safeStorage) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' ||
      typeof safeStorage.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function') {
    return { available: false, backend: '' }
  }
  const backend = typeof safeStorage.getSelectedStorageBackend === 'function'
    ? String(safeStorage.getSelectedStorageBackend() || '')
    : ''
  const available = Boolean(safeStorage.isEncryptionAvailable()) && backend !== 'basic_text'
  return { available, backend }
}

function requireSafeStorage(safeStorage) {
  const state = safeStorageState(safeStorage)
  if (!state.available) throw new Error(
    state.backend === 'basic_text' ? '系统安全存储退化为未加密 basic_text，拒绝保存凭据' : '系统安全存储当前不可用'
  )
}

export function createWebDAVSecretStore({ dataDir, safeStorage, fsApi = fs }) {
  if (!dataDir || typeof dataDir !== 'string') throw new Error('WebDAV 凭据目录未配置')
  const secretDir = path.join(dataDir, 'secrets')
  const secretPath = path.join(secretDir, WEBDAV_SECRET_FILENAME)

  const ensureDir = async () => {
    await fsApi.mkdir(secretDir, { recursive: true, mode: 0o700 })
    const info = await fsApi.lstat(secretDir)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('WebDAV 凭据目录不安全')
  }

  const inspectFile = async () => {
    const info = await optionalLstat(fsApi, secretPath)
    if (!info) return null
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('WebDAV 凭据文件不安全')
    if (info.size <= 0 || info.size > 64 * 1024) throw new Error('WebDAV 凭据文件大小异常')
    return info
  }

  return {
    path: secretPath,
    async status() {
      const state = safeStorageState(safeStorage)
      const info = await inspectFile()
      return { available: state.available, stored: Boolean(info), backend: state.backend }
    },
    async load() {
      const info = await inspectFile()
      if (!info) return ''
      requireSafeStorage(safeStorage)
      const encrypted = await fsApi.readFile(secretPath)
      const value = safeStorage.decryptString(encrypted)
      if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) {
        throw new Error('WebDAV 凭据解密结果无效')
      }
      return value
    },
    async save(value) {
      if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) {
        throw new Error('WebDAV 密码格式无效')
      }
      requireSafeStorage(safeStorage)
      await ensureDir()
      const encrypted = safeStorage.encryptString(value)
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.length > 64 * 1024) {
        throw new Error('系统安全存储返回无效密文')
      }
      const tmp = secretPath + '.tmp-' + randomBytes(8).toString('hex')
      let handle
      try {
        handle = await fsApi.open(tmp, 'wx', 0o600)
        await handle.writeFile(encrypted)
        await handle.sync()
        await handle.close()
        handle = null
        await fsApi.rename(tmp, secretPath)
        const info = await inspectFile()
        if (!info) throw new Error('WebDAV 凭据未发布')
      } finally {
        if (handle) await handle.close().catch(() => {})
        await fsApi.rm(tmp, { force: true }).catch(() => {})
      }
      return { stored: true }
    },
    async clear() {
      const info = await optionalLstat(fsApi, secretPath)
      if (!info) return { stored: false }
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('WebDAV 凭据文件不安全')
      await fsApi.rm(secretPath, { force: true })
      return { stored: false }
    },
  }
}
