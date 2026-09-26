import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import TextEditor from './TextEditor'
import { api } from '~/services/api'
import { readEditorDraft, removeEditorDraft, writeEditorDraft } from '~/services/editorDraftCache'
import { editorQuit } from '~/services/editorQuit.mjs'

vi.mock('~/services/api', () => ({
  api: vi.fn(),
}))

vi.mock('~/services/tagApi', () => ({
  tagApi: {
    getFileTags: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('./Editor/Editor', () => ({
  default: function MockEditor({ initialContent, onChange }) {
    globalThis.__textEditorMockInitialContent = initialContent
    globalThis.__textEditorMockOnChange = onChange
    return React.createElement('div', null)
  },
}))

vi.mock('./TagSelector', () => ({
  default: function MockTagSelector() {
    return null
  },
}))

function flushPromises() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('TextEditor save coordination', () => {
  let container
  let root

  beforeEach(() => {
    vi.useFakeTimers()
    api.mockReset()
    localStorage.clear()
    removeEditorDraft('file-1')
    removeEditorDraft('file-2')
    editorQuit.forget('file-1')
    editorQuit.forget('file-2')
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    if (container) {
      container.remove()
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    delete globalThis.__textEditorMockOnChange
    delete globalThis.__textEditorMockInitialContent
    editorQuit.forget('file-1')
    editorQuit.forget('file-2')
    removeEditorDraft('file-1')
    removeEditorDraft('file-2')
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('exposes create search and daily actions when no note is open', async () => {
    const onCreateNote = vi.fn()
    const onOpenSearch = vi.fn()
    const onOpenDaily = vi.fn()

    await act(async () => {
      root.render(
        <TextEditor
          activeId={null}
          deletedIds={new Set()}
          autoSaveOnSwitch={false}
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onCreateNote={onCreateNote}
          onOpenSearch={onOpenSearch}
          onOpenDaily={onOpenDaily}
        />
      )
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const createButton = buttons.find(button => button.textContent === '新建笔记')
    const searchButton = buttons.find(button => button.textContent === '快速搜索')
    const dailyButton = buttons.find(button => button.textContent === '每日笔记')

    expect(createButton).toBeTruthy()
    expect(searchButton).toBeTruthy()
    expect(dailyButton).toBeTruthy()

    await act(async () => {
      createButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      searchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      dailyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onCreateNote).toHaveBeenCalledTimes(1)
    expect(onOpenSearch).toHaveBeenCalledTimes(1)
    expect(onOpenDaily).toHaveBeenCalledTimes(1)
  })

  it('preserves explicit structure mappings in transformed drafts', async () => {
    const original = JSON.stringify({
      root: {
        children: [{
          type: 'heading',
          tag: 'h1',
          children: [{ type: 'text', text: '第一章' }],
        }],
      },
    })
    const transformed = JSON.stringify({
      root: {
        children: [{
          type: 'heading',
          tag: 'h1',
          children: [{ type: 'text', text: '合并后的章节' }],
        }],
      },
    })

    api.mockImplementation((path, init) => {
      if (!init?.method) {
        return Promise.resolve({
          id: 'file-1',
          content: original,
          updated_at: 1,
        })
      }
      return Promise.resolve({
        id: 'file-1',
        content: transformed,
        updated_at: 2,
      })
    })

    const editorRef = React.createRef()
    await act(async () => {
      root.render(
        <TextEditor
          ref={editorRef}
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch={false}
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
        />
      )
    })
    await flushPromises()

    await act(async () => {
      editorRef.current.replaceDraftContent(transformed, {
        sectionPathMappings: [{
          before: ['第一章'],
          after: ['合并后的章节'],
        }],
      })
      await Promise.resolve()
    })

    expect(editorRef.current.getReferenceRefactorState()).toMatchObject({
      currentContent: transformed,
      savedContent: original,
      structureChanged: true,
      sectionPathMappings: [{
        before: ['第一章'],
        after: ['合并后的章节'],
      }],
    })
    expect(globalThis.__textEditorMockInitialContent).toBe(transformed)
  })

  it('holds structural edits out of interval autosave until explicit review', async () => {
    const original = JSON.stringify({
      root: {
        children: [{
          type: 'heading',
          tag: 'h1',
          children: [{ type: 'text', text: '第一章' }],
        }],
      },
    })
    const changed = JSON.stringify({
      root: {
        children: [{
          type: 'heading',
          tag: 'h1',
          children: [{ type: 'text', text: '第二章' }],
        }],
      },
    })
    const statuses = []

    api.mockImplementation((path, init) => {
      if (!init?.method) {
        return Promise.resolve({
          id: 'file-1',
          content: original,
          updated_at: 1,
        })
      }
      if (init.method === 'PUT') {
        return Promise.resolve({
          id: 'file-1',
          content: changed,
          updated_at: 2,
        })
      }
      return Promise.reject(new Error('Unexpected request: ' + path))
    })

    const editorRef = React.createRef()
    await act(async () => {
      root.render(
        <TextEditor
          ref={editorRef}
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch={false}
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onStatusChange={(status) => statuses.push(status)}
        />
      )
    })
    await flushPromises()

    await act(async () => {
      globalThis.__textEditorMockOnChange(changed)
      await Promise.resolve()
    })

    expect(editorRef.current.getReferenceRefactorState()).toMatchObject({
      currentContent: changed,
      savedContent: original,
      structureChanged: true,
    })
    expect(statuses.at(-1)).toMatchObject({
      dirty: true,
      structureDirty: true,
    })

    await act(async () => {
      vi.advanceTimersByTime(30000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(api).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('章节结构待确认')

    let result
    await act(async () => {
      result = await editorRef.current.save()
    })
    await flushPromises()

    expect(result).toMatchObject({
      id: 'file-1',
      content: changed,
    })
    expect(api).toHaveBeenCalledTimes(2)
    expect(statuses.at(-1)).toMatchObject({
      dirty: false,
      structureDirty: false,
    })
  })

  it('normalizes legacy table breaks without marking the note dirty', async () => {
    const legacy = JSON.stringify({
      root: {
        type: 'root',
        children: [{
          type: 'table',
          children: [{
            type: 'tablerow',
            children: [{
              type: 'tablecell',
              children: [{
                type: 'paragraph',
                children: [{
                  type: 'text',
                  text: '来源：天地灵气。<br>方式：吐纳导引。',
                  version: 1,
                }],
                version: 1,
              }],
              version: 1,
            }],
            version: 1,
          }],
          version: 1,
        }],
        version: 1,
      },
    })
    const statuses = []

    api.mockResolvedValue({
      id: 'file-1',
      content: legacy,
      updated_at: 1,
    })

    await act(async () => {
      root.render(
        <TextEditor
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch={false}
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onStatusChange={(status) => statuses.push(status)}
        />
      )
    })
    await flushPromises()

    const normalized = JSON.parse(globalThis.__textEditorMockInitialContent)
    const tableCell = normalized.root.children[0].children[0].children[0]
    const paragraphChildren = tableCell.children[0].children

    expect(paragraphChildren.some(node => node.type === 'linebreak')).toBe(true)
    expect(globalThis.__textEditorMockInitialContent).not.toContain('<br>')
    expect(statuses.at(-1)).toMatchObject({
      activeId: 'file-1',
      dirty: false,
      saveError: false,
    })
  })

  it('does not write unchanged content on interval or explicit save', async () => {
    api.mockImplementation((path, init) => {
      if (!init?.method) {
        return Promise.resolve({
          id: 'file-1',
          content: '{"root":{"children":[]}}',
          updated_at: 1,
        })
      }
      return Promise.reject(new Error('unchanged content should not be saved'))
    })

    const editorRef = React.createRef()
    await act(async () => {
      root.render(
        <TextEditor
          ref={editorRef}
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch={false}
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
        />
      )
    })
    await flushPromises()

    await act(async () => {
      vi.advanceTimersByTime(30000)
      await Promise.resolve()
    })

    let result
    await act(async () => {
      result = await editorRef.current.save()
    })

    expect(result).toMatchObject({ id: 'file-1', skipped: true })
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('reports dirty and saved status to the workspace header', async () => {
    const changed = '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"changed"}]}]}}'
    const statuses = []

    api.mockImplementation((path, init) => {
      if (!init?.method) {
        return Promise.resolve({
          id: 'file-1',
          content: '{"root":{"children":[]}}',
          updated_at: 1,
        })
      }
      if (init.method === 'PUT') {
        return Promise.resolve({
          id: 'file-1',
          content: changed,
          updated_at: 2,
        })
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })

    const editorRef = React.createRef()
    await act(async () => {
      root.render(
        <TextEditor
          ref={editorRef}
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch={false}
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onStatusChange={(status) => statuses.push(status)}
        />
      )
    })
    await flushPromises()

    expect(statuses.at(-1)).toMatchObject({
      dirty: false,
      saveError: false,
    })

    await act(async () => {
      globalThis.__textEditorMockOnChange(changed)
      await Promise.resolve()
    })

    expect(statuses.some(status => status.dirty === true)).toBe(true)

    await act(async () => {
      await editorRef.current.save()
    })
    await flushPromises()

    expect(statuses.at(-1)).toMatchObject({
      dirty: false,
      saveError: false,
    })
    expect(statuses.at(-1).lastSavedAt).toBeTruthy()
  })

  it('keeps the current note marked as saving when a previous note finishes first', async () => {
    const pending = new Map()
    const statuses = []

    api.mockImplementation((path, init) => {
      if (!init?.method) {
        const id = path.split('/').pop()
        return Promise.resolve({
          id,
          content: '{"root":{"children":[]}}',
          updated_at: 1,
        })
      }

      if (init.method === 'PUT') {
        const id = path.split('/').pop()
        return new Promise((resolve) => {
          pending.set(id, resolve)
        })
      }

      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })

    const editorRef = React.createRef()
    await act(async () => {
      root.render(
        <TextEditor
          ref={editorRef}
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onStatusChange={(status) => statuses.push(status)}
        />
      )
    })
    await flushPromises()

    await act(async () => {
      globalThis.__textEditorMockOnChange('{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"one"}]}]}}')
      await Promise.resolve()
    })

    await act(async () => {
      root.render(
        <TextEditor
          ref={editorRef}
          activeId="file-2"
          deletedIds={new Set()}
          autoSaveOnSwitch
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onStatusChange={(status) => statuses.push(status)}
        />
      )
      await Promise.resolve()
    })
    await flushPromises()

    expect(pending.has('file-1')).toBe(true)

    await act(async () => {
      globalThis.__textEditorMockOnChange('{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"two"}]}]}}')
      await Promise.resolve()
    })

    let currentSave
    await act(async () => {
      currentSave = editorRef.current.save()
      await Promise.resolve()
    })

    expect(pending.has('file-2')).toBe(true)
    expect(statuses.at(-1)).toMatchObject({ activeId: 'file-2', saving: true })

    await act(async () => {
      pending.get('file-1')({
        id: 'file-1',
        content: '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"one"}]}]}}',
        updated_at: 2,
      })
      await Promise.resolve()
    })

    expect(statuses.at(-1)).toMatchObject({ activeId: 'file-2', saving: true })

    await act(async () => {
      pending.get('file-2')({
        id: 'file-2',
        content: '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"two"}]}]}}',
        updated_at: 3,
      })
      await currentSave
    })
    await flushPromises()

    expect(statuses.at(-1)).toMatchObject({
      activeId: 'file-2',
      saving: false,
      saveError: false,
    })
  })

  it('does not leak a previous note autosave failure into the newly opened note', async () => {
    const statuses = []

    api.mockImplementation((path, init) => {
      const id = path.split('/').pop()

      if (!init?.method) {
        return Promise.resolve({
          id,
          content: '{"root":{"children":[]}}',
          updated_at: 1,
        })
      }

      if (init.method === 'PUT' && id === 'file-1') {
        return Promise.reject(new Error('old note save failed'))
      }

      return Promise.resolve({
        id,
        content: '{"root":{"children":[]}}',
        updated_at: 2,
      })
    })

    await act(async () => {
      root.render(
        <TextEditor
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onStatusChange={(status) => statuses.push(status)}
        />
      )
    })
    await flushPromises()

    await act(async () => {
      globalThis.__textEditorMockOnChange('{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"dirty old note"}]}]}}')
      await Promise.resolve()
    })

    await act(async () => {
      root.render(
        <TextEditor
          activeId="file-2"
          deletedIds={new Set()}
          autoSaveOnSwitch
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onStatusChange={(status) => statuses.push(status)}
        />
      )
      await Promise.resolve()
    })

    await flushPromises()
    await flushPromises()

    expect(statuses.at(-1)).toMatchObject({
      activeId: 'file-2',
      saveError: false,
    })
  })

  it('recovers a fresher local draft while keeping it dirty against the server version', async () => {
    const server = '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"server"}]}]}}'
    const draft = '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"draft newer"}]}]}}'
    const statuses = []

    localStorage.setItem('editor:cache:file-1', JSON.stringify({
      content: draft,
      editedAt: Date.now(),
      savedAt: null,
    }))

    api.mockResolvedValue({
      id: 'file-1',
      content: server,
      updated_at: Math.floor((Date.now() - 60_000) / 1000),
    })

    await act(async () => {
      root.render(
        <TextEditor
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch={false}
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onStatusChange={(status) => statuses.push(status)}
        />
      )
    })
    await flushPromises()

    expect(globalThis.__textEditorMockInitialContent).toBe(draft)
    expect(statuses.at(-1)).toMatchObject({
      activeId: 'file-1',
      dirty: true,
      saveError: false,
    })

    localStorage.removeItem('editor:cache:file-1')
  })

  it('shows a retry path after save failure and clears the error after retry succeeds', async () => {
    const changed = '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"retry"}]}]}}'
    const statuses = []
    let putCount = 0

    api.mockImplementation((path, init) => {
      if (!init?.method) {
        return Promise.resolve({
          id: 'file-1',
          content: '{"root":{"children":[]}}',
          updated_at: 1,
        })
      }

      if (init.method === 'PUT') {
        putCount += 1
        if (putCount === 1) return Promise.reject(new Error('network down'))
        return Promise.resolve({
          id: 'file-1',
          content: changed,
          updated_at: 2,
        })
      }

      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })

    const editorRef = React.createRef()
    await act(async () => {
      root.render(
        <TextEditor
          ref={editorRef}
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch={false}
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onStatusChange={(status) => statuses.push(status)}
        />
      )
    })
    await flushPromises()

    await act(async () => {
      globalThis.__textEditorMockOnChange(changed)
      await Promise.resolve()
    })

    await act(async () => {
      await expect(editorRef.current.save()).rejects.toThrow('network down')
    })
    await flushPromises()

    expect(statuses.at(-1)).toMatchObject({
      saveError: true,
      dirty: true,
    })

    const retry = container.querySelector('.status-retry-btn')
    expect(retry).toBeTruthy()

    await act(async () => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushPromises()

    expect(putCount).toBe(2)
    expect(statuses.at(-1)).toMatchObject({
      saveError: false,
      dirty: false,
    })
  })

  it('replaces repaired content as a saved editor state without re-saving stale content', async () => {
    const original = '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"old"}]}]}}'
    const repaired = '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"repaired"}]}]}}'
    const statuses = []

    api.mockImplementation((path, init) => {
      if (!init?.method) {
        return Promise.resolve({
          id: 'file-1',
          content: original,
          updated_at: 1,
        })
      }
      return Promise.reject(new Error('repaired saved content should not be written again'))
    })

    const editorRef = React.createRef()
    await act(async () => {
      root.render(
        <TextEditor
          ref={editorRef}
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch={false}
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
          onStatusChange={(status) => statuses.push(status)}
        />
      )
    })
    await flushPromises()

    await act(async () => {
      editorRef.current.replaceSavedContent(repaired, 7)
      await Promise.resolve()
    })

    expect(globalThis.__textEditorMockInitialContent).toBe(repaired)
    expect(JSON.parse(localStorage.getItem('editor:cache:file-1'))).toMatchObject({
      content: repaired,
      savedAt: 7000,
    })
    expect(statuses.at(-1)).toMatchObject({
      activeId: 'file-1',
      dirty: false,
      saveError: false,
    })

    let result
    await act(async () => {
      result = await editorRef.current.save()
    })

    expect(result).toMatchObject({
      id: 'file-1',
      content: repaired,
      skipped: true,
    })
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('reuses the in-flight save when interval save overlaps manual save', async () => {
    const putRequests = []

    api.mockImplementation((path, init) => {
      if (!init?.method) {
        return Promise.resolve({
          id: 'file-1',
          content: '{"root":{"children":[]}}',
          updated_at: 1,
        })
      }

      if (init.method === 'PUT') {
        return new Promise((resolve, reject) => {
          const abort = () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          }

          if (init.signal?.aborted) {
            abort()
            return
          }

          init.signal?.addEventListener('abort', abort, { once: true })

          putRequests.push({
            resolve: (value) => {
              init.signal?.removeEventListener('abort', abort)
              resolve(value)
            },
          })
        })
      }

      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })

    const editorRef = React.createRef()

    await act(async () => {
      root.render(
        <TextEditor
          ref={editorRef}
          activeId="file-1"
          deletedIds={new Set()}
          autoSaveOnSwitch={false}
          onChange={() => {}}
          onLoaded={() => {}}
          onSaved={() => {}}
        />
      )
    })

    await flushPromises()

    await act(async () => {
      globalThis.__textEditorMockOnChange('{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"changed"}]}]}}')
      await Promise.resolve()
    })

    let savePromise
    await act(async () => {
      savePromise = editorRef.current.save()
    })

    expect(putRequests).toHaveLength(1)

    await act(async () => {
      vi.advanceTimersByTime(30000)
      await Promise.resolve()
    })

    expect(putRequests).toHaveLength(1)

    await act(async () => {
      putRequests[0].resolve({
        id: 'file-1',
        content: '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"changed"}]}]}}',
        updated_at: 2,
      })
      await savePromise
    })

    await expect(savePromise).resolves.toMatchObject({
      id: 'file-1',
      updated_at: 2,
    })
  })

  describe('exit cache and strict save receipt regression', () => {
    const baseline = '{"root":{"children":[]}}'
    const draft = '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"unsent draft"}]}]}}'
    async function mountNote(props = {}) {
      await act(async () => root.render(<TextEditor activeId="file-1" autoSaveOnSwitch={false} {...props} />))
      await flushPromises()
    }
    async function edit(content) {
      await act(async () => { globalThis.__textEditorMockOnChange(content); await Promise.resolve() })
    }
    async function removeEditor() {
      await act(async () => root.render(null))
    }

    it('does not create a draft when an unchanged note is unmounted', async () => {
      api.mockResolvedValue({ id: 'file-1', content: baseline, updated_at: 1 })
      await mountNote(); await removeEditor()
      expect(readEditorDraft('file-1')).toBeNull()
    })

    it('reopens a changed server note without a phantom cache from the previous clean mount', async () => {
      api.mockResolvedValue({ id: 'file-1', content: baseline, updated_at: 1 })
      await mountNote(); await removeEditor()
      // No cache reset between the two mounts: this reproduces the old regression.
      api.mockResolvedValue({ id: 'file-1', content: draft, updated_at: 1 })
      await mountNote()
      expect(globalThis.__textEditorMockInitialContent).toBe(draft)
      expect(readEditorDraft('file-1')).toBeNull()
    })

    it('keeps the original cache age during a clean quit inspection', async () => {
      writeEditorDraft('file-1', baseline, 1000)
      const before = readEditorDraft('file-1')
      api.mockResolvedValue({ id: 'file-1', content: baseline, updated_at: 1 })
      await mountNote()
      await act(async () => { vi.advanceTimersByTime(1000); await editorQuit.flush() })
      expect(readEditorDraft('file-1')).toEqual(before)
      expect(api).toHaveBeenCalledTimes(1)
    })

    it('retains an unsent dirty draft before the cache debounce fires', async () => {
      api.mockResolvedValue({ id: 'file-1', content: baseline, updated_at: 1 })
      await mountNote(); await edit(draft)
      expect(readEditorDraft('file-1')).toBeNull()
      await removeEditor()
      expect(readEditorDraft('file-1').content).toBe(draft)
      // Browser storage clearing must not be mistaken for clearing the memory fallback.
      localStorage.clear()
      expect(readEditorDraft('file-1').content).toBe(draft)
      await expect(editorQuit.flush()).rejects.toMatchObject({ code: 'unresolved' })
    })

    it('caches a reverted baseline before aborting its older in-flight write', async () => {
      api.mockImplementation((_path, options) => {
        if (!options?.method) return Promise.resolve({ id: 'file-1', content: baseline, updated_at: 1 })
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted'); error.name = 'AbortError'; reject(error)
          }, { once: true })
        })
      })
      const ref = React.createRef()
      await mountNote({ ref }); await edit(draft)
      let pending
      await act(async () => { pending = ref.current.save(); await Promise.resolve() })
      await edit(baseline); await removeEditor(); await pending
      expect(readEditorDraft('file-1').content).toBe(baseline)
      expect(editorQuit.pending()).toBe(1)
    })

    it.each([
      ['missing', undefined],
      ['wrong-id', { id: 'file-2', content: draft }],
      ['wrong-content', { id: 'file-1', content: 'not the submitted draft' }],
      ['missing-content', { id: 'file-1' }],
    ])('rejects a %s save receipt without approving the draft', async (_name, receipt) => {
      api.mockImplementation((_path, options) => Promise.resolve(options?.method
        ? receipt : { id: 'file-1', content: baseline, updated_at: 1 }))
      const ref = React.createRef(), onSaved = vi.fn()
      await mountNote({ ref, onSaved }); await edit(draft)
      await act(async () => { await expect(ref.current.save()).rejects.toThrow('正文保存响应未确认') })
      expect(ref.current.getReferenceRefactorState().savedContent).toBe(baseline)
      expect(onSaved).not.toHaveBeenCalled()
      expect(editorQuit.pending()).toBe(1)
      expect(container.textContent).toContain('保存失败')
    })
  })
})
