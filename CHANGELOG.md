# Changelog

All notable changes to Postly will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] — 2026-03-31

### Added

- **OAuth 2.0 Authorization Code flow** — full end-to-end PKCE flow using Electron window interception (`will-redirect`); window opens, captures the auth code, exchanges it for tokens, and closes automatically. No localhost HTTP server required.
- **OAuth token card** — active/expired status badge, formatted expiry date, granted scopes, masked access and refresh tokens with reveal and one-click copy.
- **Console tab** — every HTTP response now includes a Console tab with structured log entries (INFO / WARN / ERROR) showing environment resolution, auth source, OAuth token state, SSL settings, and request/response summary.
- **OAuth error messages** — token endpoint errors (e.g. invalid client, bad scopes) now surface the human-readable `error_description` from the provider instead of a raw Axios error.
- **Scopes validation** — OAuth panels require the scopes field to be filled in; an inline error is shown instead of silently defaulting.
- **Integration tests** — OAuth service covered by 17 tests against a fake IDP; HTTP IPC handler covered by 25 unit tests; Playwright E2E tests for the request editor.

### Changed

- **Collection page — Export** moved from a sticky footer button into a proper scrollable section, consistent with the rest of the editor.
- **OAuth token font size** increased for readability.
- **Token expiry date** formatted as `1 Apr 2026, 00:30` instead of a locale-dependent string.

### Removed

- **Husky git hooks** — removed broken pre-commit hook setup.

---

## [0.1.0] — 2026-03-29

### Added

- **Collections & groups** — organise endpoints into collections and groups with inline rename
- **Multi-protocol support** — HTTP, WebSocket, gRPC, GraphQL, and MQTT editors
- **Source integrations** — sync API collections from GitHub, GitLab, and Backstage; each source appears as its own collapsible group in the sidebar
- **OAuth 2.0 Device Flow** — authenticate with GitHub and GitLab without storing passwords; uses the device flow standard (no client secret required)
- **Auth inheritance** — per-collection auth config that inherits down through groups to individual requests
- **Environments** — named variable sets with `{{token}}` highlighting in URL and body editors
- **AI assistant** — generate and review endpoints using any OpenAI-compatible provider
- **Export / import** — export selected collections to JSON; import and assign to any source
- **Commit panel** — write and push commits to source control directly from the app
- **Drag & drop** — reorder endpoints, groups, and collections; move items between groups and sources with live drop indicators
- **SSL editor** — per-request SSL/TLS certificate configuration
- **Cross-platform builds** — Windows (exe/msi), macOS (dmg), Linux (AppImage/deb/rpm)
