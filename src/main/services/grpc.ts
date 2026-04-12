import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

export interface GrpcServiceMethod {
  name: string
  requestStream: boolean
  responseStream: boolean
}

export interface GrpcServiceInfo {
  [serviceName: string]: GrpcServiceMethod[]
}

export async function loadProtoContent(protoContent: string): Promise<GrpcServiceInfo> {
  // Write to a temp file so proto-loader can resolve imports
  const tmpFile = path.join(os.tmpdir(), `postly-${crypto.randomUUID()}.proto`)
  fs.writeFileSync(tmpFile, protoContent, 'utf8')

  try {
    const packageDef = await protoLoader.load(tmpFile, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    })

    const result: GrpcServiceInfo = {}
    for (const [fqName, def] of Object.entries(packageDef)) {
      const svcDef = def as Record<string, unknown>
      if (svcDef && typeof svcDef === 'object' && !Array.isArray(svcDef)) {
        const methods: GrpcServiceMethod[] = []
        for (const [methodName, methodDef] of Object.entries(svcDef)) {
          const md = methodDef as Record<string, unknown>
          if (md?.requestStream !== undefined) {
            methods.push({
              name: methodName,
              requestStream: Boolean(md.requestStream),
              responseStream: Boolean(md.responseStream),
            })
          }
        }
        if (methods.length > 0) {
          result[fqName] = methods
        }
      }
    }
    return result
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

export interface GrpcInvokeParams {
  serverUrl: string
  protoContent: string
  serviceName: string
  methodName: string
  metadata: Record<string, string>
  requestBody: string
  useTls: boolean
}

export async function invokeGrpc(params: GrpcInvokeParams): Promise<{
  data?: unknown
  error?: string
  duration: number
}> {
  const tmpFile = path.join(os.tmpdir(), `postly-${crypto.randomUUID()}.proto`)
  fs.writeFileSync(tmpFile, params.protoContent, 'utf8')
  const start = Date.now()

  try {
    const packageDef = await protoLoader.load(tmpFile, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    })

    const grpcObj = grpc.loadPackageDefinition(packageDef)

    // Navigate to the service constructor
    const parts = params.serviceName.split('.')
    let svcCtor: unknown = grpcObj
    for (const part of parts) {
      svcCtor = (svcCtor as Record<string, unknown>)?.[part]
    }
    if (!svcCtor || typeof svcCtor !== 'function') {
      return { error: `Service "${params.serviceName}" not found in proto`, duration: Date.now() - start }
    }

    const creds = params.useTls
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure()

    type GrpcClientCtor = new (url: string, creds: grpc.ChannelCredentials) => grpc.Client
    const client = new (svcCtor as GrpcClientCtor)(params.serverUrl, creds)

    const meta = new grpc.Metadata()
    for (const [k, v] of Object.entries(params.metadata)) {
      meta.add(k, v)
    }

    let requestData: Record<string, unknown> = {}
    try {
      requestData = JSON.parse(params.requestBody || '{}')
    } catch {
      return { error: 'Request body is not valid JSON', duration: Date.now() - start }
    }

    return await new Promise((resolve) => {
      const method = client[params.methodName]
      if (!method) {
        resolve({ error: `Method "${params.methodName}" not found on service`, duration: Date.now() - start })
        return
      }

      // Check if it's server-streaming
      const call = method.call(client, requestData, meta, (err: grpc.ServiceError | null, response: unknown) => {
        if (err) {
          resolve({ error: `${err.code}: ${err.message}`, duration: Date.now() - start })
        } else {
          resolve({ data: response, duration: Date.now() - start })
        }
      })

      if (call && typeof call.on === 'function') {
        // Server streaming — collect all messages
        const messages: unknown[] = []
        call.on('data', (msg: unknown) => messages.push(msg))
        call.on('end', () => {
          if (messages.length > 0) resolve({ data: messages, duration: Date.now() - start })
        })
        call.on('error', (err: Error) => {
          resolve({ error: err.message, duration: Date.now() - start })
        })
      }
    })
  } catch (err) {
    return { error: String(err), duration: Date.now() - start }
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}
