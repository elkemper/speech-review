import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import DefectTableApp from './components/DefectTableApp'
import { applyTableTheme, loadTableTheme } from './tableTheme'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element not found')

// The table window is a separate BrowserWindow that loads this same bundle at
// `#/table`. It deliberately does not mount the main app or its store.
const isTableWindow = window.location.hash.startsWith('#/table')

// Apply the table window's own theme before the first paint; the main window
// never sets it and stays dark.
if (isTableWindow) applyTableTheme(loadTableTheme())

createRoot(container).render(
  <React.StrictMode>
    {isTableWindow ? <DefectTableApp /> : <App />}
  </React.StrictMode>
)
