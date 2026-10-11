import { buildSnippetModel, snippetNotes, type ExportableRequest, type GeneratedSnippet, type SnippetOptions } from './model'
import { dq, indent, isJsonType, tryParseJson } from './util'

export function generateFetch(req: ExportableRequest, options: SnippetOptions): GeneratedSnippet | null {
  const m = buildSnippetModel(req, options)
  if (!m) return null
  const pre: string[] = []
  const props: string[] = [`method: ${dq(m.method)},`]

  const headers = m.headers.map((h) => `${dq(h.key)}: ${dq(h.value)},`)
  if (m.basic) headers.push(`"Authorization": "Basic " + btoa(${dq(`${m.basic.username}:${m.basic.password}`)}),`)
  if (headers.length > 0) props.push(`headers: {\n${headers.map((h) => `  ${h}`).join('\n')}\n},`)

  switch (m.body.kind) {
    case 'raw': {
      const parsed = isJsonType(m.body.contentType) ? tryParseJson(m.body.text) : undefined
      props.push(parsed !== undefined ? `body: JSON.stringify(${indent(JSON.stringify(parsed, null, 2), 2)}),` : `body: ${dq(m.body.text)},`)
      break
    }
    case 'urlencoded':
      props.push(`body: new URLSearchParams([\n${m.body.rows.map((r) => `  [${dq(r.key)}, ${dq(r.value)}],`).join('\n')}\n]),`)
      break
    case 'form':
      pre.push('const form = new FormData();')
      for (const r of m.body.rows) {
        pre.push(r.file ? `form.append(${dq(r.key)}, await openAsBlob(${dq(r.value)})); // import { openAsBlob } from "node:fs"` : `form.append(${dq(r.key)}, ${dq(r.value)});`)
      }
      props.push('body: form,')
      break
    case 'binary':
      pre.push(`const file = await readFile(${dq(m.body.path)}); // import { readFile } from "node:fs/promises"`)
      props.push('body: file,')
      break
  }

  const lines: string[] = []
  if (m.insecure) lines.push('// NOTE: fetch cannot skip TLS verification per request; run Node with NODE_TLS_REJECT_UNAUTHORIZED=0 to match the disabled setting.')
  lines.push(...pre)
  lines.push(`const response = await fetch(${dq(m.url)}, {\n${props.map((p) => `  ${indent(p, 2)}`).join('\n')}\n});`)
  lines.push('console.log(response.status, await response.text());')
  const code = lines.join('\n')
  return { code, notes: snippetNotes(m, code, options) }
}
