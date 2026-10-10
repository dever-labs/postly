import crypto from 'crypto'
import vm from 'vm'
import { queryAll, run } from '../database'
import { listVariables, replaceVariables } from './variable-store'
import type { ExtractResult, ExtractScope, RegexExec } from '../../shared/extract'

export interface ExtractOutcome {
  variable: string
  scope: ExtractScope
  ok: boolean
  /** Shown in the Console: masked when the target variable is secret. */
  display?: string
  error?: string
}

export interface ExtractTargets {
  envId: string | null
  collectionId: string | null
}

const REGEX_TIMEOUT_MS = 250

/** Rules can arrive in imported collections, so a pattern with catastrophic backtracking must not freeze the app. */
export const guardedRegex: RegexExec = (pattern, text) => {
  try {
    return vm.runInNewContext('(() => { const m = new RegExp(pattern).exec(text); return m ? Array.from(m, (g) => (g === undefined ? "" : g)) : null })()',
      { pattern, text }, { timeout: REGEX_TIMEOUT_MS }) as string[] | null
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new Error(`Pattern took longer than ${REGEX_TIMEOUT_MS} ms and was stopped`)
    throw e
  }
}

const MAX_DISPLAY = 80
const SECRET_MASK = '••••••••'

const show = (value: string, secret: boolean): string => {
  if (secret) return SECRET_MASK
  const flat = value.replace(/\s+/g, ' ')
  return flat.length > MAX_DISPLAY ? `${flat.slice(0, MAX_DISPLAY)}…` : flat
}

/** Writes extracted values to their target scope. Failures to store are reported per rule, never thrown. */
export function applyExtraction(results: ExtractResult[], targets: ExtractTargets): ExtractOutcome[] {
  const outcomes: ExtractOutcome[] = []
  const collectionRows = targets.collectionId ? listVariables('collection', targets.collectionId) : null
  let collectionChanged = false

  for (const r of results) {
    const variable = r.rule.variable.trim()
    const base = { variable, scope: r.rule.scope }
    if (!r.ok || r.value === undefined) { outcomes.push({ ...base, ok: false, error: r.error }); continue }
    try {
      if (r.rule.scope === 'environment') {
        if (!targets.envId) { outcomes.push({ ...base, ok: false, error: 'No active environment to store it in' }); continue }
        const existing = queryAll<{ id: string; is_secret: number }>(
          'SELECT id, is_secret FROM env_vars WHERE env_id = ? AND key = ? LIMIT 1', [targets.envId, variable]
        )[0]
        run('INSERT OR REPLACE INTO env_vars (id, env_id, key, value, is_secret) VALUES (?, ?, ?, ?, ?)',
          [existing?.id ?? crypto.randomUUID(), targets.envId, variable, r.value, existing?.is_secret ?? 0])
        outcomes.push({ ...base, ok: true, display: show(r.value, !!existing?.is_secret) })
      } else {
        if (!collectionRows || !targets.collectionId) { outcomes.push({ ...base, ok: false, error: 'This request is not inside a collection' }); continue }
        const row = collectionRows.find((v) => v.key === variable)
        if (row) row.value = r.value
        else collectionRows.push({ key: variable, value: r.value, isSecret: false })
        collectionChanged = true
        outcomes.push({ ...base, ok: true, display: show(r.value, !!row?.isSecret) })
      }
    } catch (e) {
      outcomes.push({ ...base, ok: false, error: `Could not store the value: ${String(e)}` })
    }
  }

  if (collectionChanged && collectionRows && targets.collectionId) {
    try { replaceVariables('collection', targets.collectionId, collectionRows) } catch (e) {
      for (const o of outcomes) if (o.ok && o.scope === 'collection') Object.assign(o, { ok: false, display: undefined, error: `Could not store the value: ${String(e)}` })
    }
  }
  return outcomes
}
