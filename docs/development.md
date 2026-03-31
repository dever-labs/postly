# Development Guide

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20+ |
| npm | 9+ |
| Git | any recent |

> **Windows only:** If building native modules, you may need the Visual Studio Build Tools. Run `npm install --global windows-build-tools` if you hit compilation errors.

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/dever-labs/postly.git
cd postly

# Install dependencies
npm install

# Start the app in development mode (hot reload)
npm run dev
```

The app opens automatically. The renderer hot-reloads on save; main process changes require a restart (`Ctrl+R` in the Electron window or re-run `npm run dev`).

---

## Project Structure

```
postly/
├── src/
│   ├── main/               # Electron main process (Node.js)
│   │   ├── database/       # SQLite schema, migrations
│   │   ├── ipc/            # IPC handlers (http, collections, oauth, …)
│   │   └── services/       # Business logic (http-executor, oauth, git)
│   ├── preload/            # Context bridge — exposes main APIs to renderer
│   └── renderer/           # React app (Vite)
│       └── src/
│           ├── components/ # UI components
│           ├── store/      # Zustand state stores
│           └── types/      # Shared TypeScript types
├── resources/              # App icons (icon.ico, icon.icns, icon.png)
├── docs/                   # Documentation
└── .github/workflows/      # CI/CD
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 29 |
| Renderer build | Vite + electron-vite |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS |
| State | Zustand |
| Database | sql.js (SQLite in WASM) |
| HTTP client | axios |
| Code editor | Monaco Editor |
| IPC | Electron contextBridge |

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start in dev mode with hot reload |
| `npm run build` | Compile renderer + main with electron-vite |
| `npm run dist` | Build + package for current platform |
| `npm run dist:win` | Package for Windows (all arches) |
| `npm run dist:mac` | Package for macOS (x64 + arm64) |
| `npm run dist:linux` | Package for Linux (x64 + arm64) |
| `npm test` | Run unit tests with Vitest |
| `npm run test:e2e` | Run Playwright E2E tests (requires `npm run build` first) |
| `npm run lint` | Lint TypeScript source |

---

## Database

The app uses `sql.js` (SQLite compiled to WebAssembly) running in the **main process**. The database file is stored in the user data directory:

- **Windows:** `%APPDATA%\postly\postly.db`
- **macOS:** `~/Library/Application Support/postly/postly.db`
- **Linux:** `~/.config/postly/postly.db`

Migrations run automatically on startup. They are additive-only (no destructive changes) and wrapped in `try/catch` to be idempotent.

---

## Adding Icons (required for production builds)

Place the following files in `resources/`:

| File | Platform | Size |
|---|---|---|
| `icon.ico` | Windows | 256×256 |
| `icon.icns` | macOS | 512×512 |
| `icon.png` | Linux | 512×512 |

You can generate all formats from a single 1024×1024 PNG using tools like [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder):

```bash
npx electron-icon-builder --input=resources/icon-source.png --output=resources/
```

---

## IPC Architecture

All communication between renderer and main goes through the context bridge (`src/preload/index.ts`). The renderer calls `window.api.*` methods which map to `ipcRenderer.invoke(...)` calls. The main process registers handlers via `ipcMain.handle(...)`.

Never use `require()` or Node APIs directly in the renderer — use the preload bridge.
