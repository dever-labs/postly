import axios from 'axios'
import crypto from 'crypto'
import SwaggerParser from '@apidevtools/swagger-parser'
import { queryOne, run } from '../database'
import { parseOpenApiToRequests } from './openapi-parser'

export interface GitHubSettings {
  token: string
  orgs: string[]
}

interface SearchItem {
  repository: { full_name: string }
  path: string
  sha: string
}

export async function discoverApis(settings: GitHubSettings): Promise<void> {
  const now = Date.now()
  const headers = { Authorization: `Bearer ${settings.token}`, Accept: 'application/vnd.github.v3+json' }

  for (const org of settings.orgs) {
    const searchResponse = await axios.get<{ items: SearchItem[] }>(
      `https://api.github.com/search/code?q=filename:openapi.yaml+org:${org}`,
      { headers }
    )

    for (const item of searchResponse.data.items) {
      const [owner, repo] = item.repository.full_name.split('/')
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${item.path}`

      let spec: object
      try {
        const rawResponse = await axios.get(rawUrl, { headers })
        spec = await SwaggerParser.dereference(rawResponse.data)
      } catch { continue }

      const sourceMeta = JSON.stringify({ org, repo: item.repository.full_name, path: item.path })
      const existing = queryOne<{ id: string }>(`SELECT id FROM collections WHERE source = 'github' AND source_meta = ?`, [sourceMeta])

      let collectionId: string
      if (existing) {
        collectionId = existing.id
        run('UPDATE collections SET updated_at = ? WHERE id = ?', [now, collectionId])
      } else {
        collectionId = crypto.randomUUID()
        run(`INSERT INTO collections (id, name, source, source_meta, created_at, updated_at) VALUES (?, ?, 'github', ?, ?, ?)`,
          [collectionId, `${item.repository.full_name} / ${item.path}`, sourceMeta, now, now])
      }

      try {
        const { groups, requests } = await parseOpenApiToRequests(spec, collectionId)
        run('DELETE FROM groups WHERE collection_id = ?', [collectionId])

        for (const g of groups) {
          run(
            `INSERT INTO groups (id, collection_id, name, description, collapsed, hidden, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [g.id, g.collectionId, g.name, g.description ?? null, g.collapsed ? 1 : 0, g.hidden ? 1 : 0, g.sortOrder, g.createdAt, g.updatedAt]
          )
        }

        for (const req of requests) {
          run(
            `INSERT INTO requests (id, group_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.id, req.groupId, req.name, req.method, req.url, req.params, req.headers, req.bodyType,
             req.bodyContent, req.authType, req.authConfig, req.description ?? null, item.path, item.sha,
             req.isDirty ? 1 : 0, req.sortOrder, req.createdAt, req.updatedAt]
          )
        }
      } catch { /* skip unparseable */ }
    }
  }
}

export async function getFileSha(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  branch: string
): Promise<string> {
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
  )
  return response.data.sha
}

export async function commitFile(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  sha: string,
  message: string,
  branch: string
): Promise<void> {
  await axios.put(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    {
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch
    },
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
  )
}

export async function listBranches(
  token: string,
  owner: string,
  repo: string
): Promise<string[]> {
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/branches`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
  )
  return (response.data as Array<{ name: string }>).map((b) => b.name)
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  newBranch: string,
  fromBranch: string
): Promise<void> {
  const refResponse = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
  )
  const sha = refResponse.data.object.sha

  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    { ref: `refs/heads/${newBranch}`, sha },
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
  )
}

export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  branch: string
): Promise<string> {
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
  )
  return Buffer.from(response.data.content, 'base64').toString('utf8')
}
