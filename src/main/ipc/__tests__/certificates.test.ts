import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers: Record<string, (event: unknown, args?: unknown) => Promise<Record<string, unknown>>> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args?: unknown) => Promise<Record<string, unknown>>) => {
      handlers[channel] = handler
    }),
  },
}))

vi.mock('../../services/certificate-store', () => ({
  listCertificates: vi.fn(),
  addCertificate: vi.fn(),
  deleteCertificate: vi.fn(),
}))

vi.mock('../../services/certificates', () => ({
  selectTlsOptions: vi.fn(),
  validateCertificate: vi.fn(),
}))

vi.mock('../../services/proxy', () => ({
  setTlsProvider: vi.fn(),
}))

import { addCertificate, deleteCertificate, listCertificates } from '../../services/certificate-store'
import { selectTlsOptions, validateCertificate } from '../../services/certificates'
import { setTlsProvider } from '../../services/proxy'
import { registerCertificateHandlers, tlsSelectionFor } from '../certificates'

const mockListCertificates = vi.mocked(listCertificates)
const mockAddCertificate = vi.mocked(addCertificate)
const mockDeleteCertificate = vi.mocked(deleteCertificate)
const mockSelectTlsOptions = vi.mocked(selectTlsOptions)
const mockValidateCertificate = vi.mocked(validateCertificate)
const mockSetTlsProvider = vi.mocked(setTlsProvider)

function invoke(channel: string, args?: unknown) {
  return handlers[channel](null, args)
}

describe('certificate IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerCertificateHandlers()
  })

  it('exposes tlsSelectionFor as the proxy TLS provider', () => {
    expect(mockSetTlsProvider).toHaveBeenCalledWith(tlsSelectionFor)
  })

  it('returns TLS selection for the requested URL', () => {
    const selection = { options: { cert: 'pem' }, customCaCount: 1, clientCertificate: 'mTLS' }
    mockListCertificates.mockReturnValueOnce([{ id: 'c1' } as never])
    mockSelectTlsOptions.mockReturnValueOnce(selection as never)

    expect(tlsSelectionFor('https://api.example.com')).toEqual(selection)
    expect(mockSelectTlsOptions).toHaveBeenCalledWith([{ id: 'c1' }], 'https://api.example.com')
  })

  it('falls back to an empty TLS selection when selecting options throws', () => {
    mockListCertificates.mockImplementation(() => { throw new Error('db unavailable') })
    expect(tlsSelectionFor('https://api.example.com')).toEqual({ options: {}, customCaCount: 0 })
  })

  it('lists certificate summaries and reports validation problems', async () => {
    mockListCertificates.mockReturnValue([
      {
        id: 'ca-1',
        kind: 'ca',
        name: 'Corp CA',
        host: '',
        port: 0,
        certPem: 'ca',
        keyPem: '',
        pfxBase64: '',
        passphrase: '',
      },
      {
        id: 'client-1',
        kind: 'client',
        name: 'Broken Client',
        host: '',
        port: 9443,
        certPem: '',
        keyPem: '',
        pfxBase64: 'pfx',
        passphrase: 'pw',
      },
    ] as never)
    mockValidateCertificate
      .mockReturnValueOnce({ summary: { subject: 'CN=Corp', validTo: '2030-01-01T00:00:00.000Z' } } as never)
      .mockReturnValueOnce({ error: 'certificate expired' } as never)

    await expect(invoke('postly:certificates:list')).resolves.toEqual({
      data: [
        {
          id: 'ca-1',
          kind: 'ca',
          name: 'Corp CA',
          host: '',
          port: 0,
          format: 'pem',
          hasPassphrase: false,
          subject: 'CN=Corp',
          validTo: '2030-01-01T00:00:00.000Z',
          problem: null,
        },
        {
          id: 'client-1',
          kind: 'client',
          name: 'Broken Client',
          host: '',
          port: 9443,
          format: 'pfx',
          hasPassphrase: true,
          subject: '',
          validTo: null,
          problem: 'certificate expired',
        },
      ],
    })
    expect(mockValidateCertificate).toHaveBeenNthCalledWith(2, {
      kind: 'client',
      name: 'Broken Client',
      host: '*',
      port: 9443,
      certPem: '',
      keyPem: '',
      pfxBase64: 'pfx',
      passphrase: 'pw',
    })
  })

  it('returns an error when listing certificates throws', async () => {
    mockListCertificates.mockImplementation(() => {
      throw new Error('list failed')
    })
    await expect(invoke('postly:certificates:list')).resolves.toEqual({ error: 'Error: list failed' })
  })

  it('adds validated certificates and returns the saved id with the parsed summary', async () => {
    mockValidateCertificate.mockReturnValueOnce({
      summary: { subject: 'CN=Client', validTo: '2031-01-01T00:00:00.000Z' },
    } as never)
    mockAddCertificate.mockReturnValueOnce('client-9')

    await expect(invoke('postly:certificates:add', { kind: 'client', name: 'Client' })).resolves.toEqual({
      data: {
        id: 'client-9',
        summary: { subject: 'CN=Client', validTo: '2031-01-01T00:00:00.000Z' },
      },
    })
    expect(mockAddCertificate).toHaveBeenCalledWith({ kind: 'client', name: 'Client' })
  })

  it('surfaces certificate validation errors without saving', async () => {
    mockValidateCertificate.mockReturnValueOnce({ error: 'host is required' } as never)
    await expect(invoke('postly:certificates:add', { kind: 'client', name: 'Client' })).resolves.toEqual({
      error: 'host is required',
    })
    expect(mockAddCertificate).not.toHaveBeenCalled()
  })

  it('deletes certificates by id', async () => {
    await expect(invoke('postly:certificates:delete', { id: 'cert-4' })).resolves.toEqual({ data: true })
    expect(mockDeleteCertificate).toHaveBeenCalledWith('cert-4')
  })

  it('returns delete failures as strings', async () => {
    mockDeleteCertificate.mockImplementationOnce(() => {
      throw new Error('locked')
    })
    await expect(invoke('postly:certificates:delete', { id: 'cert-4' })).resolves.toEqual({ error: 'Error: locked' })
  })
})
