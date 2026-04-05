import { ipcMain } from 'electron'
import { queryOne } from '../database'
import { streamAiResponse, cancelAiStream } from '../services/ai'
import type { AiChatMessage } from '../services/ai'

export function registerAiHandlers(): void {
  ipcMain.handle(
    'postly:ai:chat',
    async (event, args: { requestId: string; provider: string; model: string; messages: AiChatMessage[] }) => {
      const webContents = event.sender
      const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['ai'])
      const aiSettings = row ? (JSON.parse(row.value) as { apiKey?: string }) : {}
      const apiKey = aiSettings.apiKey ?? ''
      streamAiResponse(
        { ...args, apiKey, provider: args.provider as 'openai' | 'anthropic' },
        (text) => webContents.send('postly:ai:chunk', { requestId: args.requestId, text, done: false }),
        (error) => webContents.send('postly:ai:chunk', { requestId: args.requestId, text: '', done: true, error })
      )
      return { data: true }
    }
  )

  ipcMain.handle('postly:ai:cancel', async (_, args: { requestId: string }) => {
    cancelAiStream(args.requestId)
    return { data: true }
  })
}
