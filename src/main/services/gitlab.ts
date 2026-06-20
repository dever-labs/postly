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
        } catch {
          continue
        }

        const sourceMeta = JSON.stringify({ projectId: project.id, projectPath: project.path_with_namespace, filePath })
        const existing = queryOne<{ id: string }>(`SELECT id FROM folders WHERE parent_id IS NULL AND source = 'gitlab' AND source_meta = ?`, [sourceMeta])

        let collectionId: string
        if (existing) {
          collectionId = existing.id
          run('UPDATE folders SET updated_at = ? WHERE id = ?', [now, collectionId])
        } else {
          collectionId = crypto.randomUUID()
          run(
            `INSERT INTO folders (id, parent_id, name, source, source_meta, auth_type, auth_config, ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
             VALUES (?, NULL, ?, 'gitlab', ?, 'none', '{}', 'inherit', 0, 0, 0, ?, ?)`,
            [collectionId, project.path_with_namespace, sourceMeta, now, now]
          )
        }

        try {
          const { folders, requests } = await parseOpenApiToRequests(spec, collectionId)
          run('DELETE FROM requests WHERE folder_id = ?', [collectionId])
          run('DELETE FROM folders WHERE parent_id = ?', [collectionId])

          for (const folder of folders) {
            run(
              `INSERT INTO folders (id, parent_id, name, description, source, source_meta, integration_id, auth_type, auth_config, ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'local', NULL, NULL, 'none', '{}', 'inherit', ?, ?, ?, ?, ?)`,
              [folder.id, folder.parentId, folder.name, folder.description ?? '', folder.hidden ? 1 : 0, folder.collapsed ? 1 : 0, folder.sortOrder, folder.createdAt, folder.updatedAt]
            )
          }

          for (const request of requests) {
            run(
              `INSERT INTO requests (id, folder_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [request.id, request.folderId, request.name, request.method, request.url, request.params, request.headers, request.bodyType,
                request.bodyContent, request.authType, request.authConfig, request.description ?? null, filePath, null,
                request.isDirty ? 1 : 0, request.sortOrder, request.createdAt, request.updatedAt]
            )
          }
        } catch {
          /* skip unparseable */
        }
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
