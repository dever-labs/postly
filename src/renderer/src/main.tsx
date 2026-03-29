import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Apply stored theme class before React renders to prevent flash
const stored = localStorage.getItem('postly-theme')
if (stored === 'light') document.documentElement.classList.add('light')

// Monaco internally rejects promises when completions are cancelled (e.g. user keeps typing).
// This is harmless but pollutes the console — swallow it here.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.type === 'cancelation') e.preventDefault()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
