# Updates & Enterprise Deployment

## Standard auto-update

Postly uses [electron-updater](https://www.electron.build/auto-update) to check for and apply updates from GitHub Releases. The update lifecycle is:

1. On startup (if **Check for updates on startup** is enabled), Postly checks the release feed
2. If a newer version is found, a notification banner appears at the top of the window
3. Click **Download** to fetch the installer in the background (progress is shown)
4. Click **Install & Restart** once the download completes

You can also trigger a manual check at any time via **Settings → Updates → Check for updates now**.

---

## Enterprise / Disconnected deployment

For environments that cannot reach GitHub directly (corporate proxies, air-gapped networks, or controlled rollout scenarios), Postly supports an **internal update mirror**.

### How it works

Instead of checking GitHub Releases, Postly points to a server you control. That server serves the version manifest and installer files in the standard electron-updater [generic provider](https://www.electron.build/configuration/publish#genericserveroptions) format. Postly's GitHub Releases channel is completely unaffected — the two paths are fully isolated.

```
Postly (packaged)
    │
    ├─ [no enterprise config]  →  GitHub Releases (dever-labs/postly)
    │
    └─ [enterprise config set] →  Your internal server
                                       ├── latest-mac.yml
                                       ├── latest.yml          (Windows)
                                       ├── latest-linux.yml
                                       ├── Postly-x.x.x.dmg
                                       ├── Postly-Setup-x.x.x.exe
                                       └── Postly-x.x.x.AppImage
```

### Setting up the internal mirror

1. **Download** the release assets from [github.com/dever-labs/postly/releases](https://github.com/dever-labs/postly/releases) for the version you want to deploy.

2. **Host** the files on any HTTP/HTTPS server (nginx, S3-compatible, IIS, etc.) under a single base URL, e.g. `https://updates.internal.corp/postly/`.

3. The directory must contain the platform manifest files (`latest-mac.yml`, `latest.yml`, `latest-linux.yml`) alongside the installer binaries. These files are included in every GitHub release.

**Example `latest-mac.yml`:**
```yaml
version: 1.2.0
files:
  - url: Postly-1.2.0-arm64.dmg
    sha512: <hash from release>
    size: 94371840
  - url: Postly-1.2.0.dmg
    sha512: <hash from release>
    size: 97123456
path: Postly-1.2.0-arm64.dmg
sha512: <hash from release>
releaseDate: '2025-05-30T00:00:00.000Z'
```

> Tip: simply mirror the exact files from the GitHub release — the YAML manifests are already in the correct format and do not need editing.

### Configuring Postly to use your mirror

#### Option A — Bundled enterprise config (recommended for IT deployment)

Place an `enterprise.json` file in the `resources/` directory of the packaged application **before distributing it**. This requires repackaging after download, but means users need zero configuration.

File location inside the app bundle:

| Platform | Path |
|---|---|
| macOS | `Postly.app/Contents/Resources/enterprise.json` |
| Windows | `resources/enterprise.json` (next to the executable) |
| Linux | `resources/enterprise.json` |

**`enterprise.json` format:**
```json
{
  "updateUrl": "https://updates.internal.corp/postly/"
}
```

When this file is present, Postly shows **"Managed by your administrator"** in the Updates settings and the URL field is locked — users cannot override it.

#### Option B — Per-user setting

In **Settings → Updates → Enterprise / Disconnected Mode**, enter the internal server URL. Postly will use this URL for all future update checks. Clearing the field reverts to the GitHub Releases channel.

This option is suitable for individual users on networks that block GitHub but have access to an internal mirror.

---

## Rollback and version control

Because your internal server controls the `latest-mac.yml` / `latest.yml` manifest, you have full control over which version Postly considers "latest":

- **Deploy a new version:** update the manifest to point to the new installer
- **Roll back to a previous version:** update the manifest to point to the older installer — Postly will offer an "update" to the older version
- **Staged rollout:** serve different manifests to different user groups by routing to different paths

There is no rollback mechanism through the standard GitHub Releases channel.

---

## Security considerations

- electron-updater verifies the **SHA-512 hash** of every downloaded file against the value in the manifest before applying the update. Tampered installers will be rejected.
- Use **HTTPS** for your internal mirror to prevent man-in-the-middle attacks on the manifest or binaries.
- The bundled `enterprise.json` approach prevents users from accidentally pointing Postly at an unintended update source.
