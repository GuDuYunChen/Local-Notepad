import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectEntityEvidencePanel from './ProjectEntityEvidencePanel'
import ProjectEntityIntelligencePanel from './ProjectEntityIntelligencePanel'
import { buildProjectEntityIntelligence } from './projectEntityIntelligenceUtils'

function fixture(count = 13, textOverride) {
  const indexes = { characters: [{ id: 'char-a', title: '关关.md' }, { id: 'char-b', title: '赵三.md' }] }
  const meta = { entityAliases: { 'index:char-a': ['小关'] } }
  const notes = Array.from({ length: count }, (_, index) => ({
    id: 'c' + (index + 1), title: '第' + (index + 1) + '章.md',
    content: JSON.stringify({ root: { type: 'root', children: [{
      type: 'paragraph', children: [
        { type: 'text', text: textOverride ?? ('关关来了。' + (index % 2 === 0 ? '小关也到了。' : '')) },
        { type: 'wiki-link', id: 'char-a', title: '关关', sectionPath: ['身世'] },
      ],
    }] } }),
  }))
  const workspace = { project: { id: 'p1' }, volumes: [
    { id: 'v1', title: '第一卷', notes: notes.slice(0, 7) },
    { id: '', title: '未分卷', notes: notes.slice(7) },
  ] }
  const intelligence = buildProjectEntityIntelligence(workspace, indexes, meta)
  return { indexes, meta, workspace, intelligence }
}

let container
let root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const byLabel = label => container.querySelector('[aria-label="' + label + '"]')
const button = text => [...container.querySelectorAll('button')].find(item => item.textContent === text)
const cards = () => container.querySelectorAll('.project-entity-evidence-card')
async function click(element) {
  expect(element).toBeTruthy()
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}
async function change(element, value) {
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function render(data, props = {}) {
  await act(async () => root.render(
    <ProjectEntityEvidencePanel
      projectId="p1" intelligence={data.intelligence} entityId="index:char-a"
      projectMeta={data.meta} {...props}
    />
  ))
}

describe('entity body evidence browser', () => {
  it('integrates into the existing entity panel and opens the correct chapter', async () => {
    const data = fixture(2)
    const onOpenFile = vi.fn()
    await act(async () => root.render(
      <ProjectEntityIntelligencePanel workspace={data.workspace} projectIndexes={data.indexes}
        projectMeta={data.meta} onOpenFile={onOpenFile} />
    ))
    expect(byLabel('实体正文证据')).toBeTruthy()
    expect(container.querySelector('mark').textContent).toBe('关关')
    await click(byLabel('打开证据章节 第1章'))
    expect(onOpenFile).toHaveBeenCalledWith('c1')
  })

  it('paginates through every chapter including those beyond the former cutoff', async () => {
    await render(fixture())
    expect(cards()).toHaveLength(6)
    expect(button('上一页').disabled).toBe(true)
    await click(button('下一页'))
    expect(cards()).toHaveLength(6)
    expect(byLabel('正文证据章节 7')).toBeTruthy()
    await click(button('下一页'))
    expect(cards()).toHaveLength(1)
    expect(byLabel('正文证据章节 13')).toBeTruthy()
    expect(button('下一页').disabled).toBe(true)
  })

  it('filters mixed WikiLink chapters by alias and reports alias-only totals', async () => {
    await render(fixture())
    await click(button('下一页'))
    await change(byLabel('实体证据来源筛选'), 'alias')
    expect(container.querySelector('[role="status"]').textContent).toContain('找到 7 章 · 共 7 次 别名 提及')
    expect(container.querySelector('.project-entity-evidence-pagination').textContent).toContain('第 1 / 2 页')
    expect([...container.querySelectorAll('mark')].every(mark => mark.textContent === '小关')).toBe(true)
  })

  it('distinguishes ungrouped chapters and resets filters', async () => {
    await render(fixture())
    await change(byLabel('实体证据卷筛选'), JSON.stringify(''))
    expect(cards()).toHaveLength(6)
    expect(byLabel('正文证据章节 8')).toBeTruthy()
    expect(byLabel('正文证据章节 1')).toBeNull()
    await click(button('重置筛选'))
    expect(byLabel('正文证据章节 1')).toBeTruthy()
  })

  it('searches chapter names and shows a recoverable empty state', async () => {
    await render(fixture())
    await change(byLabel('搜索实体证据章节'), '第13章')
    expect(cards()).toHaveLength(1)
    expect(byLabel('正文证据章节 13')).toBeTruthy()
    await change(byLabel('搜索实体证据章节'), '没有这个章节')
    expect(cards()).toHaveLength(0)
    expect(container.textContent).toContain('没有符合当前筛选的证据')
    await click(button('重置筛选'))
    expect(cards()).toHaveLength(6)
  })

  it('resets page and search when switching project or entity', async () => {
    const data = fixture()
    await render(data)
    await change(byLabel('搜索实体证据章节'), '第13章')
    await render(data, { projectId: 'p2' })
    expect(byLabel('搜索实体证据章节').value).toBe('')
    expect(cards()).toHaveLength(6)
    await change(byLabel('搜索实体证据章节'), '第13章')
    await render(data, { entityId: 'index:char-b' })
    expect(byLabel('搜索实体证据章节').value).toBe('')
    expect(container.textContent).toContain('正文证据回看 · 赵三')
  })

  it('renders hostile-looking markup only as text while highlighting the entity', async () => {
    await render(fixture(1, '<img src=x onerror="alert(1)">关关</img>'))
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(container.textContent).toContain('<img src=x')
    expect(container.querySelector('mark').textContent).toBe('关关')
  })

  it('separates explicit link labels from prose quotations', async () => {
    await render(fixture(1))
    await change(byLabel('实体证据来源筛选'), 'wiki')
    expect(container.querySelectorAll('mark')).toHaveLength(0)
    expect(container.textContent).toContain('链接标签，不是正文节选')
    expect(container.querySelector('code').textContent).toBe('[[关关#身世]]')
  })

  it('handles unavailable chapter content and a removed entity without stale excerpts', async () => {
    const data = fixture(1)
    data.intelligence = { ...data.intelligence, chapters: [] }
    await render(data, { onOpenFile: vi.fn() })
    expect(container.textContent).toContain('当前章节内容暂不可用')
    expect(byLabel('打开证据章节 第1章').disabled).toBe(true)
    await render(data, { entityId: 'missing' })
    expect(container.textContent).toContain('请选择一个实体')
    expect(cards()).toHaveLength(0)
  })

  it('refreshes excerpts from changed manuscript data without editing it', async () => {
    const original = fixture(1, '关关看见清晨。')
    await render(original)
    const next = fixture(1, '关关看见黄昏。')
    const snapshot = structuredClone(next)
    await render(next)
    expect(container.textContent).toContain('黄昏')
    expect(container.textContent).not.toContain('清晨')
    expect(next).toEqual(snapshot)
    expect(byLabel('打开证据章节 第1章').disabled).toBe(true)
  })
})
