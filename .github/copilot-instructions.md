# Postly — Copilot & Agent Instructions

> **This file is read automatically by:**
> - GitHub Copilot (IDE extensions, chat, coding agent)
> - GitHub Desktop → "Generate commit message" (Copilot-powered)
> - Any tool using the GitHub Copilot SDK against this repository

## Build Commands

- `npm run build` — Compile with electron-vite (main + preload + renderer)
- `npm test` — Run unit tests (Vitest)
- `npm run test:integration` — Run integration tests (downloads mockly binary first)
- `npm run test:e2e` — Run Playwright E2E tests
- `npm run lint` — ESLint across `src/`
- `npm run typecheck` — TypeScript type-check (no emit)

## Workflow

After making code changes, always run:

```
npm run typecheck && npm run lint && npm test
```

- Fix any type errors or lint issues before committing
- Feature branches are cut from `main`
- Write operations in the UI (create/edit/delete) must go through `openGitAction()` to trigger `GitCommitOverlay`

---

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/) style. Not enforced by tooling but used consistently across the project.

### Format

```
<type>(<optional scope>): <short description>

<optional body>

<optional footer — e.g. BREAKING CHANGE: or Closes #N>
```

### Allowed types

| Type       | When to use                                            |
|------------|--------------------------------------------------------|
| `feat`     | New user-facing feature                                |
| `fix`      | Bug fix                                                |
| `security` | Security fix or hardening                              |
| `perf`     | Performance improvement (no API change)                |
| `refactor` | Code restructure — no behaviour change, no new feature |
| `revert`   | Reverts a previous commit                              |
| `docs`     | Documentation only                                     |
| `test`     | Adding or updating tests                               |
| `chore`    | Maintenance, dependencies, config                      |
| `build`    | Build system or tooling changes                        |
| `ci`       | CI/CD workflow changes                                 |

### Examples

```
feat(oauth): add client_credentials grant
fix(http): resolve timeout not applied to redirected requests
chore(deps): bump axios to 2.x
test(ipc): cover SSL flag forwarding
```

---

## Code conventions

- **Language**: TypeScript strict mode throughout — no `any` except in explicit casts
- **React**: functional components only; Zustand for global state
- **Styling**: Tailwind utility classes; no inline `style` props except dynamic values (e.g. resize widths)
- **IPC**: all renderer→main calls go through `window.api.*` (preload bridge) — never `require()` in renderer
- **Tests**: Vitest for unit/integration; Playwright for E2E; real HTTP servers preferred over mocks for network-level tests
- **Drag region**: all pages use `pt-8 pb-4 shrink-0` for the drag strip — never `h-8` or other sizes
- **Git overlay**: write operations (create/edit/delete collections, groups, endpoints) use `openGitAction()` from the UI store to trigger the `GitCommitOverlay`

## Project structure (key paths)

```
src/main/          — Electron main process (IPC handlers, services, DB)
src/preload/       — Context bridge (window.api.*)
src/renderer/src/  — React UI (components, stores, types)
  store/           — Zustand stores (collections, requests, ui, settings…)
  components/      — UI components
  types/index.ts   — Shared type definitions
```

## Agent guidance

When implementing a task as a Copilot coding agent:

1. **Read the issue carefully** — check acceptance criteria and technical context sections before writing any code.
2. **Explore before editing** — use grep/glob to understand the relevant code before making changes.
3. **Verify at every step** — run `npm run typecheck && npm run lint && npm test` after changes; fix all errors before moving on.
4. **Run integration tests if touching HTTP/IPC** — `npm run test:integration` covers real HTTP flows via Mockly.
5. **Keep changes surgical** — only modify files directly related to the task; don't reformat unrelated code.
6. **Reference the issue** — include `Closes #N` in the commit/PR when resolving an issue.
