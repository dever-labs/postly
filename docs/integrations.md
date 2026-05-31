# Connecting Sources

Postly can sync API collections from two types of external sources: **Git repositories** and **Backstage**. Each source appears as its own collapsible group in the sidebar alongside your local collections.

To add a source, click **Add Git Source** at the bottom of the sidebar.

---

## Git repository

The **Git** source type works with any git host — GitHub, GitLab, Gitea, Azure DevOps, Bitbucket, or any self-hosted git server. Postly clones the repository locally using your system's git credentials; no token or OAuth setup is required inside the app.

### Authentication

Postly delegates authentication to your system git tooling:

| URL style | How credentials are resolved |
|---|---|
| `https://github.com/org/repo` | Git Credential Manager, macOS Keychain, `~/.netrc`, etc. |
| `git@github.com:org/repo.git` | SSH agent or `~/.ssh/id_ed25519` / `id_rsa` (auto-detected) |
| `https://gitlab.example.com/…` | Same as HTTPS above |
| Any self-hosted | Same rules — whatever your system git would use |

If `git clone <url>` works in your terminal, it will work in Postly.

### Connecting

1. Click **Add Git Source** in the sidebar
2. Select **Git repository**
3. Paste the repository URL (HTTPS or SSH)
4. Optionally edit the display name (auto-filled from `org/repo`)
5. Set the default branch (default: `main`)
6. Click **Connect** — Postly clones the repository and imports any API definitions it finds

### What gets imported

Postly auto-discovers API definitions on connect and sync:

| File(s) found | What happens |
|---|---|
| `openapi.yaml` / `openapi.json` | Imported as a collection with groups per tag |
| `swagger.yaml` / `swagger.json` | Same |
| `openapi/openapi.yaml`, `docs/openapi.yaml`, `api/openapi.yaml` | Same |
| `*.postly.json` | Imported as a full Postly collection (requests, auth, groups) |

Multiple files can coexist — each produces a separate collection in the sidebar.

### Syncing and committing

- Click the **Sync** icon next to a git source to pull the latest changes from the remote branch
- For `*.postly.json` collections, you can edit requests and commit changes back to the repository using the **Commit** panel (commit icon in the request editor toolbar)
- Changes to OpenAPI-sourced collections are read-only from Postly's perspective — edit the spec file in your repo

---

## Backstage

### Prerequisites

You need a running Backstage instance with the Software Catalog enabled. Postly reads API entities from the catalog API.

Optionally, create a **service account token** if your Backstage instance requires authentication.

### Connecting

1. Click **Add Git Source** → select **Backstage**
2. Enter a display name and your Backstage base URL (e.g. `http://localhost:7007`)
3. Optionally enter a **service account token** if required
4. Click **Connect**

Postly fetches all API entities from the catalog and creates a collection for each one that has an OpenAPI/Swagger definition.

---

## Managing sources

- Click the **settings icon** next to any connected source in the sidebar to edit its configuration
- To remove a source, open the settings page and scroll down to the **Remove** section
- Collections synced from a git or Backstage source are read-only by default; drag them to **Local** to make fully independent copies
