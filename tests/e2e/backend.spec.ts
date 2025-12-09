/**
 * E2E：后端关键流程
 * 覆盖：创建文件、另存为、导入（单/多）、主题设置切换
 */
import { spawn } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const base = 'http://127.0.0.1:27121'

async function call(path: string, init?: RequestInit) {
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const body = await res.json()
  if (body.code !== 0) throw new Error(body.message)
  return body.data
}

let proc: any

beforeAll(async () => {
  if (!process.env.SKIP_SPAWN) {
    proc = spawn('.\\server\\bin\\notepad-server.exe', { 
        cwd: process.cwd(), 
        stdio: 'inherit'
    })
  }
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(base + '/api/health')
      if (res.ok) break
    } catch {}
    await new Promise(r => setTimeout(r, 300))
  }
})

afterAll(async () => {
  proc?.kill()
})

describe('backend e2e', () => {
  it('create and save-as', async () => {
    const f = await call('/api/files', { method: 'POST', body: JSON.stringify({ title: 'e2e', content: 'content' }) })
    expect(f.id).toBeTruthy()
    const out = require('node:path').resolve(process.cwd(), 'server', 'e2e-export.txt')
    const resp = await call(`/api/files/${f.id}/save-as`, { method: 'POST', body: JSON.stringify({ path: out }) })
    expect(resp.ok).toBe(true)
  })

  it('import single file', async () => {
    const out = require('node:path').resolve(process.cwd(), 'server', 'e2e-export.txt')
    await call('/api/files/import', { method: 'POST', body: JSON.stringify({ path: out }) })
  })

  it('import multiple files', async () => {
    const out = require('node:path').resolve(process.cwd(), 'server', 'e2e-export.txt')
    await call('/api/files/import', { method: 'POST', body: JSON.stringify({ path: out }) })
    await call('/api/files/import', { method: 'POST', body: JSON.stringify({ path: out }) })
  })

  it('settings toggle theme', async () => {
    const s1 = await call('/api/settings')
    const next = s1.theme === 'light' ? 'dark' : 'light'
    const s2 = await call('/api/settings', { method: 'PUT', body: JSON.stringify({ theme: next }) })
    expect(s2.theme).toBe(next)
  })

  it('roundtrip iso-2022-cn', async () => {
    const content = '中文编码往返测试——一些标点：，。！？'
    const f = await call('/api/files', { method: 'POST', body: JSON.stringify({ title: 'iso2022cn', content }) })
    const out = require('node:path').resolve(process.cwd(), 'server', 'e2e-iso2022cn.txt')
    await call(`/api/files/${f.id}/save-as`, { method: 'POST', body: JSON.stringify({ path: out, encoding: 'iso-2022-cn' }) })
    const imported = await call('/api/files/import', { method: 'POST', body: JSON.stringify({ path: out, encoding: 'iso-2022-cn' }) })
    expect(imported.content).toBe(content)
  })

  it('create folder and nested file', async () => {
    // 1. Create Folder
    const folder = await call('/api/files', { 
        method: 'POST', 
        body: JSON.stringify({ title: 'e2e-folder', is_folder: true }) 
    })
    expect(folder.id).toBeTruthy()
    expect(folder.is_folder).toBe(true)

    // 2. Create File inside Folder
    const file = await call('/api/files', { 
        method: 'POST', 
        body: JSON.stringify({ title: 'nested-file', content: 'nested', parent_id: folder.id }) 
    })
    expect(file.id).toBeTruthy()
    expect(file.parent_id).toBe(folder.id)

    // 3. List files and check hierarchy (flat list with parent_id)
    const list = await call('/api/files')
    const foundFolder = list.find((i: any) => i.id === folder.id)
    const foundFile = list.find((i: any) => i.id === file.id)
    expect(foundFolder).toBeTruthy()
    expect(foundFile).toBeTruthy()
    expect(foundFile.parent_id).toBe(folder.id)
  })
})
