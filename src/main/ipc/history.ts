import { ipcMain } from 'electron'
import { listHistory, getHistoryEntry, deleteHistoryEntry, clearHistory } from '../services/history'

export function registerHistoryHandlers(): void {
  ipcMain.handle('postly:history:list', async (_, args?: { search?: string; limit?: number; offset?: number }) => {
    try { return { data: listHistory(args ?? {}) } } catch (err) { return { error: String(err) } }
  })
  ipcMain.handle('postly:history:get', async (_, args: { id: string }) => {
    try { return { data: getHistoryEntry(args.id) } } catch (err) { return { error: String(err) } }
  })
  ipcMain.handle('postly:history:delete', async (_, args: { id: string }) => {
    try { deleteHistoryEntry(args.id); return { data: true } } catch (err) { return { error: String(err) } }
  })
  ipcMain.handle('postly:history:clear', async () => {
    try { clearHistory(); return { data: true } } catch (err) { return { error: String(err) } }
  })
}
