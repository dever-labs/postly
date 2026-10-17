import { EXTRACT_RULES_KEY, serializeRules, type ExtractRule } from '../../shared/extract'
import { DYNAMIC_VARIABLES } from '../../shared/variables'
import type { ExportCollection, ExportFolder, ExportRequest } from '../ipc/export-import'
import crypto from 'crypto'
import { parseBru, type BruBlocks, type BruRow } from './bru-lang'
import { isObj, kv, list, parseQuery, splitUrl, str, type Auth, type Obj } from './import-util'

// Bruno collections: a directory of .bru files (bruno.json, collection.bru, folder.bru, requests,
// environments/*.bru), or the JSON file produced by Bruno's "Export collection".

export interface BrunoFile {
  path: string
  text: string
}

export interface BrunoEntry {
  collection: ExportCollection
  warnings: string[]
}

const NO_AUTH: Auth = { type: 'none', config: {} }
const INHERIT: Auth = { type: 'inherit', config: {} }
const SUPPORTED_DYNAMIC = new Set(DYNAMIC_VARIABLES.map((v) => v.name))

/** One request, whichever way it was stored. */
interface BruRequest {
  name: string
  type: string
  seq: number
  method: string
  url: string
  params: Array<BruRow & { type?: string }>
  headers: BruRow[]
  bodyMode: string
  body: Obj
  authMode: string
  auth: Obj
  varsPre: BruRow[]
  varsPost: BruRow[]
  hasScripts: boolean
  hasTests: boolean
  assertions: number
  docs: string
}

/** Settings shared by a folder or the collection. */
interface BruSettings {
  name: string
  seq: number
  headers: BruRow[]
  authMode: string
  auth: Obj
  varsPre: BruRow[]
  hasScripts: boolean
  docs: string
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const rowsOf = (v: unknown): BruRow[] => list(v).map((r) => ({ name: str(r.name), value: str(r.value), enabled: r.enabled !== false }))

// ─── .bru → model ────────────────────────────────────────────────────────────

const toDict = (rows: BruRow[] | undefined): Obj => Object.fromEntries((rows ?? []).map((r) => [r.name, r.value]))

function authFromBlocks(b: BruBlocks): Obj {
  const get = (name: string) => toDict(b.dicts.get(`auth:${name}`))
  const o = get('oauth2')
  const key = get('apikey')
  return {
    basic: get('basic'),
    bearer: get('bearer'),
    digest: get('digest'),
    ntlm: get('ntlm'),
    awsv4: get('awsv4'),
    wsse: get('wsse'),
    oauth1: get('oauth1'),
    apikey: key,
    oauth2: {
      grantType: o.grant_type, authorizationUrl: o.authorization_url, accessTokenUrl: o.access_token_url, clientId: o.client_id,
      clientSecret: o.client_secret, scope: o.scope, callbackUrl: o.callback_url,
    },
  }
}

function requestFromBru(source: string, fallbackName: string): { request: BruRequest; unknown: string[] } {
  const b = parseBru(source)
  const meta = toDict(b.dicts.get('meta'))
  const verb = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'connect', 'trace'].find((m) => b.dicts.has(m))
  const http = toDict(b.dicts.get(verb ?? 'http'))
  const params = (b.dicts.get('params:query') ?? []).map((r) => ({ ...r, type: 'query' }))
    .concat((b.dicts.get('params:path') ?? []).map((r) => ({ ...r, type: 'path' })))
  const t = (name: string) => b.texts.get(name) ?? ''
  return {
    unknown: b.unknown,
    request: {
      name: str(meta.name) || fallbackName,
      type: str(meta.type) || 'http',
      seq: num(meta.seq),
      method: (verb ?? (str(http.method) || 'get')).toUpperCase(),
      url: str(http.url),
      params,
      headers: b.dicts.get('headers') ?? [],
      bodyMode: str(http.body) || 'none',
      body: {
        json: t('body:json'), text: t('body:text'), xml: t('body:xml'), sparql: t('body:sparql'),
        graphql: { query: t('body:graphql'), variables: t('body:graphql:vars') },
        formUrlEncoded: b.dicts.get('body:form-urlencoded') ?? [],
        multipartForm: b.dicts.get('body:multipart-form') ?? [],
        file: b.dicts.get('body:file') ?? [],
      },
      authMode: str(http.auth) || 'none',
      auth: authFromBlocks(b),
      varsPre: b.dicts.get('vars:pre-request') ?? [],
      varsPost: b.dicts.get('vars:post-response') ?? [],
      hasScripts: !!(t('script:pre-request').trim() || t('script:post-response').trim()),
      hasTests: !!t('tests').trim(),
      assertions: (b.dicts.get('assert') ?? []).length,
      docs: t('docs'),
    },
  }
}

