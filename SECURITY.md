# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Previous minor | ✅ (critical fixes only) |
| Older | ❌ |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them via [GitHub's private vulnerability reporting](https://github.com/dever-labs/postly/security/advisories/new).

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Potential impact

You'll receive a response within **5 business days**. If confirmed, a patch will be released as quickly as possible.

## Electron Security Posture

Postly follows Electron security best practices:

- `contextIsolation: true` — renderer is isolated from the main process
- `nodeIntegration: false` — renderer cannot access Node.js APIs directly
- `sandbox: true` — renderer process runs in OS sandbox
- All main process APIs are exposed via a typed `contextBridge` preload
- No `eval()` or `new Function()` with user content
- `webSecurity: true` — same-origin policy enforced in renderer
- All IPC inputs are validated in the main process before use

## Dependencies

We run automated dependency audits on every PR and weekly via GitHub Actions.
Critical vulnerabilities block merges. Dependabot is enabled for automated patch PRs.

### Supply-chain attack protection

[Socket.dev](https://socket.dev) is installed as a GitHub App and scans every pull
request that modifies `package.json` or `package-lock.json`. Unlike `npm audit`,
which only catches *known* CVEs, Socket detects *active* supply-chain threats:

- Newly added or changed install scripts in any dependency
- Obfuscated code and dynamic `require()` patterns
- Typosquatting (package names similar to popular packages)
- Packages that read environment variables (credential exfiltration risk)
- Packages pulled from git or HTTP URLs (no integrity guarantee)
- Recent maintainer changes (common hijack vector)

The project-level configuration lives in [`socket.yml`](./socket.yml).
