import { describe, expect, it } from 'vitest'
import { MAX_FOLDER_FILES, selectCollectionFiles } from '../folder-files'

const f = (path: string, size = 10) => ({ path, size })
const paths = (r: { files: Array<{ path: string }> }) => r.files.map((x) => x.path)

describe('selectCollectionFiles', () => {
  it('keeps Bruno files and drops unrelated YAML', () => {
    const r = selectCollectionFiles([f('c/bruno.json'), f('c/a.bru'), f('c/.circleci/config.yml'), f('c/docker-compose.yml'), f('c/pnpm-lock.yaml', 99_000_000)])
    expect(paths(r)).toEqual(['c/bruno.json', 'c/a.bru'])
    expect(r.tooLarge).toBe(false)
  })

  it('keeps all YAML below an opencollection.yml only', () => {
    const r = selectCollectionFiles([f('r/opencollection.yml'), f('r/api/get.yml'), f('r/other/ci.yml')].map((x) => x).concat([f('x/ci.yml')]))
    expect(paths(r)).toEqual(['r/opencollection.yml', 'r/api/get.yml', 'r/other/ci.yml'])
  })

  it('keeps Postman v3 files', () => {
    const r = selectCollectionFiles([f('w/postman/collections/N/.resources/definition.yaml'), f('w/postman/collections/N/a.request.yaml'), f('w/postman/environments/E.yaml'), f('w/docker-compose.yml')])
    expect(r.files).toHaveLength(3)
  })

  it('skips ignored directories and reports limits', () => {
    expect(paths(selectCollectionFiles([f('c/node_modules/p/a.bru'), f('c/.git/b.bru'), f('c/.github/w.request.yaml')]))).toEqual([])
    expect(selectCollectionFiles([f('c/a.bru', 3 * 1024 * 1024)]).tooLarge).toBe(true)
    expect(selectCollectionFiles(Array.from({ length: MAX_FOLDER_FILES + 1 }, (_, i) => f(`c/${i}.bru`))).tooMany).toBe(true)
  })
})