function settingsFromBru(source: string, fallbackName: string): BruSettings & { unknown: string[] } {
  const b = parseBru(source)
  const meta = toDict(b.dicts.get('meta'))
  const mode = toDict(b.dicts.get('auth')).mode
  return {
    name: str(meta.name) || fallbackName,
    seq: num(meta.seq),
    headers: b.dicts.get('headers') ?? [],
    authMode: str(mode),
    auth: authFromBlocks(b),
    varsPre: b.dicts.get('vars:pre-request') ?? [],
    hasScripts: !!(b.texts.get('script:pre-request')?.trim() || b.texts.get('script:post-response')?.trim() || b.texts.get('tests')?.trim()),
    docs: b.texts.get('docs') ?? '',
    unknown: b.unknown,
  }
}

// ─── Bruno JSON export → model ───────────────────────────────────────────────

function requestFromExport(item: Obj): BruRequest {
  const r = isObj(item.request) ? item.request : {}
  const body = isObj(r.body) ? r.body : {}
  const auth = isObj(r.auth) ? r.auth : {}
  const script = isObj(r.script) ? r.script : {}
  const vars = isObj(r.vars) ? r.vars : {}
  return {
    name: str(item.name) || 'Request',
    type: str(item.type).replace(/-request$/, '') || 'http',
    seq: num(item.seq),
    method: (str(r.method) || 'GET').toUpperCase(),
    url: str(r.url),
    params: list(r.params).map((p) => ({ name: str(p.name), value: str(p.value), enabled: p.enabled !== false, type: str(p.type) || 'query' })),
    headers: rowsOf(r.headers),
    bodyMode: str(body.mode) || 'none',
    body: {
      json: str(body.json), text: str(body.text), xml: str(body.xml), sparql: str(body.sparql),
      graphql: isObj(body.graphql) ? body.graphql : {},
      formUrlEncoded: rowsOf(body.formUrlEncoded),
      multipartForm: list(body.multipartForm).map((p) => ({ name: str(p.name), value: str(p.value), enabled: p.enabled !== false, fileType: p.type === 'file' })),
      file: list(body.file),
    },
    authMode: str(auth.mode) || 'none',
    auth,
    varsPre: rowsOf(vars.req),
    varsPost: rowsOf(vars.res),
    hasScripts: !!(str(script.req).trim() || str(script.res).trim()),
    hasTests: !!str(r.tests).trim(),
    assertions: list(r.assertions).length,
    docs: str(r.docs),
  }
}

function settingsFromExport(root: unknown, name: string, seq: number): BruSettings {
  const r = isObj(root) && isObj(root.request) ? root.request : {}
  const script = isObj(r.script) ? r.script : {}
  const vars = isObj(r.vars) ? r.vars : {}
  const auth = isObj(r.auth) ? r.auth : {}
  return {
    name, seq,
    headers: rowsOf(r.headers),
    authMode: str(auth.mode),
    auth,
    varsPre: rowsOf(vars.req),
    hasScripts: !!(str(script.req).trim() || str(script.res).trim() || str(r.tests).trim()),
    docs: str(r.docs),
  }
}

// ─── Conversion ──────────────────────────────────────────────────────────────

const POST_VAR = /^\$?res\.(body|status|headers)(.*)$/

