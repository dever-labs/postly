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

### Authentication

| Option | When to use |
|---|---|
| **Guest** | Local Backstage with the guest provider |
| **Token** | A static service token — sees whatever the token may see, not what *you* may see |
| **OAuth** | Sign in to Backstage itself in your browser — recommended for shared instances (e.g. devhub) |
| **GitLab / GitHub / Google** | Backstage's sign-in popup for that provider |

### Sign in with OAuth

**OAuth** signs you in as yourself, through whatever login the Backstage instance uses (OIDC, SSO, …), so the catalog shows exactly what you're allowed to see. Backstage is the OAuth 2.0 authorization server; Postly is a public native client:

1. Postly discovers the authorization server from `<base URL>/.well-known/oauth-authorization-server`, `<base URL>/api/auth/.well-known/oauth-authorization-server` or `<base URL>/api/auth/.well-known/openid-configuration` (first one that answers).
2. It starts a one-shot callback server on `127.0.0.1` with a random free port and opens your **system browser** at the authorization endpoint (authorization code + PKCE S256, a random `state`, scope `openid offline_access`).
3. You sign in and approve Postly in Backstage; the browser returns to the callback. A response with the wrong `state` is refused.
4. Postly exchanges the code for an access token and a refresh token, stores both in its encrypted database (key protected by the OS keychain), and syncs the catalog.

Access tokens are refreshed automatically before they expire and after a `401`; refresh tokens rotate. **Save & Reconnect** re-syncs without the browser while the refresh token is valid. **Sign out** (or removing the source) revokes the refresh token at Backstage and forgets both tokens.

Postly identifies itself with a [Client ID Metadata Document](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/) instead of a pre-registered client. Its client ID is the URL of that document, [`oauth/client.json`](../oauth/client.json) in this repo:

```
https://raw.githubusercontent.com/dever-labs/postly/main/oauth/client.json
```

#### What a Backstage admin needs to enable

Backstage's auth backend must have Client ID Metadata Documents enabled (`auth.clientIdMetadataDocuments`, in recent `@backstage/plugin-auth-backend` releases) and allow Postly's client ID. Setting `allowedClientIdPatterns` replaces Backstage's defaults, so keep any you rely on:

```yaml
auth:
  clientIdMetadataDocuments:
    enabled: true
    allowedClientIdPatterns:
      - 'https://raw.githubusercontent.com/dever-labs/postly/main/oauth/client.json'
      # Backstage's defaults, if you use them (Claude, VS Code, Codex):
      # - 'https://claude.ai/*'
      # - 'https://vscode.dev/*'
      # - 'https://chatgpt.com/oauth/codex/*/client.json'
  # Optional but recommended: without refresh tokens you sign in again every hour.
  experimentalRefreshToken:
    enabled: true
```

Redirects: the document registers `http://127.0.0.1/callback` and `http://localhost/callback`. Backstage (like RFC 8252 §7.3) matches loopback redirect URIs on scheme, host and path and ignores the port, so the random port Postly listens on is accepted. If you override `allowedRedirectUriPatterns`, keep `http://127.0.0.1:*/*`.

devhub (`https://hub.dever.dk`) already allows Postly ([dever-labs/devhub#82](https://github.com/dever-labs/devhub/pull/82)).

### Connecting

1. Click **Add Git Source** → select **Backstage**
2. Enter a display name and your Backstage base URL (e.g. `http://localhost:7007` or `https://hub.dever.dk`)
3. Pick an authentication option (and enter a **token** for Token)
4. Click **Connect** — for OAuth, finish signing in in your browser

Postly fetches all API entities from the catalog and creates a collection for each Component that provides APIs, and for each API not provided by a Component (OpenAPI/Swagger, GraphQL and gRPC definitions).

### "Open in Postly" links

Postly registers the `postly://` URL scheme, so a Backstage page (devhub's API pages, for instance) can link straight into it:

```
postly://open?backstage=<url-encoded base URL>&entity=<url-encoded entity ref>
```

For example:

```
postly://open?backstage=https%3A%2F%2Fhub.dever.dk&entity=api%3Amockly%2Fmockly-management-api
```

- `backstage` — the Backstage base URL, `http://` or `https://` only, no credentials, query or fragment.
- `entity` — `kind:namespace/name`, where kind is `api` or `component`.

Clicking it brings Postly to the front and opens that entity's collection. If no source exists for that base URL yet, Postly asks before adding it (with **OAuth** sign-in). If the entity isn't in the last sync, Postly syncs once more before reporting it as not found. Links with anything else — other actions, parameters, schemes or malformed refs — are refused.

Installed builds register the scheme automatically (Windows installer, macOS app bundle, Linux `.desktop` file; the portable Windows build and AppImage register it the first time they start). In development, start with `POSTLY_DEV_PROTOCOL=1 npm run dev` to register the dev build.

---

## Managing sources

- Click the **settings icon** next to any connected source in the sidebar to edit its configuration
- To remove a source, open the settings page and scroll down to the **Remove** section
- Collections synced from a git or Backstage source are read-only by default; drag them to **Local** to make fully independent copies
