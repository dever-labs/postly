/**
 * Declarative post-response extraction: pull a value out of a response into a variable.
 * Shared by the main process (which runs the rules) and the renderer (inline validation).
 * Rules are stored on the request under `protocolConfig.extractRules` as JSON, so they
 * follow the request through drafts, exports and git files without a schema change.
 */

export type ExtractSource = 'json' | 'header' | 'status' | 'cookie' | 'regex'
export type ExtractScope = 'environment' | 'collection'

export interface ExtractRule {
  id: string
  source: ExtractSource
  /** JSON path or pointer, header or cookie name, or regular expression. Unused for `status`. */
  expression: string
  variable: string
  scope: ExtractScope
  enabled: boolean
}

export const EXTRACT_RULES_KEY = 'extractRules'

export const SOURCE_LABELS: Record<ExtractSource, string> = {
  json: 'JSON body',
  header: 'Header',
  status: 'Status code',
  cookie: 'Cookie',
  regex: 'Body regex',
}

export interface ExtractableResponse {
  status: number
  headers: Record<string, string>
  body: string
  cookies?: { name: string; value: string }[]
}

export interface ExtractResult {
  rule: ExtractRule
  ok: boolean
  value?: string
  error?: string
}

/** Cap on the text a pattern sees; the main process also bounds how long a pattern may run. */
const MAX_REGEX_INPUT = 1_000_000

/** Returns the match groups, or null for no match. May throw (for example on timeout). */
export type RegexExec = (pattern: string, text: string) => string[] | null

const plainRegex: RegexExec = (pattern, text) => {
  const m = new RegExp(pattern).exec(text)
  return m ? [...m] : null
}
const VARIABLE_NAME = /^[A-Za-z_][\w.-]*$/

type Segment = string | number

export function parseRules(raw: string | undefined): ExtractRule[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((r, i): ExtractRule[] => {
      if (!r || typeof r !== 'object') return []
      const o = r as Record<string, unknown>
      if (!(o.source as string in SOURCE_LABELS)) return []
      return [{
        id: typeof o.id === 'string' && o.id ? o.id : `rule-${i}`,
        source: o.source as ExtractSource,
        expression: typeof o.expression === 'string' ? o.expression : '',
        variable: typeof o.variable === 'string' ? o.variable : '',
        scope: o.scope === 'collection' ? 'collection' : 'environment',
        enabled: o.enabled !== false,
      }]
    })
  } catch { return [] }
}

export function serializeRules(rules: ExtractRule[]): string {
  return JSON.stringify(rules)
}

/** Parses `$.a.b[0]`, `a.b[0]['c d']` or a JSON pointer such as `/a/b/0`. Returns an error string for invalid syntax. */
export function parseJsonPath(expr: string): Segment[] | string {
  const text = expr.trim()
  if (!text) return 'Enter a JSON path such as $.data.token'
  if (text.startsWith('/')) {
    return text.slice(1).split('/').map((s) => {
      const key = s.replace(/~1/g, '/').replace(/~0/g, '~')
      return /^(0|[1-9]\d*)$/.test(key) ? Number(key) : key
    })
  }
  let rest = text.startsWith('$') ? text.slice(1) : `.${text}`
  const out: Segment[] = []
  while (rest.length > 0) {
    let m: RegExpExecArray | null
    if ((m = /^\.([^.[\]\s]+)/.exec(rest))) out.push(m[1])
    else if ((m = /^\[(\d+)\]/.exec(rest))) out.push(Number(m[1]))
    else if ((m = /^\[(?:'([^']*)'|"([^"]*)")\]/.exec(rest))) out.push(m[1] ?? m[2])
    else if (/^\[\*\]|^\.\./.test(rest)) return 'Wildcards and recursive descent are not supported'
    else return `Unexpected "${rest.slice(0, 8)}" in JSON path`
    rest = rest.slice(m[0].length)
  }
  return out
}

function walk(root: unknown, path: Segment[]): { found: boolean; value?: unknown } {
  let cur = root
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return { found: false }
    // Own properties only, so paths like `constructor` or `__proto__` never reach the prototype chain
    if (!Object.prototype.hasOwnProperty.call(cur, String(seg))) return { found: false }
    cur = (cur as Record<string, unknown>)[String(seg)]
  }
  return { found: true, value: cur }
}

/** Edit-time check: the message to show next to the rule, or null when it is valid. */
export function validateRule(rule: Pick<ExtractRule, 'source' | 'expression' | 'variable'>): string | null {
  if (!rule.variable.trim()) return 'Choose a variable name'
  if (!VARIABLE_NAME.test(rule.variable.trim())) return 'Variable names use letters, digits, _ . - and cannot start with a digit'
  switch (rule.source) {
    case 'json': {
      const parsed = parseJsonPath(rule.expression)
      return typeof parsed === 'string' ? parsed : null
    }
    case 'header': return rule.expression.trim() ? null : 'Enter a header name'
    case 'cookie': return rule.expression.trim() ? null : 'Enter a cookie name'
    case 'regex': {
      if (!rule.expression) return 'Enter a regular expression'
      try { new RegExp(rule.expression); return null } catch (e) { return (e as Error).message.replace(/^Invalid regular expression: /, '') }
    }
    case 'status': return null
  }
}

const stringify = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

function extractValue(rule: ExtractRule, res: ExtractableResponse, regex: RegexExec): { value?: string; error?: string } {
  const expr = rule.expression.trim()
  switch (rule.source) {
    case 'status': return { value: String(res.status) }
    case 'header': {
      const key = Object.keys(res.headers).find((k) => k.toLowerCase() === expr.toLowerCase())
      return key === undefined ? { error: `Header "${expr}" is not in the response` } : { value: res.headers[key] }
    }
    case 'cookie': {
      const cookie = (res.cookies ?? []).find((c) => c.name === expr)
      return cookie ? { value: cookie.value } : { error: `Cookie "${expr}" was not set by the response` }
    }
    case 'json': {
      let body: unknown
      try { body = JSON.parse(res.body) } catch { return { error: 'Response body is not valid JSON' } }
      const path = parseJsonPath(rule.expression)
      if (typeof path === 'string') return { error: path }
      const hit = walk(body, path)
      return hit.found ? { value: stringify(hit.value) } : { error: `Nothing found at ${expr}` }
    }
    case 'regex': {
      const match = regex(rule.expression, res.body.slice(0, MAX_REGEX_INPUT))
      if (!match) return { error: 'Pattern did not match the response body' }
      return { value: match[1] ?? match[0] }
    }
  }
}

/** Runs enabled rules. Never throws: a rule that cannot be evaluated is reported, not raised. */
export function runExtraction(rules: ExtractRule[], res: ExtractableResponse, regex: RegexExec = plainRegex): ExtractResult[] {
  return rules.filter((r) => r.enabled).map((rule): ExtractResult => {
    const invalid = validateRule(rule)
    if (invalid) return { rule, ok: false, error: invalid }
    try {
      const { value, error } = extractValue(rule, res, regex)
      return value === undefined ? { rule, ok: false, error: error ?? 'No value' } : { rule, ok: true, value }
    } catch (e) {
      return { rule, ok: false, error: String(e) }
    }
  })
}
