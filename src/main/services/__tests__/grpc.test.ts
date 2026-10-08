import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
const mockProtoLoad = vi.hoisted(() => vi.fn())
const mockGrpcLoadPackageDefinition = vi.hoisted(() => vi.fn())
const mockCreateSsl = vi.hoisted(() => vi.fn(() => 'ssl-creds'))
const mockCreateInsecure = vi.hoisted(() => vi.fn(() => 'insecure-creds'))
const mockMetadataAdd = vi.hoisted(() => vi.fn())
const mockRandomUuid = vi.hoisted(() => vi.fn(() => 'uuid-1'))

vi.mock('fs', () => ({
  default: {
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
  },
}))

vi.mock('os', () => ({
  default: {
    tmpdir: vi.fn(() => '/workspaces/postly/.vitest-grpc'),
  },
}))

vi.mock('crypto', () => ({
  default: {
    randomUUID: mockRandomUuid,
  },
}))

vi.mock('@grpc/proto-loader', () => ({
  load: mockProtoLoad,
}))

vi.mock('@grpc/grpc-js', () => {
  class Metadata {
    add = mockMetadataAdd
  }

  return {
    Metadata,
    credentials: {
      createSsl: mockCreateSsl,
      createInsecure: mockCreateInsecure,
    },
    loadPackageDefinition: mockGrpcLoadPackageDefinition,
  }
})

import { loadProtoContent, invokeGrpc } from '../grpc'
import * as grpc from '@grpc/grpc-js'

beforeEach(() => {
  vi.clearAllMocks()
  mockRandomUuid.mockReturnValue('uuid-1')
})

describe('loadProtoContent', () => {
  it('loads proto definitions, extracts services, and cleans up the temp file', async () => {
    mockProtoLoad.mockResolvedValueOnce({
      'demo.Greeter': {
        SayHello: { requestStream: false, responseStream: false },
        StreamHello: { requestStream: false, responseStream: true },
        notAMethod: { description: 'ignore me' },
      },
      'demo.HelloRequest': { format: 'Protocol Buffer 3 DescriptorProto' },
    })

    const result = await loadProtoContent('syntax = "proto3";')

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/workspaces/postly/.vitest-grpc/postly-uuid-1.proto',
      'syntax = "proto3";',
      'utf8',
    )
    expect(mockProtoLoad).toHaveBeenCalledWith(
      '/workspaces/postly/.vitest-grpc/postly-uuid-1.proto',
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      },
    )
    expect(result).toEqual({
      'demo.Greeter': [
        { name: 'SayHello', requestStream: false, responseStream: false },
        { name: 'StreamHello', requestStream: false, responseStream: true },
      ],
    })
    expect(mockUnlinkSync).toHaveBeenCalledWith('/workspaces/postly/.vitest-grpc/postly-uuid-1.proto')
  })

  it('cleans up the temp file when proto loading fails', async () => {
    mockProtoLoad.mockRejectedValueOnce(new Error('bad proto'))

    await expect(loadProtoContent('invalid')).rejects.toThrow('bad proto')
    expect(mockUnlinkSync).toHaveBeenCalledWith('/workspaces/postly/.vitest-grpc/postly-uuid-1.proto')
  })
})

