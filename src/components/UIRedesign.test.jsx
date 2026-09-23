import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import WorkspaceSidebar from './WorkspaceSidebar'
import TrashPanel, { trashDaysRemaining } from './TrashPanel'
import { diagnosticsToText, formatDiagnosticBytes } from './SettingsPanel'
import TemplateSelector from './TemplateSelector'
import QuickSwitcher, { buildHighlightSegments, getSearchMatchScope } from './QuickSwitcher'
import ToastViewport from './ToastViewport'
import NameDialog from './NameDialog'
import ReferenceRefactorDialog from './ReferenceRefactorDialog'
import LongFormStructurePanel from './LongFormStructurePanel'
import ProjectWorkspacePanel from './ProjectWorkspacePanel'
import ProjectTodayCenter from './ProjectTodayCenter'
import FocusSessionBar from './FocusSessionBar'
import FocusSessionAnalyticsPanel from './FocusSessionAnalyticsPanel'
import ProjectInsightsPanel from './ProjectInsightsPanel'
import { compareLibraryItems } from './FileList'
import { statusLabel } from './InspectorPanel'
import { toast } from '~/services/toast'
import { api, listAllFilesWithContent, searchFiles } from '~/services/api'
import { tagApi } from '~/services/tagApi'
import {
  appendFocusSession,
  createFocusSession,
  finalizeFocusSession,
} from './focusSessionUtils'

vi.mock('./ThemeToggle', () => ({
  default: function MockThemeToggle() {
    return React.createElement('button', { 'aria-label': '切换主题' }, 'theme')
  },
}))

vi.mock('~/services/api', () => ({
  api: vi.fn(),
  listAllFilesWithContent: vi.fn(),
  searchFiles: vi.fn(),
}))

