import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import FileSelectorDialog from '../../src/components/FileSelectorDialog'

describe('FileSelectorDialog', () => {
  let container = null
  let root = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    document.body.removeChild(container)
    container = null
    vi.clearAllMocks()
  })

  const items = [
    { id: '1', title: 'File 1', is_folder: false, parent_id: '', sort_order: 10 },
    { id: '2', title: 'File 2', is_folder: false, parent_id: '', sort_order: 9 },
    { id: '3', title: 'File 3', is_folder: false, parent_id: '', sort_order: 8 },
    { id: '4', title: 'File 4', is_folder: false, parent_id: '', sort_order: 7 },
  ]

  it('should render items and handle single selection', async () => {
    await act(async () => {
      root.render(
        <FileSelectorDialog open={true} items={items} onConfirm={() => {}} onClose={() => {}} />
      )
    })
    
    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes.length).toBe(4)

    // Click first
    await act(async () => {
        checkboxes[0].click()
    })
    
    // Check counter
    const counter = container.querySelector('.counter')
    expect(counter.textContent).toContain('1')
  })

  it('should handle Select All', async () => {
    await act(async () => {
      root.render(
        <FileSelectorDialog open={true} items={items} onConfirm={() => {}} onClose={() => {}} />
      )
    })

    const selectAllBtn = container.querySelector('.toolbar .btn')
    expect(selectAllBtn.textContent).toBe('全选')
    
    await act(async () => {
        selectAllBtn.click()
    })
    
    const counter = container.querySelector('.counter')
    expect(counter.textContent).toContain('4')
    expect(selectAllBtn.textContent).toBe('取消全选')
  })

  it('should handle Shift + Click range selection', async () => {
    await act(async () => {
      root.render(
        <FileSelectorDialog open={true} items={items} onConfirm={() => {}} onClose={() => {}} />
      )
    })

    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    
    // Click first (File 1)
    await act(async () => {
        checkboxes[0].click()
    })
    
    // Shift + Click third (File 3)
    // Note: We need to simulate the event with shiftKey
    await act(async () => {
        const event = new MouseEvent('click', { bubbles: true, shiftKey: true })
        // Checkbox change event usually triggered by click, but React onChange uses native event.
        // We dispatch click on the INPUT element.
        // Important: checking the checkbox triggers change.
        // Manually dispatching click will toggle the checkbox state in DOM.
        checkboxes[2].dispatchEvent(event)
    })
    
    // Should select 1, 2, 3
    const counter = container.querySelector('.counter')
    expect(counter.textContent).toContain('3')
  })

  it('should call onConfirm with selected ids', async () => {
    const onConfirm = vi.fn()
    await act(async () => {
      root.render(
        <FileSelectorDialog open={true} items={items} onConfirm={onConfirm} onClose={() => {}} />
      )
    })

    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    await act(async () => {
        checkboxes[0].click() // Select 1
        checkboxes[1].click() // Select 2
    })
    
    const confirmBtn = container.querySelector('.modal-footer .btn.primary')
    await act(async () => {
        confirmBtn.click()
    })
    
    expect(onConfirm).toHaveBeenCalled()
    const args = onConfirm.mock.calls[0]
    // First arg is all selected IDs
    expect(args[0]).toHaveLength(2)
    expect(args[0]).toContain('1')
    expect(args[0]).toContain('2')
  })
})
