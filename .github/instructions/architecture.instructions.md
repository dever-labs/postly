---
applyTo: "src/**"
---

# Architecture Conventions

## Process Boundaries

- `src/main/` — Electron main process: IPC handlers, services, SQLite DB
- `src/preload/` — Context bridge exposing `window.api.*` to the renderer
- `src/renderer/src/` — React UI (never use `require()` here)

All renderer → main communication **must** go through `window.api.*` (the preload bridge).

## State Management

- Global state: **Zustand** stores in `src/renderer/src/store/`
- No Redux, no Context for global state

## UI Patterns

- Functional React components only — no class components
- Tailwind utility classes for styling — no inline `style` props except dynamic values (e.g. resize widths)
- Every page's drag strip uses `pt-8 pb-4 shrink-0` — never `h-8` or other sizes

## Data & Write Operations

- Shared types: `src/renderer/src/types/index.ts`
- Write operations (create/edit/delete collections, groups, endpoints) must call `openGitAction()` from the UI store to trigger the `GitCommitOverlay`
