import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../database', () => ({
  queryAll: vi.fn(),
  run: vi.fn(),
}))

vi.mock('crypto', () => ({
  default: { randomUUID: vi.fn(() => 'cert-id-1') },
}))

import { queryAll, run } from '../../database'
import { addCertificate, deleteCertificate, listCertificates } from '../certificate-store'

const mockQueryAll = vi.mocked(queryAll)
const mockRun = vi.mocked(run)

describe('certificate-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps database rows to certificate entries', () => {
    mockQueryAll.mockReturnValue([
      {
        id: 'ca-1',
        kind: 'ca',
        name: 'Corp Root',
        host: null,
        port: null,
        cert_pem: 'ca-pem',
        key_pem: null,
        pfx_b64: null,
        passphrase: null,
      },
      {
        id: 'client-1',
        kind: 'unexpected',
        name: 'API Client',
        host: ' api.example.com ',
        port: 8443,
        cert_pem: 'cert',
        key_pem: 'key',
        pfx_b64: 'pfx',
        passphrase: 'secret',
      },
    ] as never)

    expect(listCertificates()).toEqual([
      {
        id: 'ca-1',
        kind: 'ca',
        name: 'Corp Root',
        host: '',
        port: 0,
        certPem: 'ca-pem',
        keyPem: '',
        pfxBase64: '',
        passphrase: '',
      },
      {
        id: 'client-1',
        kind: 'client',
        name: 'API Client',
        host: ' api.example.com ',
        port: 8443,
        certPem: 'cert',
        keyPem: 'key',
        pfxBase64: 'pfx',
        passphrase: 'secret',
      },
    ])
    expect(mockQueryAll).toHaveBeenCalledWith('SELECT * FROM certificates ORDER BY created_at ASC')
  })

  it('trims client names and hosts, preserves client port, and returns the generated id', () => {
    const id = addCertificate({
      kind: 'client',
      name: '  Mutual TLS  ',
      host: ' api.example.com ',
      port: 9443,
      certPem: 'cert',
      keyPem: 'key',
      pfxBase64: 'pfx',
      passphrase: 'pw',
    })

    expect(id).toBe('cert-id-1')
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO certificates'),
      ['cert-id-1', 'client', 'Mutual TLS', 'api.example.com', 9443, 'cert', 'key', 'pfx', 'pw', expect.any(Number)],
    )
  })

  it('stores CA entries without client host or port values', () => {
    addCertificate({
      kind: 'ca',
      name: '  Corporate CA  ',
      host: 'ignored.example.com',
      port: 8443,
      certPem: 'ca',
    })

    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO certificates'),
      ['cert-id-1', 'ca', 'Corporate CA', '', 0, 'ca', '', '', '', expect.any(Number)],
    )
  })

  it('deletes certificates by id', () => {
    deleteCertificate('cert-9')
    expect(mockRun).toHaveBeenCalledWith('DELETE FROM certificates WHERE id = ?', ['cert-9'])
  })
})
