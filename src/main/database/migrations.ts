export const migrations: string[] = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'local',
    source_meta TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    collapsed INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    url TEXT NOT NULL DEFAULT '',
    params TEXT NOT NULL DEFAULT '[]',
    headers TEXT NOT NULL DEFAULT '[]',
    body_type TEXT NOT NULL DEFAULT 'none',
    body_content TEXT NOT NULL DEFAULT '',
    auth_type TEXT NOT NULL DEFAULT 'none',
    auth_config TEXT NOT NULL DEFAULT '{}',
    description TEXT,
    scm_path TEXT,
    scm_sha TEXT,
    is_dirty INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS env_vars (
    id TEXT PRIMARY KEY,
    env_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    is_secret INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS oauth_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grant_type TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret TEXT,
    auth_url TEXT,
    token_url TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '',
    redirect_uri TEXT NOT NULL DEFAULT 'http://localhost:9876/callback',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    oauth_config_id TEXT NOT NULL REFERENCES oauth_configs(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type TEXT NOT NULL DEFAULT 'Bearer',
    expires_at INTEGER,
    scope TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    client_id TEXT DEFAULT '',
    client_secret TEXT DEFAULT '',
    token TEXT DEFAULT '',
    refresh_token TEXT DEFAULT '',
    connected_user TEXT DEFAULT '',
    repo TEXT DEFAULT '',
    branch TEXT DEFAULT 'main',
    status TEXT DEFAULT 'disconnected',
    error_message TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`
]
