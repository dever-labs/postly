---
applyTo: "**/*.test.ts,**/*.spec.ts,**/*.test.tsx,e2e/**"
---

# Testing Conventions

## Unit & Integration Tests (Vitest)

- Test files live alongside source: `src/**/*.test.ts` or `src/**/*.spec.ts`
- Integration tests are in `src/` with config `vitest.integration.config.ts`
- Prefer **real HTTP servers** over mocks for network-level tests
- Use `vi.mock()` only for Electron APIs (`electron`, `electron-store`, etc.)

## E2E Tests (Playwright)

- Tests live in `e2e/`
- Config: `playwright.config.ts`
- Run headless with `npm run test:e2e`, headed with `npm run test:e2e:headed`
- The Mockly binary is auto-downloaded before E2E runs

## Running Tests

```bash
npm test                  # unit tests
npm run test:integration  # integration (downloads mockly)
npm run test:e2e          # E2E headless
npm run typecheck         # type checking (run before committing)
```
