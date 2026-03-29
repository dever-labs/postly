# Postly

> A cross-platform API client built for teams — with native Backstage, GitHub, and GitLab integration.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Release](https://img.shields.io/github/v/release/dever-labs/postly)

---

## What is Postly?

Postly is a desktop API client similar to Postman, built with Electron. It's designed for developers who work with APIs discovered through internal developer portals or source control — not just manually created collections.

**Key differentiator:** Connect Postly to your Backstage instance, GitHub, or GitLab repository, and your APIs automatically appear as collections alongside locally created ones. Everything lives in one place.

---

## Features

### API Collections
- Organise requests into **collections** and **groups**
- Full request editor: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
- URL parameters, headers, and body (JSON, form-data, URL-encoded, raw, binary, GraphQL)
- Per-request response viewer with syntax highlighting (pretty, raw, preview)

### Authentication — all levels
Configure auth once on a collection or group, and requests inherit it automatically.

| Type | Description |
|---|---|
| **Bearer Token** | Static bearer token |
| **Basic Auth** | Username + password |
| **JWT Bearer** | JWT token with configurable prefix |
| **OAuth 2.0** | Authorization Code (PKCE) or Client Credentials — token auto-cached and refreshed |
| **NTLM** | Windows authentication with domain/workstation |
| **Inherit** | Walk up to group → collection → integration |

### Source Integrations
Pull APIs directly from:
- **Backstage** — discovers APIs via the Backstage catalog
- **GitHub** — reads OpenAPI specs from repositories
- **GitLab** — reads OpenAPI specs from repositories

Collections from each source appear as separate groups in the sidebar. Changes can be committed back to source control from within the app.

### Environments
- Multiple named environments with key-value variables
- `{{VAR_NAME}}` interpolation in URLs, headers, and body
- Secret variable masking

### Quality of Life
- Per-entity SSL verification (inherit / enabled / disabled)
- Resizable sidebar and response panel
- Search and filter across all collections
- Dark and light theme
- Breadcrumb navigation (Source › Collection › Group › Request)

---

## Download

Download the latest release for your platform from the [Releases](https://github.com/dever-labs/postly/releases) page.

| Platform | Installer |
|---|---|
| Windows x64 | `Postly-Setup-x.x.x.exe` |
| Windows arm64 | `Postly-Setup-x.x.x-arm64.exe` |
| macOS Intel | `Postly-x.x.x.dmg` |
| macOS Apple Silicon | `Postly-x.x.x-arm64.dmg` |
| Linux x64 | `Postly-x.x.x.AppImage` / `.deb` |
| Linux arm64 | `Postly-x.x.x-arm64.AppImage` / `.deb` |

---

## Development

See [docs/development.md](docs/development.md) for full setup instructions.

```bash
# Install dependencies
npm install

# Start dev server (hot reload)
npm run dev

# Build
npm run build
```

---

## Integrations

See [docs/integrations.md](docs/integrations.md) for connecting Backstage, GitHub, and GitLab.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit your changes
4. Open a pull request

---

## License

MIT — see [LICENSE](LICENSE)
