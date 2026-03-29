# Changelog

All notable changes to Postly will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