describe('invokeGrpc', () => {
  it('returns an error when the requested service is missing', async () => {
    mockProtoLoad.mockResolvedValueOnce({ packageDef: true })
    mockGrpcLoadPackageDefinition.mockReturnValueOnce({})

    const result = await invokeGrpc({
      serverUrl: 'localhost:50051',
      protoContent: 'syntax = "proto3";',
      serviceName: 'demo.Greeter',
      methodName: 'SayHello',
      metadata: {},
      requestBody: '{}',
      useTls: false,
    })

    expect(result).toEqual({
      error: 'Service "demo.Greeter" not found in proto',
      duration: expect.any(Number),
    })
  })

  it('returns an error for invalid JSON request bodies', async () => {
    const client = { SayHello: vi.fn() }
    const serviceCtor = vi.fn(function ServiceCtor() {
      return client
    })

    mockProtoLoad.mockResolvedValueOnce({ packageDef: true })
    mockGrpcLoadPackageDefinition.mockReturnValueOnce({ demo: { Greeter: serviceCtor } })

    const result = await invokeGrpc({
      serverUrl: 'localhost:50051',
      protoContent: 'syntax = "proto3";',
      serviceName: 'demo.Greeter',
      methodName: 'SayHello',
      metadata: { authorization: 'Bearer token' },
      requestBody: '{invalid-json',
      useTls: false,
    })

    expect(result).toEqual({
      error: 'Request body is not valid JSON',
      duration: expect.any(Number),
    })
    expect(client.SayHello).not.toHaveBeenCalled()
  })

  it('invokes unary methods with metadata and insecure credentials', async () => {
    const unaryMethod = vi.fn((_request: unknown, _metadata: unknown, callback: (err: null, response: unknown) => void) => {
      callback(null, { message: 'hello' })
      return undefined
    })
    const serviceCtor = vi.fn(function ServiceCtor() {
      return { SayHello: unaryMethod }
    })

    mockProtoLoad.mockResolvedValueOnce({ packageDef: true })
    mockGrpcLoadPackageDefinition.mockReturnValueOnce({ demo: { Greeter: serviceCtor } })

    const result = await invokeGrpc({
      serverUrl: 'localhost:50051',
      protoContent: 'syntax = "proto3";',
      serviceName: 'demo.Greeter',
      methodName: 'SayHello',
      metadata: { authorization: 'Bearer token', 'x-trace-id': 'trace-1' },
      requestBody: '{"name":"Postly"}',
      useTls: false,
    })

    expect(result).toEqual({
      data: { message: 'hello' },
      duration: expect.any(Number),
    })
    expect(mockCreateInsecure).toHaveBeenCalledOnce()
    expect(mockCreateSsl).not.toHaveBeenCalled()
    expect(serviceCtor).toHaveBeenCalledWith('localhost:50051', 'insecure-creds')
    expect(unaryMethod).toHaveBeenCalledWith(
      { name: 'Postly' },
      expect.any(grpc.Metadata),
      expect.any(Function),
    )
    expect(mockMetadataAdd.mock.calls).toEqual([
      ['authorization', 'Bearer token'],
      ['x-trace-id', 'trace-1'],
    ])
  })

  it('returns method-level gRPC errors from unary calls', async () => {
    const unaryMethod = vi.fn((_request: unknown, _metadata: unknown, callback: (err: { code: number; message: string }) => void) => {
      callback({ code: 13, message: 'boom' })
      return undefined
    })
    const serviceCtor = vi.fn(function ServiceCtor() {
      return { SayHello: unaryMethod }
    })

    mockProtoLoad.mockResolvedValueOnce({ packageDef: true })
    mockGrpcLoadPackageDefinition.mockReturnValueOnce({ demo: { Greeter: serviceCtor } })

    const result = await invokeGrpc({
      serverUrl: 'localhost:50051',
      protoContent: 'syntax = "proto3";',
      serviceName: 'demo.Greeter',
      methodName: 'SayHello',
      metadata: {},
      requestBody: '{}',
      useTls: false,
    })

    expect(result).toEqual({
      error: '13: boom',
      duration: expect.any(Number),
    })
  })

  it('returns an error when the requested method is missing', async () => {
    const serviceCtor = vi.fn(function ServiceCtor() {
      return {}
    })

    mockProtoLoad.mockResolvedValueOnce({ packageDef: true })
    mockGrpcLoadPackageDefinition.mockReturnValueOnce({ demo: { Greeter: serviceCtor } })

    const result = await invokeGrpc({
      serverUrl: 'localhost:50051',
      protoContent: 'syntax = "proto3";',
      serviceName: 'demo.Greeter',
      methodName: 'MissingMethod',
      metadata: {},
      requestBody: '{}',
      useTls: true,
    })

    expect(result).toEqual({
      error: 'Method "MissingMethod" not found on service',
      duration: expect.any(Number),
    })
    expect(mockCreateSsl).toHaveBeenCalledOnce()
  })

  it('collects server-streaming responses', async () => {
    const handlers: Record<string, (value?: unknown) => void> = {}
    const call = {
      on: vi.fn((event: string, handler: (value?: unknown) => void) => {
        handlers[event] = handler
        return call
      }),
    }
    const streamMethod = vi.fn(() => {
      queueMicrotask(() => {
        handlers.data?.({ id: 1 })
        handlers.data?.({ id: 2 })
        handlers.end?.()
      })
      return call
    })
    const serviceCtor = vi.fn(function ServiceCtor() {
      return { StreamHello: streamMethod }
    })

    mockProtoLoad.mockResolvedValueOnce({ packageDef: true })
    mockGrpcLoadPackageDefinition.mockReturnValueOnce({ demo: { Greeter: serviceCtor } })

    const result = await invokeGrpc({
      serverUrl: 'localhost:50051',
      protoContent: 'syntax = "proto3";',
      serviceName: 'demo.Greeter',
      methodName: 'StreamHello',
      metadata: {},
      requestBody: '{}',
      useTls: false,
    })

    expect(result).toEqual({
      data: [{ id: 1 }, { id: 2 }],
      duration: expect.any(Number),
    })
  })

  it('returns streaming errors emitted by the call object', async () => {
    const handlers: Record<string, (value?: unknown) => void> = {}
    const call = {
      on: vi.fn((event: string, handler: (value?: unknown) => void) => {
        handlers[event] = handler
        return call
      }),
    }
    const streamMethod = vi.fn(() => {
      queueMicrotask(() => {
        handlers.error?.(new Error('stream exploded'))
      })
      return call
    })
    const serviceCtor = vi.fn(function ServiceCtor() {
      return { StreamHello: streamMethod }
    })

    mockProtoLoad.mockResolvedValueOnce({ packageDef: true })
    mockGrpcLoadPackageDefinition.mockReturnValueOnce({ demo: { Greeter: serviceCtor } })

    const result = await invokeGrpc({
      serverUrl: 'localhost:50051',
      protoContent: 'syntax = "proto3";',
      serviceName: 'demo.Greeter',
      methodName: 'StreamHello',
      metadata: {},
      requestBody: '{}',
      useTls: false,
    })

    expect(result).toEqual({
      error: 'stream exploded',
      duration: expect.any(Number),
    })
  })

  it('returns caught loader errors and still removes the temp file', async () => {
    mockProtoLoad.mockRejectedValueOnce(new Error('failed to load proto'))

    const result = await invokeGrpc({
      serverUrl: 'localhost:50051',
      protoContent: 'syntax = "proto3";',
      serviceName: 'demo.Greeter',
      methodName: 'SayHello',
      metadata: {},
      requestBody: '{}',
      useTls: false,
    })

    expect(result).toEqual({
      error: 'Error: failed to load proto',
      duration: expect.any(Number),
    })
    expect(mockUnlinkSync).toHaveBeenCalledWith('/workspaces/postly/.vitest-grpc/postly-uuid-1.proto')
  })
})
