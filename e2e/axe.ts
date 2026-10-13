import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'

/**
 * Runs axe-core inside the app window. @axe-core/playwright is not used because it opens a second
 * browser page for its analysis, which Electron windows do not support.
 */
const AXE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')

export interface AxeViolation {
  id: string
  impact: string | null | undefined
  help: string
  nodes: string[]
}

export async function runAxe(page: Page, scope?: string): Promise<AxeViolation[]> {
  await page.evaluate(AXE_SOURCE)
  return page.evaluate(async (selector) => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact?: string | null; help: string; nodes: Array<{ target: unknown[]; html: string }> }> }> } }).axe
    const result = await axe.run(selector ? { include: [selector] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 160)}`) }))
  }, scope)
}
