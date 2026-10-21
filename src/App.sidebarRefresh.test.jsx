import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { DndProvider } from 'react-dnd'
import { TestBackend } from 'react-dnd-test-backend'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import App from './App'
import { api, listAllFiles } from '~/services/api'

const fixture = vi.hoisted(() => ({ rows: [], releaseRefresh: null, delayed: false }))
vi.mock('~/services/api', () => ({ api: vi.fn(), listAllFiles: vi.fn(), searchFiles: vi.fn(),
  createFileVersionSnapshot: vi.fn(), listAllFilesWithContent: vi.fn() }))
// The App, sidebar, file list, refresh callbacks and their buttons are real.
// This entry regression stops before editing or any native export operation.
vi.mock('./components/TextEditor', () => ({ default: React.forwardRef(function Editor({ activeId }, ref) {
  return <div className="editor-input" data-editor-note={activeId || ''}>
    {fixture.rows.find(row => row.id === activeId)?.content || ''}
  </div>
}) }))

let host, root, directory, widthDescriptor, verifyLocalExportDesktop
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
const state = () => ({
  collapsed: Boolean(host.querySelector('.workspace-sidebar.collapsed')),
  rows: host.querySelectorAll('[data-file-id]').length,
  title: host.querySelector('.workspace-title-button')?.textContent || '',
})

beforeAll(async () => {
  // Default Vitest also runs in a clean checkout, before Desktop preparation.
  await new Promise((resolve, reject) => {
    execFile(process.execPath, [path.resolve('scripts/build-local-export-fixture.mjs')],
      { timeout: 8000, windowsHide: true }, error => error ? reject(error) : resolve())
  })
  ;({ verifyLocalExportDesktop } = await import('../scripts/check-local-export-desktop.mjs'))
})

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 704 })
  localStorage.clear(); fixture.rows = []; fixture.releaseRefresh = null; fixture.delayed = false
  api.mockReset().mockResolvedValue([]); listAllFiles.mockReset()
  listAllFiles.mockImplementation(() => {
    if (fixture.rows.length && !fixture.delayed) {
      fixture.delayed = true
      return new Promise(resolve => { fixture.releaseRefresh = () => resolve([...fixture.rows].reverse()) })
    }
    return Promise.resolve([...fixture.rows].reverse())
  })
  directory = mkdtempSync(path.join(tmpdir(), 'export-sidebar-entry-'))
  mkdirSync(path.join(directory, 'uploads'))
  let upload = 0
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    expect(url).toBe('http://127.0.0.1:27121/api/upload')
    const file = init.body.get('file'), filename = `fixture-${++upload}`
    writeFileSync(path.join(directory, 'uploads', filename), Buffer.from(await file.arrayBuffer()))
    return { status: 200, json: async () => ({ code: 0, message: 'OK', data: { url: '/uploads/' + filename } }) }
  }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  // Use the existing App-test startup clock only for its intentional 100ms mount.
  vi.useFakeTimers()
  await act(async () => root.render(<DndProvider backend={TestBackend}><App /></DndProvider>))
  await act(async () => vi.advanceTimersByTimeAsync(100))
  vi.useRealTimers(); await flush()
})

afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  rmSync(directory, { recursive: true, force: true })
  localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor)
  else delete window.innerWidth
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('actual export driver restores the real sidebar after asynchronous small-window auto-selection', async () => {
  expect(state()).toEqual({ collapsed: false, rows: 0, title: '' })
  const pending = [], collapsed = [], clicks = [], report = {}, reachedEntry = new Error('Canonical entry reached')
  const evaluate = async expression => {
    let value
    await act(async () => { value = await eval(expression) })
    return value
  }
  const until = async (probe, message) => {
    // Bound the platform polling adapter by observations, without widening the
    // production driver's deadlines. Resolve the real deferred list only here.
    for (let attempt = 0; attempt < 8; attempt++) {
      const value = await probe()
      if (value) return value
      if (fixture.releaseRefresh) {
        pending.push(state())
        const release = fixture.releaseRefresh; fixture.releaseRefresh = null
        await act(async () => release()); await flush(); collapsed.push(state())
      } else await flush()
    }
    throw new Error(message)
  }
  let outcome
  try {
    await verifyLocalExportDesktop({ report, save: () => {}, dataDirectory: directory,
      api: async (url, init) => {
        expect(url).toBe('/api/files'); expect(init.method).toBe('POST')
        const order = fixture.rows.length + 1
        const row = { ...JSON.parse(init.body), id: 'export-' + order, created_at: order, updated_at: order }
        fixture.rows.push(row); return row
      }, evaluate, until,
      click: async selector => {
        expect(typeof selector).toBe('string')
        const node = host.querySelector(selector); expect(node, selector).toBeTruthy()
        clicks.push(selector)
        await act(async () => node.click()); await flush()
      },
      mark: name => {
        expect(name).toBe('actual-app-and-canonical-synthetic-documents')
        throw reachedEntry
      },
    })
  } catch (error) { outcome = error }
  if (outcome !== reachedEntry) throw outcome || new Error('Driver did not reach the canonical entry')
  expect(pending).toEqual([{ collapsed: false, rows: 0, title: '' }])
  expect(collapsed).toEqual([{ collapsed: true, rows: 0, title: 'EXPORT102 Batch 100.md' }])
  expect(clicks.filter(selector => selector === 'button[aria-label="展开侧边栏"]')).toHaveLength(1)
  expect(clicks).toContain('[data-file-id="' + report.fixture.folderID + '"]')
  expect(clicks).toContain('[data-file-id="' + report.fixture.noteID + '"]')
  expect(report.fixture.documents).toBe(103)
  expect(host.querySelector('[data-editor-note]')?.dataset.editorNote).toBe(report.fixture.noteID)
  // Selecting the canonical note closes the sidebar again, as the real App is
  // designed to do at this width. Subsequent driver entries must restore it.
  expect(state()).toEqual({ collapsed: true, rows: 0, title: 'EXPORT102 原文.md' })
  expect(window.innerWidth).toBe(704)
  expect(localStorage.getItem('sidebarCollapsedV4')).toBe('true')
})
