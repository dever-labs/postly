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
