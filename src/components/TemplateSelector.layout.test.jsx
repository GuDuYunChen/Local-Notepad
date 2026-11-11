import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { test, expect, vi } from 'vitest'
import TemplateSelector from './TemplateSelector'
import UiThemeProvider from './ui/UiThemeProvider'

// The real Windows template-picker matrix observed a 150px tall template
// tile, which is intentional content, not a 40px action. Keep ordinary
// controls under the original shared height-token contract.
test('template tiles declare content layout without reclassifying ordinary actions', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(<UiThemeProvider><TemplateSelector open onClose={vi.fn()} onSelect={vi.fn()} /></UiThemeProvider>)
    })
    const tiles = [...host.querySelectorAll('.template-selector .template-card')]
    expect(tiles).toHaveLength(5)
    for (const tile of tiles) {
      expect(tile.tagName).toBe('BUTTON')
      expect(tile.dataset.uiControl).toBe('button')
      expect(tile.dataset.uiLayout).toBe('content')
      expect(tile.querySelector('.template-card-top strong')?.textContent.trim()).toBeTruthy()
      expect(tile.querySelector('.template-card-description')?.textContent.trim()).toBeTruthy()
      expect(tile.querySelectorAll('.template-card-preview > span').length).toBeGreaterThan(0)
    }
    const manage = [...host.querySelectorAll('.template-selector button')]
      .find(button => button.textContent.includes('管理我的模板'))
    expect(manage).toBeTruthy()
    expect(manage.dataset.uiControl).toBe('button')
    expect(manage.dataset.uiLayout).toBe('action')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
