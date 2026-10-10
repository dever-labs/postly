import { describe, it, expect } from 'vitest'
import { convertPostmanScripts, parsePostmanCollection } from '../postman-parser'
import { parseRules } from '../../../../shared/extract'

const test = (exec: string[]) => [{ listen: 'test', script: { exec } }]

describe('Postman test scripts', () => {
  it('converts environment and collection variable sets from the response', () => {
    const { rules, warnings } = convertPostmanScripts('Login', test([
      '// save the token',
      'var jsonData = pm.response.json();',
      'pm.environment.set("token", jsonData.data.access_token);',
      "pm.collectionVariables.set('first', jsonData.items[0].id);",
      'pm.environment.set("rid", pm.response.headers.get("X-Request-Id"));',
      'pm.environment.set("status", pm.response.code);',
      'pm.environment.set("sid", pm.cookies.get("sid"));',
      'pm.environment.set("direct", pm.response.json().user.name);',
    ]))
    expect(warnings).toEqual([])
    expect(rules.map((r) => [r.source, r.expression, r.variable, r.scope])).toEqual([
      ['json', '$.data.access_token', 'token', 'environment'],
      ['json', '$.items[0].id', 'first', 'collection'],
      ['header', 'X-Request-Id', 'rid', 'environment'],
      ['status', '', 'status', 'environment'],
      ['cookie', 'sid', 'sid', 'environment'],
      ['json', '$.user.name', 'direct', 'environment'],
    ])
  })

  it('warns about what it cannot convert and keeps what it can', () => {
    const { rules, warnings } = convertPostmanScripts('R', test([
      'const d = pm.response.json();',
      'pm.environment.set("a", d.x);',
      'pm.environment.set("b", d.x.toUpperCase());',
      'pm.globals.set("g", d.x);',
      'pm.test("ok", function () { pm.response.to.have.status(200); });',
    ]))
    expect(rules).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/3 script lines/)
  })

  it('warns that pre-request scripts are not imported', () => {
    const { warnings } = convertPostmanScripts('R', [{ listen: 'prerequest', script: { exec: ['console.log(1)'] } }])
    expect(warnings[0]).toMatch(/pre-request/)
  })

  it('attaches rules to the imported request', () => {
    const out = parsePostmanCollection({
      info: { name: 'C', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{
        name: 'Login',
        request: { method: 'POST', url: 'http://x/login' },
        event: test(['pm.environment.set("t", pm.response.json().token);', 'tests["x"] = true;']),
      }],
    })
    const req = out.groups[0].requests[0]
    expect(parseRules(req.protocolConfig.extractRules)).toHaveLength(1)
    expect(out.warnings).toHaveLength(1)
  })
})
