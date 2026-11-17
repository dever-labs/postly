import { describe, it, expect } from 'vitest'
import {
  DeepLinkError, findDeepLinkInArgv, formatEntityRef, parseBackstageBaseUrl, parseDeepLink, parseEntityRef, sameBackstageBaseUrl,
} from '../deep-link'

const link = (params: string) => `postly://open?${params}`
const DEVHUB = 'backstage=https%3A%2F%2Fhub.dever.dk'

describe('parseDeepLink', () => {
  it('parses the documented open link', () => {
    expect(parseDeepLink(link(`${DEVHUB}&entity=api%3Amockly%2Fmockly-management-api`))).toEqual({
      action: 'open-backstage-entity',
      backstageBaseUrl: 'https://hub.dever.dk',
      entity: { kind: 'api', namespace: 'mockly', name: 'mockly-management-api' },
    })
  })

  it('accepts unencoded values, component refs, mixed case and a base path', () => {
    expect(parseDeepLink('postly://open?backstage=http://localhost:7007/&entity=Component:default/petstore')).toMatchObject({
      backstageBaseUrl: 'http://localhost:7007',
      entity: { kind: 'component', namespace: 'default', name: 'petstore' },
    })
    expect(parseDeepLink(link('backstage=https%3A%2F%2Fexample.com%2Fbackstage%2F&entity=api%3Adefault%2Fx')).backstageBaseUrl)
      .toBe('https://example.com/backstage')
    expect(parseDeepLink(`POSTLY://OPEN?${DEVHUB}&entity=api:default/x`).entity.name).toBe('x')
    expect(parseDeepLink(`postly://open/?${DEVHUB}&entity=api:default/x`).entity.name).toBe('x')
  })

  it.each([
    ['another scheme', `https://open?${DEVHUB}&entity=api:default/x`],
    ['an unknown action', `postly://import?${DEVHUB}&entity=api:default/x`],
    ['an extra path', `postly://open/../../etc?${DEVHUB}&entity=api:default/x`],
    ['an unknown parameter', link(`${DEVHUB}&entity=api:default/x&file=/etc/passwd`)],
    ['a duplicated parameter', link(`${DEVHUB}&backstage=https://evil.example&entity=api:default/x`)],
    ['a missing entity', link(DEVHUB)],
    ['a missing base URL', link('entity=api:default/x')],
    ['a javascript: base URL', link('backstage=javascript:alert(1)&entity=api:default/x')],
    ['a file: base URL', link('backstage=file:///etc/passwd&entity=api:default/x')],
    ['credentials in the base URL', link('backstage=https://u:p@hub.example&entity=api:default/x')],
    ['a query in the base URL', link('backstage=https%3A%2F%2Fhub.example%2F%3Fx%3D1&entity=api:default/x')],
    ['a fragment on the link', `${link(`${DEVHUB}&entity=api:default/x`)}#frag`],
    ['credentials on the link', `postly://user@open?${DEVHUB}&entity=api:default/x`],
    ['a port on the link', `postly://open:80?${DEVHUB}&entity=api:default/x`],
    ['an entity without namespace', link(`${DEVHUB}&entity=api:x`)],
    ['an unsupported kind', link(`${DEVHUB}&entity=user:default/jane`)],
    ['path traversal in the entity', link(`${DEVHUB}&entity=api:..%2F..%2Fetc`)],
    ['dots-only names', link(`${DEVHUB}&entity=api:default/..`)],
    ['extra segments', link(`${DEVHUB}&entity=api:default/a/b`)],
    ['spaces', link(`${DEVHUB}&entity=api:default/a%20b`)],
    ['an overlong name', link(`${DEVHUB}&entity=api:default/${'a'.repeat(64)}`)],
    ['an overlong link', link(`${DEVHUB}&entity=api:default/x&pad=${'a'.repeat(3000)}`)],
    ['garbage', 'not a url'],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseDeepLink(raw)).toThrow(DeepLinkError)
  })
})

describe('entity refs', () => {
  it('round-trips', () => {
    expect(formatEntityRef(parseEntityRef('API:my-ns/my_api.v2'))).toBe('api:my-ns/my_api.v2')
  })
})

describe('parseBackstageBaseUrl', () => {
  it('normalises to origin + path without trailing slash', () => {
    expect(parseBackstageBaseUrl('HTTPS://Hub.Dever.DK:443//')).toBe('https://hub.dever.dk')
  })
})

describe('findDeepLinkInArgv', () => {
  it('picks the postly:// argument (Windows/Linux pass the link in argv)', () => {
    expect(findDeepLinkInArgv(['C:\\Postly\\Postly.exe', '--allow-file-access', 'postly://open?x'])).toBe('postly://open?x')
    expect(findDeepLinkInArgv(['/usr/bin/postly', '--no-sandbox'])).toBeUndefined()
  })
})

describe('sameBackstageBaseUrl', () => {
  it('ignores host case and trailing slashes but not scheme, port or path', () => {
    expect(sameBackstageBaseUrl('https://Hub.dever.dk/', 'https://hub.dever.dk')).toBe(true)
    expect(sameBackstageBaseUrl('http://hub.dever.dk', 'https://hub.dever.dk')).toBe(false)
    expect(sameBackstageBaseUrl('https://hub.dever.dk:8443', 'https://hub.dever.dk')).toBe(false)
    expect(sameBackstageBaseUrl('https://hub.dever.dk/a', 'https://hub.dever.dk')).toBe(false)
    expect(sameBackstageBaseUrl('nonsense', 'https://hub.dever.dk')).toBe(false)
  })
})
