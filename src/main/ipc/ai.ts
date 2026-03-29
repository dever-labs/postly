import { ipcMain } from 'electron'
import { streamAiResponse, cancelAiStream } from '../services/ai'
import type { AiChatMessage } from '../services/ai'

export function registerAiHandlers(): void {
  ipcMain.handle(
    'postly:ai:chat',
    async (event, args: { requestId: string; provider: string; apiKey: string; model: string; messages: AiChatMessage[] }) => {
      const webContents = event.sender
      streamAiResponse(
        { ...args, provider: args.provider as 'openai' | 'anthropic' },
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
