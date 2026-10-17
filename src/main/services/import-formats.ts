import { CORE_SCHEMA, load as yamlLoad, mergeTag } from 'js-yaml'
import type { ExportCollection, ExportFolder } from '../ipc/export-import'
import { isOpenApiDocument, parseOpenApi } from './import-openapi'
import { convertPostman, isPostmanCollection, isPostmanEnvironment, isPostmanV1Collection } from './import-postman'

export type ImportFormat = 'postly' | 'openapi' | 'postman'

export interface ImportPreviewCollection {
  collection: ExportCollection
  folders: number
  requests: number
}

export interface ImportPreview {
  format: ImportFormat
  collections: ImportPreviewCollection[]
  warnings: string[]
}

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024

function countFolder(folder: { requests?: unknown[]; folders?: ExportFolder[]; groups?: ExportFolder[] }): { folders: number; requests: number } {
  let folders = 0
  let requests = folder.requests?.length ?? 0
  for (const child of folder.folders ?? folder.groups ?? []) {
    const inner = countFolder(child)
    folders += 1 + inner.folders
    requests += inner.requests
  }
  return { folders, requests }
}

export function summarize(collection: ExportCollection): ImportPreviewCollection {
  return { collection, ...countFolder(collection) }
}

function parseText(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) throw new Error('The file is empty.')
  try {
    return JSON.parse(trimmed)
  } catch (jsonError) {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) throw new Error(`Invalid JSON: ${(jsonError as Error).message}`, { cause: jsonError })
    try {
      return yamlLoad(trimmed, { schema: CORE_SCHEMA.withTags(mergeTag) })
    } catch (yamlError) {
      throw new Error(`Could not read the file as JSON or YAML: ${(yamlError as Error).message}`, { cause: yamlError })
    }
  }
}

/** Detects the format of an import file and converts it to Postly collections without touching the database. */
export async function previewImport(text: string, options: { sourceUrl?: string } = {}): Promise<ImportPreview> {
  if (text.length > MAX_IMPORT_BYTES) throw new Error('The file is larger than 20 MB.')
  const doc = parseText(text)
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw new Error('Unrecognised file: expected a JSON or YAML object.')

  const obj = doc as Record<string, unknown>
  if (typeof obj.$schema === 'string' && obj.$schema.startsWith('postly/') && Array.isArray(obj.collections)) {
    return { format: 'postly', collections: (obj.collections as ExportCollection[]).map(summarize), warnings: [] }
  }
  if (isOpenApiDocument(obj)) {
    let result
    try {
      result = await parseOpenApi(obj, options.sourceUrl)
    } catch (err) {
      throw new Error(`Invalid OpenAPI document: ${(err as Error).message}`, { cause: err })
    }
    return { format: 'openapi', collections: [summarize(result.collection)], warnings: result.warnings }
  }
  if (isPostmanCollection(obj)) {
    const result = convertPostman(obj)
    return { format: 'postman', collections: [summarize(result.collection)], warnings: result.warnings }
  }
  if (isPostmanEnvironment(obj)) throw new Error('This is a Postman environment file. Import a Postman collection (v2.0 or v2.1) instead.')
  if (isPostmanV1Collection(obj)) throw new Error('This is a Postman collection v1 file, which is not supported. Export it again as Collection v2.1.')
  throw new Error('Unrecognised format. Supported: Postly export, Postman collection v2.x, OpenAPI 3.x and Swagger 2 (JSON or YAML).')
}
