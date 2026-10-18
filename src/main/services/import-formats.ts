import { CORE_SCHEMA, load as yamlLoad, mergeTag } from 'js-yaml'
import type { ExportCollection, ExportEnvironment, ExportFolder } from '../ipc/export-import'
import { isOpenApiDocument, parseOpenApi } from './import-openapi'
import { convertBrunoEnvironmentExport, convertBrunoExport, convertBrunoFiles, isBrunoEnvironmentExport, isBrunoExport, type BrunoFile } from './import-bruno'
import { convertBrunoYamlFiles, isBrunoYamlFolder } from './import-bruno-yaml'
import { convertInsomnia, convertInsomniaEnvironment, insomniaKind } from './import-insomnia'
import { convertPostmanV3Files, isPostmanV3Folder } from './import-postman-v3'
import { convertPostman, convertPostmanEnvironment, isPostmanCollection, isPostmanEnvironment, isPostmanV1Collection } from './import-postman'
import { list } from './import-util'

export type ImportFormat =
  | 'postly'
  | 'openapi'
  | 'postman'
  | 'postman-environment'
  | 'insomnia'
  | 'insomnia-environment'
  | 'bruno-environment'
  | 'bruno'

export interface ImportPreviewCollection {
  collection: ExportCollection
  folders: number
  requests: number
  environments: number
}

export interface ImportPreview {
  format: ImportFormat
  collections: ImportPreviewCollection[]
  environments?: ExportEnvironment[]
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
  return { collection, ...countFolder(collection), environments: collection.environments?.length ?? 0 }
}

function parseText(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) throw new Error('The file is empty.')
  try {
    return JSON.parse(trimmed)
  } catch (jsonError) {
    try {
      return yamlLoad(trimmed, { schema: CORE_SCHEMA.withTags(mergeTag) })
    } catch (yamlError) {
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) throw new Error(`Invalid JSON: ${(jsonError as Error).message}`, { cause: yamlError })
      throw new Error(`Could not read the file as JSON or YAML: ${(yamlError as Error).message}`, { cause: yamlError })
    }
  }
}

function summarizePostmanEnvironment(doc: Record<string, unknown>): { environment: ExportEnvironment; warnings: string[] } {
  const environment = convertPostmanEnvironment(doc)
  const values = list(doc.values)
  const disabled = values.filter((value) => value.disabled === true || value.enabled === false).length
  const secrets = values.filter((value) => value.disabled !== true && value.enabled !== false && value.type === 'secret').length
  const warnings: string[] = []
  if (disabled > 0) warnings.push(`${environment.name}: skipped ${disabled} disabled variable${disabled !== 1 ? 's' : ''}.`)
  if (secrets > 0) warnings.push(`${environment.name}: ${secrets} secret variable${secrets !== 1 ? 's were' : ' was'} imported without a value. Re-enter ${secrets !== 1 ? 'them' : 'it'} in Postly.`)
  return { environment, warnings }
}

function normalizePreviewEnvironments(value: unknown): ExportEnvironment[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const environment = entry as Partial<ExportEnvironment>
    const rawName = typeof environment.name === 'string'
      ? environment.name
      : typeof environment.name === 'number' || typeof environment.name === 'boolean'
        ? String(environment.name)
        : 'Imported'
    const name = rawName.trim() || 'Imported'
    const variables = Array.isArray(environment.variables)
      ? environment.variables.flatMap((row) => {
          if (typeof row !== 'object' || row === null) return []
          const variable = row as Partial<ExportEnvironment['variables'][number]>
          return [{
            key: typeof variable.key === 'string' ? variable.key : String(variable.key ?? ''),
            value: typeof variable.value === 'string' ? variable.value : String(variable.value ?? ''),
            isSecret: variable.isSecret === true,
          }]
        })
      : []
    return [{ name, variables }]
  })
}

