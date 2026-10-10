/**
 * Variable scopes and {{placeholder}} interpolation, shared by the main process
 * (which sends requests) and the renderer (tooltips, autocomplete, code snippets)
 * so both resolve a name the same way.
 *
 * Precedence, lowest to highest: dynamic built-ins < global < collection < environment.
 */

export type VarScope = 'dynamic' | 'global' | 'collection' | 'environment'

export type ScopeValues = Record<string, string>

export interface VariableScopes {
  global?: ScopeValues
  collection?: ScopeValues
  environment?: ScopeValues
}

/** Highest precedence first. */
export const SCOPE_ORDER: Exclude<VarScope, 'dynamic'>[] = ['environment', 'collection', 'global']

export const SCOPE_LABELS: Record<VarScope, string> = {
  dynamic: 'Built-in',
  global: 'Global',
  collection: 'Collection',
  environment: 'Environment',
}

export const PRECEDENCE_HELP = 'Environment overrides Collection, which overrides Global. Built-in {{$…}} variables are used only when no variable has that name.'

export interface DynamicVariableInfo {
  name: string
  description: string
}

export const DYNAMIC_VARIABLES: DynamicVariableInfo[] = [
  { name: '$guid', description: 'A random UUID, new for every use' },
  { name: '$timestamp', description: 'Unix time in seconds, fixed for one send' },
  { name: '$isoTimestamp', description: 'ISO 8601 date and time, fixed for one send' },
  { name: '$randomInt', description: 'A random integer from 0 to 1000, new for every use' },
]

export interface DynamicSources {
  now: () => number
  uuid: () => string
  random: () => number
}

const defaultSources = (): DynamicSources => ({
  now: () => Date.now(),
  uuid: () => globalThis.crypto.randomUUID(),
  random: () => Math.random(),
})

/** Creates the generator for one send. Timestamps are captured once so every use in the request agrees. */
export function createDynamicVariables(sources: Partial<DynamicSources> = {}): (name: string) => string | undefined {
  const s = { ...defaultSources(), ...sources }
  const at = s.now()
  return (name) => {
    switch (name) {
      case '$guid': return s.uuid()
      case '$timestamp': return String(Math.floor(at / 1000))
      case '$isoTimestamp': return new Date(at).toISOString()
      case '$randomInt': return String(Math.floor(s.random() * 1001))
      default: return undefined
    }
  }
}

export interface Resolution {
  /** The variable name exactly as it appears between the braces, trimmed. */
  name: string
  scope: VarScope | null
  value?: string
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** Finds a variable by name using the scope precedence. `dynamic` is only consulted when nothing else matches. */
export function lookupVariable(name: string, scopes: VariableScopes, dynamic?: (name: string) => string | undefined): Resolution {
  for (const scope of SCOPE_ORDER) {
    const values = scopes[scope]
    if (values && hasOwn(values, name)) return { name, scope, value: values[name] }
  }
  const generated = name.startsWith('$') ? (dynamic ?? createDynamicVariables())(name) : undefined
  return generated === undefined ? { name, scope: null } : { name, scope: 'dynamic', value: generated }
}

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g

export interface InterpolationResult {
  text: string
  /** One entry per distinct name, in order of first use. */
  resolutions: Resolution[]
}

/** Replaces {{name}} placeholders. Unknown names are left untouched so they stay visible. */
export function interpolate(text: string, scopes: VariableScopes, dynamic?: (name: string) => string | undefined): InterpolationResult {
  const seen = new Map<string, Resolution>()
  const gen = dynamic ?? createDynamicVariables()
  const out = text.replace(PLACEHOLDER, (whole, raw: string) => {
    const name = raw.trim()
    const r = lookupVariable(name, scopes, gen)
    if (!seen.has(name)) seen.set(name, { name, scope: r.scope })
    return r.scope === null ? whole : (r.value ?? '')
  })
  return { text: out, resolutions: [...seen.values()] }
}

/** Merges the resolutions from several interpolations, keeping the first for each name. */
export function mergeResolutions(lists: Resolution[][]): Resolution[] {
  const seen = new Map<string, Resolution>()
  for (const list of lists) for (const r of list) if (!seen.has(r.name)) seen.set(r.name, r)
  return [...seen.values()]
}

/** One-line, value-free summary for the Console. */
export function summarizeResolutions(resolutions: Resolution[]): { resolved: string | null; unresolved: string[] } {
  const resolved = resolutions.filter((r) => r.scope !== null)
  return {
    resolved: resolved.length === 0 ? null : resolved.map((r) => `${r.name} ← ${SCOPE_LABELS[r.scope as VarScope].toLowerCase()}`).join(', '),
    unresolved: resolutions.filter((r) => r.scope === null).map((r) => `{{${r.name}}}`),
  }
}
