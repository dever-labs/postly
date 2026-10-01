import fs from 'fs'
import path from 'path'
import { BrowserWindow, dialog, type WebContents } from 'electron'

interface FileBody {
  bodyType: string
  body?: string
}

// path + target origin pairs the user already approved this session.
const approved = new Set<string>()

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile() } catch { return false }
}

/**
 * Local files a request would read and upload. Mirrors the executor: only existing
 * files count, since anything else is sent as plain text.
 */
export function collectLocalFilePaths(req: FileBody): string[] {
  const found: string[] = []
  if (req.bodyType === 'form-data' && req.body) {
    try {
      const fields = JSON.parse(req.body) as Array<{ key?: string; value?: string; enabled?: boolean; fieldType?: string }>
      for (const f of fields) {
        if (f.enabled && f.key && f.fieldType === 'file' && f.value && isFile(f.value)) found.push(path.resolve(f.value))
      }
    } catch { /* not valid form-data JSON; executor ignores it too */ }
  } else if (req.bodyType === 'binary' && req.body && isFile(req.body)) {
    found.push(path.resolve(req.body))
  }
  return [...new Set(found)]
}

function originOf(url: string): string {
  try { return new URL(url).origin } catch { return url }
}

/**
 * Collections can be imported or synced from git, so a file path stored in one is not
 * proof the user meant to upload that file. Ask before any not-yet-approved file is
 * read and sent to a server.
 */
export async function confirmLocalFileReads(
  files: string[],
  url: string,
  sender: WebContents,
  ask: typeof showConfirmDialog = showConfirmDialog
): Promise<boolean> {
  const origin = originOf(url)
  const pending = files.filter((f) => !approved.has(`${f}\n${origin}`))
  if (pending.length === 0) return true
  if (!(await ask(sender, pending, origin))) return false
  for (const f of pending) approved.add(`${f}\n${origin}`)
  return true
}

async function showConfirmDialog(sender: WebContents, files: string[], origin: string): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(sender)
  const options = {
    type: 'warning' as const,
    title: 'Upload local files?',
    message: `This request will read ${files.length === 1 ? 'a file' : `${files.length} files`} from your computer and send ${files.length === 1 ? 'it' : 'them'} to ${origin}.`,
    detail: files.join('\n'),
    buttons: ['Cancel', 'Send'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return response === 1
}

/** Test helper. */
export function resetApprovedFileReads(): void {
  approved.clear()
}
