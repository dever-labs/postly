export const MAX_FOLDER_FILE_BYTES = 2 * 1024 * 1024
export const MAX_FOLDER_FILES = 5000

interface Candidate { path: string; size: number }

const IGNORED_DIRS = new Set(['node_modules', '.git', '.github'])
const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/') + 1))

/**
 * Picks the files of a collection folder worth reading: Bruno (.bru, bruno.json), Bruno YAML (anything
 * below an opencollection.yml) and Postman v3 (.resources, *.request.yaml, postman/collections|environments).
 * Other YAML (CI configs, lockfiles, specs) is left alone so it cannot block or bloat an import.
 */
export function selectCollectionFiles<T extends Candidate>(files: T[]): { files: T[]; tooLarge: boolean; tooMany: boolean } {
  const live = files.filter((f) => !f.path.split('/').some((seg) => IGNORED_DIRS.has(seg)))
  const yamlRoots = live.filter((f) => /(^|\/)opencollection\.ya?ml$/.test(f.path)).map((f) => dirOf(f.path))
  const wanted = live.filter((f) => {
    if (/\.bru$|(^|\/)bruno\.json$/.test(f.path)) return true
    if (!/\.ya?ml$/.test(f.path)) return false
    return yamlRoots.some((root) => f.path.startsWith(root))
      || /\.(request|example)\.ya?ml$|(^|\/)\.resources\/|(^|\/)postman\/(collections|environments)\//.test(f.path)
  })
  return { files: wanted, tooLarge: wanted.some((f) => f.size > MAX_FOLDER_FILE_BYTES), tooMany: wanted.length > MAX_FOLDER_FILES }
}
