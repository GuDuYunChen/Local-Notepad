import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import EvidenceLocateButton from './EvidenceLocateButton'
import ProjectEntityEvidencePanel from './ProjectEntityEvidencePanel'
import { buildProjectEntityIntelligence } from './projectEntityIntelligenceUtils'
import { evidenceNavigation } from '~/services/evidenceNavigation'
import { toast } from '~/services/toast'

const body = JSON.stringify({ root: { type: 'root', children: [{ type: 'paragraph', children: [
  { type: 'text', text: '关关。关关。' },
  { type: 'wiki-link', id: 'a', title: '关关', sectionPath: [] },
] }] } })
let container, root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(toast, 'error').mockImplementation(() => {})
  vi.spyOn(toast, 'warning').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  evidenceNavigation.cancel()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  evidenceNavigation.cancel()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function render(props = {}) {
  await act(async () => root.render(<EvidenceLocateButton chapterId="c1" content={body}
    sample={{ start: 3, end: 5, match: '关关' }} label="定位测试" {...props} />))
}
async function click(element = container.querySelector('button')) {
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
}

describe('evidence locate actions', () => {
  it('queues the exact occurrence before calling the existing chapter opener', async () => {
    const open = vi.fn(() => expect(evidenceNavigation.peek('c1').target.start).toBe(3))
    await render({ onOpenFile: open })
    await click()
    expect(open).toHaveBeenCalledWith('c1')
    expect(evidenceNavigation.peek('c1').target.match).toBe('关关')
  })
  it('clears its own pending request on an asynchronous open failure', async () => {
    await render({ onOpenFile: () => Promise.reject(new Error('offline')) })
    await click()
    expect(evidenceNavigation.peek()).toBeNull()
    expect(toast.error).toHaveBeenCalled()
  })
  it('clears its own pending request on a synchronous open failure', async () => {
    await render({ onOpenFile: () => { throw new Error('offline') } })
    await click()
    expect(evidenceNavigation.peek()).toBeNull()
  })
  it('does not erase a newer navigation when an earlier open fails late', async () => {
    let reject
    await render({ onOpenFile: () => new Promise((_, no) => { reject = no }) })
    await click()
    const newer = evidenceNavigation.start('c2', { version: 1 })
    await act(async () => { reject(new Error('old')); await Promise.resolve() })
    expect(evidenceNavigation.peek().id).toBe(newer)
    expect(toast.error).not.toHaveBeenCalled()
  })
  it('disables unavailable actions and rejects invalid evidence', async () => {
    await render()
    expect(container.querySelector('button').disabled).toBe(true)
    const open = vi.fn()
    await render({ onOpenFile: open, sample: { start: -1, end: 1 } })
    await click()
    expect(open).not.toHaveBeenCalled()
    expect(evidenceNavigation.peek()).toBeNull()
  })
  it('wires both prose and WikiLink actions into the actual evidence cards', async () => {
    const workspace = { project: { id: 'p1' }, volumes: [{ id: 'v1', notes: [{ id: 'c1', title: '第一章.md', content: body }] }] }
    const model = buildProjectEntityIntelligence(workspace, { characters: [{ id: 'a', title: '关关.md' }] })
    const open = vi.fn()
    await act(async () => root.render(<ProjectEntityEvidencePanel projectId="p1" intelligence={model}
      entityId="index:a" projectMeta={{}} onOpenFile={open} />))
    const prose = container.querySelectorAll('.project-entity-evidence-excerpt button')
    expect(prose.length).toBe(2)
    await click(prose[1])
    expect(evidenceNavigation.peek().target.start).toBe(3)
    await click(container.querySelector('.project-entity-evidence-wiki button'))
    expect(evidenceNavigation.peek().target.kind).toBe('wiki')
    await click(container.querySelector('[aria-label="打开证据章节 第一章"]'))
    expect(evidenceNavigation.peek()).toBeNull()
  })
})
