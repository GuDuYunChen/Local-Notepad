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
      .toEqual(['今日', '项目', '计划', '分析', '洞察'])

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

    const planningTab = viewButtons.find(
      button => button.querySelector('strong')?.textContent === '计划'
    )
    await click(planningTab)

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

    const insightsTab = viewButtons.find(
      button => button.querySelector('strong')?.textContent === '洞察'
    )
    await click(insightsTab)

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

    const scriptButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '剧本')
    await click(scriptButton)
    expect(container.textContent).toContain('剧本项目')
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

    const templateButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '套用小说模板')
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
    expect(container.textContent).toContain('创作洞察与自动复盘')
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
      textarea.value = '上午进入状态很快，下次继续从冲突段直接开始。'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
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
