import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, extname, relative } from 'path'

const RENDERER_SRC = join(__dirname, '../..')

function getAllFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...getAllFiles(full, extensions))
    } else if (extensions.includes(extname(entry.name))) {
      results.push(full)
    }
  }
  return results
}

type Rule = {
  description: string
  extensions: string[]
  /** Return violation message if the line is a problem, null otherwise */
  check: (line: string) => string | null
}

const RULES: Rule[] = [
  {
    description: 'outline-none removed in v4 — use outline-hidden',
    extensions: ['.tsx', '.ts'],
    check: (line) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return null
      return /\boutline-none\b/.test(line) ? 'outline-none → outline-hidden' : null
    },
  },
  {
    description: 'backdrop-blur-sm renamed in v4 — use backdrop-blur-xs',
    extensions: ['.tsx', '.ts'],
    check: (line) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return null
      return /\bbackdrop-blur-sm\b/.test(line) ? 'backdrop-blur-sm → backdrop-blur-xs' : null
    },
  },
  {
    description: 'bare "rounded" renamed in v4 — use rounded-sm',
    extensions: ['.tsx', '.ts'],
    check: (line) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return null
      // Match "rounded" not followed by a dash+letter/number (i.e. not rounded-md, rounded-lg, etc.)
      return /\brounded(?!-[a-z0-9])/.test(line) ? 'rounded → rounded-sm' : null
    },
  },
  {
    description: 'bare "shadow" renamed in v4 — use shadow-sm',
    extensions: ['.tsx', '.ts'],
    check: (line) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return null
      // Match "shadow" not preceded or followed by a dash (avoids shadow-lg, drop-shadow etc.)
      return /(?<![a-z-])shadow(?!-[a-z0-9])/.test(line) ? 'shadow → shadow-sm' : null
    },
  },
  {
    description: 'flex-shrink removed in v4 — use shrink',
    extensions: ['.tsx', '.ts'],
    check: (line) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return null
      return /\bflex-shrink\b/.test(line) ? 'flex-shrink → shrink' : null
    },
  },
  {
    description: 'flex-grow removed in v4 — use grow',
    extensions: ['.tsx', '.ts'],
    check: (line) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return null
      return /\bflex-grow\b/.test(line) ? 'flex-grow → grow' : null
    },
  },
  {
    description: 'overflow-ellipsis removed in v4 — use text-ellipsis',
    extensions: ['.tsx', '.ts'],
    check: (line) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return null
      return /\boverflow-ellipsis\b/.test(line) ? 'overflow-ellipsis → text-ellipsis' : null
    },
  },
  {
    description: '@tailwind directives removed in v4 — use @import "tailwindcss"',
    extensions: ['.css'],
    check: (line) => {
      return /@tailwind\s+(base|components|utilities)/.test(line)
        ? '@tailwind base/components/utilities → @import "tailwindcss"'
        : null
    },
  },
]

describe('Tailwind v4 class compliance', () => {
  for (const rule of RULES) {
    it(rule.description, () => {
      const files = getAllFiles(RENDERER_SRC, rule.extensions).filter(
        (f) => !f.includes('__tests__'),
      )

      const violations: string[] = []

      for (const file of files) {
        const lines = readFileSync(file, 'utf-8').split('\n')
        for (let i = 0; i < lines.length; i++) {
          const msg = rule.check(lines[i])
          if (msg) {
            violations.push(`  ${relative(RENDERER_SRC, file)}:${i + 1} — ${msg}`)
          }
        }
      }

      expect(
        violations,
        `Deprecated Tailwind class(es) found:\n${violations.join('\n')}`,
      ).toHaveLength(0)
    })
  }
})
