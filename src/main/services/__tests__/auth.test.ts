import { describe, it, expect } from 'vitest'
import { applyApiKey, buildDigestHeader, isSupportedDigestAlgorithm, maskTail, parseDigestChallenge, signAwsV4 } from '../auth'

describe('applyApiKey', () => {
  it('adds a header', () => {
    const r = applyApiKey('https://x.test/a', { Accept: '*/*' }, { key: 'X-Api-Key', value: 's3cret', in: 'header' })
    expect(r?.headers).toEqual({ Accept: '*/*', 'X-Api-Key': 's3cret' })
    expect(r?.url).toBe('https://x.test/a')
    expect(r?.description).not.toContain('s3cret')
  })

  it('defaults to a header when no location is set', () => {
    expect(applyApiKey('https://x.test', {}, { key: 'k', value: 'v' })?.headers).toEqual({ k: 'v' })
  })

  it('appends an encoded query parameter, keeping existing query and fragment', () => {
    const r = applyApiKey('https://x.test/a?b=1#frag', {}, { key: 'api key', value: 'a&b', in: 'query' })
    expect(r?.url).toBe('https://x.test/a?b=1&api%20key=a%26b#frag')
    expect(r?.description).not.toContain('a&b')
  })

  it('does nothing without a name or value', () => {
    expect(applyApiKey('https://x.test', {}, { key: '', value: 'v' })).toBeNull()
    expect(applyApiKey('https://x.test', {}, { key: 'k', value: '' })).toBeNull()
  })
})

describe('Digest', () => {
  const header = 'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"'

  it('parses a challenge, including when other schemes are offered', () => {
    const c = parseDigestChallenge(`Basic realm="x", ${header}`)
    expect(c).toMatchObject({ realm: 'testrealm@host.com', nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093', algorithm: 'MD5', qop: ['auth', 'auth-int'] })
    expect(parseDigestChallenge('Basic realm="x"')).toBeNull()
    expect(parseDigestChallenge(undefined)).toBeNull()
  })

  it('reproduces the RFC 2617 example response', () => {
    const challenge = parseDigestChallenge(header)!
    const out = buildDigestHeader({ challenge, username: 'Mufasa', password: 'Circle Of Life', method: 'GET', uri: '/dir/index.html', cnonce: '0a4f113b' })
    expect(out).toContain('response="6629fae49393a05397450978507c4ef1"')
    expect(out).toContain('qop=auth, nc=00000001, cnonce="0a4f113b"')
    expect(out).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"')
  })

  it('works without qop and with SHA-256', () => {
    const c = parseDigestChallenge('Digest realm="r", nonce="n", algorithm=SHA-256')!
    const out = buildDigestHeader({ challenge: c, username: 'u', password: 'p', method: 'GET', uri: '/' })
    expect(out).toContain('algorithm=SHA-256')
    expect(out).not.toContain('qop=')
    expect(out).toMatch(/response="[0-9a-f]{64}"/)
  })

  it('knows which algorithms it supports', () => {
    expect(isSupportedDigestAlgorithm('MD5')).toBe(true)
    expect(isSupportedDigestAlgorithm('SHA-256-sess')).toBe(true)
    expect(isSupportedDigestAlgorithm('CRC32')).toBe(false)
  })
})

describe('AWS Signature V4', () => {
  const config = { accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service' }
  const now = new Date('2015-08-30T12:36:00Z')

  it('produces the signature of a separate reference implementation (GET /)', () => {
    const r = signAwsV4({ method: 'GET', url: 'https://example.amazonaws.com/', headers: {}, body: undefined, config, now })
    expect(r.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=94c0945d9b54850561bdae1b1447e5d7f481422ac9370f5ee6580fc1cd898e2e'
    )
    expect(r.headers['X-Amz-Date']).toBe('20150830T123600Z')
  })

  it('sorts query parameters before signing', () => {
    const r = signAwsV4({ method: 'GET', url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1', headers: {}, body: undefined, config, now })
    expect(r.headers.Authorization).toContain('Signature=3ce40d01ce8ce1b781db3ce3112dc91b62f83acec90b2a8215787d7b8f230e6a')
  })

  it('includes the session token and content type in the signature, and signs the body', () => {
    const plain = signAwsV4({ method: 'POST', url: 'https://example.amazonaws.com/x', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}', config, now })
    const withToken = signAwsV4({ method: 'POST', url: 'https://example.amazonaws.com/x', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}', config: { ...config, sessionToken: 'tok' }, now })
    const otherBody = signAwsV4({ method: 'POST', url: 'https://example.amazonaws.com/x', headers: { 'Content-Type': 'application/json' }, body: '{"a":2}', config, now })
    expect(plain.signedHeaders).toBe('content-type;host;x-amz-date')
    expect(withToken.signedHeaders).toBe('content-type;host;x-amz-date;x-amz-security-token')
    expect(withToken.headers['X-Amz-Security-Token']).toBe('tok')
    expect(otherBody.headers.Authorization).not.toBe(plain.headers.Authorization)
  })

  it('adds the payload hash header for S3 and supports unsigned payloads', () => {
    const r = signAwsV4({ method: 'PUT', url: 'https://bucket.s3.amazonaws.com/a b.txt', headers: {}, body: null, config: { ...config, service: 's3' }, now })
    expect(r.headers['X-Amz-Content-Sha256']).toBe('UNSIGNED-PAYLOAD')
    expect(r.signedHeaders).toContain('x-amz-content-sha256')
  })
})

describe('maskTail', () => {
  it('keeps only the last characters of long ids', () => {
    expect(maskTail('AKIA1234567890ABCD')).toBe('••••ABCD')
    expect(maskTail('short')).toBe('••••')
  })
})
