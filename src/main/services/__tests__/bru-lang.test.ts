import { describe, expect, it } from 'vitest'
import { parseBru, parseBruEnvironment } from '../bru-lang'

describe('parseBru', () => {
  it('parses BOM and CRLF input with quoted keys, local rows, text blocks, lists, and unknown blocks', () => {
    const doc = parseBru(
      '\uFEFFheaders {\r\n'
      + '  "X Key": value\r\n'
      + '  @localOnly: here\r\n'
      + '  @~disabledLocal: hidden\r\n'
      + "  notes: '''\r\n"
      + '    first line\r\n'
      + '      second line\r\n'
      + "  '''\r\n"
      + '}\r\n\r\n'
      + 'vars:secret [\r\n'
      + '  alpha,\r\n'
      + '  beta\r\n'
      + ']\r\n\r\n'
      + 'docs {\r\n'
      + '    line 1\r\n'
      + '      line 2\r\n'
      + '}\r\n\r\n'
      + 'frobnicate {\r\n'
      + '  mode: on\r\n'
      + '}\r\n',
    )

    expect(doc.dicts.get('headers')).toEqual([
      { name: 'X Key', value: 'value', enabled: true },
      { name: 'localOnly', value: 'here', enabled: true, local: true },
      { name: 'disabledLocal', value: 'hidden', enabled: false, local: true },
      { name: 'notes', value: 'first line\n  second line', enabled: true },
    ])
    expect(doc.lists.get('vars:secret')).toEqual(['alpha', 'beta'])
    expect(doc.texts.get('docs')).toBe('line 1\n  line 2')
    expect(doc.unknown).toEqual(['frobnicate'])
  })

  it('keeps empty blocks and partial unterminated text blocks without throwing', () => {
    const empty = parseBru('headers {\n}\n\nvars:secret [\n]\n')
    expect(empty.dicts.get('headers')).toEqual([])
    expect(empty.lists.get('vars:secret')).toEqual([])

    const partial = parseBru("body:text {\n  hello\n    world\n")
    expect(partial.texts.get('body:text')).toBe('hello\n  world')
  })
})

describe('parseBruEnvironment', () => {
  it('parses vars, secret vars, extends, external secrets, color, and annotations', () => {
    const env = parseBruEnvironment(
      '\uFEFFcolor: blue\r\n'
      + 'extends: "Shared"\r\n'
      + 'extends [\r\n'
      + '  base,\r\n'
      + '  "Staging",\r\n'
      + ']\r\n'
      + 'vars {\r\n'
      + '  host: https://example.com\r\n'
      + '  @localOnly: yes\r\n'
      + '  ~disabled: no\r\n'
      + '}\r\n'
      + 'vars:secret [\r\n'
      + '  apiKey,\r\n'
      + '  ~oldKey,\r\n'
      + '  @note()\r\n'
      + ']\r\n'
      + 'vars:externalsecrets:vault {\r\n'
      + '}\r\n',
    )

    expect(env.hasColor).toBe(true)
    expect(env.extends).toEqual(['Shared', 'base', 'Staging'])
    expect(env.variables).toEqual([
      { name: 'host', value: 'https://example.com', enabled: true },
      { name: 'localOnly', value: 'yes', enabled: true, local: true },
      { name: 'disabled', value: 'no', enabled: false },
    ])
    expect(env.secretVariables).toEqual([
      { name: 'apiKey', value: '', enabled: true },
      { name: 'oldKey', value: '', enabled: false },
    ])
    expect(env.externalSecrets).toEqual(['vault'])
    expect(env.malformed).toBe(false)
  })

  it('flags malformed rows and unterminated blocks while preserving parsed values', () => {
    const env = parseBruEnvironment(
      'vars {\n'
      + '  ok: 1\n'
      + '  broken\n'
      + '}\n\n'
      + "vars {\n"
      + "  notes: '''\n"
      + '    hello\n',
    )

    expect(env.variables[0]).toEqual({ name: 'ok', value: '1', enabled: true })
    expect(env.variables[1]).toMatchObject({ name: 'notes', enabled: true })
    expect(env.variables[1].value.trim()).toBe('hello')
    expect(env.malformed).toBe(true)
  })
})
