# Changelog

All notable changes to Postly will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] — 2026-04-28

### Fixed

- **Backstage self-signed certificates** — added a "Skip SSL verification" toggle to the Backstage connect and edit pages, and to the Backstage settings panel. When enabled, connections to Backstage instances using self-signed certificates will succeed instead of throwing `unable to verify the first certificate` (closes #57).

---

## [0.6.0] — 2026-04-17

### Added

- **OAuth session persistence** — the authorization-code flow now reuses a named persistent Electron session partition (`persist:oauth-<configId>`) per OAuth config so the IDP session cookie survives between auth attempts; users are no longer re-prompted to log in when refreshing a token (closes #53).
- **OAuth integration tests** — Mockly v0.5.0-based integration tests covering `clientCredentials`, `refreshTokenGrant`, and `authorizeAuthCode` token-exchange; call-body inspection verifies correct form params are sent to the token endpoint.
- **OAuth E2E tests** — Playwright suite that boots the real app against a live Mockly token server and a minimal inline IDP, asserting that the `idp-session` cookie is present and unchanged after a second auth attempt.

---

## [0.5.0] — 2026-04-12

### Added

- **Backstage integration** — full OAuth login flow (GitLab, GitHub, Google, Guest) with an icon tile picker; sync collections from Backstage Component entities including gRPC and GraphQL service types (closes #38).
- **GraphQL query editor** — Monaco-based editor with schema-aware field autocomplete; trigger with `Ctrl+Space`, accept with `Enter`. Variables and schema views also upgraded to Monaco editors.
- **gRPC URL validation** — inline warning banner shown when an `http://` or `https://` URL is entered for a gRPC endpoint, with a corrected URL suggestion.

### Fixed

- **Panel drag performance** — sidebar and editor/response divider drag now mutates the DOM directly during drag with a single Zustand commit on mouse-up, eliminating React re-renders at 60 fps (closes #38).
- **ResizablePanel bounds** — editor pane can no longer be dragged to 0 px or arbitrarily large values; clamped to 150–800 px.
- **Backstage auth** — `provider` validated against an allowlist before URL/JS interpolation; IPC handler rejects unknown providers; `client_id`-sourced `authProvider` normalised in integrations connect flow.
- **Backstage settings** — `authProvider` normalised once with `?? 'token'` so `useOAuth` and `signIn` share a consistent fallback.
- **Integration remount** — edit page now remounts correctly when switching between integrations.

### Security

- **Provider injection** — `provider` string validated against `['gitlab','github','google']` allowlist before being interpolated into `loadURL()` and `executeJavaScript()` template literals in `backstage.ts`.

---

## [0.4.3] — 2026-04-12

### Fixed

- **Window drag area** — scrollable content no longer moves the window drag strip; drag region is now a fixed strip and content areas are marked `no-drag` (closes #12).
- **Window controls** — minimize, maximize/restore and close buttons now resolve the target window from `event.sender` instead of `getAllWindows()[0]`, preventing accidental targeting of OAuth popups or DevTools windows.
- **Theme initialisation** — `nativeTheme.themeSource` is now always set on startup (both `light` and `dark`), keeping native UI elements consistent with the renderer theme.
- **Window controls accessibility** — caption buttons now carry explicit `aria-label` attributes (`Minimize`, `Restore`/`Maximize`, `Close`) for screen reader support.
- **Light mode colours** — minimize, maximize and close button colours corrected for light mode; text contrast improved across light and dark themes.

---

## [0.4.2] — 2026-04-09

### Fixed

- **Git connect** — unblock Connect button when credential dialog is cancelled (closes #40).
- **Git SSH URLs** — `git@` SSH URLs now accepted as valid repository URLs (closes #43).
- **OAuth transaction** — resolve "cannot commit — no transaction is active" error (closes #41).

---

## [0.4.1] — 2026-04-07

### Fixed

- **OAuth 2.0 SSL verification** — `sslVerification: false` in Settings was silently ignored by all four OAuth IPC handlers; certificate errors were thrown even when SSL verification was disabled. Now correctly respected across `authorize`, `token:get`, `inline:authorize`, and `inline:token:get` (closes #29).
- **OAuth window crash** — `TypeError: object has been destroyed` thrown when the user closes the authorization window early; `webContents` event listeners are now only removed while the window is still alive.
- **OAuth refresh token grant** — missing `await` on the `DELETE` query in the refresh grant; `saveToken` now runs inside a transaction to prevent partial writes.
- **Integration tests** — Mockly-based integration tests added for the HTTP executor; integration tests excluded from the default unit test run.

### Security

- **PreviewTab iframe** — sandbox policy tightened to block script execution and same-origin access in the response preview iframe.
- **Multiple vulnerabilities** — XSS, path traversal, API key exposure, and arbitrary file-read issues resolved.

---

## [0.4.0] — 2026-04-03

### Added

- **Draft cache** — all editors (URL, headers, body, auth) now persist unsaved changes; navigating away and back restores the draft automatically.
- **Undo history** — Ctrl+Z restores the previous draft state across all editors.
- **Sidebar collapse persistence** — expanded/collapsed state of collections and groups is saved and restored across app restarts.

### Changed

- **URL bar performance** — decoupled from the global request store to eliminate typing lag on large collections.
- **Electron** — updated from 35 → 41.

### Fixed

- Dirty indicator flash and Ctrl+Z clear in URL and body inputs.
- `setActiveRequest` race condition; draft flush and error-handling edge cases.

### Security

- OAuth `redirectUri` no longer exposed as a shared constant; removed `DEFAULT_OAUTH_REDIRECT_URI`.
- CodeQL security and quality alerts resolved across `oauth.ts`.

---

## [0.3.0] — 2026-04-02

### Added

- **Per-request SSL verification** — individual requests, groups, and collections can override the global SSL setting; the hierarchy (request → group → collection → global) is resolved at execution time.
- **OAuth SSL support** — when SSL verification is disabled, the OAuth authorization window runs in a dedicated in-memory session partition with certificate verification bypassed, so login pages on self-signed endpoints load correctly.
- **Commitlint** — conventional commit enforcement added to CI; all commit messages are now validated on push.

### Changed

- **CI** — `release-please` automation removed in favour of manual version bumps driven by git tags.

---

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
