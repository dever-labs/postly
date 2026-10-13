import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import fs from 'fs'
import { getResponseBody } from '../services/response-store'
import { deriveFilename, mimeOf } from '../../shared/response-file'

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024
const PREVIEW_TYPES = /^image\/(png|jpeg|gif|webp|bmp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/

const header = (headers: Record<string, string>, name: string): string | undefined => {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
  return key ? headers[key] : undefined
}

const GONE = 'This response is no longer available. Send the request again.'

export function registerResponseHandlers(): void {
  ipcMain.handle('postly:response:save', async (event: IpcMainInvokeEvent, data: { bodyId?: string }) => {
    const stored = getResponseBody(data?.bodyId)
    if (!stored) return { error: GONE }
    try {
      const defaultPath = deriveFilename({
        contentDisposition: header(stored.headers, 'content-disposition'),
        contentType: header(stored.headers, 'content-type'),
        url: stored.url,
      })
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = { title: 'Save Response', defaultPath }
      const result = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options))
      if (result.canceled || !result.filePath) return { data: null }
      await fs.promises.writeFile(result.filePath, stored.raw)
      return { data: { filePath: result.filePath, size: stored.raw.length } }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('postly:response:preview', (_event: IpcMainInvokeEvent, data: { bodyId?: string }) => {
    const stored = getResponseBody(data?.bodyId)
    if (!stored) return { error: GONE }
    const mime = mimeOf(header(stored.headers, 'content-type'))
    if (!PREVIEW_TYPES.test(mime)) return { data: null }
    if (stored.raw.length > MAX_PREVIEW_BYTES) return { error: 'Image is too large to preview. Use Save instead.' }
    return { data: { mime, base64: stored.raw.toString('base64') } }
  })
}
