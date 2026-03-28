import axios from 'axios'
import crypto from 'crypto'
import SwaggerParser from '@apidevtools/swagger-parser'
import { queryOne, run } from '../database'
import { parseOpenApiToRequests } from './openapi-parser'

export interface GitLabSettings {
  baseUrl: string
  clientId: string
  token: string
  connectedUser?: { username: string; name: string; avatarUrl: string }
  repo: string
  groups: string[]
}

interface GitLabProject {
  id: number
  name: string
  path_with_namespace: string
  default_branch: string
}

export async function discoverApis(settings: GitLabSettings): Promise<void> {
  const now = Date.now()
  const base = settings.baseUrl.replace(/\/$/, '')
  const headers = { 'PRIVATE-TOKEN': settings.token }

  for (const group of settings.groups) {
    const projectsResponse = await axios.get<GitLabProject[]>(
      `${base}/api/v4/groups/${encodeURIComponent(group)}/projects?per_page=100`,
      { headers }
    )

    for (const project of projectsResponse.data) {
      const branch = project.default_branch ?? 'main'
      const candidates = ['openapi.yaml', 'openapi.json', 'openapi/openapi.yaml', 'docs/openapi.yaml']

      for (const filePath of candidates) {
        let spec: object
        try {
          const encodedPath = encodeURIComponent(filePath)
          const rawResponse = await axios.get(
            `${base}/api/v4/projects/${project.id}/repository/files/${encodedPath}/raw?ref=${branch}`,
            { headers }
          )
          spec = await SwaggerParser.dereference(rawResponse.data)
        } catch { continue }

        const sourceMeta = JSON.stringify({ projectId: project.id, projectPath: project.path_with_namespace, filePath })
        const existing = queryOne<{ id: string }>(`SELECT id FROM collections WHERE source = 'gitlab' AND source_meta = ?`, [sourceMeta])

        let collectionId: string
        if (existing) {
          collectionId = existing.id
          run('UPDATE collections SET updated_at = ? WHERE id = ?', [now, collectionId])
        } else {
          collectionId = crypto.randomUUID()
          run(`INSERT INTO collections (id, name, source, source_meta, created_at, updated_at) VALUES (?, ?, 'gitlab', ?, ?, ?)`,
            [collectionId, project.path_with_namespace, sourceMeta, now, now])
        }

        try {
          const { groups: parsedGroups, requests } = await parseOpenApiToRequests(spec, collectionId)
          run('DELETE FROM groups WHERE collection_id = ?', [collectionId])

          for (const g of parsedGroups) {
            run(
              `INSERT INTO groups (id, collection_id, name, description, collapsed, hidden, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [g.id, g.collectionId, g.name, g.description ?? null, g.collapsed ? 1 : 0, g.hidden ? 1 : 0, g.sortOrder, g.createdAt, g.updatedAt]
            )
          }

          for (const req of requests) {
            run(
              `INSERT INTO requests (id, group_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [req.id, req.groupId, req.name, req.method, req.url, req.params, req.headers, req.bodyType,
               req.bodyContent, req.authType, req.authConfig, req.description ?? null, filePath, null,
               req.isDirty ? 1 : 0, req.sortOrder, req.createdAt, req.updatedAt]
            )
          }
        } catch { /* skip unparseable */ }
        break
      }
    }
  }
}

export async function getFileSha(
  token: string,
  baseUrl: string,
  projectId: string,
  filePath: string,
  branch: string
): Promise<string> {
  const base = baseUrl.replace(/\/$/, '')
  const encodedPath = encodeURIComponent(filePath)
  const response = await axios.get(
    `${base}/api/v4/projects/${projectId}/repository/files/${encodedPath}?ref=${branch}`,
    { headers: { 'PRIVATE-TOKEN': token } }
  )
  return response.data.last_commit_id
}

export async function commitFile(
  token: string,
  baseUrl: string,
  projectId: string,
  filePath: string,
  content: string,
  sha: string,
  message: string,
  branch: string
): Promise<void> {
  const base = baseUrl.replace(/\/$/, '')
  const encodedPath = encodeURIComponent(filePath)
  await axios.put(
    `${base}/api/v4/projects/${projectId}/repository/files/${encodedPath}`,
    {
      branch,
      content,
      commit_message: message,
      last_commit_id: sha
    },
    { headers: { 'PRIVATE-TOKEN': token } }
  )
}

export async function listBranches(
  token: string,
  baseUrl: string,
  projectId: string
): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')
  const response = await axios.get(
    `${base}/api/v4/projects/${projectId}/repository/branches`,
    { headers: { 'PRIVATE-TOKEN': token } }
  )
  return (response.data as Array<{ name: string }>).map((b) => b.name)
}

export async function createBranch(
  token: string,
  baseUrl: string,
  projectId: string,
  newBranch: string,
  fromBranch: string
): Promise<void> {
  const base = baseUrl.replace(/\/$/, '')
  await axios.post(
    `${base}/api/v4/projects/${projectId}/repository/branches`,
    { branch: newBranch, ref: fromBranch },
    { headers: { 'PRIVATE-TOKEN': token } }
  )
}

export async function getFileContent(
  token: string,
  baseUrl: string,
  projectId: string,
  filePath: string,
  branch: string
): Promise<string> {
  const base = baseUrl.replace(/\/$/, '')
  const encodedPath = encodeURIComponent(filePath)
  const response = await axios.get(
    `${base}/api/v4/projects/${projectId}/repository/files/${encodedPath}/raw?ref=${branch}`,
    { headers: { 'PRIVATE-TOKEN': token } }
  )
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
}
