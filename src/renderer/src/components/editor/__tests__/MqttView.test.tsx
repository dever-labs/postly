// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MqttView } from '../MqttView'

const connect = vi.fn(async () => ({ data: { connectionId: 'mqtt-1' } }))

beforeEach(() => {
  connect.mockClear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      mqtt: {
        connect,
        subscribe: vi.fn(async () => ({ data: true })),
        unsubscribe: vi.fn(async () => ({ data: true })),
        publish: vi.fn(async () => ({ data: true })),
        disconnect: vi.fn(async () => ({ data: true })),
        onEvent: () => () => undefined,
      },
    },
  })
})

afterEach(cleanup)

describe('MqttView', () => {
  it('connects with the request broker URL', async () => {
    render(
      <MqttView
        brokerUrl="mqtt://broker.example:1883"
        clientId=""
        username=""
        password=""
        keepAlive=""
        cleanSession="true"
        subscriptions="[]"
        onConfigChange={() => undefined}
      />,
    )

    await userEvent.click(screen.getByText('Connect to broker'))

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({
      brokerUrl: 'mqtt://broker.example:1883',
    }))
  })

  it('blocks invalid broker URLs and explains the error', async () => {
    render(
      <MqttView
        brokerUrl="broker.example"
        clientId=""
        username=""
        password=""
        keepAlive=""
        cleanSession="true"
        subscriptions="[]"
        onConfigChange={() => undefined}
      />,
    )

    expect(screen.getByText('Broker URL must be a valid URL.')).toBeDefined()
    expect(screen.getByText('Connect to broker')).toHaveProperty('disabled', true)
    expect(connect).not.toHaveBeenCalled()
  })
})
