import http from 'http'
import https from 'https'
import net from 'net'
import { AsyncLocalStorage } from 'async_hooks'

/** Whether a request is still waiting for its TCP connection, so a timeout can be reported as a connect timeout. */
export interface ConnectState { connecting: boolean }

const storage = new AsyncLocalStorage<ConnectState>()
let installed = false

type Create = (this: unknown, ...args: unknown[]) => net.Socket

function wrap(proto: { createConnection: unknown }): void {
  const original = proto.createConnection as Create
  proto.createConnection = function (this: unknown, ...args: unknown[]): net.Socket {
    const socket = original.apply(this, args)
    const state = storage.getStore()
    if (state && socket?.connecting) {
      state.connecting = true
      socket.once('connect', () => { state.connecting = false })
    }
    return socket
  }
}

function install(): void {
  if (installed) return
  installed = true
  wrap(http.Agent.prototype as unknown as { createConnection: unknown })
  wrap(https.Agent.prototype as unknown as { createConnection: unknown })
}

/** Runs `fn`; sockets opened on its behalf update `state.connecting`. */
export function trackConnect<T>(state: ConnectState, fn: () => Promise<T>): Promise<T> {
  install()
  return storage.run(state, fn)
}
