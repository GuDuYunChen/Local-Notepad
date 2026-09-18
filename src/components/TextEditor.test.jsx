import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import TextEditor from './TextEditor'
import { api } from '~/services/api'

vi.mock('~/services/api', () => ({
  api: vi.fn(),
}))

vi.mock('~/services/tagApi', () => ({
  tagApi: {
    getFileTags: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('./Editor/Editor', () => ({
  default: function MockEditor({ onChange }) {
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
    vi.clearAllTimers()
    vi.useRealTimers()
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
        content: '{"root":{"children":[]}}',
        updated_at: 2,
      })
      await savePromise
    })

    await expect(savePromise).resolves.toMatchObject({
      id: 'file-1',
      updated_at: 2,
    })
  })
})
