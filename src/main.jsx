import React from 'react'
import { createRoot } from 'react-dom/client'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import App from './App'
import { initializeThemeFromStorage } from './services/themePreference'
import './styles/index.css'
import './styles/redesign.css'
import './styles/editor-document.css'
import './styles/dark-theme.css'

import { installDocumentQuitBridge } from './services/editorQuitBridge.mjs'
import './styles/editor-quit.css'

initializeThemeFromStorage()
const disposeQuitBridge = installDocumentQuitBridge({ bridge: window.electronAPI })
if (import.meta.hot) import.meta.hot.dispose(disposeQuitBridge)

const el = document.getElementById('root')
if (el) {
  const root = createRoot(el)
  root.render(
    <DndProvider backend={HTML5Backend}>
      <App />
    </DndProvider>
  )
}
