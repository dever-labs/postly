import { ipcMain } from 'electron'
import { loadProtoContent, invokeGrpc } from '../services/grpc'

export function registerGrpcHandlers(): void {
  ipcMain.handle('postly:grpc:load-proto', async (_, args: { protoContent: string }) => {
    try {
      const services = await loadProtoContent(args.protoContent)
      return { data: services }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:grpc:invoke', async (_, args: {
    serverUrl: string
    protoContent: string
    serviceName: string
    methodName: string
    metadata?: Record<string, string>
    requestBody: string
    useTls?: boolean
  }) => {
    try {
      const result = await invokeGrpc({
        serverUrl: args.serverUrl,
        protoContent: args.protoContent,
        serviceName: args.serviceName,
        methodName: args.methodName,
        metadata: args.metadata ?? {},
        requestBody: args.requestBody,
        useTls: args.useTls ?? false,
      })
      return result.error ? { error: result.error, duration: result.duration } : { data: result.data, duration: result.duration }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
