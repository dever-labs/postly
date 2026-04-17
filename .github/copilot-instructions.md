# Postly — Copilot & Agent Instructions

> **This file is read automatically by:**
> - GitHub Copilot (IDE extensions, chat, coding agent)
> - GitHub Desktop → "Generate commit message" (Copilot-powered)
> - Any tool using the GitHub Copilot SDK against this repository
>
> **All generated commit messages must follow the rules below.**

## Commit messages — Conventional Commits (required)

Every commit **must** follow [Conventional Commits](https://www.conventionalcommits.org/).
This is enforced by commitlint in CI.

A git commit message template is also provided in `.gitmessage` at the repo root.
Configure it locally with: `git config commit.template .gitmessage`

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

### Breaking changes

Append `!` to the type, **or** add `BREAKING CHANGE:` in the footer:

```
feat!: remove legacy NTLM auth config shape

BREAKING CHANGE: authConfig for NTLM no longer accepts `domain` at root level.
Migrate to `authConfig.ntlm.domain`.
```

### Scopes (optional but encouraged)

Use a short noun describing what part of the codebase changed:

```
feat(oauth): add client_credentials grant
fix(http): resolve timeout not applied to redirected requests
chore(deps): bump axios to 2.x
test(ipc): cover SSL flag forwarding
```

### Rules (enforced by commitlint)

- Subject line **≤ 72 characters** — **HARD LIMIT, CI will reject anything longer**
- Subject line **no trailing period**
- **No `WIP` commits** merged to main
- Body lines **≤ 100 characters**

### Auto-generation rules (Copilot commit message generation)

When generating a commit message automatically, you **must**:

1. **Count the subject line characters before finalising.** If it would exceed 72, shorten it — never exceed 72 under any circumstance.
2. **Move detail to the body, never the subject.** Phrases like "to verify X", "in order to Y", "by doing Z", "which ensures W" belong in the body, not the subject line.
3. **Stop at the object, not the purpose.** `test(oauth): add session persistence tests` is correct. `test(oauth): add session persistence tests to verify token refresh behavior` is too long and wrong.
4. **Prefer omitting the scope over truncating mid-word.** If `type(scope): description` is too long, try dropping the scope before shortening the description.

Quick mental check before finalising: `type(scope): description` — count the characters. If > 72, cut.

### Good examples

```
feat(ssl): propagate ssl-verification setting into oauth token requests
fix(oauth): use unique session partition per auth attempt
security: disable rejectUnauthorized only when user explicitly opts out
docs: document conventional commit rules in CONTRIBUTING.md
chore(deps): add selfsigned devDependency for ssl integration tests
test(oauth): add self-signed https server tests for ssl verification
ci: add commitlint check to pull-request workflow
```

### Bad examples — will be rejected

```
Fixed bug                                           # no type
feat: add new thing.                                # trailing period
WIP: experimenting                                  # WIP not allowed
FEAT: add thing                                     # type must be lowercase
test(e2e): add OAuth session persistence tests to verify token refresh behavior  # > 72 chars
feat(oauth): add integration tests to ensure browser session is preserved        # > 72 chars
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
