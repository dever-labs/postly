import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../database', () => ({
  queryOne: vi.fn(),
  run: vi.fn(),
}))

import { queryOne, run } from '../../database'
import { activeEnvKey, deleteCookiesForEnv, loadCookies, NO_ENV_KEY, saveCookies } from '../cookie-store'

const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)

describe('cookie-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the active environment id when one exists', () => {
    mockQueryOne.mockReturnValueOnce({ id: 'env-1' } as never)
    expect(activeEnvKey()).toBe('env-1')
    expect(mockQueryOne).toHaveBeenCalledWith('SELECT id FROM environments WHERE is_active = 1 LIMIT 1')
  })

  it('falls back to the shared jar key when no environment is active', () => {
    mockQueryOne.mockReturnValueOnce(undefined as never)
    expect(activeEnvKey()).toBe(NO_ENV_KEY)
  })

  it('loads cookies from JSON', () => {
    mockQueryOne.mockReturnValueOnce({
      cookies_json: JSON.stringify([{ name: 'sid', value: 'abc', domain: 'example.com', path: '/' }]),
    } as never)

    expect(loadCookies('env-1')).toEqual([{ name: 'sid', value: 'abc', domain: 'example.com', path: '/' }])
  })

  it('returns an empty array when the jar row is missing, malformed, or not an array', () => {
    mockQueryOne
      .mockReturnValueOnce(undefined as never)
      .mockReturnValueOnce({ cookies_json: '{bad json' } as never)
      .mockReturnValueOnce({ cookies_json: '{"name":"sid"}' } as never)

    expect(loadCookies('env-1')).toEqual([])
    expect(loadCookies('env-1')).toEqual([])
    expect(loadCookies('env-1')).toEqual([])
  })

  it('deletes the jar when asked to save an empty cookie list', () => {
    saveCookies('env-1', [])
    expect(mockRun).toHaveBeenCalledWith('DELETE FROM cookie_jars WHERE env_key = ?', ['env-1'])
  })

  it('serializes cookies when saving a non-empty list', () => {
    saveCookies('env-1', [{ name: 'sid', value: 'abc', domain: 'example.com', path: '/' }])
    expect(mockRun).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO cookie_jars (env_key, cookies_json, updated_at) VALUES (?, ?, ?)',
      ['env-1', '[{"name":"sid","value":"abc","domain":"example.com","path":"/"}]', expect.any(Number)],
    )
  })

  it('deletes all cookies for an environment', () => {
    deleteCookiesForEnv('env-2')
    expect(mockRun).toHaveBeenCalledWith('DELETE FROM cookie_jars WHERE env_key = ?', ['env-2'])
  })
})
