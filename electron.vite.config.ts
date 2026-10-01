import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import type { Plugin } from 'vite'

// Strict CSP for the packaged renderer (file://). Not applied in dev: Vite HMR
// needs inline scripts and a websocket that this policy intentionally forbids.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Monaco and Tailwind inject inline styles; http(s) is for the response Preview iframe
  // (srcdoc inherits this policy), which must be able to load a page's own CSS and fonts.
  // Scripts stay locked to 'self' and the iframe is sandboxed without allow-scripts.
  "style-src 'self' 'unsafe-inline' http: https:",
  "img-src 'self' data: blob: http: https:", // avatars from GitHub/GitLab/Backstage
  "font-src 'self' data: http: https:",
  "worker-src 'self' blob:",
  "connect-src 'self'", // all network access goes through the main process via IPC
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const cspPlugin = (): Plugin => ({
  name: 'postly-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
  ],
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@main': path.resolve('src/main') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [tailwindcss(), react(), cspPlugin()],
    resolve: { alias: { '@': path.resolve('src/renderer/src') } }
  }
})