vi.mock('~/services/tagApi', () => ({
  tagApi: {
    list: vi.fn(),
    create: vi.fn(),
    getFileTags: vi.fn(),
    addFileTag: vi.fn(),
    removeFileTag: vi.fn(),
    getFilesByTag: vi.fn(),
  },
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
    listAllFilesWithContent.mockReset()
    searchFiles.mockReset()
    tagApi.list.mockReset()
    tagApi.create.mockReset()
    tagApi.getFileTags.mockReset()
    tagApi.addFileTag.mockReset()
    tagApi.removeFileTag.mockReset()
    tagApi.getFilesByTag.mockReset()
    tagApi.list.mockResolvedValue([])
    tagApi.getFilesByTag.mockResolvedValue([])
    localStorage.clear()
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

  it('renders a complete expanded workspace sidebar by default', async () => {
    const onChangeWorkspace = vi.fn()
    const onOpenSearch = vi.fn()
    const onOpenBackup = vi.fn()
    const onOpenShortcuts = vi.fn()
    const onToggleCollapsed = vi.fn()

    await act(async () => {
      root.render(
        <WorkspaceSidebar
          activeWorkspace="notes"
          collapsed={false}
          onToggleCollapsed={onToggleCollapsed}
          onChangeWorkspace={onChangeWorkspace}
          onOpenSearch={onOpenSearch}
          onOpenBackup={onOpenBackup}
          onOpenShortcuts={onOpenShortcuts}
        >
          <div data-library="true">笔记资料库</div>
        </WorkspaceSidebar>
      )
    })

    expect(container.textContent).toContain('记事本')
    expect(container.textContent).toContain('我的本地空间')
    expect(container.textContent).toContain('笔记资料库')

    const buttons = Array.from(container.querySelectorAll('button'))
    const searchButton = buttons.find(button => button.getAttribute('aria-label') === '搜索笔记')
    const notesButton = buttons.find(button => button.getAttribute('aria-label') === '笔记')
    const projectButton = buttons.find(button => button.getAttribute('aria-label') === '项目')
    const dailyButton = buttons.find(button => button.getAttribute('aria-label') === '每日笔记')
    const graphButton = buttons.find(button => button.getAttribute('aria-label') === '知识图谱')
    const moreButton = buttons.find(button => button.getAttribute('aria-label') === '更多功能')

    expect(searchButton).toBeTruthy()
    expect(notesButton).toBeTruthy()
    expect(notesButton.classList.contains('active')).toBe(true)
    expect(projectButton).toBeTruthy()
    expect(dailyButton).toBeTruthy()
    expect(graphButton).toBeTruthy()
    expect(moreButton).toBeTruthy()

    await click(searchButton)
    expect(onOpenSearch).toHaveBeenCalledTimes(1)

    await click(projectButton)
    expect(onChangeWorkspace).toHaveBeenCalledWith('projects')

    await click(dailyButton)
    expect(onChangeWorkspace).toHaveBeenCalledWith('daily')

    await click(moreButton)
    const moreItems = Array.from(container.querySelectorAll('[role="menuitem"]'))
    expect(moreItems.some(button => button.textContent.includes('回收站'))).toBe(true)
    expect(moreItems.some(button => button.textContent.includes('设置'))).toBe(true)
    expect(moreItems.some(button => button.textContent.includes('备份与恢复'))).toBe(true)
    expect(moreItems.some(button => button.textContent.includes('快捷键'))).toBe(true)

    await click(moreItems.find(button => button.textContent.includes('备份与恢复')))
    expect(onOpenBackup).toHaveBeenCalledTimes(1)
  })

  it('keeps the sidebar compact only after the user collapses it', async () => {
    await act(async () => {
      root.render(
        <WorkspaceSidebar
          activeWorkspace="notes"
          collapsed
          onToggleCollapsed={() => {}}
          onChangeWorkspace={() => {}}
          onOpenSearch={() => {}}
          onOpenBackup={() => {}}
          onOpenShortcuts={() => {}}
        >
          <div data-library="true">笔记资料库</div>
        </WorkspaceSidebar>
      )
    })

    expect(container.querySelector('.workspace-sidebar').classList.contains('collapsed')).toBe(true)
    expect(container.querySelector('[data-library="true"]')).toBeNull()
    expect(container.querySelector('button[aria-label="展开侧边栏"]')).toBeTruthy()
  })

  it('sorts pinned and newly created library items predictably', () => {
    const items = [
      { id: 'old', sort_order: 0, created_at: 100, is_pinned: false },
      { id: 'new', sort_order: 0, created_at: 200, is_pinned: false },
      { id: 'manual-top', sort_order: 5000, created_at: 50, is_pinned: false },
      { id: 'pinned', sort_order: 10, created_at: 1, is_pinned: true },
    ]

    const sorted = [...items].sort(compareLibraryItems)

    expect(sorted.map(item => item.id)).toEqual([
      'pinned',
      'manual-top',
      'new',
      'old',
    ])
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

  it('organizes project work into persistent focused views', async () => {
    const onOpenFile = vi.fn()
    listAllFilesWithContent.mockResolvedValue([
      {
        id: 'project',
        title: '太初宇宙',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
      {
        id: 'volume-1',
        title: '第一卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 100,
      },
      {
        id: 'chapter-1',
        title: '第一章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 100,
        updated_at: 10,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '一二三' }],
            }],
          },
        }),
      },
    ])

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={onOpenFile}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    expect(container.textContent).toContain('项目工作台')
    expect(container.textContent).toContain('太初宇宙')

    const viewButtons = Array.from(
      container.querySelectorAll('.project-workspace-view-tabs button')
    )
    expect(viewButtons.map(button => button.querySelector('strong')?.textContent))
      .toEqual(['今日', '项目', '计划', '分析', '洞察', '结构'])

    expect(container.textContent).toContain('今日创作中心')
    expect(container.textContent).toContain('创作日历与冲刺')
    expect(container.textContent).not.toContain('创作计划')
    expect(container.textContent).not.toContain('创作分析')
    expect(container.textContent).not.toContain('创作洞察与自动复盘')

    const sprintButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent.includes('7 天'))
    expect(sprintButton).toBeTruthy()
    await click(sprintButton)
    expect(container.textContent).toContain('冲刺进度')

    const reviewInput = container.querySelector('textarea[aria-label="今日写作复盘"]')
    expect(reviewInput).toBeTruthy()

    const todayPlanJump = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '查看计划')
    expect(todayPlanJump).toBeTruthy()
    await click(todayPlanJump)

    expect(container.textContent).toContain('创作计划')
    expect(container.textContent).toContain('项目节奏')
    expect(container.textContent).toContain('卷级里程碑')
    expect(container.textContent).toContain('下一章节队列')
    expect(container.textContent).not.toContain('今日创作中心')

    const presetButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '应用小说节奏')
    expect(presetButton).toBeTruthy()
    await click(presetButton)

    expect(container.querySelector('input[aria-label="每日写作目标"]').value)
      .toBe('2000')
    expect(container.querySelector('input[aria-label="每周写作目标"]').value)
      .toBe('12000')

    const analysisTab = viewButtons.find(
      button => button.querySelector('strong')?.textContent === '分析'
    )
    await click(analysisTab)

    expect(container.textContent).toContain('创作分析')
    expect(container.textContent).toContain('写作节奏')
    expect(container.textContent).toContain('Session 分析与复盘')
    expect(container.textContent).not.toContain('创作计划')

    const insightJump = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '查看洞察')
    expect(insightJump).toBeTruthy()
    await click(insightJump)

    expect(container.textContent).toContain('创作洞察与自动复盘')
    expect(container.textContent).toContain('需要注意')
    expect(container.textContent).not.toContain('创作分析')

    const projectTab = viewButtons.find(
      button => button.querySelector('strong')?.textContent === '项目'
    )
    await click(projectTab)

    expect(container.textContent).toContain('创作进度')
    expect(container.textContent).toContain('最近写作')
    expect(container.textContent).toContain('项目索引')
    expect(container.textContent).toContain('第一卷')
    expect(container.textContent).toContain('第一章')
    expect(container.textContent).toContain('3 字')
    expect(container.textContent).toContain('草稿')
    expect(container.querySelector('input[aria-label="搜索项目章节"]')).toBeTruthy()
    expect(container.querySelector('select[aria-label="按章节状态筛选"]')).toBeTruthy()
    expect(container.querySelector('select[aria-label="按卷筛选"]')).toBeTruthy()
    expect(container.querySelector('.project-board-filter-summary').textContent)
      .toContain('1')
    expect(container.textContent).not.toContain('创作计划')
    expect(localStorage.getItem('localNotepad.projectWorkspace.activeView'))
      .toBe('project')

    const statusButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '草稿')
    await click(statusButton)
    expect(container.textContent).toContain('修订')

    const chapterButton = Array.from(container.querySelectorAll('button'))
      .find(button => (
        button.textContent.includes('第一章') &&
        button.classList.contains('project-chapter-open')
      ))
    await click(chapterButton)
    expect(onOpenFile).toHaveBeenCalledWith('chapter-1')

    const projectActions = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent.includes('项目操作'))
    expect(projectActions).toBeTruthy()
    await click(projectActions)

    const actionsMenu = container.querySelector('.project-actions-menu')
    expect(actionsMenu).toBeTruthy()
    expect(actionsMenu.textContent).toContain('初始化项目模板')
    expect(actionsMenu.textContent).toContain('合并导出 Markdown')
    expect(actionsMenu.textContent).toContain('合并导出 Word')

    const scriptButton = Array.from(actionsMenu.querySelectorAll('button'))
      .find(button => button.textContent === '剧本')
    await click(scriptButton)
    expect(container.textContent).toContain('剧本项目')
  })

  it('selects visible chapters and applies bulk status and move actions', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'project'
    )

    const projectFiles = [
      {
        id: 'project',
        title: '批量项目',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
      {
        id: 'volume-1',
        title: '第一卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 100,
      },
      {
        id: 'volume-2',
        title: '第二卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 200,
      },
      {
        id: 'chapter-1',
        title: '第一章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 100,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '第一章正文' }],
            }],
          },
        }),
      },
      {
        id: 'chapter-2',
        title: '第二章.md',
        is_folder: false,
        parent_id: 'volume-2',
        sort_order: 100,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '第二章正文' }],
            }],
          },
        }),
      },
    ]

    listAllFilesWithContent.mockResolvedValue(projectFiles)
    api.mockResolvedValue(null)

    const openDirectoryDialog = vi.fn().mockResolvedValue('C:/exports')
    const exportCombinedManuscript = vi.fn().mockResolvedValue({
      success: true,
      path: 'C:/exports/批量项目-选中章节.md',
    })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        openDirectoryDialog,
        exportCombinedManuscript,
      },
    })

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={() => {}}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    const bulkToggle = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '批量选择')
    expect(bulkToggle).toBeTruthy()
    await click(bulkToggle)

    const bulkbar = container.querySelector('.project-board-bulkbar')
    expect(bulkbar).toBeTruthy()
    expect(container.querySelectorAll('.project-chapter-select input'))
      .toHaveLength(2)

    const selectVisible = Array.from(bulkbar.querySelectorAll('button'))
      .find(button => button.textContent === '选择当前结果')
    await click(selectVisible)

    expect(bulkbar.textContent).toContain('已选 2 章节')
    expect(container.querySelectorAll('.project-chapter-card.selected'))
      .toHaveLength(2)

    const applyStatus = Array.from(bulkbar.querySelectorAll('button'))
      .find(button => button.textContent === '应用状态')
    await click(applyStatus)

    const saved = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(saved.project.statuses).toMatchObject({
      'chapter-1': 'review',
      'chapter-2': 'review',
    })

    const exportMarkdown = Array.from(bulkbar.querySelectorAll('button'))
      .find(button => button.textContent === 'MD')
    expect(exportMarkdown).toBeTruthy()
    await click(exportMarkdown)
    await flushPromises()

    expect(openDirectoryDialog).toHaveBeenCalledTimes(1)
    expect(exportCombinedManuscript).toHaveBeenCalledWith(
      ['chapter-1', 'chapter-2'],
      'C:/exports',
      'markdown',
      '批量项目-选中章节',
    )

    const moveTarget = bulkbar.querySelector('select[aria-label="批量移动目标卷"]')
    await act(async () => {
      moveTarget.value = 'volume-2'
      moveTarget.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    const move = Array.from(bulkbar.querySelectorAll('button'))
      .find(button => button.textContent === '移动')
    await click(move)
    await flushPromises()

    const moveCalls = api.mock.calls
      .filter(([requestPath, init]) => (
        requestPath.startsWith('/api/files/') &&
        init?.method === 'PUT'
      ))
      .map(([requestPath, init]) => ({
        requestPath,
        body: JSON.parse(init.body),
      }))

    expect(moveCalls).toHaveLength(2)
    expect(moveCalls.every(call => call.body.parent_id === 'volume-2'))
      .toBe(true)

    delete window.electronAPI
  })

  it('quick creates batches duplicates and safely splits project chapters', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'project'
    )

    const structuredChapter = JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'heading',
            tag: 'h1',
            version: 1,
            children: [{ type: 'text', text: '第一章', version: 1 }],
          },
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', text: '前半正文', version: 1 }],
          },
          {
            type: 'heading',
            tag: 'h2',
            version: 1,
            children: [{ type: 'text', text: '夜入青崖镇', version: 1 }],
          },
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', text: '后半正文', version: 1 }],
          },
        ],
      },
    })

    const projectFiles = [
      {
        id: 'project',
        title: '章节管理项目',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
      {
        id: 'volume-1',
        title: '第一卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 100,
      },
      {
        id: 'chapter-1',
        title: '第一章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 100,
        content: structuredChapter,
      },
    ]

    listAllFilesWithContent.mockResolvedValue(projectFiles)
    let createdIndex = 0
    api.mockImplementation(async (requestPath, init) => {
      if (requestPath === '/api/files' && init?.method === 'POST') {
        const payload = JSON.parse(init.body)
        createdIndex += 1
        return {
          id: 'created-' + createdIndex,
          ...payload,
          sort_order: 1000 + createdIndex * 1000,
          updated_at: 1,
        }
      }
      if (requestPath.endsWith('/versions/snapshot') && init?.method === 'POST') {
        return null
      }
      if (requestPath.startsWith('/api/files/') && init?.method === 'PUT') {
        return null
      }
      if (requestPath.startsWith('/api/files/') && init?.method === 'DELETE') {
        return null
      }
      throw new Error('Unexpected request: ' + requestPath)
    })

    const onOpenFile = vi.fn()
    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={onOpenFile}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    const createToggle = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '新增章节')
    expect(createToggle).toBeTruthy()
    await click(createToggle)

    let createbar = container.querySelector('.project-board-createbar')
    expect(createbar).toBeTruthy()

    const createTarget = createbar.querySelector('select[aria-label="新建目标卷"]')
    await act(async () => {
      createTarget.value = 'volume-1'
      createTarget.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    const quickCreate = Array.from(createbar.querySelectorAll('button'))
      .find(button => button.textContent === '快速新建')
    await click(quickCreate)
    await flushPromises()

    const postBodiesAfterQuick = api.mock.calls
      .filter(([requestPath, init]) => (
        requestPath === '/api/files' && init?.method === 'POST'
      ))
      .map(([, init]) => JSON.parse(init.body))

    expect(postBodiesAfterQuick[0]).toMatchObject({
      title: '第二章.md',
      parent_id: 'volume-1',
      is_folder: false,
    })
    expect(onOpenFile).toHaveBeenCalledWith('created-1')

    createbar = container.querySelector('.project-board-createbar')
    expect(createbar).toBeTruthy()
    const titleTextarea = createbar.querySelector('textarea[aria-label="批量新增章节标题"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      ).set
      setter.call(titleTextarea, '番外一\n番外二')
      titleTextarea.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    const batchCreate = Array.from(createbar.querySelectorAll('button'))
      .find(button => button.textContent === '批量创建')
    await click(batchCreate)
    await flushPromises()

    const postBodiesAfterBatch = api.mock.calls
      .filter(([requestPath, init]) => (
        requestPath === '/api/files' && init?.method === 'POST'
      ))
      .map(([, init]) => JSON.parse(init.body))

    expect(postBodiesAfterBatch.slice(1, 3).map(body => body.title))
      .toEqual(['番外一.md', '番外二.md'])

    const bulkToggle = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '批量选择')
    await click(bulkToggle)

    let checkbox = container.querySelector(
      'input[aria-label="选择章节 第一章"]'
    )
    await act(async () => {
      checkbox.click()
      await Promise.resolve()
    })

    let bulkbar = container.querySelector('.project-board-bulkbar')
    const duplicate = Array.from(bulkbar.querySelectorAll('button'))
      .find(button => button.textContent === '复制')
    await click(duplicate)
    await flushPromises()

    const postBodiesAfterDuplicate = api.mock.calls
      .filter(([requestPath, init]) => (
        requestPath === '/api/files' && init?.method === 'POST'
      ))
      .map(([, init]) => JSON.parse(init.body))
    expect(postBodiesAfterDuplicate[3]).toMatchObject({
      title: '第一章 副本.md',
      content: structuredChapter,
      parent_id: 'volume-1',
    })

    checkbox = container.querySelector(
      'input[aria-label="选择章节 第一章"]'
    )
    await act(async () => {
      checkbox.click()
      await Promise.resolve()
    })

    bulkbar = container.querySelector('.project-board-bulkbar')
    const split = Array.from(bulkbar.querySelectorAll('button'))
      .find(button => button.textContent === '拆分')
    expect(split).toBeTruthy()
    await click(split)

    const preview = container.querySelector('.project-board-split-preview')
    expect(preview).toBeTruthy()
    expect(preview.textContent).toContain('夜入青崖镇')
    expect(
      preview.querySelector('input[aria-label="拆分后的新章节标题"]').value
    ).toBe('夜入青崖镇.md')

    const confirmSplit = Array.from(preview.querySelectorAll('button'))
      .find(button => button.textContent === '确认拆分')
    await click(confirmSplit)
    await flushPromises()

    expect(api).toHaveBeenCalledWith(
      '/api/files/chapter-1/versions/snapshot',
      { method: 'POST' },
    )

    const splitCreate = api.mock.calls
      .filter(([requestPath, init]) => (
        requestPath === '/api/files' && init?.method === 'POST'
      ))
      .map(([, init]) => JSON.parse(init.body))
      .find(body => body.title === '夜入青崖镇.md')

    expect(splitCreate).toBeTruthy()
    const splitTail = JSON.parse(splitCreate.content)
    expect(splitTail.root.children[0]).toMatchObject({
      type: 'heading',
      tag: 'h1',
    })

    const sourceUpdate = api.mock.calls.find(([requestPath, init]) => (
      requestPath === '/api/files/chapter-1' &&
      init?.method === 'PUT' &&
      JSON.parse(init.body).content
    ))
    expect(sourceUpdate).toBeTruthy()
    const sourceBody = JSON.parse(sourceUpdate[1].body)
    const splitHead = JSON.parse(sourceBody.content)
    expect(splitHead.root.children).toHaveLength(2)
  })

  it('uses chapter presets continuation volume management and relative inserts', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'project'
    )

    const chapterOne = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '第一章' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '冲突建立' }],
          },
          {
            type: 'paragraph',
            children: [{ type: 'text', text: '第一章正文不应续建复制' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '转折' }],
          },
        ],
      },
    })
    const chapterTwo = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '第二章' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '线索推进' }],
          },
          {
            type: 'paragraph',
            children: [{ type: 'text', text: '第二章正文不应续建复制' }],
          },
        ],
      },
    })

    const projectFiles = [
      {
        id: 'project',
        title: '模板项目',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
      {
        id: 'volume-1',
        title: '第一卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 100,
      },
      {
        id: 'chapter-1',
        title: '第一章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 100,
        content: chapterOne,
      },
      {
        id: 'chapter-2',
        title: '第二章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 200,
        content: chapterTwo,
      },
    ]

    listAllFilesWithContent.mockResolvedValue(projectFiles)
    let createdIndex = 0
    api.mockImplementation(async (requestPath, init) => {
      if (requestPath === '/api/files' && init?.method === 'POST') {
        const payload = JSON.parse(init.body)
        createdIndex += 1
        return {
          id: 'created-template-' + createdIndex,
          ...payload,
          sort_order: 1000 + createdIndex * 1000,
          updated_at: 1,
        }
      }
      if (requestPath.startsWith('/api/files/') && init?.method === 'PUT') {
        return null
      }
      throw new Error('Unexpected request: ' + requestPath)
    })

    const onOpenFile = vi.fn()
    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={onOpenFile}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    const volumeColumn = Array.from(
      container.querySelectorAll('.project-volume-column')
    ).find(column => column.textContent.includes('第一卷'))
    expect(volumeColumn).toBeTruthy()

    const manageVolume = Array.from(volumeColumn.querySelectorAll('button'))
      .find(button => button.textContent === '批量')
    await click(manageVolume)

    let bulkbar = container.querySelector('.project-board-bulkbar')
    expect(bulkbar).toBeTruthy()
    expect(bulkbar.textContent).toContain('已选 2 章节')
    expect(container.querySelectorAll('.project-chapter-card.selected'))
      .toHaveLength(2)

    const endSelection = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '结束多选')
    await click(endSelection)

    const createInVolume = Array.from(volumeColumn.querySelectorAll('button'))
      .find(button => button.textContent === '＋')
    await click(createInVolume)

    let createbar = container.querySelector('.project-board-createbar')
    expect(createbar).toBeTruthy()
    expect(
      createbar.querySelector('select[aria-label="新建目标卷"]').value
    ).toBe('volume-1')

    const presetSelect = createbar.querySelector('select[aria-label="章节模板"]')
    expect(Array.from(presetSelect.options).map(option => option.textContent))
      .toEqual(['标准章节', '冲突推进', '信息揭示', '空白'])

    await act(async () => {
      presetSelect.value = 'conflict'
      presetSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    const quickCreate = Array.from(createbar.querySelectorAll('button'))
      .find(button => button.textContent === '快速新建')
    await click(quickCreate)
    await flushPromises()

    const postsAfterPreset = api.mock.calls
      .filter(([requestPath, init]) => (
        requestPath === '/api/files' && init?.method === 'POST'
      ))
      .map(([, init]) => JSON.parse(init.body))

    expect(postsAfterPreset[0].title).toBe('第三章.md')
    expect(postsAfterPreset[0].parent_id).toBe('volume-1')
    expect(postsAfterPreset[0].content).toContain('冲突建立')
    expect(postsAfterPreset[0].content).toContain('章末钩子')

    createbar = container.querySelector('.project-board-createbar')
    const continueButton = Array.from(createbar.querySelectorAll('button'))
      .find(button => button.textContent === '从上一章续建')
    expect(continueButton).toBeTruthy()
    expect(continueButton.disabled).toBe(false)
    await click(continueButton)
    await flushPromises()

    const postsAfterContinue = api.mock.calls
      .filter(([requestPath, init]) => (
        requestPath === '/api/files' && init?.method === 'POST'
      ))
      .map(([, init]) => JSON.parse(init.body))

    expect(postsAfterContinue[1].content).toContain('线索推进')
    expect(postsAfterContinue[1].content).not.toContain('第二章正文不应续建复制')

    const firstCard = Array.from(container.querySelectorAll('.project-chapter-card'))
      .find(card => card.textContent.includes('第一章'))
    expect(firstCard).toBeTruthy()

    const afterInsert = Array.from(firstCard.querySelectorAll('button'))
      .find(button => button.textContent === '后插')
    expect(afterInsert).toBeTruthy()
    await click(afterInsert)
    await flushPromises()

    const postsAfterInsert = api.mock.calls
      .filter(([requestPath, init]) => (
        requestPath === '/api/files' && init?.method === 'POST'
      ))
      .map(([, init]) => JSON.parse(init.body))

    expect(postsAfterInsert[2].content).toContain('冲突建立')
    expect(postsAfterInsert[2].content).toContain('转折')
    expect(postsAfterInsert[2].content).not.toContain('第一章正文不应续建复制')
    expect(onOpenFile).toHaveBeenCalledWith('created-template-3')

    const reorderCalls = api.mock.calls.filter(([requestPath, init]) => (
      requestPath.startsWith('/api/files/') &&
      init?.method === 'PUT' &&
      JSON.parse(init.body).sort_order !== undefined
    ))
    expect(reorderCalls.length).toBeGreaterThan(0)
  })

  it('creates renames targets reorders and duplicates project volumes', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'project'
    )

    const fileStore = [
      {
        id: 'project',
        title: '卷管理项目',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
      {
        id: 'volume-1',
        title: '第一卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 100,
      },
      {
        id: 'volume-2',
        title: '第二卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 200,
      },
      {
        id: 'chapter-1',
        title: '第一章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 100,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '第一章正文' }],
            }],
          },
        }),
      },
      {
        id: 'chapter-2',
        title: '第二章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 200,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '第二章正文' }],
            }],
          },
        }),
      },
      {
        id: 'chapter-3',
        title: '第三章.md',
        is_folder: false,
        parent_id: 'volume-2',
        sort_order: 100,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '第三章正文' }],
            }],
          },
        }),
      },
    ]
    let createdIndex = 0
    listAllFilesWithContent.mockImplementation(async () => (
      fileStore.map(item => ({ ...item }))
    ))
    api.mockImplementation(async (requestPath, init) => {
      if (requestPath === '/api/files' && init?.method === 'POST') {
        const payload = JSON.parse(init.body)
        createdIndex += 1
        const siblings = fileStore.filter(item => (
          String(item.parent_id || '') === String(payload.parent_id || '')
        ))
        const created = {
          id: 'volume-created-' + createdIndex,
          ...payload,
          sort_order: siblings.reduce(
            (max, item) => Math.max(max, Number(item.sort_order) || 0),
            0,
          ) + 1000,
          updated_at: 1,
        }
        fileStore.push(created)
        return { ...created }
      }

      if (requestPath.startsWith('/api/files/') && init?.method === 'PUT') {
        const id = requestPath.split('/').pop()
        const target = fileStore.find(item => item.id === id)
        if (!target) throw new Error('missing file ' + id)
        Object.assign(target, JSON.parse(init.body))
        return { ...target }
      }

      if (requestPath.startsWith('/api/files/') && init?.method === 'DELETE') {
        const id = requestPath.split('/').pop()
        const index = fileStore.findIndex(item => item.id === id)
        if (index >= 0) fileStore.splice(index, 1)
        return null
      }

      throw new Error('Unexpected request: ' + requestPath)
    })

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={() => {}}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    const newVolume = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '新增卷')
    expect(newVolume).toBeTruthy()
    await click(newVolume)
    await flushPromises()

    const createdEmptyVolume = fileStore.find(item => (
      item.is_folder && item.title === '第三卷'
    ))
    expect(createdEmptyVolume).toBeTruthy()
    expect(container.textContent).toContain('第三卷')

    let firstVolume = Array.from(
      container.querySelectorAll('.project-volume-column')
    ).find(column => (
      column.querySelector('.project-volume-header strong')?.textContent === '第一卷'
    ))
    expect(firstVolume).toBeTruthy()

    let settings = Array.from(firstVolume.querySelectorAll('button'))
      .find(button => button.textContent === '设置')
    await click(settings)

    let manager = container.querySelector('.project-volume-manager')
    expect(manager).toBeTruthy()

    const nameInput = manager.querySelector('input[aria-label="卷名称"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(nameInput, '开篇卷')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    const targetInput = manager.querySelector(
      'input[aria-label="第一卷目标字数"]'
    )
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(targetInput, '50000')
      targetInput.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    const saveSettings = Array.from(manager.querySelectorAll('button'))
      .find(button => button.textContent === '保存设置')
    await click(saveSettings)
    await flushPromises()

    expect(fileStore.find(item => item.id === 'volume-1').title)
      .toBe('开篇卷')
    const storedMeta = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(storedMeta.project.volumeMilestones['volume-1'].targetWords)
      .toBe(50000)

    firstVolume = Array.from(
      container.querySelectorAll('.project-volume-column')
    ).find(column => (
      column.querySelector('.project-volume-header strong')?.textContent === '开篇卷'
    ))
    settings = Array.from(firstVolume.querySelectorAll('button'))
      .find(button => button.textContent === '设置')
    await click(settings)

    manager = container.querySelector('.project-volume-manager')
    const moveRight = Array.from(manager.querySelectorAll('button'))
      .find(button => button.textContent === '后移 →')
    await click(moveRight)
    await flushPromises()

    expect(fileStore.find(item => item.id === 'volume-2').sort_order)
      .toBeLessThan(fileStore.find(item => item.id === 'volume-1').sort_order)

    manager = container.querySelector('.project-volume-manager')
    const duplicateVolumeButton = Array.from(manager.querySelectorAll('button'))
      .find(button => button.textContent === '复制整卷')
    await click(duplicateVolumeButton)
    await flushPromises()

    const duplicatedVolume = fileStore.find(item => (
      item.is_folder && item.title === '开篇卷 副本'
    ))
    expect(duplicatedVolume).toBeTruthy()
    expect(fileStore.filter(item => (
      !item.is_folder && item.parent_id === duplicatedVolume.id
    )).map(item => item.title)).toEqual([
      '第一章.md',
      '第二章.md',
    ])
  })

  it('splits and merges complete project volumes without losing chapter ownership', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'project'
    )

    const lexical = text => JSON.stringify({
      root: {
        children: [{
          type: 'paragraph',
          children: [{ type: 'text', text }],
        }],
      },
    })
    const fileStore = [
      { id: 'project', title: '拆卷项目', is_folder: true, parent_id: '', sort_order: 100 },
      { id: 'volume-1', title: '第一卷', is_folder: true, parent_id: 'project', sort_order: 100 },
      { id: 'volume-2', title: '第二卷', is_folder: true, parent_id: 'project', sort_order: 200 },
      { id: 'chapter-1', title: '第一章.md', is_folder: false, parent_id: 'volume-1', sort_order: 100, content: lexical('一') },
      { id: 'chapter-2', title: '第二章.md', is_folder: false, parent_id: 'volume-1', sort_order: 200, content: lexical('二') },
      { id: 'chapter-3', title: '第三章.md', is_folder: false, parent_id: 'volume-1', sort_order: 300, content: lexical('三') },
      { id: 'chapter-4', title: '第四章.md', is_folder: false, parent_id: 'volume-2', sort_order: 100, content: lexical('四') },
    ]
    let createdIndex = 0
    listAllFilesWithContent.mockImplementation(async () => (
      fileStore.map(item => ({ ...item }))
    ))
    api.mockImplementation(async (requestPath, init) => {
      if (requestPath === '/api/files' && init?.method === 'POST') {
        const payload = JSON.parse(init.body)
        createdIndex += 1
        const created = {
          id: 'split-volume-' + createdIndex,
          ...payload,
          sort_order: 1000 + createdIndex * 1000,
          updated_at: 1,
        }
        fileStore.push(created)
        return { ...created }
      }
      if (requestPath.startsWith('/api/files/') && init?.method === 'PUT') {
        const id = requestPath.split('/').pop()
        const target = fileStore.find(item => item.id === id)
        Object.assign(target, JSON.parse(init.body))
        return { ...target }
      }
      if (requestPath.startsWith('/api/files/') && init?.method === 'DELETE') {
        const id = requestPath.split('/').pop()
        const index = fileStore.findIndex(item => item.id === id)
        if (index >= 0) fileStore.splice(index, 1)
        return null
      }
      throw new Error('Unexpected request: ' + requestPath)
    })

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={() => {}}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    let firstVolume = Array.from(
      container.querySelectorAll('.project-volume-column')
    ).find(column => (
      column.querySelector('.project-volume-header strong')?.textContent === '第一卷'
    ))
    let settings = Array.from(firstVolume.querySelectorAll('button'))
      .find(button => button.textContent === '设置')
    await click(settings)

    let manager = container.querySelector('.project-volume-manager')
    const splitStart = manager.querySelector(
      'select[aria-label="选择卷拆分起点"]'
    )
    await act(async () => {
      splitStart.value = 'chapter-2'
      splitStart.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    const splitButton = Array.from(manager.querySelectorAll('button'))
      .find(button => button.textContent === '拆为新卷')
    await click(splitButton)
    await flushPromises()

    const splitFolder = fileStore.find(item => (
      item.is_folder &&
      item.parent_id === 'project' &&
      item.title === '第三卷'
    ))
    expect(splitFolder).toBeTruthy()
    expect(fileStore.find(item => item.id === 'chapter-1').parent_id)
      .toBe('volume-1')
    expect(fileStore.find(item => item.id === 'chapter-2').parent_id)
      .toBe(splitFolder.id)
    expect(fileStore.find(item => item.id === 'chapter-3').parent_id)
      .toBe(splitFolder.id)

    const splitColumn = Array.from(
      container.querySelectorAll('.project-volume-column')
    ).find(column => (
      column.querySelector('.project-volume-header strong')?.textContent === '第三卷'
    ))
    expect(splitColumn).toBeTruthy()
    settings = Array.from(splitColumn.querySelectorAll('button'))
      .find(button => button.textContent === '设置')
    await click(settings)

    manager = container.querySelector('.project-volume-manager')
    const mergeTarget = manager.querySelector(
      'select[aria-label="合并目标卷"]'
    )
    await act(async () => {
      mergeTarget.value = 'volume-2'
      mergeTarget.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    const mergeButton = Array.from(manager.querySelectorAll('button'))
      .find(button => button.textContent === '合并并删除当前卷')
    await click(mergeButton)
    await flushPromises()

    expect(fileStore.some(item => item.id === splitFolder.id)).toBe(false)
    expect(fileStore.find(item => item.id === 'chapter-2').parent_id)
      .toBe('volume-2')
    expect(fileStore.find(item => item.id === 'chapter-3').parent_id)
      .toBe('volume-2')
  })

  it('switches project views with Alt shortcuts without hijacking form input', async () => {
    listAllFilesWithContent.mockResolvedValue([
      {
        id: 'project',
        title: '快捷项目',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
      {
        id: 'chapter-1',
        title: '第一章.md',
        is_folder: false,
        parent_id: 'project',
        sort_order: 100,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '正文' }],
            }],
          },
        }),
      },
    ])

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={() => {}}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: '3',
        altKey: true,
      }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain('创作计划')

    const dailyGoal = container.querySelector('input[aria-label="每日写作目标"]')
    expect(dailyGoal).toBeTruthy()

    await act(async () => {
      dailyGoal.dispatchEvent(new KeyboardEvent('keydown', {
        key: '5',
        altKey: true,
        bubbles: true,
      }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain('创作计划')
    expect(container.textContent).not.toContain('创作洞察与自动复盘')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: '4',
        altKey: true,
      }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain('创作分析')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: '5',
        altKey: true,
      }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain('创作洞察与自动复盘')

    const adjustPlan = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '调整计划')
    expect(adjustPlan).toBeTruthy()
    await click(adjustPlan)
    expect(container.textContent).toContain('创作计划')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: '6',
        altKey: true,
      }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain('长篇结构总览')
    expect(
      container.querySelector('.project-workspace-view-tabs button.active strong')
        .textContent
    ).toBe('结构')
  })

  it('renders and filters the long-form story map with project index coverage', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'structure'
    )
    localStorage.setItem(
      'localNotepad.projectWorkspace.v1',
      JSON.stringify({
        project: {
          type: 'novel',
          targetWords: 100000,
          chapterTargetWords: 3000,
          statuses: {
            'chapter-1': 'done',
            'chapter-2': 'review',
          },
          summaries: {
            'chapter-2': '青崖镇冲突升级',
          },
          supportNoteIds: [],
          foreshadowStates: {},
          volumeMilestones: {
            'volume-1': {
              targetWords: 12000,
            },
          },
          chapterQueue: [],
          sprint: null,
          dailyReviews: {},
        },
      })
    )

    listAllFilesWithContent.mockResolvedValue([
      {
        id: 'project',
        title: '故事地图项目',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
      {
        id: 'volume-1',
        title: '第一卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 100,
      },
      {
        id: 'volume-2',
        title: '第二卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 200,
      },
      {
        id: 'chapter-1',
        title: '第一章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 100,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '开篇正文' }],
            }],
          },
        }),
      },
      {
        id: 'chapter-2',
        title: '第二章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 200,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '青崖镇正文' }],
            }],
          },
        }),
      },
    ])

    tagApi.list.mockResolvedValue([
      { id: 'tag-character', name: '角色' },
      { id: 'tag-location', name: '地点' },
      { id: 'tag-foreshadow', name: '伏笔' },
    ])
    tagApi.getFilesByTag.mockImplementation(async tagId => {
      if (tagId === 'tag-character') {
        return [{ id: 'chapter-1', title: '第一章.md', updated_at: 1 }]
      }
      if (tagId === 'tag-location') {
        return [{ id: 'chapter-2', title: '第二章.md', updated_at: 2 }]
      }
      if (tagId === 'tag-foreshadow') {
        return [{ id: 'chapter-2', title: '第二章.md', updated_at: 2 }]
      }
      return []
    })

    const onOpenFile = vi.fn()
    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={onOpenFile}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()
    await flushPromises()

    expect(container.textContent).toContain('长篇结构总览')
    expect(container.textContent).toContain('第一卷')
    expect(container.textContent).toContain('第二卷')
    expect(container.querySelectorAll('.project-story-node')).toHaveLength(2)
    expect(container.textContent).toContain('人物索引')
    expect(container.textContent).toContain('地点索引')
    expect(container.textContent).toContain('伏笔索引')
    expect(container.textContent).toContain('人物')
    expect(container.textContent).toContain('地点')
    expect(container.textContent).toContain('伏笔')

    const search = container.querySelector('input[aria-label="搜索故事地图"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(search, '青崖镇')
      search.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.querySelectorAll('.project-story-node')).toHaveLength(1)
    const visibleNode = container.querySelector('.project-story-node')
    expect(visibleNode.textContent).toContain('第二章')
    expect(visibleNode.textContent).toContain('青崖镇冲突升级')

    await click(visibleNode)
    expect(onOpenFile).toHaveBeenCalledWith('chapter-2')

    const markerFilter = container.querySelector(
      'select[aria-label="故事地图索引筛选"]'
    )
    await act(async () => {
      markerFilter.value = 'foreshadows'
      markerFilter.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    expect(container.querySelectorAll('.project-story-node')).toHaveLength(1)
  })

  it('creates character arcs and foreshadow lifecycle nodes on real chapters', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'structure'
    )

    listAllFilesWithContent.mockResolvedValue([
      {
        id: 'project',
        title: '生命周期项目',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
      {
        id: 'volume-1',
        title: '第一卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 100,
      },
      {
        id: 'chapter-1',
        title: '第一章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 100,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '关关初次登场' }],
            }],
          },
        }),
      },
      {
        id: 'chapter-2',
        title: '第二章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 200,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '黑铁副印揭示' }],
            }],
          },
        }),
      },
    ])

    tagApi.list.mockResolvedValue([
      { id: 'tag-character', name: '角色' },
      { id: 'tag-foreshadow', name: '伏笔' },
    ])
    tagApi.getFilesByTag.mockImplementation(async tagId => {
      if (tagId === 'tag-character') {
        return [{ id: 'chapter-1', title: '第一章.md', updated_at: 1 }]
      }
      if (tagId === 'tag-foreshadow') {
        return [{ id: 'chapter-2', title: '第二章.md', updated_at: 2 }]
      }
      return []
    })

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={() => {}}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()
    await flushPromises()

    const typeSelect = container.querySelector(
      'select[aria-label="新建轨迹类型"]'
    )
    expect(typeSelect).toBeTruthy()

    await act(async () => {
      typeSelect.value = 'character'
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    let sourceSelect = container.querySelector(
      'select[aria-label="关联现有索引"]'
    )
    expect(sourceSelect).toBeTruthy()
    await act(async () => {
      sourceSelect.value = 'chapter-1'
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    let trackTitle = container.querySelector('input[aria-label="轨迹名称"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(trackTitle, '关关弧光')
      trackTitle.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    let createTrack = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '新建轨迹')
    await click(createTrack)
    await flushPromises()

    let chapterSelect = container.querySelector(
      'select[aria-label="轨迹节点章节"]'
    )
    await act(async () => {
      chapterSelect.value = 'chapter-1'
      chapterSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    let noteInput = container.querySelector('input[aria-label="轨迹节点说明"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(noteInput, '初次登场并建立核心欲望')
      noteInput.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    let addNode = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '添加节点')
    await click(addNode)
    await flushPromises()

    let stored = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(stored.project.storylines).toHaveLength(1)
    expect(stored.project.storylines[0]).toMatchObject({
      title: '关关弧光',
      type: 'character',
      sourceNoteId: 'chapter-1',
    })
    expect(stored.project.storylines[0].events).toEqual([
      expect.objectContaining({
        noteId: 'chapter-1',
        stage: 'entry',
        note: '初次登场并建立核心欲望',
      }),
    ])

    await act(async () => {
      typeSelect.value = 'foreshadow'
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    sourceSelect = container.querySelector(
      'select[aria-label="关联现有索引"]'
    )
    await act(async () => {
      sourceSelect.value = 'chapter-2'
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    trackTitle = container.querySelector('input[aria-label="轨迹名称"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(trackTitle, '黑铁副印')
      trackTitle.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    createTrack = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '新建轨迹')
    await click(createTrack)
    await flushPromises()

    chapterSelect = container.querySelector(
      'select[aria-label="轨迹节点章节"]'
    )
    await act(async () => {
      chapterSelect.value = 'chapter-2'
      chapterSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    const stageSelect = container.querySelector(
      'select[aria-label="轨迹生命周期阶段"]'
    )
    await act(async () => {
      stageSelect.value = 'payoff'
      stageSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    addNode = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '添加节点')
    await click(addNode)
    await flushPromises()

    stored = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(stored.project.storylines).toHaveLength(2)
    expect(stored.project.storylines[1].events).toHaveLength(1)
    expect(stored.project.storylines[1].events[0]).toMatchObject({
      noteId: 'chapter-2',
      stage: 'payoff',
    })
    expect(stored.project.foreshadowStates['chapter-2']).toBe('recovered')

    const secondNode = Array.from(
      container.querySelectorAll('.project-story-node')
    ).find(node => node.textContent.includes('第二章'))
    expect(secondNode).toBeTruthy()
    expect(secondNode.textContent).toContain('回收')

    const foreshadowTrack = Array.from(
      container.querySelectorAll('.project-storyline-list > button')
    ).find(button => button.textContent.includes('黑铁副印'))
    expect(foreshadowTrack.textContent).toContain('已收束')
  })

  it('renders storyline intersection matrix rhythm diagnostics and chapter hotspots', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'structure'
    )
    localStorage.setItem(
      'localNotepad.projectWorkspace.v1',
      JSON.stringify({
        project: {
          type: 'novel',
          targetWords: 0,
          chapterTargetWords: 0,
          dailyGoal: 0,
          weeklyGoal: 0,
          deadline: '',
          statuses: {},
          summaries: {},
          supportNoteIds: [],
          foreshadowStates: {},
          volumeMilestones: {},
          chapterQueue: [],
          sprint: null,
          dailyReviews: {},
          storylines: [
            {
              id: 'plot-main',
              title: '调查主线',
              type: 'plot',
              sourceNoteId: '',
              description: '',
              events: [
                { id: 'p1', noteId: 'chapter-1', stage: 'setup', note: '' },
                { id: 'p2', noteId: 'chapter-5', stage: 'advance', note: '' },
              ],
            },
            {
              id: 'char-main',
              title: '关关弧光',
              type: 'character',
              sourceNoteId: '',
              description: '',
              events: [
                { id: 'c1', noteId: 'chapter-1', stage: 'entry', note: '' },
                { id: 'c2', noteId: 'chapter-2', stage: 'desire', note: '' },
              ],
            },
            {
              id: 'foreshadow-main',
              title: '副印伏笔',
              type: 'foreshadow',
              sourceNoteId: '',
              description: '',
              events: [
                { id: 'f1', noteId: 'chapter-1', stage: 'plant', note: '' },
                { id: 'f2', noteId: 'chapter-5', stage: 'payoff', note: '' },
              ],
            },
          ],
        },
      })
    )

    const lexical = text => JSON.stringify({
      root: {
        children: [{
          type: 'paragraph',
          children: [{ type: 'text', text }],
        }],
      },
    })

    listAllFilesWithContent.mockResolvedValue([
      { id: 'project', title: '交叉诊断项目', is_folder: true, parent_id: '', sort_order: 100 },
      { id: 'volume-1', title: '第一卷', is_folder: true, parent_id: 'project', sort_order: 100 },
      { id: 'volume-2', title: '第二卷', is_folder: true, parent_id: 'project', sort_order: 200 },
      { id: 'chapter-1', title: '第一章.md', is_folder: false, parent_id: 'volume-1', sort_order: 100, content: lexical('一') },
      { id: 'chapter-2', title: '第二章.md', is_folder: false, parent_id: 'volume-1', sort_order: 200, content: lexical('二') },
      { id: 'chapter-3', title: '第三章.md', is_folder: false, parent_id: 'volume-1', sort_order: 300, content: lexical('三') },
      { id: 'chapter-4', title: '第四章.md', is_folder: false, parent_id: 'volume-2', sort_order: 100, content: lexical('四') },
      { id: 'chapter-5', title: '第五章.md', is_folder: false, parent_id: 'volume-2', sort_order: 200, content: lexical('五') },
    ])
    tagApi.list.mockResolvedValue([])
    tagApi.getFilesByTag.mockResolvedValue([])

    const onOpenFile = vi.fn()
    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={onOpenFile}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()
    await flushPromises()

    const diagnostics = container.querySelector(
      '.project-storyline-diagnostics'
    )
    expect(diagnostics).toBeTruthy()
    expect(diagnostics.textContent).toContain('剧情线交叉与节奏诊断')
    expect(diagnostics.textContent).toContain('跨卷轨迹矩阵')
    expect(diagnostics.textContent).toContain('调查主线')
    expect(diagnostics.textContent).toContain('最长断档 3 章')
    expect(diagnostics.textContent).toContain('生命周期缺口')
    expect(diagnostics.textContent).toContain('收束')
    expect(diagnostics.textContent).toContain('章节交汇热点')
    expect(diagnostics.textContent).toContain('3 条轨迹 / 3 节点')

    const overloadedNode = Array.from(
      container.querySelectorAll('.project-story-node.storyline-overloaded')
    ).find(node => node.textContent.includes('第一章'))
    expect(overloadedNode).toBeTruthy()

    const hotspot = Array.from(
      diagnostics.querySelectorAll('.project-storyline-hotspots button')
    ).find(button => button.textContent.includes('第一章'))
    expect(hotspot).toBeTruthy()
    await click(hotspot)
    expect(onOpenFile).toHaveBeenCalledWith('chapter-1')

    const matrixRows = diagnostics.querySelectorAll(
      '.project-storyline-matrix-row:not(.head)'
    )
    expect(matrixRows).toHaveLength(3)
  })

  it('creates filters focuses opens and deletes project entity relationships', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'structure'
    )

    const lexical = text => JSON.stringify({
      root: {
        children: [{
          type: 'paragraph',
          children: [{ type: 'text', text }],
        }],
      },
    })

    listAllFilesWithContent.mockResolvedValue([
      { id: 'project', title: '关系图项目', is_folder: true, parent_id: '', sort_order: 100 },
      { id: 'volume-1', title: '第一卷', is_folder: true, parent_id: 'project', sort_order: 100 },
      { id: 'chapter-1', title: '关关.md', is_folder: false, parent_id: 'volume-1', sort_order: 100, content: lexical('人物') },
      { id: 'chapter-2', title: '青崖镇.md', is_folder: false, parent_id: 'volume-1', sort_order: 200, content: lexical('地点') },
      { id: 'chapter-3', title: '黑铁副印.md', is_folder: false, parent_id: 'volume-1', sort_order: 300, content: lexical('伏笔') },
    ])
    tagApi.list.mockResolvedValue([
      { id: 'tag-character', name: '角色' },
      { id: 'tag-location', name: '地点' },
      { id: 'tag-foreshadow', name: '伏笔' },
    ])
    tagApi.getFilesByTag.mockImplementation(async tagId => {
      if (tagId === 'tag-character') {
        return [{ id: 'chapter-1', title: '关关.md', updated_at: 3 }]
      }
      if (tagId === 'tag-location') {
        return [{ id: 'chapter-2', title: '青崖镇.md', updated_at: 2 }]
      }
      if (tagId === 'tag-foreshadow') {
        return [{ id: 'chapter-3', title: '黑铁副印.md', updated_at: 1 }]
      }
      return []
    })

    const onOpenFile = vi.fn()
    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={onOpenFile}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()
    await flushPromises()

    const relationPanel = container.querySelector('.project-relation-panel')
    expect(relationPanel).toBeTruthy()
    expect(relationPanel.textContent).toContain('实体关系图')
    expect(relationPanel.querySelectorAll('.project-relation-node'))
      .toHaveLength(3)

    const entityType = relationPanel.querySelector(
      'select[aria-label="自定义实体类型"]'
    )
    await act(async () => {
      entityType.value = 'faction'
      entityType.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    const entityName = relationPanel.querySelector(
      'input[aria-label="自定义实体名称"]'
    )
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(entityName, '青莲剑宗')
      entityName.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    const addEntity = Array.from(relationPanel.querySelectorAll('button'))
      .find(button => button.textContent === '添加实体')
    await click(addEntity)
    await flushPromises()

    expect(container.querySelectorAll('.project-relation-node'))
      .toHaveLength(4)

    const source = container.querySelector(
      'select[aria-label="关系源实体"]'
    )
    const target = container.querySelector(
      'select[aria-label="关系目标实体"]'
    )
    const relationType = container.querySelector(
      'select[aria-label="新建关系类型"]'
    )
    const factionOption = Array.from(target.options)
      .find(option => option.textContent.includes('青莲剑宗'))
    expect(factionOption).toBeTruthy()

    await act(async () => {
      source.value = 'index:chapter-1'
      source.dispatchEvent(new Event('change', { bubbles: true }))
      relationType.value = 'belongs'
      relationType.dispatchEvent(new Event('change', { bubbles: true }))
      target.value = factionOption.value
      target.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    const relationLabel = container.querySelector(
      'input[aria-label="自定义关系标签"]'
    )
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(relationLabel, '宗门弟子')
      relationLabel.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    const addRelation = Array.from(
      container.querySelectorAll('.project-relation-create-grid button')
    ).find(button => button.textContent === '添加关系')
    await click(addRelation)
    await flushPromises()

    let stored = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(stored.project.relationEntities).toEqual([
      expect.objectContaining({
        label: '青莲剑宗',
        type: 'faction',
      }),
    ])
    expect(stored.project.relations).toEqual([
      expect.objectContaining({
        sourceId: 'index:chapter-1',
        targetId: factionOption.value,
        type: 'belongs',
        directed: true,
        label: '宗门弟子',
      }),
    ])
    expect(container.querySelectorAll('.project-relation-edges > g'))
      .toHaveLength(1)

    const factionNode = Array.from(
      container.querySelectorAll('.project-relation-node')
    ).find(node => node.textContent.includes('青莲剑宗'))
    expect(factionNode).toBeTruthy()
    await click(factionNode)

    const focusNeighbor = Array.from(
      container.querySelectorAll('.project-relation-detail button')
    ).find(button => button.textContent === '只看相邻')
    expect(focusNeighbor).toBeTruthy()
    await click(focusNeighbor)
    expect(container.querySelectorAll('.project-relation-node'))
      .toHaveLength(2)

    const clearFilters = Array.from(
      container.querySelectorAll('.project-relation-controls button')
    ).find(button => button.textContent === '清除筛选')
    await click(clearFilters)

    const characterNode = Array.from(
      container.querySelectorAll('.project-relation-node')
    ).find(node => node.textContent.includes('关关'))
    await click(characterNode)
    const openNote = Array.from(
      container.querySelectorAll('.project-relation-detail button')
    ).find(button => button.textContent === '打开关联笔记')
    await click(openNote)
    expect(onOpenFile).toHaveBeenCalledWith('chapter-1')

    const relationEdge = container.querySelector('.project-relation-edges > g')
    await click(relationEdge)
    const deleteRelation = Array.from(
      container.querySelectorAll('.project-relation-detail button')
    ).find(button => button.textContent === '删除关系')
    expect(deleteRelation).toBeTruthy()
    await click(deleteRelation)
    await flushPromises()

    stored = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(stored.project.relations).toEqual([])
  })

  it('records relationship evolution on chapters and updates the current graph state', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'structure'
    )
    localStorage.setItem(
      'localNotepad.projectWorkspace.v1',
      JSON.stringify({
        project: {
          type: 'novel',
          targetWords: 0,
          chapterTargetWords: 0,
          dailyGoal: 0,
          weeklyGoal: 0,
          deadline: '',
          statuses: {},
          summaries: {},
          supportNoteIds: [],
          foreshadowStates: {},
          volumeMilestones: {},
          chapterQueue: [],
          sprint: null,
          dailyReviews: {},
          storylines: [],
          relationEntities: [],
          relations: [{
            id: 'relationship-1',
            sourceId: 'index:chapter-1',
            targetId: 'index:chapter-2',
            type: 'ally',
            directed: false,
            label: '旧友',
            note: '',
            events: [{
              id: 'relationship-event-1',
              noteId: 'chapter-1',
              eventType: 'establish',
              relationType: 'ally',
              label: '结识',
              note: '第一次并肩',
            }],
          }],
        },
      })
    )

    const lexical = text => JSON.stringify({
      root: {
        children: [{
          type: 'paragraph',
          children: [{ type: 'text', text }],
        }],
      },
    })

    listAllFilesWithContent.mockResolvedValue([
      { id: 'project', title: '关系演化项目', is_folder: true, parent_id: '', sort_order: 100 },
      { id: 'volume-1', title: '第一卷', is_folder: true, parent_id: 'project', sort_order: 100 },
      { id: 'chapter-1', title: '第一章.md', is_folder: false, parent_id: 'volume-1', sort_order: 100, content: lexical('一') },
      { id: 'chapter-2', title: '第二章.md', is_folder: false, parent_id: 'volume-1', sort_order: 200, content: lexical('二') },
      { id: 'chapter-3', title: '第三章.md', is_folder: false, parent_id: 'volume-1', sort_order: 300, content: lexical('三') },
    ])
    tagApi.list.mockResolvedValue([
      { id: 'tag-character', name: '角色' },
    ])
    tagApi.getFilesByTag.mockImplementation(async tagId => (
      tagId === 'tag-character'
        ? [
          { id: 'chapter-1', title: '关关.md', updated_at: 3 },
          { id: 'chapter-2', title: '赵三.md', updated_at: 2 },
        ]
        : []
    ))

    const onOpenFile = vi.fn()
    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={onOpenFile}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()
    await flushPromises()

    let relationEdge = container.querySelector('.project-relation-edges > g')
    expect(relationEdge).toBeTruthy()
    expect(relationEdge.textContent).toContain('旧友')
    expect(relationEdge.textContent).toContain('同盟')
    await click(relationEdge)

    let chapterSelect = container.querySelector(
      'select[aria-label="关系变化章节"]'
    )
    let eventType = container.querySelector(
      'select[aria-label="关系变化类型"]'
    )
    let resultingType = container.querySelector(
      'select[aria-label="变化后的关系类型"]'
    )
    let eventNote = container.querySelector(
      'input[aria-label="关系变化说明"]'
    )
    expect(chapterSelect).toBeTruthy()

    await act(async () => {
      chapterSelect.value = 'chapter-2'
      chapterSelect.dispatchEvent(new Event('change', { bubbles: true }))
      eventType.value = 'break'
      eventType.dispatchEvent(new Event('change', { bubbles: true }))
      resultingType.value = 'rival'
      resultingType.dispatchEvent(new Event('change', { bubbles: true }))
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(eventNote, '立场冲突导致决裂')
      eventNote.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    let recordChange = Array.from(
      container.querySelectorAll('.project-relation-detail button')
    ).find(button => button.textContent === '记录关系变化')
    await click(recordChange)
    await flushPromises()

    let stored = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(stored.project.relations[0].events).toHaveLength(2)
    expect(stored.project.relations[0].events[1]).toMatchObject({
      noteId: 'chapter-2',
      eventType: 'break',
      relationType: 'rival',
      note: '立场冲突导致决裂',
    })

    relationEdge = container.querySelector('.project-relation-edges > g')
    expect(relationEdge.textContent).toContain('对立')
    expect(container.textContent).toContain('关系演化时间轴')
    expect(container.textContent).toContain('破裂')
    expect(container.textContent).toContain('立场冲突导致决裂')
    const secondStoryNode = Array.from(
      container.querySelectorAll('.project-story-node')
    ).find(node => node.textContent.includes('第二章'))
    expect(secondStoryNode).toBeTruthy()
    expect(secondStoryNode.textContent).toContain('关系·破裂')

    chapterSelect = container.querySelector(
      'select[aria-label="关系变化章节"]'
    )
    eventType = container.querySelector(
      'select[aria-label="关系变化类型"]'
    )
    resultingType = container.querySelector(
      'select[aria-label="变化后的关系类型"]'
    )
    await act(async () => {
      chapterSelect.value = 'chapter-3'
      chapterSelect.dispatchEvent(new Event('change', { bubbles: true }))
      eventType.value = 'repair'
      eventType.dispatchEvent(new Event('change', { bubbles: true }))
      resultingType.value = 'ally'
      resultingType.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    recordChange = Array.from(
      container.querySelectorAll('.project-relation-detail button')
    ).find(button => button.textContent === '记录关系变化')
    await click(recordChange)
    await flushPromises()

    stored = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(stored.project.relations[0].events).toHaveLength(3)
    expect(container.querySelector('.project-relation-current-state').textContent)
      .toContain('同盟')
    expect(container.querySelector('.project-relation-current-state').textContent)
      .toContain('2 次类型变化')

    const secondChapterTimeline = Array.from(
      container.querySelectorAll('.project-relation-timeline-chapter')
    ).find(button => button.textContent.includes('第二章'))
    expect(secondChapterTimeline).toBeTruthy()
    await click(secondChapterTimeline)
    expect(onOpenFile).toHaveBeenCalledWith('chapter-2')
  })

  it('discovers reviewable relation candidates from repeated explicit WikiLink co-occurrence', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'structure'
    )
    localStorage.setItem(
      'localNotepad.projectWorkspace.v1',
      JSON.stringify({
        project: {
          supportNoteIds: [
            'character-note',
            'location-note',
            'foreshadow-note',
          ],
        },
      })
    )

    const linkedContent = ids => JSON.stringify({
      root: {
        children: [{
          type: 'paragraph',
          children: ids.map((id, index) => ({
            type: 'wiki-link',
            id,
            title: ['关关', '青崖镇', '黑铁副印'][index] || ('实体' + index),
            sectionPath: [],
          })),
        }],
      },
    })

    listAllFilesWithContent.mockResolvedValue([
      { id: 'project', title: '共现项目', is_folder: true, parent_id: '', sort_order: 100 },
      { id: 'volume-1', title: '第一卷', is_folder: true, parent_id: 'project', sort_order: 100 },
      {
        id: 'character-note',
        title: '关关.md',
        is_folder: false,
        parent_id: 'project',
        sort_order: 10,
        content: linkedContent([]),
      },
      {
        id: 'location-note',
        title: '青崖镇.md',
        is_folder: false,
        parent_id: 'project',
        sort_order: 20,
        content: linkedContent([]),
      },
      {
        id: 'foreshadow-note',
        title: '黑铁副印.md',
        is_folder: false,
        parent_id: 'project',
        sort_order: 30,
        content: linkedContent([]),
      },
      {
        id: 'chapter-1',
        title: '第一章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 100,
        content: linkedContent(['character-note', 'location-note', 'foreshadow-note']),
      },
      {
        id: 'chapter-2',
        title: '第二章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 200,
        content: linkedContent(['character-note', 'location-note', 'foreshadow-note']),
      },
      {
        id: 'chapter-3',
        title: '第三章.md',
        is_folder: false,
        parent_id: 'volume-1',
        sort_order: 300,
        content: linkedContent(['character-note', 'location-note']),
      },
    ])

    tagApi.list.mockResolvedValue([
      { id: 'tag-character', name: '角色' },
      { id: 'tag-location', name: '地点' },
      { id: 'tag-foreshadow', name: '伏笔' },
    ])
    tagApi.getFilesByTag.mockImplementation(async tagId => {
      if (tagId === 'tag-character') {
        return [{ id: 'character-note', title: '关关.md', updated_at: 3 }]
      }
      if (tagId === 'tag-location') {
        return [{ id: 'location-note', title: '青崖镇.md', updated_at: 2 }]
      }
      if (tagId === 'tag-foreshadow') {
        return [{ id: 'foreshadow-note', title: '黑铁副印.md', updated_at: 1 }]
      }
      return []
    })

    const onOpenFile = vi.fn()
    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={onOpenFile}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()
    await flushPromises()

    let suggestionPanel = container.querySelector(
      '.project-relation-suggestions'
    )
    expect(suggestionPanel).toBeTruthy()
    expect(suggestionPanel.textContent).toContain('关系自动发现')
    expect(suggestionPanel.textContent).toContain('仅分析正文中明确的 [[WikiLink]] 共现')
    expect(suggestionPanel.querySelectorAll(
      '.project-relation-suggestion-list article'
    )).toHaveLength(3)

    const primarySuggestion = Array.from(
      suggestionPanel.querySelectorAll(
        '.project-relation-suggestion-list article'
      )
    ).find(article => (
      article.textContent.includes('关关') &&
      article.textContent.includes('青崖镇')
    ))
    expect(primarySuggestion).toBeTruthy()
    expect(primarySuggestion.textContent).toContain('3 章共同出现')
    expect(primarySuggestion.textContent).toContain('覆盖全书 100%')

    const firstEvidence = Array.from(
      primarySuggestion.querySelectorAll(
        '.project-relation-suggestion-evidence button'
      )
    ).find(button => button.textContent.includes('第一章'))
    expect(firstEvidence).toBeTruthy()
    await click(firstEvidence)
    expect(onOpenFile).toHaveBeenCalledWith('chapter-1')

    const typeSelect = primarySuggestion.querySelector(
      'select[aria-label^="候选关系类型"]'
    )
    await act(async () => {
      typeSelect.value = 'located'
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    const accept = Array.from(primarySuggestion.querySelectorAll('button'))
      .find(button => button.textContent === '接受建议')
    await click(accept)
    await flushPromises()

    let stored = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(stored.project.relations).toEqual([
      expect.objectContaining({
        sourceId: 'index:character-note',
        targetId: 'index:location-note',
        type: 'located',
        directed: true,
        note: expect.stringContaining('证据 3 个章节'),
      }),
    ])

    suggestionPanel = container.querySelector('.project-relation-suggestions')
    expect(
      Array.from(suggestionPanel.querySelectorAll(
        '.project-relation-suggestion-list article'
      )).some(article => (
        article.textContent.includes('关关') &&
        article.textContent.includes('青崖镇')
      ))
    ).toBe(false)

    const ignoredSuggestion = Array.from(
      suggestionPanel.querySelectorAll(
        '.project-relation-suggestion-list article'
      )
    ).find(article => (
      article.textContent.includes('关关') &&
      article.textContent.includes('黑铁副印')
    ))
    expect(ignoredSuggestion).toBeTruthy()

    const ignore = Array.from(ignoredSuggestion.querySelectorAll('button'))
      .find(button => button.textContent === '忽略')
    await click(ignore)
    await flushPromises()

    stored = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(stored.project.relationSuggestionIgnores).toHaveLength(1)

    suggestionPanel = container.querySelector('.project-relation-suggestions')
    expect(suggestionPanel.textContent).toContain('恢复 1 个已忽略候选')
    expect(
      Array.from(suggestionPanel.querySelectorAll(
        '.project-relation-suggestion-list article'
      )).some(article => (
        article.textContent.includes('关关') &&
        article.textContent.includes('黑铁副印')
      ))
    ).toBe(false)

    const restore = Array.from(suggestionPanel.querySelectorAll('button'))
      .find(button => button.textContent === '恢复 1 个已忽略候选')
    await click(restore)
    await flushPromises()

    suggestionPanel = container.querySelector('.project-relation-suggestions')
    expect(
      Array.from(suggestionPanel.querySelectorAll(
        '.project-relation-suggestion-list article'
      )).some(article => (
        article.textContent.includes('关关') &&
        article.textContent.includes('黑铁副印')
      ))
    ).toBe(true)
  })

  it('uses confirmed aliases to discover medium-confidence plain-text relationships', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'structure'
    )
    localStorage.setItem(
      'localNotepad.projectWorkspace.v1',
      JSON.stringify({
        project: {
          supportNoteIds: ['character-note', 'location-note'],
        },
      })
    )

    const lexical = text => JSON.stringify({
      root: {
        children: [{
          type: 'paragraph',
          children: [{ type: 'text', text }],
        }],
      },
    })

    listAllFilesWithContent.mockResolvedValue([
      { id: 'project', title: '实体智能项目', is_folder: true, parent_id: '', sort_order: 100 },
      { id: 'volume-1', title: '第一卷', is_folder: true, parent_id: 'project', sort_order: 100 },
      { id: 'character-note', title: '关关.md', is_folder: false, parent_id: 'project', sort_order: 10, content: lexical('人物设定') },
      { id: 'location-note', title: '青崖镇.md', is_folder: false, parent_id: 'project', sort_order: 20, content: lexical('地点设定') },
      { id: 'chapter-1', title: '第一章.md', is_folder: false, parent_id: 'volume-1', sort_order: 100, content: lexical('关姑娘来到青崖镇寻找线索。') },
      { id: 'chapter-2', title: '第二章.md', is_folder: false, parent_id: 'volume-1', sort_order: 200, content: lexical('关姑娘再次回到青崖镇。') },
    ])

    tagApi.list.mockResolvedValue([
      { id: 'tag-character', name: '角色' },
      { id: 'tag-location', name: '地点' },
    ])
    tagApi.getFilesByTag.mockImplementation(async tagId => {
      if (tagId === 'tag-character') {
        return [{ id: 'character-note', title: '关关.md', updated_at: 2 }]
      }
      if (tagId === 'tag-location') {
        return [{ id: 'location-note', title: '青崖镇.md', updated_at: 1 }]
      }
      return []
    })

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={() => {}}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()
    await flushPromises()

    const intelligence = container.querySelector(
      '.project-entity-intelligence'
    )
    expect(intelligence).toBeTruthy()
    expect(intelligence.textContent).toContain('实体智能层')

    const entitySelect = intelligence.querySelector(
      'select[aria-label="选择实体别名对象"]'
    )
    await act(async () => {
      entitySelect.value = 'index:character-note'
      entitySelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    const aliasInput = intelligence.querySelector(
      'input[aria-label="新增实体别名"]'
    )
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      setter.call(aliasInput, '关姑娘')
      aliasInput.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    const addAlias = Array.from(intelligence.querySelectorAll('button'))
      .find(button => button.textContent === '添加别名')
    await click(addAlias)
    await flushPromises()

    let stored = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(stored.project.entityAliases).toEqual({
      'index:character-note': ['关姑娘'],
    })

    const heatmapRows = Array.from(
      container.querySelectorAll('.project-entity-heatmap-row')
    )
    const characterRow = heatmapRows.find(row => (
      row.textContent.includes('关关') && !row.classList.contains('head')
    ))
    expect(characterRow).toBeTruthy()
    expect(characterRow.querySelectorAll(
      '.project-entity-heatmap-cell.active'
    )).toHaveLength(2)
    expect(characterRow.textContent).toContain('A')

    let suggestionPanel = container.querySelector(
      '.project-relation-suggestions'
    )
    let suggestion = Array.from(
      suggestionPanel.querySelectorAll(
        '.project-relation-suggestion-list article'
      )
    ).find(article => (
      article.textContent.includes('关关') &&
      article.textContent.includes('青崖镇')
    ))
    expect(suggestion).toBeTruthy()
    expect(suggestion.textContent).toContain('中置信')
    expect(suggestion.textContent).toContain('别名')
    expect(suggestion.textContent).toContain('原名')

    const confidenceFilter = suggestionPanel.querySelector(
      'select[aria-label="关系建议最低置信度"]'
    )
    await act(async () => {
      confidenceFilter.value = 'high'
      confidenceFilter.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    expect(
      container.querySelectorAll(
        '.project-relation-suggestion-list article'
      )
    ).toHaveLength(0)

    suggestionPanel = container.querySelector('.project-relation-suggestions')
    const confidenceFilterAgain = suggestionPanel.querySelector(
      'select[aria-label="关系建议最低置信度"]'
    )
    await act(async () => {
      confidenceFilterAgain.value = 'medium'
      confidenceFilterAgain.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    suggestion = Array.from(
      container.querySelectorAll(
        '.project-relation-suggestion-list article'
      )
    ).find(article => (
      article.textContent.includes('关关') &&
      article.textContent.includes('青崖镇')
    ))
    expect(suggestion).toBeTruthy()

    const typeSelect = suggestion.querySelector(
      'select[aria-label^="候选关系类型"]'
    )
    await act(async () => {
      typeSelect.value = 'located'
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    const accept = Array.from(suggestion.querySelectorAll('button'))
      .find(button => button.textContent === '接受建议')
    await click(accept)
    await flushPromises()

    stored = JSON.parse(
      localStorage.getItem('localNotepad.projectWorkspace.v1')
    )
    expect(stored.project.relations).toEqual([
      expect.objectContaining({
        sourceId: 'index:character-note',
        targetId: 'index:location-note',
        type: 'located',
        note: expect.stringContaining('中置信'),
      }),
    ])
    expect(stored.project.relations[0].note)
      .toContain('别名 / 原名')
  })

  it('offers actionable empty states for projects without manuscript chapters', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'project'
    )
    listAllFilesWithContent.mockResolvedValue([
      {
        id: 'project',
        title: '空项目',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
    ])

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={() => {}}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    expect(container.textContent).toContain('这个项目还没有正文章节')
    expect(container.textContent).toContain('初始化项目模板')
    expect(container.textContent).toContain('返回笔记')
    expect(container.querySelector('.project-workspace-board')).toBeNull()
  })

  it('creates the first chapter inside an existing first volume', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'project'
    )
    listAllFilesWithContent.mockResolvedValue([
      {
        id: 'project',
        title: '空长篇',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
      {
        id: 'volume-1',
        title: '第一卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 100,
      },
    ])
    api.mockImplementation(async (requestPath, init) => {
      if (requestPath === '/api/files' && init?.method === 'POST') {
        const body = JSON.parse(init.body)
        return {
          id: 'first-created',
          ...body,
          sort_order: 1000,
          updated_at: 1,
        }
      }
      throw new Error('Unexpected request: ' + requestPath)
    })

    const onOpenFile = vi.fn()
    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={onOpenFile}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    const createFirst = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '新建第一个章节')
    expect(createFirst).toBeTruthy()
    await click(createFirst)
    await flushPromises()

    const createCall = api.mock.calls.find(([requestPath, init]) => (
      requestPath === '/api/files' && init?.method === 'POST'
    ))
    expect(createCall).toBeTruthy()
    expect(JSON.parse(createCall[1].body)).toMatchObject({
      title: '第一章.md',
      parent_id: 'volume-1',
      is_folder: false,
    })
    expect(onOpenFile).toHaveBeenCalledWith('first-created')
  })

  it('restores the last project workspace view', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'analysis'
    )
    listAllFilesWithContent.mockResolvedValue([
      {
        id: 'project',
        title: '分析项目',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
    ])

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={() => {}}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    const activeTab = container.querySelector(
      '.project-workspace-view-tabs button.active'
    )
    expect(activeTab.querySelector('strong').textContent).toBe('分析')
    expect(container.textContent).toContain('创作分析')
    expect(container.querySelector('.project-today-center')).toBeNull()
  })

  it('initializes a structured novel project template without overwriting existing work', async () => {
    const initialFiles = [{
      id: 'project',
      title: '新小说',
      is_folder: true,
      parent_id: '',
      sort_order: 100,
    }]

    listAllFilesWithContent.mockResolvedValue(initialFiles)
    tagApi.list.mockResolvedValue([])
    tagApi.create.mockImplementation(async ({ name }) => ({
      id: 'tag-' + name,
      name,
    }))
    tagApi.addFileTag.mockResolvedValue(null)

    let createdIndex = 0
    api.mockImplementation(async (path, init) => {
      if (path === '/api/files' && init?.method === 'POST') {
        const payload = JSON.parse(init.body)
        createdIndex += 1
        return {
          id: 'created-' + createdIndex,
          ...payload,
          sort_order: createdIndex * 1000,
          updated_at: 1,
        }
      }
      throw new Error('Unexpected request: ' + path)
    })

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={() => {}}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()

    const projectActions = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent.includes('项目操作'))
    expect(projectActions).toBeTruthy()
    await click(projectActions)

    const templateButton = Array.from(
      container.querySelectorAll('.project-actions-menu button')
    ).find(button => button.textContent === '初始化项目模板')
    expect(templateButton).toBeTruthy()

    await click(templateButton)
    await flushPromises()
    await flushPromises()

    const createCalls = api.mock.calls
      .filter(([path, init]) => path === '/api/files' && init?.method === 'POST')
      .map(([, init]) => JSON.parse(init.body))

    expect(createCalls.some(call => call.is_folder && call.title === '第一卷')).toBe(true)

    const firstChapter = createCalls.find(call => call.title === '第一章.md')
    expect(firstChapter).toBeTruthy()
    const chapterState = JSON.parse(firstChapter.content)
    expect(chapterState.root.children[0]).toMatchObject({
      type: 'heading',
      tag: 'h1',
    })

    expect(tagApi.create).toHaveBeenCalledWith({ name: '角色' })
    expect(tagApi.create).toHaveBeenCalledWith({ name: '地点' })
    expect(tagApi.create).toHaveBeenCalledWith({ name: '伏笔' })
    expect(tagApi.addFileTag).toHaveBeenCalled()
  })

  it('renders tagged character location and foreshadow indexes', async () => {
    localStorage.setItem(
      'localNotepad.projectWorkspace.activeView',
      'analysis'
    )
    listAllFilesWithContent.mockResolvedValue([
      {
        id: 'project',
        title: '长篇小说',
        is_folder: true,
        parent_id: '',
        sort_order: 100,
      },
      {
        id: 'volume',
        title: '第一卷',
        is_folder: true,
        parent_id: 'project',
        sort_order: 100,
      },
      {
        id: 'character-note',
        title: '关关.md',
        is_folder: false,
        parent_id: 'volume',
        sort_order: 100,
        updated_at: 20,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '主角设定' }],
            }],
          },
        }),
      },
      {
        id: 'location-note',
        title: '青崖镇.md',
        is_folder: false,
        parent_id: 'volume',
        sort_order: 200,
        updated_at: 10,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '地点设定' }],
            }],
          },
        }),
      },
      {
        id: 'foreshadow-note',
        title: '剑鞘伏笔.md',
        is_folder: false,
        parent_id: 'volume',
        sort_order: 300,
        updated_at: 5,
        content: JSON.stringify({
          root: {
            children: [{
              type: 'paragraph',
              children: [{ type: 'text', text: '伏笔设定' }],
            }],
          },
        }),
      },
    ])

    tagApi.list.mockResolvedValue([
      { id: 'tag-character', name: '角色' },
      { id: 'tag-location', name: '地点' },
      { id: 'tag-foreshadow', name: '伏笔' },
    ])
    tagApi.getFilesByTag.mockImplementation(async tagId => {
      if (tagId === 'tag-character') return [{ id: 'character-note', title: '关关.md' }]
      if (tagId === 'tag-location') return [{ id: 'location-note', title: '青崖镇.md' }]
      if (tagId === 'tag-foreshadow') return [{ id: 'foreshadow-note', title: '剑鞘伏笔.md' }]
      return []
    })

    await act(async () => {
      root.render(
        <ProjectWorkspacePanel
          onOpenFile={() => {}}
          onClose={() => {}}
        />
      )
    })
    await flushPromises()
    await flushPromises()

    expect(container.textContent).toContain('关关')
    expect(container.textContent).toContain('青崖镇')
    expect(container.textContent).toContain('剑鞘伏笔')
    expect(container.textContent).toContain('伏笔回收')
    expect(container.textContent).toContain('待回收')

    const foreshadowState = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '待回收')
    expect(foreshadowState).toBeTruthy()
    await click(foreshadowState)
    expect(container.textContent).toContain('已回收')
  })

  it('starts a timed focus session from the today creative center', async () => {
    const onStartFocus = vi.fn()
    const onOpenFile = vi.fn()
    const workspace = {
      project: { id: 'project', title: '长篇小说', type: 'novel' },
      volumes: [{
        id: 'v1',
        title: '第一卷',
        notes: [
          {
            id: 'chapter-1',
            title: '第一章.md',
            status: 'draft',
          },
          {
            id: 'chapter-2',
            title: '第二章.md',
            status: 'review',
          },
        ],
      }],
    }

    const completed = finalizeFocusSession(
      createFocusSession({
        projectId: 'project',
        noteId: 'chapter-2',
        noteTitle: '第二章.md',
        durationMinutes: 25,
        startWords: 1000,
        startedAt: Date.now() - 1800000,
      }),
      1450,
      {
        endedAt: Date.now() - 300000,
      },
    )
    appendFocusSession(completed)

    await act(async () => {
      root.render(
        <ProjectTodayCenter
          workspace={workspace}
          projectMeta={{
            chapterQueue: ['chapter-1', 'chapter-2'],
            dailyReviews: {},
          }}
          onOpenFile={onOpenFile}
          onStartFocus={onStartFocus}
        />
      )
    })

    expect(container.textContent).toContain('今日创作中心')
    expect(container.textContent).toContain('第一章')
    expect(container.textContent).toContain('最近 Session')
    expect(container.textContent).toContain('+450 字')

    const primary = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent.includes('开始下一章 · 50 分钟'))
    expect(primary).toBeTruthy()
    await click(primary)

    expect(onStartFocus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'chapter-1' }),
      50,
    )
  })

  it('shows focus session words timer controls and end action', async () => {
    const onEnd = vi.fn()
    const onToggleFocus = vi.fn()
    const session = createFocusSession({
      projectId: 'project',
      noteId: 'chapter-1',
      noteTitle: '第一章.md',
      durationMinutes: 50,
      startWords: 1000,
      startedAt: Date.now(),
    })

    await act(async () => {
      root.render(
        <FocusSessionBar
          session={session}
          currentWords={1280}
          focused
          onToggleFocus={onToggleFocus}
          onEnd={onEnd}
        />
      )
    })

    expect(container.textContent).toContain('专注 Session')
    expect(container.textContent).toContain('第一章')
    expect(container.textContent).toContain('+280')
    expect(container.textContent).toContain('结束 Session')

    const toggle = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '显示界面')
    await click(toggle)
    expect(onToggleFocus).toHaveBeenCalledTimes(1)

    const end = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '结束 Session')
    await click(end)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('renders focus session analytics and saves a review note', async () => {
    const projectId = 'analytics-project'
    const base = new Date(2026, 8, 21, 8).getTime()

    const first = finalizeFocusSession(
      createFocusSession({
        projectId,
        noteId: 'chapter-1',
        noteTitle: '第一章.md',
        durationMinutes: 25,
        startWords: 1000,
        startedAt: base,
      }),
      1750,
      {
        endedAt: base + 1500 * 1000,
        reason: 'timer',
      },
    )
    const second = finalizeFocusSession(
      createFocusSession({
        projectId,
        noteId: 'chapter-2',
        noteTitle: '第二章.md',
        durationMinutes: 50,
        startWords: 2000,
        startedAt: base + 2 * 60 * 60 * 1000,
      }),
      3200,
      {
        endedAt: base + 2 * 60 * 60 * 1000 + 3000 * 1000,
        reason: 'timer',
      },
    )

    appendFocusSession(first)
    appendFocusSession(second)

    await act(async () => {
      root.render(
        <FocusSessionAnalyticsPanel
          workspace={{
            project: { id: projectId, title: '长篇小说' },
            volumes: [],
          }}
          onOpenFile={() => {}}
        />
      )
    })

    expect(container.textContent).toContain('Session 分析与复盘')
    expect(container.textContent).toContain('专注效率')
    expect(container.textContent).toContain('最佳写作时段')
    expect(container.textContent).toContain('25 / 50 / 90 分钟效果')
    expect(container.textContent).toContain('专注趋势')
    expect(container.textContent).toContain('章节 Session 效率')
    expect(container.textContent).toContain('Session 复盘')

    const thirtyDay = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '30 天')
    expect(thirtyDay).toBeTruthy()
    await click(thirtyDay)

    const reviewButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '复盘')
    expect(reviewButton).toBeTruthy()
    await click(reviewButton)

    const textarea = container.querySelector('textarea[aria-label="Session 复盘备注"]')
    expect(textarea).toBeTruthy()

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      ).set
      valueSetter.call(
        textarea,
        '上午进入状态很快，下次继续从冲突段直接开始。',
      )
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '保存复盘')
    expect(save).toBeTruthy()
    await click(save)

    expect(container.textContent)
      .toContain('上午进入状态很快，下次继续从冲突段直接开始。')
  })

  it('renders creative insights and copies an auto report', async () => {
    const projectId = 'insight-project'
    const onOpenFile = vi.fn()
    const now = new Date()
    const dayKey = offset => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 12)
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-')
    }
    const at = (offset, hour) => (
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, hour).getTime()
    )

    localStorage.setItem('localNotepad.projectAnalytics.v1', JSON.stringify({
      [projectId]: [
        { date: dayKey(2), totalWords: 48000, noteWords: {} },
        { date: dayKey(1), totalWords: 49000, noteWords: {} },
        { date: dayKey(0), totalWords: 50000, noteWords: {} },
      ],
    }))

    localStorage.setItem('localNotepad.focusSessions.v1', JSON.stringify({
      [projectId]: [
        {
          id: 'a1',
          projectId,
          noteId: 'chapter-1',
          noteTitle: '第一章.md',
          durationMinutes: 50,
          startedAt: at(2, 8),
          endedAt: at(2, 8) + 1800000,
          elapsedSeconds: 1800,
          wordDelta: 1000,
          completedTimer: true,
          reviewNote: '顺利',
        },
        {
          id: 'a2',
          projectId,
          noteId: 'chapter-1',
          noteTitle: '第一章.md',
          durationMinutes: 50,
          startedAt: at(1, 8),
          endedAt: at(1, 8) + 1800000,
          elapsedSeconds: 1800,
          wordDelta: 900,
          completedTimer: true,
          reviewNote: '',
        },
        {
          id: 'b1',
          projectId,
          noteId: 'chapter-2',
          noteTitle: '第二章.md',
          durationMinutes: 50,
          startedAt: at(2, 20),
          endedAt: at(2, 20) + 1800000,
          elapsedSeconds: 1800,
          wordDelta: 120,
          completedTimer: false,
          reviewNote: '',
        },
        {
          id: 'b2',
          projectId,
          noteId: 'chapter-2',
          noteTitle: '第二章.md',
          durationMinutes: 50,
          startedAt: at(1, 20),
          endedAt: at(1, 20) + 1800000,
          elapsedSeconds: 1800,
          wordDelta: 100,
          completedTimer: false,
          reviewNote: '',
        },
        {
          id: 'b3',
          projectId,
          noteId: 'chapter-2',
          noteTitle: '第二章.md',
          durationMinutes: 50,
          startedAt: at(0, 20),
          endedAt: at(0, 20) + 1800000,
          elapsedSeconds: 1800,
          wordDelta: 80,
          completedTimer: false,
          reviewNote: '',
        },
      ],
    }))

    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    })

    const workspace = {
      project: {
        id: projectId,
        title: '太初宇宙',
        type: 'novel',
      },
      totalWords: 50000,
      volumes: [{
        id: 'volume-1',
        title: '第一卷',
        notes: [
          {
            id: 'chapter-1',
            title: '第一章.md',
            status: 'done',
            wordCount: 25000,
            updated_at: Math.floor(at(0, 8) / 1000),
          },
          {
            id: 'chapter-2',
            title: '第二章.md',
            status: 'draft',
            wordCount: 25000,
            updated_at: Math.floor(at(20, 8) / 1000),
          },
        ],
      }],
    }

    await act(async () => {
      root.render(
        <ProjectInsightsPanel
          workspace={workspace}
          projectMeta={{
            targetWords: 100000,
            dailyGoal: 2000,
            weeklyGoal: 12000,
            deadline: dayKey(-10),
            statuses: {
              'chapter-1': 'done',
              'chapter-2': 'draft',
            },
            foreshadowStates: {},
          }}
          projectIndexes={{
            foreshadows: [
              { id: 'f1', title: '伏笔1.md' },
              { id: 'f2', title: '伏笔2.md' },
              { id: 'f3', title: '伏笔3.md' },
              { id: 'f4', title: '伏笔4.md' },
              { id: 'f5', title: '伏笔5.md' },
            ],
          }}
          onOpenFile={onOpenFile}
        />
      )
    })
    await flushPromises()

    expect(container.textContent).toContain('创作洞察与自动复盘')
    expect(container.textContent).toContain('需要注意')
    expect(container.textContent).toContain('难写章节')
    expect(container.textContent).toContain('下一阶段建议')
    expect(container.textContent).toContain('自动周度复盘')
    expect(container.textContent).toContain('第二章')

    const difficult = container.querySelector('.project-difficult-list button')
    expect(difficult).toBeTruthy()
    await click(difficult)
    expect(onOpenFile).toHaveBeenCalledWith('chapter-2')

    const thirty = Array.from(container.querySelectorAll('.project-insights-period button'))
      .find(button => button.textContent === '30 天')
    await click(thirty)

    expect(container.textContent).toContain('自动月度复盘')
    expect(container.textContent).toContain('真实历史')

    const preview = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '预览报告')
    await click(preview)

    expect(container.querySelector('.project-insight-report-preview').textContent)
      .toContain('## 写作产出')

    const copy = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '复制报告')
    await click(copy)
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
    expect(clipboardWrite.mock.calls[0][0]).toContain('# 太初宇宙 · 30 天复盘')
  })

  it('renders and reorders a long-form volume chapter structure', async () => {
    const onApplyDraft = vi.fn()
    const structuredContent = JSON.stringify({
      root: {
        children: [
          {
            type: 'heading',
            tag: 'h1',
            children: [{ type: 'text', text: '第一卷' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '第一章' }],
          },
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'A' }],
          },
          {
            type: 'heading',
            tag: 'h2',
            children: [{ type: 'text', text: '第二章' }],
          },
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'B' }],
          },
        ],
      },
    })

    await act(async () => {
      root.render(
        <LongFormStructurePanel
          content={structuredContent}
          onApplyDraft={onApplyDraft}
          onExtractSection={() => {}}
        />
      )
    })

    expect(container.textContent).toContain('第一卷')
    const expand = Array.from(container.querySelectorAll('.long-structure-expand'))
      .find(button => !button.disabled)
    expect(expand).toBeTruthy()
    await click(expand)

    expect(container.textContent).toContain('第一章')
    expect(container.textContent).toContain('第二章')

    const secondRow = Array.from(container.querySelectorAll('.long-structure-row'))
      .find(row => row.textContent.includes('第二章'))
    const up = Array.from(secondRow.querySelectorAll('button'))
      .find(button => button.getAttribute('aria-label') === '上移 第二章')

    expect(up).toBeTruthy()
    await click(up)

    expect(onApplyDraft).toHaveBeenCalledTimes(1)
    expect(onApplyDraft.mock.calls[0][1]).toMatchObject({
      reason: 'reorder',
      sectionPathMappings: [],
    })
    expect(onApplyDraft.mock.calls[0][0].indexOf('第二章'))
      .toBeLessThan(onApplyDraft.mock.calls[0][0].indexOf('第一章'))
  })

  it('shows proactive reference impact before a refactor', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    await act(async () => {
      root.render(
        <ReferenceRefactorDialog
          mode="rename"
          targetTitle="旧标题"
          nextTitle="新标题"
          onConfirm={onConfirm}
          onCancel={onCancel}
          plan={{
            summary: {
              incomingReferences: 2,
              affectedFiles: 1,
              repairable: 1,
              broken: 1,
            },
            sources: [{
              id: 'source-1',
              title: '正文',
              incomingReferences: 2,
              repairable: 1,
              broken: 1,
              changes: [{
                ordinal: 0,
                before: '[[旧标题#旧层级 › 青莲剑宗]]',
                after: '[[新标题#世界观 › 青莲剑宗]]',
                issues: ['title-stale', 'section-moved'],
              }],
            }],
          }}
        />
      )
    })

    expect(container.textContent).toContain('改名前检查引用影响')
    expect(container.textContent).toContain('旧标题')
    expect(container.textContent).toContain('新标题')
    expect(container.textContent).toContain('正文')
    expect(container.textContent).toContain('章节可自动迁移')
    expect(container.textContent).toContain('1 处引用无法唯一判断')

    const confirm = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '继续改名')
    expect(confirm).toBeTruthy()

    await click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
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
