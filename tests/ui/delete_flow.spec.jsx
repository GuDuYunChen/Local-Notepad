import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import FileList from '../../src/components/FileList'
import { api } from '../../src/services/api'

// Mock API
vi.mock('../../src/services/api', () => ({
  api: vi.fn()
}))

// Mock Electron API
window.electronAPI = {
  openFileDialog: vi.fn(),
  saveFileDialog: vi.fn()
}

describe('FileList Delete Flow', () => {
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

  it('should pass skipSave: true to onSelect when deleting selected file', async () => {
    const onSelect = vi.fn()
    const onItemsChanged = vi.fn()
    
    // Mock API response for load
    const items = [
      { id: '1', title: 'File 1', is_folder: false, parent_id: '' },
      { id: '2', title: 'File 2', is_folder: false, parent_id: '' }
    ]
    api.mockResolvedValueOnce(items) // For load()

    await act(async () => {
      root.render(
        <FileList 
          selectedId={'1'} 
          onSelect={onSelect} 
          onItemsChanged={onItemsChanged}
        />
      )
    })

    // Wait for load
    await new Promise(r => setTimeout(r, 0))
    
    // Check initial render
    const file1 = Array.from(container.querySelectorAll('.title')).find(el => el.textContent.includes('File 1'))
    expect(file1).toBeTruthy()

    // Simulate Right Click on File 1 to open Context Menu
    await act(async () => {
        const li = file1.closest('li')
        const event = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 100,
            clientY: 100
        })
        li.dispatchEvent(event)
    })
    
    // Check Context Menu appears
    const contextMenu = document.querySelector('.context-menu')
    expect(contextMenu).toBeTruthy()
    
    // Click "Delete" in Context Menu
    const deleteOption = Array.from(contextMenu.querySelectorAll('.menu-item.danger')).find(el => el.textContent.includes('删除'))
    expect(deleteOption).toBeTruthy()
    
    await act(async () => {
        deleteOption.click()
    })
    
    // Check Delete Confirmation Dialog
    const modal = document.querySelector('.modal')
    expect(modal).toBeTruthy()
    expect(modal.textContent).toContain('File 1')
    
    // Mock Delete API success
    api.mockResolvedValueOnce({}) // For delete request
    api.mockResolvedValueOnce([items[1]]) // For reload (load() is called after delete)

    // Click "Delete" button in Modal
    const confirmBtn = modal.querySelector('button.danger')
    await act(async () => {
        confirmBtn.click()
    })
    
    // Verify API called
    expect(api).toHaveBeenCalledWith('/api/files/1', { method: 'DELETE' })
    
    // Verify onSelect called with skipSave: true
    // The first call might be initial load selection (if any), but we passed selectedId='1'
    // FileList might call onSelect(items[0]) on load if selectedId was missing, but we provided it.
    
    // Check calls
    // We expect onSelect to be called with (nextFile, { skipSave: true })
    // nextFile should be File 2 (id: '2')
    
    // Find the call
    const calls = onSelect.mock.calls
    // Filter calls that might be relevant
    const deleteCall = calls.find(args => args[1]?.skipSave === true)
    
    expect(deleteCall).toBeTruthy()
    expect(deleteCall[0].id).toBe('2')
  })
})
