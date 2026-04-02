# Contributing to Postly

Thank you for taking the time to contribute!

## Getting Started

1. [Fork](https://github.com/dever-labs/postly/fork) the repository
2. Clone your fork: `git clone https://github.com/<your-name>/postly.git`
3. Set up the dev environment: see [docs/development.md](docs/development.md)
4. Create a branch: `git checkout -b feat/my-feature`

## Development Workflow

```bash
npm install       # install dependencies
npm run dev       # start with hot reload
npm run typecheck # verify types before committing
npm run lint      # check for lint errors
npm test          # run test suite
```

All four must pass before opening a PR.

## Pull Request Guidelines

- **One concern per PR** — don't bundle unrelated changes
- **Describe the change** — what and why, not just how
- **Add tests** for new behaviour where feasible
- **Keep commits clean** — squash fixups before asking for review

### Commit message format (Conventional Commits — enforced)

Every commit must follow [Conventional Commits](https://www.conventionalcommits.org/).
This is checked by commitlint in CI and drives automatic versioning (see `release-please-config.json`).

```
<type>(<optional scope>): <short description in lowercase, no trailing period>
```

| Type | Effect on version |
|------|-------------------|
| `feat` | minor bump (0.x.0) |
| `fix` / `security` / `perf` | patch bump (0.0.x) |
| `feat!` or `BREAKING CHANGE:` in footer | major bump (x.0.0) |
| `refactor`, `docs`, `test`, `chore`, `build`, `ci` | no bump |

**Good examples:**
```
feat(oauth): add client_credentials grant support
fix(http): resolve timeout not applied after redirect
security: use unique session partition per oauth auth attempt
docs: document conventional commit rules
chore(deps): bump electron to 36.x
```

**Bad (rejected by CI):**
```
Fixed bug                  # missing type
feat: Fixed bug            # capitalised subject
feat: add thing.           # trailing period
```

## Reporting Bugs

Use the [Bug Report](https://github.com/dever-labs/postly/issues/new?template=bug_report.md) issue template.

Include:
- OS and version
- Steps to reproduce
- Expected vs. actual behaviour
- Logs from `Help → Open DevTools` if relevant

## Suggesting Features

Open a [Feature Request](https://github.com/dever-labs/postly/issues/new?template=feature_request.md) issue. Discuss before building large features to avoid wasted effort.

## Security Vulnerabilities

See [SECURITY.md](SECURITY.md) — do not open public issues for security reports.

## Code Style

- TypeScript strict mode
- React functional components only (no class components)
- Tailwind for styling — no inline `style` props except for dynamic values (e.g. resize widths)
- Zustand for global state — no prop drilling beyond two levels
- All IPC calls go through `window.api.*` (preload bridge) — never `require()` in renderer
