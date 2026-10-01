import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: vi.fn() }, dialog: { showMessageBox: vi.fn() } }))

import { collectLocalFilePaths, confirmLocalFileReads, resetApprovedFileReads } from '../file-access'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postly-fa-'))
const fileA = path.join(dir, 'a.txt')
const fileB = path.join(dir, 'b.txt')
fs.writeFileSync(fileA, 'a')
fs.writeFileSync(fileB, 'b')
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const form = (fields: unknown[]) => JSON.stringify(fields)
const sender = {} as never

describe('collectLocalFilePaths', () => {
  it('returns enabled form-data file fields that exist', () => {
    const body = form([
      { key: 'f', value: fileA, enabled: true, fieldType: 'file' },
      { key: 'g', value: fileB, enabled: true, fieldType: 'file' },
    ])
    expect(collectLocalFilePaths({ bodyType: 'form-data', body })).toEqual([fileA, fileB])
  })

  it('ignores disabled fields, text fields, unnamed fields and missing files', () => {
    const body = form([
      { key: 'off', value: fileA, enabled: false, fieldType: 'file' },
      { key: 'txt', value: fileA, enabled: true, fieldType: 'text' },
      { key: '', value: fileA, enabled: true, fieldType: 'file' },
      { key: 'gone', value: path.join(dir, 'nope'), enabled: true, fieldType: 'file' },
      { key: 'dir', value: dir, enabled: true, fieldType: 'file' },
    ])
    expect(collectLocalFilePaths({ bodyType: 'form-data', body })).toEqual([])
  })

  it('de-duplicates repeated paths', () => {
    const body = form([
      { key: 'a', value: fileA, enabled: true, fieldType: 'file' },
      { key: 'b', value: fileA, enabled: true, fieldType: 'file' },
    ])
    expect(collectLocalFilePaths({ bodyType: 'form-data', body })).toEqual([fileA])
  })

  it('returns the path of a binary body when it is an existing file', () => {
    expect(collectLocalFilePaths({ bodyType: 'binary', body: fileA })).toEqual([fileA])
    expect(collectLocalFilePaths({ bodyType: 'binary', body: path.join(dir, 'nope') })).toEqual([])
  })

  it('returns nothing for other body types or malformed form-data', () => {
    expect(collectLocalFilePaths({ bodyType: 'raw-json', body: fileA })).toEqual([])
    expect(collectLocalFilePaths({ bodyType: 'form-data', body: '{oops' })).toEqual([])
    expect(collectLocalFilePaths({ bodyType: 'form-data' })).toEqual([])
  })
})

describe('confirmLocalFileReads', () => {
  beforeEach(() => resetApprovedFileReads())

  it('asks once and remembers approval for the same file and origin', async () => {
    const ask = vi.fn().mockResolvedValue(true)
    expect(await confirmLocalFileReads([fileA], 'https://api.example.com/upload', sender, ask)).toBe(true)
    expect(await confirmLocalFileReads([fileA], 'https://api.example.com/other', sender, ask)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(sender, [fileA], 'https://api.example.com')
  })

  it('asks again for a different origin', async () => {
    const ask = vi.fn().mockResolvedValue(true)
    await confirmLocalFileReads([fileA], 'https://a.example.com', sender, ask)
    await confirmLocalFileReads([fileA], 'https://evil.example.com', sender, ask)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('only asks about files that are not yet approved', async () => {
    const ask = vi.fn().mockResolvedValue(true)
    await confirmLocalFileReads([fileA], 'https://a.example.com', sender, ask)
    await confirmLocalFileReads([fileA, fileB], 'https://a.example.com', sender, ask)
    expect(ask).toHaveBeenLastCalledWith(sender, [fileB], 'https://a.example.com')
  })

  it('does not remember a refusal', async () => {
    const ask = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect(await confirmLocalFileReads([fileA], 'https://a.example.com', sender, ask)).toBe(false)
    expect(await confirmLocalFileReads([fileA], 'https://a.example.com', sender, ask)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('does not ask when there are no files', async () => {
    const ask = vi.fn()
    expect(await confirmLocalFileReads([], 'https://a.example.com', sender, ask)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })
})
