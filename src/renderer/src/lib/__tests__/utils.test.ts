import { describe, it, expect } from 'vitest'
import { cn } from '../utils'

describe('cn', () => {
  it('joins multiple class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('ignores falsy values', () => {
    expect(cn('foo', undefined, null, false, 'bar')).toBe('foo bar')
  })

  it('handles conditional object syntax', () => {
    expect(cn({ active: true, disabled: false })).toBe('active')
  })

  it('deduplicates conflicting Tailwind classes (last wins)', () => {
    // tailwind-merge resolves conflicts: bg-red-500 then bg-blue-500 → bg-blue-500
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500')
  })

  it('merges padding classes correctly', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('returns empty string for no args', () => {
    expect(cn()).toBe('')
  })

  it('handles array inputs', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })
})
