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
Pull APIs directly from any git repository or Backstage:
- **Any git host** — GitHub, GitLab, Gitea, Azure DevOps, Bitbucket, self-hosted — uses your system git credentials (SSH or HTTPS, no token setup needed in the app)
- **Backstage** — discovers APIs via the Backstage software catalog

Collections from each source appear as separate groups in the sidebar. `*.postly.json` collection files can be committed back to the repository from within the app; OpenAPI specs are read-only.

### Environments
- Multiple named environments with key-value variables
- `{{VAR_NAME}}` interpolation in URLs, headers, and body
- Secret variable masking

### Quality of Life
- **Console tab** on every response — structured log of auth source, environment resolution, OAuth token state, SSL settings, and request/response summary
- Per-entity SSL verification (inherit / enabled / disabled)
- **Proxy support** (Settings → Network): system proxy (OS, `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`), or a manual HTTP/HTTPS/SOCKS proxy with credentials and a bypass list — applied to requests, OAuth, Backstage, GitHub and GitLab
- **Request history** — every request you send is kept locally (History tab) with its response; search, reopen, delete or clear. Secrets in headers, auth, query strings, bodies are capped at 32 KB. Configure or disable under Settings → General
- **Working set** — instead of tabs, a short list above the collection tree shows what you are working on: pinned requests, everything with unsaved changes (flagged and counted so nothing is forgotten) and your 8 most recent. Clean entries age out on their own. Back/forward (buttons or Alt+←/→) step through the requests you opened
- **Command palette** (Ctrl/Cmd+K) — fuzzy-search every request by name, URL, source, collection or group, switch environment, open settings, create a request or check for updates, all from the keyboard
- **Keyboard shortcuts** — Ctrl/Cmd+Enter send, Esc cancel, Ctrl/Cmd+S save, Ctrl/Cmd+N new request, Ctrl/Cmd+L focus URL, Ctrl/Cmd+Shift+F search the sidebar, Ctrl/Cmd+B toggle the sidebar, Ctrl/Cmd+, settings, Alt+←/→ back/forward, Alt+↑/↓ step through the working set; press Ctrl/Cmd+/ (or ? when idle) for the full cheat sheet, and hover buttons to see their keys
- **cURL import & export** — paste a cURL command (bash, cmd or PowerShell, e.g. Chrome's "Copy as cURL") into the URL bar or use *Import from cURL* in the command palette; copy any HTTP/GraphQL request as cURL, JavaScript (fetch), Node.js (axios), Python (requests), Go (net/http) or C# (HttpClient) with variables resolved or kept and credentials masked unless you opt in
- **Cookie jar** — `Set-Cookie` from responses (including redirect hops) is stored per environment, honouring domain, path, Secure and expiry, and sent automatically to matching requests; a `Cookie` header you set yourself wins. A Cookies tab on the response and a manager in Settings let you inspect, edit and delete cookies. Values never appear in the Console or history, and the jar is stored encrypted with the rest of your data
- **Variable scopes** — `{{NAME}}` resolves from environment, then collection, then global variables (most specific wins), in the URL, headers, body and auth. Global variables live in Settings → Variables, collection variables in the collection editor (committed with git collections; secret values never are). Built-ins `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}` and `{{$randomInt}}` are generated on each send. Autocomplete and tooltips show where a variable comes from, and the Console lists resolutions and unresolved names
- Resizable sidebar and response panel
- Search and filter across all collections
- Dark and light theme
- Breadcrumb navigation (Source › Collection › Group › Request)

### Automatic Updates
Postly checks for updates automatically on startup and shows a notification banner when a new version is available. Updates are downloaded in the background and applied on the next restart.

Configure update behaviour in **Settings → Updates**:
- Toggle automatic startup checks on or off
- Set a custom internal update server URL for enterprise/air-gapped deployments

See [docs/updates.md](docs/updates.md) for enterprise deployment options.

---

## Download

### macOS

The recommended way to install on macOS is via [Homebrew](https://brew.sh) — it bypasses Gatekeeper automatically:

```bash
brew install dever-labs/tap/postly
```

Alternatively, download the `.dmg` from the [Releases](https://github.com/dever-labs/postly/releases) page. Because Postly is not notarized, macOS will block it on first launch. To allow it, run this once after installing:

```bash
xattr -cr /Applications/Postly.app
```

Or: right-click the app → **Open** → click **Open** in the dialog.

### Windows & Linux

Download the latest installer for your platform from the [Releases](https://github.com/dever-labs/postly/releases) page.

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
