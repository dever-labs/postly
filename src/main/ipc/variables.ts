import { ipcMain } from 'electron'
import { listAllVariables, replaceVariables, type StoredScope, type VariableRow } from '../services/variable-store'

export function registerVariableHandlers(): void {
  ipcMain.handle('postly:variables:list', async () => {
    try { return { data: listAllVariables() } } catch (err) { return { error: String(err) } }
  })
  ipcMain.handle('postly:variables:set', async (_, args: { scope: StoredScope; ownerId?: string; vars: VariableRow[] }) => {
    try {
      if (args.scope !== 'global' && args.scope !== 'collection') return { error: 'Unknown variable scope' }
      replaceVariables(args.scope, args.ownerId ?? '', args.vars ?? [])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
