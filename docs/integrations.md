# Connecting Integrations

Postly can sync API collections from three external sources: **GitHub**, **GitLab**, and **Backstage**. Each source appears as its own collapsible group in the sidebar alongside your local collections.

---

## GitHub

### Prerequisites

Create a **GitHub OAuth App** (no client secret required — Postly uses the Device Flow standard):

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Set **Homepage URL** to `http://localhost`
3. Set **Authorization callback URL** to `http://localhost`
4. Copy the **Client ID** (you do not need the client secret)

### Connecting

1. In Postly, click **Connect a source** at the bottom of the sidebar
2. Select **GitHub**
3. Enter a display name and your GitHub base URL (`https://github.com` or your GitHub Enterprise URL)
4. Paste the **Client ID**
5. Enter the **repository** to sync from (`owner/repo`)
6. Enter the default **branch** (e.g. `main`)
7. Click **Save & Reconnect** — you will be shown a device code to approve at github.com/login/device
8. Once approved, collections from the repository are imported into the sidebar

### What gets synced

Postly looks for a `postly.json` file (or files matching `*.postly.json`) at the root of the configured repository and branch. The file format is the same as the Postly export format.

---

## GitLab

### Prerequisites

Create a **GitLab OAuth Application**:

1. Go to **GitLab → User Settings → Applications** (or the Admin Area for instance-wide)
2. Set **Redirect URI** to `http://localhost`
3. Enable the `read_api` scope
4. Copy the **Application ID** (Client ID)

### Connecting

1. In Postly, click **Connect a source**
2. Select **GitLab**
3. Enter a display name and your GitLab base URL (`https://gitlab.com` or your self-hosted URL)
4. Paste the **Application ID** as the Client ID
5. Enter the **repository** (`namespace/project`) and **branch**
6. Click **Save & Reconnect** — you will be shown a device code to approve on your GitLab instance
7. Once approved, collections are synced from the repository

---

## Backstage

### Prerequisites

You need a running Backstage instance with the Software Catalog enabled. Postly reads API entities from the catalog API.

Optionally, create a **service account token** if your Backstage instance requires authentication.

### Connecting

1. In Postly, click **Connect a source**
2. Select **Backstage**
3. Enter a display name and your Backstage base URL (e.g. `http://localhost:7007`)
4. Optionally enter a **service account token** if required
5. Set the **default path** (defaults to `/api/catalog`)
6. Click **Save & Connect**

Postly will fetch all API entities from the catalog and create a collection group for each one that contains OpenAPI/Swagger definitions.

---

## Managing integrations

- Click the **settings icon** next to any connected source in the sidebar to edit its configuration
- To remove a source, open the edit page and scroll down to the **Remove** section
- Collections synced from a source are read-only by default; to make local changes, drag collections to your **Local** source

## Committing changes

For GitHub and GitLab sources, Postly includes a **Commit panel** that lets you write a commit message and push changes back to the source repository directly from the app. Open it via the commit icon in the request editor toolbar.
