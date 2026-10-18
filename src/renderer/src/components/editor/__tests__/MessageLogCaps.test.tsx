// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

vi.mock('@/components/editor/tabs/HeadersTab', () => ({
  HeadersTab: () => <div data-testid="headers-tab" />,
}))

vi.mock('@/lib/boundedMessageLog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/boundedMessageLog')>('@/lib/boundedMessageLog')
  return {
    ...actual,
    appendBoundedMessages<T>(current: { items: T[]; dropped: number }, incoming: T[]) {
      return actual.appendBoundedMessages(current, incoming, 3)
    },
  }
})

import { WebSocketView } from '../WebSocketView'
import { MqttView } from '../MqttView'

let wsListener: ((event: unknown) => void) | null = null
let mqttListener: ((event: unknown) => void) | null = null

beforeEach(() => {
  wsListener = null
  mqttListener = null
  vi.spyOn(Date, 'now').mockReturnValue(123)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ws: {
        onEvent: vi.fn((cb: (event: unknown) => void) => { wsListener = cb; return () => { wsListener = null } }),
        connect: vi.fn(async () => ({})),
        disconnect: vi.fn(async () => undefined),
        send: vi.fn(async () => undefined),
      },
      mqtt: {
        onEvent: vi.fn((cb: (event: unknown) => void) => { mqttListener = cb; return () => { mqttListener = null } }),
        connect: vi.fn(async () => ({})),
        disconnect: vi.fn(async () => undefined),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        publish: vi.fn(async () => undefined),
      },
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('message log caps', () => {
  it('drops older WebSocket messages, shows an indicator, and clears the log', async () => {
    render(<WebSocketView url="wss://example.test" headers={[]} onHeadersChange={vi.fn()} />)

    act(() => {
      for (let i = 0; i < 4; i++) {
        wsListener?.({ connectionId: 'ws-123', type: 'message', data: `message-${i}`, timestamp: 123 + i })
      }
    })

    expect(screen.getByTestId('ws-messages-dropped').textContent).toMatch(/1 older messages dropped/i)
    expect(screen.queryByText('message-0')).toBeNull()
    expect(screen.getByText('message-3')).toBeDefined()

    await userEvent.click(screen.getByTitle('Clear messages'))

    expect(screen.queryByTestId('ws-messages-dropped')).toBeNull()
    expect(screen.getByText('No messages yet')).toBeDefined()
  })

  it('drops older MQTT messages, shows an indicator, and clears the log', async () => {
    render(
      <MqttView
        brokerUrl="mqtt://localhost:1883"
        clientId=""
        username=""
        password=""
        keepAlive=""
        cleanSession="true"
        subscriptions="[]"
        onConfigChange={vi.fn()}
      />,
    )

    act(() => {
      for (let i = 0; i < 4; i++) {
        mqttListener?.({ connectionId: 'mqtt-123', type: 'message', topic: 'events/demo', payload: `payload-${i}`, timestamp: 123 + i })
      }
    })

    expect(screen.getByTestId('mqtt-messages-dropped').textContent).toMatch(/1 older messages dropped/i)
    expect(screen.queryByText('payload-0')).toBeNull()
    expect(screen.getByText('payload-3')).toBeDefined()

    await userEvent.click(screen.getByLabelText('Clear messages'))

    expect(screen.queryByTestId('mqtt-messages-dropped')).toBeNull()
    expect(screen.getByText('No messages')).toBeDefined()
  })
})