/** `res.body.token` style expressions become Extract rules; anything computed is skipped. */
function extractRule(row: BruRow): ExtractRule | null {
  const m = POST_VAR.exec(row.value.trim().replace(/^\{\{|\}\}$/g, '').trim())
  if (!m) return null
  const rule = { id: crypto.randomUUID(), variable: row.name, scope: 'collection' as const, enabled: row.enabled }
  if (m[1] === 'status' && !m[2]) return { ...rule, source: 'status', expression: '' }
  if (m[1] === 'body' && /^(\.\w+|\[\d+\]|\[(?:'[^']*'|"[^"]*")\])*$/.test(m[2])) return { ...rule, source: 'json', expression: `$${m[2]}` }
  const header = m[1] === 'headers' ? /^(?:\.([\w-]+)|\[(['"])([^'"]+)\2\])$/.exec(m[2]) : null
  if (header) return { ...rule, source: 'header', expression: header[1] ?? header[3] }
  return null
}

const GRANTS = new Set(['authorization_code', 'client_credentials', 'password', 'implicit'])

function convertAuth(mode: string, auth: Obj, label: string, warnings: string[]): Auth {
  const a = (name: string): Obj => (isObj(auth[name]) ? auth[name] : {})
  switch (mode) {
    case '':
    case 'inherit':
      return { ...INHERIT }
    case 'none':
      return { ...NO_AUTH }
    case 'basic':
      return { type: 'basic', config: { username: str(a('basic').username), password: str(a('basic').password) } }
    case 'bearer':
      return { type: 'bearer', config: { token: str(a('bearer').token) } }
    case 'digest':
      return { type: 'digest', config: { username: str(a('digest').username), password: str(a('digest').password) } }
    case 'ntlm':
      return { type: 'ntlm', config: { username: str(a('ntlm').username), password: str(a('ntlm').password), domain: str(a('ntlm').domain), workstation: str(a('ntlm').workstation) } }
    case 'apikey': {
      const k = a('apikey')
      return { type: 'apikey', config: { key: str(k.key), value: str(k.value), in: /^query/i.test(str(k.placement)) ? 'query' : 'header' } }
    }
    case 'awsv4': {
      const k = a('awsv4')
      return { type: 'awsv4', config: { accessKey: str(k.accessKeyId), secretKey: str(k.secretAccessKey), sessionToken: str(k.sessionToken), region: str(k.region), service: str(k.service) } }
    }
    case 'oauth2': {
      const o = a('oauth2')
      const grant = str(o.grantType) || 'authorization_code'
      if (!GRANTS.has(grant)) {
        warnings.push(`${label}: OAuth 2.0 grant type "${grant}" is not supported; configure authentication manually.`)
        return { ...NO_AUTH }
      }
      if (grant === 'password') warnings.push(`${label}: the username and password of the OAuth 2.0 password grant were not mapped.`)
      return {
        type: 'oauth2',
        config: { grantType: grant, clientId: str(o.clientId), clientSecret: str(o.clientSecret), authUrl: str(o.authorizationUrl), tokenUrl: str(o.accessTokenUrl), scopes: str(o.scope), redirectUri: str(o.callbackUrl) },
      }
    }
    default:
      warnings.push(`${label}: "${mode}" authentication is not supported; configure it manually.`)
      return { ...NO_AUTH }
  }
}

function convertBody(r: BruRequest, label: string, warnings: string[]): { bodyType: string; bodyContent: string } {
  const body = r.body
  const rows = (v: unknown): Array<BruRow & { fileType?: boolean }> => (Array.isArray(v) ? (v as Array<BruRow & { fileType?: boolean }>) : [])
  switch (r.bodyMode) {
    case 'json': return { bodyType: 'raw-json', bodyContent: str(body.json) }
    case 'text': return { bodyType: 'raw-text', bodyContent: str(body.text) }
    case 'xml': return { bodyType: 'raw-xml', bodyContent: str(body.xml) }
    case 'sparql': return { bodyType: 'raw-text', bodyContent: str(body.sparql) }
    case 'graphql': {
      const gql = isObj(body.graphql) ? body.graphql : {}
      return { bodyType: 'graphql', bodyContent: JSON.stringify({ query: str(gql.query), variables: str(gql.variables) }) }
    }
    case 'formUrlEncoded':
      return { bodyType: 'x-www-form-urlencoded', bodyContent: JSON.stringify(rows(body.formUrlEncoded).map((p) => kv(p.name, p.value, p.enabled))) }
    case 'multipartForm':
      return {
        bodyType: 'form-data',
        bodyContent: JSON.stringify(rows(body.multipartForm).map((p) => {
          // .bru files mark a file part as `@file(path)`
          const file = /^@file\((.*?)\)(\s|$)/.exec(p.value)
          return { ...kv(p.name, file ? file[1] : p.value, p.enabled), ...(file || p.fileType ? { fieldType: 'file' } : {}) }
        })),
      }
    case 'file':
      warnings.push(`${label}: the file for the binary body was not imported; pick it again in the Body tab.`)
      return { bodyType: 'binary', bodyContent: '' }
    case 'none':
      return { bodyType: 'none', bodyContent: '' }
    default:
      warnings.push(`${label}: body type "${r.bodyMode}" is not supported.`)
      return { bodyType: 'none', bodyContent: '' }
  }
}

interface Context {
  warnings: string[]
  variables: Map<string, string>
  pathVariables: Map<string, string>
  dynamic: Set<string>
  scripted: string[]
  tested: string[]
  preVars: string[]
}

function noteDynamic(ctx: Context, value: string) {
  for (const m of value.matchAll(/\{\{\s*(\$[A-Za-z]+)\s*\}\}/g)) if (!SUPPORTED_DYNAMIC.has(m[1])) ctx.dynamic.add(m[1])
}

function convertRequest(r: BruRequest, ctx: Context): ExportRequest {
  const label = `"${r.name}"`
  const { warnings } = ctx
  const declared = r.params.filter((p) => p.type === 'path').map((p) => ({ key: p.name, value: p.value }))
  const split = splitUrl(r.url, ctx.pathVariables, declared)
  const queryRows = r.params.filter((p) => p.type !== 'path')
  const params = queryRows.length > 0 || split.query === null
    ? queryRows.map((p) => kv(p.name, p.value, p.enabled))
    : parseQuery(split.query)
  const headers = r.headers.filter((h) => h.name).map((h) => kv(h.name, h.value, h.enabled))
  const body = convertBody(r, label, warnings)
  const auth = convertAuth(r.authMode, r.auth, label, warnings)

  if (r.hasScripts) ctx.scripted.push(label)
  if (r.hasTests || r.assertions > 0) ctx.tested.push(label)
  if (r.varsPre.length > 0) ctx.preVars.push(label)

  const rules: ExtractRule[] = []
  const skipped: string[] = []
  for (const row of r.varsPost) {
    const rule = extractRule(row)
    if (rule) rules.push(rule)
    else skipped.push(row.name)
  }
  if (skipped.length > 0) warnings.push(`${label}: ${skipped.length} post-response variable${skipped.length === 1 ? '' : 's'} could not be converted (${skipped.slice(0, 3).join(', ')}).`)

  for (const value of [split.url, ...params.map((p) => p.key + p.value), ...headers.map((h) => h.key + h.value), body.bodyContent]) noteDynamic(ctx, value)

  return {
    name: r.name,
    method: r.method,
    url: split.url,
    protocol: 'http',
    params,
    headers,
    bodyType: body.bodyType,
    bodyContent: body.bodyContent,
    auth,
    ssl: 'inherit',
    description: r.docs,
    protocolConfig: rules.length > 0 ? { [EXTRACT_RULES_KEY]: serializeRules(rules) } : {},
  }
}

interface Tree {
  settings: BruSettings
  requests: BruRequest[]
  folders: Tree[]
  unsupported: string[]
}

function convertFolderSettings(s: BruSettings, label: string, ctx: Context): { description: string; auth: Auth } {
  if (s.headers.some((h) => h.name)) ctx.warnings.push(`${label}: its headers were not imported; add them to each request.`)
  if (s.hasScripts) ctx.scripted.push(label)
  if (s.varsPre.length > 0) {
    for (const row of s.varsPre) if (row.enabled && !ctx.variables.has(row.name)) ctx.variables.set(row.name, row.value)
    ctx.warnings.push(`${label}: its variables were added to the collection variables.`)
  }
  return { description: s.docs, auth: convertAuth(s.authMode, s.auth, label, ctx.warnings) }
}

function convertTree(tree: Tree, ctx: Context): { requests: ExportRequest[]; folders: ExportFolder[] } {
  const requests: ExportRequest[] = []
  for (const r of [...tree.requests].sort((a, b) => a.seq - b.seq)) requests.push(convertRequest(r, ctx))
  const folders: ExportFolder[] = [...tree.folders].sort((a, b) => a.settings.seq - b.settings.seq).map((child) => {
    const { description, auth } = convertFolderSettings(child.settings, `Folder "${child.settings.name}"`, ctx)
    return { name: child.settings.name, description, auth, ssl: 'inherit', ...convertTree(child, ctx) }
  })
  for (const name of tree.unsupported) ctx.warnings.push(`"${name}": only HTTP and GraphQL requests are imported.`)
  return { requests, folders }
}

function finish(name: string, settings: BruSettings, tree: Tree, environments: string[], extra: string[], seedWarnings: string[]): BrunoEntry {
  const ctx: Context = { warnings: [...seedWarnings], variables: new Map(), pathVariables: new Map(), dynamic: new Set(), scripted: [], tested: [], preVars: [] }
  for (const row of settings.varsPre) if (row.enabled && !ctx.variables.has(row.name)) ctx.variables.set(row.name, row.value)
  const rootAuth = convertAuth(settings.authMode, settings.auth, 'Collection', ctx.warnings)
  if (settings.headers.some((h) => h.name)) ctx.warnings.push('Collection: its headers were not imported; add them to each request.')
  if (settings.hasScripts) ctx.scripted.push('Collection')

  const { requests, folders } = convertTree(tree, ctx)
  if (requests.length === 0 && folders.length === 0) ctx.warnings.push('The collection has no requests.')

  if (ctx.scripted.length > 0) {
    const sample = ctx.scripted.slice(0, 3).join(', ')
    ctx.warnings.push(`Scripts were not imported for ${ctx.scripted.length} item${ctx.scripted.length === 1 ? '' : 's'} (${sample}${ctx.scripted.length > 3 ? ', …' : ''}).`)
  }
  if (ctx.preVars.length > 0) ctx.warnings.push(`Request variables (pre-request vars) were not imported for ${ctx.preVars.length} request${ctx.preVars.length === 1 ? '' : 's'} (${ctx.preVars.slice(0, 3).join(', ')}${ctx.preVars.length > 3 ? ', …' : ''}).`)
  if (ctx.tested.length > 0) ctx.warnings.push(`Tests and assertions were not imported for ${ctx.tested.length} request${ctx.tested.length === 1 ? '' : 's'}.`)
  if (environments.length > 0) {
    ctx.warnings.push(`${environments.length} environment${environments.length === 1 ? ' was' : 's were'} not imported (${environments.slice(0, 3).join(', ')}${environments.length > 3 ? ', …' : ''}); create them in Postly and set the variables your requests use.`)
  }
  if (ctx.dynamic.size > 0) ctx.warnings.push(`Dynamic variables Postly does not provide are used and will stay unresolved: ${[...ctx.dynamic].map((d) => `{{${d}}}`).join(', ')}.`)
  ctx.warnings.push(...extra)
  for (const [key, value] of ctx.pathVariables) if (!ctx.variables.has(key)) ctx.variables.set(key, value)

  return {
    collection: {
      name: name || 'Imported Bruno collection',
      description: settings.docs,
      source: 'local',
      auth: rootAuth.type === 'inherit' ? { ...NO_AUTH } : rootAuth,
      ssl: 'inherit',
      variables: [...ctx.variables].map(([key, value]) => ({ key, value, isSecret: false })),
      requests,
      folders,
    },
    warnings: ctx.warnings,
  }
}

const emptySettings = (name: string): BruSettings => ({ name, seq: 0, headers: [], authMode: '', auth: {}, varsPre: [], hasScripts: false, docs: '' })

// ─── Directories of .bru files ───────────────────────────────────────────────

const IGNORED_DIRS = new Set(['node_modules', '.git'])
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

export function isBrunoYamlCollection(files: BrunoFile[]): boolean {
  return files.some((f) => /(^|\/)opencollection\.ya?ml$/.test(f.path))
}

export function convertBrunoFiles(input: BrunoFile[]): BrunoEntry[] {
  const files = input.map((f) => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\.?\//, '') }))
    .filter((f) => !f.path.split('/').some((seg) => IGNORED_DIRS.has(seg)))

  const roots = files.filter((f) => baseName(f.path) === 'bruno.json').map((f) => dirName(f.path))
  if (roots.length === 0) {
    // Without bruno.json the picked folder itself is the collection
    const first = files.find((f) => f.path.endsWith('.bru'))
    if (!first) return []
    roots.push(first.path.split('/').length > 1 ? first.path.split('/')[0] : '')
  }
  roots.sort((a, b) => b.length - a.length)
  const owner = (path: string) => roots.find((r) => r === '' || path.startsWith(`${r}/`))

  return roots.map((root) => {
    const prefix = root ? `${root}/` : ''
    const mine = files.filter((f) => owner(f.path) === root)
    const rel = (f: BrunoFile) => f.path.slice(prefix.length)

    const warnings: string[] = []
    let name = baseName(root)
    const config = mine.find((f) => rel(f) === 'bruno.json')
    const extra: string[] = []
    if (config) {
      try {
        const json = JSON.parse(config.text) as Obj
        if (str(json.name)) name = str(json.name)
        const proxy = isObj(json.proxy) ? json.proxy : {}
        const certs = isObj(json.clientCertificates) ? list(json.clientCertificates.certs) : []
        if (proxy.enabled === true || str(proxy.enabled) === 'true' || certs.length > 0) extra.push('The collection’s proxy and client certificate settings were not imported; configure them in Postly’s settings.')
      } catch (err) {
        warnings.push(`bruno.json could not be read (${(err as Error).message}); the folder name was used.`)
      }
    }

    const environments = mine.filter((f) => /^environments\/[^/]+\.bru$/.test(rel(f))).map((f) => baseName(f.path).replace(/\.bru$/, ''))
    const collectionBru = mine.find((f) => rel(f) === 'collection.bru')
    const settings = collectionBru ? settingsFromBru(collectionBru.text, name) : emptySettings(name)

    const makeTree = (dir: string, folderSettings: BruSettings): Tree => {
      const tree: Tree = { settings: folderSettings, requests: [], folders: [], unsupported: [] }
      const subdirs = new Set<string>()
      for (const f of mine) {
        const r = rel(f)
        if (!r.startsWith(dir) || r === 'bruno.json' || /^environments\//.test(r)) continue
        const rest = r.slice(dir.length)
        if (rest.includes('/')) subdirs.add(rest.split('/')[0])
        else if (f.path.endsWith('.bru') && baseName(f.path) !== 'folder.bru' && !(dir === '' && rest === 'collection.bru')) {
          const parsed = requestFromBru(f.text, baseName(f.path).replace(/\.bru$/, ''))
          if (parsed.request.type === 'http' || parsed.request.type === 'graphql') tree.requests.push(parsed.request)
          else tree.unsupported.push(parsed.request.name)
        }
      }
      for (const sub of [...subdirs].sort()) {
        const folderFile = mine.find((f) => rel(f) === `${dir}${sub}/folder.bru`)
        const s = folderFile ? settingsFromBru(folderFile.text, sub) : emptySettings(sub)
        tree.folders.push(makeTree(`${dir}${sub}/`, s))
      }
      return tree
    }
    return finish(name, settings, makeTree('', settings), environments, extra, warnings)
  })
}

// ─── Bruno JSON export ───────────────────────────────────────────────────────

export function isBrunoExport(doc: unknown): boolean {
  return isObj(doc) && typeof doc.name === 'string' && Array.isArray(doc.items) && (doc.version === '1' || doc.version === 1) && (isObj(doc.brunoConfig) || Array.isArray(doc.environments))
}

export function convertBrunoExport(doc: Obj): BrunoEntry {
  const build = (items: Obj[], settings: BruSettings): Tree => {
    const tree: Tree = { settings, requests: [], folders: [], unsupported: [] }
    for (const item of items) {
      if (item.type === 'folder') {
        const name = str(item.name) || 'Folder'
        tree.folders.push(build(list(item.items), settingsFromExport(item.root, name, num(item.seq))))
      } else if (/^(http|graphql)(-request)?$/.test(str(item.type))) tree.requests.push(requestFromExport(item))
      else tree.unsupported.push(str(item.name))
    }
    return tree
  }
  const root = settingsFromExport(doc.root, str(doc.name), 0)
  const environments = list(doc.environments).map((e) => str(e.name)).filter(Boolean)
  return finish(str(doc.name), root, build(list(doc.items), root), environments, [], [])
}
