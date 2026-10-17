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

const TEXT_BLOCKS = new Set([
  'body:json', 'body:text', 'body:xml', 'body:sparql', 'body:graphql', 'body:graphql:vars',
  'script:pre-request', 'script:post-response', 'tests', 'docs',
])
const LIST_BLOCKS = new Set(['vars:secret'])
const DICT_PREFIXES = ['params:', 'query', 'headers', 'auth', 'body', 'vars', 'assert', 'settings', 'meta', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'connect', 'trace', 'http']

const isDict = (name: string) => DICT_PREFIXES.some((p) => name === p || (p.endsWith(':') ? name.startsWith(p) : name.startsWith(`${p}:`)))

/** Parses `key: value` lines; returns the rows. Annotations and blank lines are skipped. */
function parseDict(lines: string[]): BruRow[] {
  const rows: BruRow[] = []
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()
    if (!line || (line.startsWith('@') && /^@\w+\(/.test(line))) continue

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
      if (colon < 0) continue
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
  return rows
}

function dedent(lines: string[]): string {
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)?.[0].length ?? 0), Infinity)
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n').replace(/\s+$/, '')
}

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
      if (lines[i].trim() === "'''") inQuote = !inQuote
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
