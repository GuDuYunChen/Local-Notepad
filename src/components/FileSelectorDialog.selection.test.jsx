import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FileSelectorDialog from './FileSelectorDialog'

const items = [
  { id: 'root', title: '主目录', is_folder: true, parent_id: '' },
  { id: 'nested', title: '子目录', is_folder: true, parent_id: 'root' },
  { id: 'a', title: '取消的笔记', is_folder: false, parent_id: 'nested' },
  { id: 'b', title: '保留的笔记', is_folder: false, parent_id: 'nested' },
  { id: 'c', title: '同级笔记', is_folder: false, parent_id: 'root' },
  { id: 'complete', title: '完整目录', is_folder: true, parent_id: 'root' },
  { id: 'd', title: '完整一', is_folder: false, parent_id: 'complete' },
  { id: 'e', title: '完整二', is_folder: false, parent_id: 'complete' },
]
let host, root, confirm, close
const row = title => [...host.querySelectorAll('.tree-item')].find(node => node.querySelector('.title')?.textContent === title)
const checkbox = title => row(title)?.querySelector('input[type="checkbox"]')
const button = text => [...host.querySelectorAll('button')].find(node => node.textContent.trim() === text)
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()) }
const expand = async title => click(row(title).querySelector('.selector-tree-toggle'))
const render = async props => act(async () => root.render(<FileSelectorDialog open items={items} onConfirm={confirm} onClose={close} {...props} />))
const expandAll = async () => { await expand('主目录'); await expand('子目录'); await expand('完整目录') }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  confirm = vi.fn(); close = vi.fn()
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

it('keeps unchecked nested notes out of confirmed roots while retaining a fully selected sibling directory', async () => {
  await render(); await expandAll(); await click(checkbox('主目录'))
  expect([...host.querySelectorAll('input[type="checkbox"]')].every(input => input.checked)).toBe(true)
  await click(checkbox('取消的笔记'))
  expect(checkbox('取消的笔记').checked).toBe(false)
  expect(checkbox('子目录').checked).toBe(false); expect(checkbox('子目录').indeterminate).toBe(true)
  expect(checkbox('主目录').checked).toBe(false); expect(checkbox('主目录').indeterminate).toBe(true)
  expect(checkbox('完整目录').checked).toBe(true)
  await click(button('确定'))
  const [allIds, roots] = confirm.mock.calls[0]
  expect(new Set(allIds)).toEqual(new Set(['b', 'c', 'complete', 'd', 'e']))
  expect(new Set(roots)).toEqual(new Set(['b', 'c', 'complete']))
  expect(allIds).not.toContain('a'); expect(roots).not.toContain('root'); expect(roots).not.toContain('nested')
  expect(close).toHaveBeenCalledTimes(1)
})

it('removes empty ancestor selections when every selected note is unchecked and keeps select-all reversible', async () => {
  await render(); await expandAll(); await click(checkbox('主目录'))
  for (const title of ['取消的笔记', '保留的笔记', '同级笔记', '完整一', '完整二']) await click(checkbox(title))
  expect([...host.querySelectorAll('input[type="checkbox"]')].every(input => !input.checked && !input.indeterminate)).toBe(true)
  expect(host.textContent).toContain('已选择 0 项'); expect(button('确定').disabled).toBe(true)
  await click(button('确定')); expect(confirm).not.toHaveBeenCalled()
  await click(button('全选')); expect(button('取消全选')).toBeTruthy()
  await click(button('取消全选')); expect(button('确定').disabled).toBe(true)
  expect(host.textContent).toContain('已选择 0 项')
})

it('expands an initially selected folder into checked descendants and confirms that same complete subtree', async () => {
  await render({ initialSelectedIds: ['root'] })
  expect(checkbox('主目录').checked).toBe(true); expect(button('取消全选')).toBeTruthy()
  await expandAll()
  expect([...host.querySelectorAll('input[type="checkbox"]')].every(input => input.checked)).toBe(true)
  await click(button('确定'))
  expect(new Set(confirm.mock.calls[0][0])).toEqual(new Set(items.map(item => item.id)))
  expect(confirm.mock.calls[0][1]).toEqual(['root'])
})

it('initial folder selection and select-all preserve the current file and its disabled deletion ancestors', async () => {
  await render({ initialSelectedIds: ['root', 'a'], selectedFileId: 'a', showDeleteWarning: true })
  await expandAll()
  for (const title of ['主目录', '子目录', '取消的笔记']) {
    expect(checkbox(title).disabled).toBe(true)
    expect(checkbox(title).checked).toBe(false); expect(checkbox(title).indeterminate).toBe(false)
    await click(checkbox(title))
  }
  expect(checkbox('保留的笔记').checked).toBe(true); expect(checkbox('完整目录').checked).toBe(true)
  await click(button('确定'))
  expect(new Set(confirm.mock.calls[0][0])).toEqual(new Set(['b', 'c', 'complete', 'd', 'e']))
  expect(new Set(confirm.mock.calls[0][1])).toEqual(new Set(['b', 'c', 'complete']))
  await click(button('取消全选')); await click(button('全选')); confirm.mockClear()
  await click(button('确定'))
  expect(new Set(confirm.mock.calls[0][1])).toEqual(new Set(['b', 'c', 'complete']))
})

it('reconciles a partially selected ancestor if a new unchecked descendant appears while the dialog is open', async () => {
  await render({ initialSelectedIds: ['root'] }); await expandAll()
  const additional = { id: 'new', title: '新出现的笔记', is_folder: false, parent_id: 'nested' }
  await render({ items: [...items, additional], initialSelectedIds: ['root'] })
  expect(checkbox('新出现的笔记').checked).toBe(false)
  expect(checkbox('子目录').checked).toBe(false); expect(checkbox('主目录').checked).toBe(false)
  await click(button('确定'))
  expect(new Set(confirm.mock.calls[0][1])).toEqual(new Set(['a', 'b', 'c', 'complete']))
  expect(confirm.mock.calls[0][0]).not.toContain('new')
})

it('preserves single-folder and top-level destination selection without applying deletion exclusions', async () => {
  await render({ mode: 'single-folder', selectedFileId: 'a', initialSelectedIds: ['nested'] })
  await expand('主目录')
  expect(row('子目录').classList.contains('selected')).toBe(true)
  expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
  expect(row('取消的笔记')).toBeUndefined()
  await click(button('确定')); expect(confirm).toHaveBeenLastCalledWith(['nested'], ['nested'])
  await click(row('我的笔记（顶层）')); await click(button('确定'))
  expect(confirm).toHaveBeenLastCalledWith([''], [''])
})

it('can close and reopen with initial folder selection without changing hook order or reviving prior partial choices', async () => {
  await render({ initialSelectedIds: ['root'] }); await expandAll(); await click(checkbox('取消的笔记'))
  await render({ open: false, initialSelectedIds: ['root'] })
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  await render({ initialSelectedIds: ['root'] }); await expandAll()
  expect(checkbox('取消的笔记').checked).toBe(true); expect(checkbox('主目录').checked).toBe(true)
})
