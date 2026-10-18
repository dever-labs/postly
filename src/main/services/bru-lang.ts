// A reader for Bruno's .bru file format. It follows the grammar of bruno-lang v2 closely enough for
// everything Postly maps: dictionary blocks (key: value, `~` for disabled, quoted keys, '''
// multi-line values), list blocks (tags, vars:secret) and text blocks (bodies, scripts, tests, docs).

export type BruRow = { name: string; value: string; enabled: boolean; local?: boolean }

export interface BruBlocks {
  /** Dictionary blocks keyed by block name, in file order. */
  dicts: Map<string, BruRow[]>
  /** Text blocks such as body:json, script:pre-request, tests and docs. */
  texts: Map<string, string>
  /** List blocks such as vars:secret. */
  lists: Map<string, string[]>
  /** Blocks that were present but are not understood. */
  unknown: string[]
}

export interface BruEnvironment {
  variables: BruRow[]
  secretVariables: BruRow[]
  extends: string[]
  externalSecrets: string[]
  hasColor: boolean
  malformed: boolean
}

const TEXT_BLOCKS = new Set([
  'body:json', 'body:text', 'body:xml', 'body:sparql', 'body:graphql', 'body:graphql:vars',
  'script:pre-request', 'script:post-response', 'tests', 'docs',
])
const LIST_BLOCKS = new Set(['vars:secret'])
const DICT_PREFIXES = ['params:', 'query', 'headers', 'auth', 'body', 'vars', 'assert', 'settings', 'meta', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'connect', 'trace', 'http']

const isDict = (name: string) => DICT_PREFIXES.some((p) => name === p || (p.endsWith(':') ? name.startsWith(p) : name.startsWith(`${p}:`)))

/** Parses `key: value` lines; returns the rows. Annotations and blank lines are skipped. */
function parseDictDetailed(lines: string[]): { rows: BruRow[]; malformed: number } {
  const rows: BruRow[] = []
  let malformed = 0
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()
    if (!line || /^@\w+(?:\(.*\))?:?$/.test(line)) continue

    let enabled = true
    if (line.startsWith('~')) { enabled = false; line = line.slice(1) }
    let local = false
    if (line.startsWith('@')) { local = true; line = line.slice(1) }
    if (line.startsWith('~')) { enabled = false; line = line.slice(1) }

    let name: string
    let rest: string
    if (line.startsWith('"')) {
      let j = 1
      let key = ''
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && j + 1 < line.length) { key += line[j + 1]; j += 2 } else { key += line[j]; j++ }
      }
      name = key
      rest = line.slice(j + 1).replace(/^\s*:/, '')
    } else {
      const colon = line.indexOf(':')
      if (colon < 0) { malformed++; continue }
      name = line.slice(0, colon).trim()
      rest = line.slice(colon + 1)
    }

    let value = rest.trim()
    if (value === '[') {
      const items: string[] = []
      for (i++; i < lines.length && lines[i].trim() !== ']'; i++) {
        const item = lines[i].trim().replace(/,$/, '')
        if (item) items.push(item)
      }
      value = items.join('\n')
    } else if (value === "'''") {
      const parts: string[] = []
      for (i++; i < lines.length && lines[i].trim() !== "'''"; i++) parts.push(lines[i])
      const indent = Math.min(...parts.filter((p) => p.trim()).map((p) => /^ */.exec(p)?.[0].length ?? 0), Infinity)
      value = parts.map((p) => p.slice(Number.isFinite(indent) ? indent : 0)).join('\n')
    }
    rows.push({ name, value, enabled, ...(local ? { local } : {}) })
  }
  return { rows, malformed }
}

function parseDict(lines: string[]): BruRow[] {
  return parseDictDetailed(lines).rows
}

function parseListRows(lines: string[]): BruRow[] {
  const rows: BruRow[] = []
  for (const raw of lines) {
    let line = raw.trim().replace(/,$/, '')
    if (!line || /^@\w+(?:\(.*\))?:?$/.test(line)) continue
    let enabled = true
    if (line.startsWith('~')) { enabled = false; line = line.slice(1).trim() }
    if (!line) continue
    rows.push({ name: line, value: '', enabled })
  }
  return rows
}

function parseScalarList(lines: string[]): string[] {
  return lines.map((line) => line.trim().replace(/,$/, ''))
    .filter(Boolean)
    .map((line) => line.replace(/^"(.*)"$/, '$1'))
}

function dedent(lines: string[]): string {
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)?.[0].length ?? 0), Infinity)
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n').replace(/\s+$/, '')
}

const tripleQuotes = (line: string): number => (line.match(/'''/g) ?? []).length

export function parseBru(source: string): BruBlocks {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const out: BruBlocks = { dicts: new Map(), texts: new Map(), lists: new Map(), unknown: [] }
  for (let i = 0; i < lines.length; i++) {
    const start = /^([A-Za-z][\w:.-]*)\s*([{[])\s*$/.exec(lines[i])
    if (!start) continue
    const name = start[1]
    const close = start[2] === '{' ? '}' : ']'
    const body: string[] = []
    let inQuote = false
    for (i++; i < lines.length; i++) {
      if (tripleQuotes(lines[i]) % 2 === 1) inQuote = !inQuote
      if (!inQuote && lines[i].trimEnd() === close) break
      body.push(lines[i])
    }
    if (start[2] === '[' || LIST_BLOCKS.has(name)) {
      out.lists.set(name, body.map((l) => l.trim().replace(/,$/, '')).filter(Boolean))
    } else if (TEXT_BLOCKS.has(name)) {
      out.texts.set(name, dedent(body))
    } else if (isDict(name)) {
      out.dicts.set(name, parseDict(body))
    } else {
      out.unknown.push(name)
    }
  }
  return out
}

export function parseBruEnvironment(source: string): BruEnvironment {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const out: BruEnvironment = {
    variables: [],
    secretVariables: [],
    extends: [],
    externalSecrets: [],
    hasColor: false,
    malformed: false,
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    if (/^color\s*:/.test(trimmed)) {
      out.hasColor = true
      continue
    }
    if (/^extends\s*:/.test(trimmed)) {
      const name = trimmed.slice(trimmed.indexOf(':') + 1).trim()
      if (name) out.extends.push(name.replace(/^"(.*)"$/, '$1'))
      continue
    }

    const start = /^([A-Za-z][\w:.-]*)\s*([{[])\s*$/.exec(lines[i])
    if (!start) continue
    const name = start[1]
    const close = start[2] === '{' ? '}' : ']'
    const body: string[] = []
    let inQuote = false
    let closed = false
    for (i++; i < lines.length; i++) {
      if (tripleQuotes(lines[i]) % 2 === 1) inQuote = !inQuote
      if (!inQuote && lines[i].trimEnd() === close) {
        closed = true
        break
      }
      body.push(lines[i])
    }
    if (!closed) out.malformed = true

    if (name === 'vars') {
      const parsed = parseDictDetailed(body)
      out.variables.push(...parsed.rows)
      if (parsed.malformed > 0) out.malformed = true
      continue
    }
    if (name === 'vars:secret') {
      out.secretVariables.push(...parseListRows(body))
      continue
    }
    if (name === 'extends') {
      out.extends.push(...parseScalarList(body))
      continue
    }
    if (name.startsWith('vars:externalsecrets:')) {
      out.externalSecrets.push(name.slice('vars:externalsecrets:'.length) || name)
    }
  }

  return out
}