/** Detects the format of an import file and converts it to Postly collections without touching the database. */
export async function previewImport(text: string, options: { sourceUrl?: string } = {}): Promise<ImportPreview> {
  if (text.length > MAX_IMPORT_BYTES) throw new Error('The file is larger than 20 MB.')
  const doc = parseText(text)
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw new Error('Unrecognised file: expected a JSON or YAML object.')

  const obj = doc as Record<string, unknown>
  if (typeof obj.$schema === 'string' && obj.$schema.startsWith('postly/') && Array.isArray(obj.collections)) {
    const environments = normalizePreviewEnvironments(obj.environments)
    return { format: 'postly', collections: (obj.collections as ExportCollection[]).map(summarize), ...(environments ? { environments } : {}), warnings: [] }
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
  if (isPostmanEnvironment(obj)) {
    const result = summarizePostmanEnvironment(obj)
    return { format: 'postman-environment', collections: [], environments: [result.environment], warnings: result.warnings }
  }
  const insomnia = insomniaKind(obj)
  if (insomnia === 'unsupported') throw new Error('This Insomnia file type is not supported. Export a collection or workspace from Insomnia.')
  if (insomnia === 'environment') {
    const result = convertInsomniaEnvironment(obj)
    return { format: 'insomnia-environment', collections: [], environments: result.environments, warnings: result.warnings }
  }
  if (insomnia) {
    const entries: ImportPreviewCollection[] = []
    const warnings: string[] = []
    const converted = convertInsomnia(obj, insomnia)
    if (converted.collections.length === 0 && converted.environments) {
      return { format: 'insomnia-environment', collections: [], environments: converted.environments, warnings: converted.warnings ?? [] }
    }
    warnings.push(...(converted.warnings ?? []))
    for (const entry of converted.collections) {
      let { collection } = entry
      const own = [...entry.warnings]
      if (entry.spec) {
        // A design document without requests is its OpenAPI definition
        try {
          const spec = await parseOpenApi(parseText(entry.spec) as Record<string, unknown>, options.sourceUrl)
          collection = { ...spec.collection, name: collection.name }
          own.push(...spec.warnings)
        } catch (err) {
          throw new Error(`The Insomnia design document contains an invalid OpenAPI definition: ${(err as Error).message}`, { cause: err })
        }
      }
      entries.push(summarize(collection))
      warnings.push(...(converted.collections.length > 1 ? own.map((w) => `${collection.name}: ${w}`) : own))
    }
    return { format: 'insomnia', collections: entries, warnings }
  }
  if (isBrunoEnvironmentExport(obj)) {
    const result = convertBrunoEnvironmentExport(obj)
    return { format: 'bruno-environment', collections: [], environments: result.environments, warnings: result.warnings }
  }
  if (isBrunoExport(obj)) {
    const result = convertBrunoExport(obj)
    return { format: 'bruno', collections: [summarize(result.collection)], warnings: result.warnings }
  }
  if (isPostmanV1Collection(obj)) throw new Error('This is a Postman collection v1 file, which is not supported. Export it again as Collection v2.1.')
  if (obj.$kind === 'collection') {
    const entries = convertPostmanV3Files([{ path: 'collection.yaml', text }])
    if (entries.length > 0) return { format: 'postman', collections: entries.map((e) => summarize(e.collection)), warnings: multi(entries) }
  }
  throw new Error('Unrecognised format. Supported: Postly export, Postman collection v2.x, Insomnia v4/v5 export, Bruno JSON export, OpenAPI 3.x and Swagger 2 (JSON or YAML).')
}

export const MAX_FOLDER_FILES = 5000

const multi = (entries: Array<{ collection: ExportCollection; warnings: string[] }>) =>
  entries.flatMap((e) => (entries.length > 1 ? e.warnings.map((w) => `${e.collection.name}: ${w}`) : e.warnings))

/** Converts the files of a Bruno (.bru or YAML) or Postman v3 collection folder without touching the database. */
export function previewFolder(files: BrunoFile[]): ImportPreview {
  if (files.length > MAX_FOLDER_FILES) throw new Error(`The folder has more than ${MAX_FOLDER_FILES} collection files.`)
  if (files.reduce((n, f) => n + f.text.length, 0) > MAX_IMPORT_BYTES) throw new Error('The folder is larger than 20 MB.')
  let format: ImportFormat = 'bruno'
  const hasBruFiles = files.some((file) => /\.bru$/i.test(file.path))
  let entries = !hasBruFiles && isBrunoYamlFolder(files) ? convertBrunoYamlFiles(files) : convertBrunoFiles(files)
  if (entries.length === 0 && isBrunoYamlFolder(files)) entries = convertBrunoYamlFiles(files)
  if (entries.length === 0 && isPostmanV3Folder(files)) {
    format = 'postman'
    entries = convertPostmanV3Files(files)
  }
  if (entries.length === 0) throw new Error('No Bruno (.bru or YAML) or Postman v3 collection files were found in that folder.')
  return { format, collections: entries.map((e) => summarize(e.collection)), warnings: multi(entries) }
}
