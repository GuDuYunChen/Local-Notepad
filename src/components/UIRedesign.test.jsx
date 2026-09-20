import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ConsumerHeader from './ConsumerHeader'
import NavigationRail from './NavigationRail'
import TrashPanel, { trashDaysRemaining } from './TrashPanel'
import { diagnosticsToText, formatDiagnosticBytes } from './SettingsPanel'
import TemplateSelector from './TemplateSelector'
import QuickSwitcher, { buildHighlightSegments, getSearchMatchScope } from './QuickSwitcher'
import ToastViewport from './ToastViewport'
import NameDialog from './NameDialog'
import { statusLabel } from './InspectorPanel'
import { toast } from '~/services/toast'
import { api, searchFiles } from '~/services/api'

vi.mock('./ThemeToggle', () => ({
  default: function MockThemeToggle() {
    return React.createElement('button', { 'aria-label': '切换主题' }, 'theme')
  },
}))

vi.mock('~/services/api', () => ({
  api: vi.fn(),
  searchFiles: vi.fn(),
}))

function click(element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('UI redesign smoke tests', () => {
  let container
  let root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    api.mockReset()
    searchFiles.mockReset()
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
    container?.remove()
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })

  it('switches workspaces and exposes global navigation actions', async () => {
    const onChangeWorkspace = vi.fn()
    const onOpenSearch = vi.fn()
    const onOpenBackup = vi.fn()
    const onOpenShortcuts = vi.fn()

    await act(async () => {
      root.render(
        <ConsumerHeader
          activeWorkspace="notes"
          onChangeWorkspace={onChangeWorkspace}
          onOpenSearch={onOpenSearch}
          onOpenBackup={onOpenBackup}
          onOpenShortcuts={onOpenShortcuts}
        />
      )
    })

    const searchButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('搜索'))
    const notesButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('笔记'))
    const dailyButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('每日笔记'))
    const graphButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('知识图谱'))
    const moreButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('更多'))

    expect(searchButton).toBeTruthy()
    expect(notesButton).toBeTruthy()
    expect(notesButton.classList.contains('active')).toBe(true)
    expect(dailyButton).toBeTruthy()
    expect(graphButton).toBeTruthy()
    expect(moreButton).toBeTruthy()

    await click(searchButton)
    expect(onOpenSearch).toHaveBeenCalledTimes(1)

    await click(dailyButton)
    expect(onChangeWorkspace).toHaveBeenCalledWith('daily')

    await click(graphButton)
    expect(onChangeWorkspace).toHaveBeenCalledWith('graph')

    const clickMoreItem = async (label) => {
      await click(moreButton)
      const item = Array.from(container.querySelectorAll('[role="menuitem"]'))
        .find(button => button.textContent.includes(label))
      expect(item).toBeTruthy()
      await click(item)
    }

    await clickMoreItem('回收站')
    expect(onChangeWorkspace).toHaveBeenCalledWith('trash')

    await clickMoreItem('设置')
    expect(onChangeWorkspace).toHaveBeenCalledWith('settings')

    await clickMoreItem('备份与恢复')
    expect(onOpenBackup).toHaveBeenCalledTimes(1)

    await clickMoreItem('快捷键')
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1)
  })

  it('keeps the minimal navigation rail focused on core consumer actions', async () => {
    const onChangeWorkspace = vi.fn()
    const onOpenSearch = vi.fn()

    await act(async () => {
      root.render(
        <NavigationRail
          activeWorkspace="notes"
          onChangeWorkspace={onChangeWorkspace}
          onOpenSearch={onOpenSearch}
        />
      )
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons.some(button => button.getAttribute('aria-label') === '搜索笔记')).toBe(true)
    expect(buttons.some(button => button.getAttribute('aria-label') === '笔记列表')).toBe(true)
    expect(buttons.some(button => button.getAttribute('aria-label') === '每日笔记')).toBe(true)
    expect(buttons.some(button => button.getAttribute('aria-label') === '更多功能')).toBe(true)
    expect(buttons.some(button => button.getAttribute('aria-label') === '知识图谱')).toBe(false)
    expect(buttons.some(button => button.getAttribute('aria-label') === '设置')).toBe(false)

    await click(buttons.find(button => button.getAttribute('aria-label') === '搜索笔记'))
    expect(onOpenSearch).toHaveBeenCalledTimes(1)

    await click(buttons.find(button => button.getAttribute('aria-label') === '每日笔记'))
    expect(onChangeWorkspace).toHaveBeenCalledWith('daily')

    await click(buttons.find(button => button.getAttribute('aria-label') === '更多功能'))
    const moreItems = Array.from(container.querySelectorAll('[role="menuitem"]'))
    expect(moreItems.some(button => button.textContent.includes('知识图谱'))).toBe(true)
    expect(moreItems.some(button => button.textContent.includes('回收站'))).toBe(true)
    expect(moreItems.some(button => button.textContent.includes('设置'))).toBe(true)
  })

  it('highlights the first search match without regex side effects', () => {
    expect(buildHighlightSegments('Alpha [Beta] Gamma', '[beta]')).toEqual([
      { text: 'Alpha ', match: false },
      { text: '[Beta]', match: true },
      { text: ' Gamma', match: false },
    ])
  })

  it('distinguishes title and body matches in quick search', () => {
    const file = {
      title: 'Project Notes',
      content: JSON.stringify({
        root: {
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: 'contains roadmap details' }] },
          ],
        },
      }),
    }

    expect(getSearchMatchScope(file, 'project')).toBe('title')
    expect(getSearchMatchScope(file, 'roadmap')).toBe('content')
    expect(getSearchMatchScope({ ...file, is_pinned: true }, '')).toBe('pinned')
  })

  it('opens recent notes and supports keyboard selection in quick search', async () => {
    const onSelectFile = vi.fn()
    const onClose = vi.fn()

    api.mockResolvedValue([
      {
        id: 'file-1',
        title: '第一篇笔记',
        content: '第一篇内容',
        updated_at: 100,
        is_folder: false,
        is_deleted: false,
      },
      {
        id: 'file-2',
        title: '第二篇笔记',
        content: '第二篇内容',
        updated_at: 200,
        is_folder: false,
        is_deleted: false,
      },
    ])
    searchFiles.mockResolvedValue([])

    await act(async () => {
      root.render(
        <QuickSwitcher open onClose={onClose} onSelectFile={onSelectFile} />
      )
    })
    await flushPromises()

    const input = container.querySelector('input[aria-label="搜索标题或正文"]')
    const results = container.querySelectorAll('.quick-switcher-result')

    expect(input).toBeTruthy()
    expect(results).toHaveLength(2)
    expect(api).toHaveBeenCalledTimes(1)
    expect(results[0].textContent).toContain('第二篇笔记')
    expect(results[1].textContent).toContain('第一篇笔记')

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await Promise.resolve()
    })

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })

    expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calculates recycle-bin retention without going below zero', () => {
    const now = new Date('2026-09-18T12:00:00Z').getTime()
    expect(trashDaysRemaining(Math.floor(now / 1000), now)).toBe(30)
    expect(trashDaysRemaining(Math.floor((now - 5 * 24 * 60 * 60 * 1000) / 1000), now)).toBe(25)
    expect(trashDaysRemaining(Math.floor((now - 40 * 24 * 60 * 60 * 1000) / 1000), now)).toBe(0)
  })

  it('restores a recycle-bin item through the restore endpoint', async () => {
    const onRestored = vi.fn()
    api.mockImplementation((path, init) => {
      if (path === '/api/files/trash' && !init?.method) {
        return Promise.resolve([
          {
            id: 'deleted-1',
            title: 'Deleted.md',
            is_folder: false,
            is_deleted: true,
            deleted_at: Math.floor(Date.now() / 1000),
          },
        ])
      }
      if (path === '/api/files/deleted-1/restore' && init?.method === 'POST') {
        return Promise.resolve(null)
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })

    await act(async () => {
      root.render(<TrashPanel onClose={() => {}} onRestored={onRestored} />)
    })
    await flushPromises()

    const restoreButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '恢复')

    expect(restoreButton).toBeTruthy()

    await click(restoreButton)
    await flushPromises()

    expect(api).toHaveBeenCalledWith('/api/files/deleted-1/restore', { method: 'POST' })
    expect(onRestored).toHaveBeenCalledWith(['deleted-1'])
    expect(container.textContent).toContain('回收站是空的')
  })

  it('uses an in-app confirmation before permanently deleting from trash', async () => {
    api.mockImplementation((path, init) => {
      if (path === '/api/files/trash' && !init?.method) {
        return Promise.resolve([
          {
            id: 'deleted-2',
            title: '旧笔记.md',
            is_folder: false,
            is_deleted: true,
            deleted_at: Math.floor(Date.now() / 1000),
          },
        ])
      }
      if (path === '/api/files/deleted-2/permanent' && init?.method === 'DELETE') {
        return Promise.resolve(null)
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })

    await act(async () => {
      root.render(<TrashPanel onClose={() => {}} onRestored={() => {}} />)
    })
    await flushPromises()

    const rowDeleteButton = Array.from(container.querySelectorAll('.trash-item-actions button'))
      .find(button => button.textContent === '永久删除')

    expect(rowDeleteButton).toBeTruthy()
    await click(rowDeleteButton)

    const dialog = container.querySelector('.consumer-confirm-modal')
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain('永久删除这项内容？')
    expect(dialog.textContent).toContain('旧笔记.md')

    const confirmButton = Array.from(dialog.querySelectorAll('button'))
      .find(button => button.textContent === '永久删除')
    await click(confirmButton)
    await flushPromises()

    expect(api).toHaveBeenCalledWith('/api/files/deleted-2/permanent', { method: 'DELETE' })
    expect(container.textContent).toContain('回收站是空的')
  })

  it('keeps file format and location behind secondary options when naming a note', async () => {
    const onConfirm = vi.fn().mockResolvedValue(null)
    const onCancel = vi.fn()

    await act(async () => {
      root.render(
        <NameDialog
          defaultName="未命名"
          title="新建笔记"
          message="给这篇笔记起个名字："
          showFormatSelect
          currentPathLabel="我的笔记 / 项目"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )
    })

    expect(container.textContent).toContain('新建笔记')
    expect(container.querySelector('select')).toBeNull()
    expect(container.textContent).not.toContain('我的笔记 / 项目')

    const optionsButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent.includes('更多选项'))
    expect(optionsButton).toBeTruthy()

    await click(optionsButton)

    expect(container.querySelector('select')).toBeTruthy()
    expect(container.textContent).toContain('保存格式')
    expect(container.textContent).toContain('我的笔记 / 项目')
  })

  it('formats diagnostics for display and copy', () => {
    expect(formatDiagnosticBytes(0)).toBe('0 B')
    expect(formatDiagnosticBytes(2048)).toBe('2.0 KB')
    expect(formatDiagnosticBytes(5 * 1024 * 1024)).toBe('5.0 MB')

    const text = diagnosticsToText(
      {
        integrity: 'ok',
        journal_mode: 'wal',
        foreign_keys: true,
        busy_timeout: 5000,
        database_size: 2048,
        active_notes: 3,
        active_folders: 1,
        trash_items: 2,
        backup_count: 4,
        data_dir: '/data',
        database_path: '/data/data.db',
        backup_dir: '/data/backups',
        upload_dir: '/data/uploads',
      },
      {
        version: '4.0.0',
        platform: 'win32',
        arch: 'x64',
        electron: '31.0.0',
        chrome: '126',
        node: '20',
        packaged: true,
      },
      12.4
    )

    expect(text).toContain('应用版本: 4.0.0')
    expect(text).toContain('数据库完整性: ok')
    expect(text).toContain('后端响应: 12 ms')
    expect(text).toContain('数据目录: /data')
  })

  it('maps editor save state consistently for the inspector', () => {
    expect(statusLabel({ saveError: true }, false)).toBe('保存失败')
    expect(statusLabel({ saving: true }, false)).toBe('保存中…')
    expect(statusLabel({ dirty: true }, false)).toBe('未保存')
    expect(statusLabel({ dirty: false, lastSavedAt: Date.now() }, false)).toBe('已保存')
    expect(statusLabel({}, false)).toBe('尚未保存')
  })

  it('shows and closes lightweight loading toasts', async () => {
    await act(async () => {
      root.render(<ToastViewport />)
    })

    let closeToast
    await act(async () => {
      closeToast = toast.loading('正在处理', 0)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('正在处理')

    await act(async () => {
      closeToast()
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('正在处理')
  })

  it('creates a blank note from the template selector', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <TemplateSelector open onClose={onClose} onSelect={onSelect} />
      )
    })

    const blankButton = Array.from(container.querySelectorAll('.template-card'))
      .find(button => button.textContent.includes('空白笔记'))

    expect(blankButton).toBeTruthy()
    await click(blankButton)
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('returns structured template content and closes with Escape', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <TemplateSelector open onClose={onClose} onSelect={onSelect} />
      )
    })

    const projectButton = Array.from(container.querySelectorAll('.template-card'))
      .find(button => button.textContent.includes('项目计划'))

    expect(projectButton).toBeTruthy()
    await click(projectButton)

    expect(onSelect).toHaveBeenCalledTimes(1)
    const selected = onSelect.mock.calls[0][0]
    expect(selected.id).toBe('project')
    expect(selected.content).toContain('里程碑')
    expect(selected.content).toContain('下一步')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
