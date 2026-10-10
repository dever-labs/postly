import { buildSnippetModel, snippetNotes, type ExportableRequest, type GeneratedSnippet, type SnippetOptions } from './model'
import { dq, indent, isJsonType, tryParseJson } from './util'

export function generateAxios(req: ExportableRequest, options: SnippetOptions): GeneratedSnippet | null {
  const m = buildSnippetModel(req, options)
  if (!m) return null
  const imports = ['import axios from "axios";']
  const pre: string[] = []
  const props: string[] = [`method: ${dq(m.method.toLowerCase())},`, `url: ${dq(m.url)},`]

  if (m.headers.length > 0) props.push(`headers: {\n${m.headers.map((h) => `  ${dq(h.key)}: ${dq(h.value)},`).join('\n')}\n},`)
  if (m.basic) props.push(`auth: { username: ${dq(m.basic.username)}, password: ${dq(m.basic.password)} },`)

  switch (m.body.kind) {
    case 'raw': {
      const parsed = isJsonType(m.body.contentType) ? tryParseJson(m.body.text) : undefined
      props.push(parsed !== undefined ? `data: ${indent(JSON.stringify(parsed, null, 2), 2)},` : `data: ${dq(m.body.text)},`)
      break
    }
    case 'urlencoded':
      props.push(`data: new URLSearchParams([\n${m.body.rows.map((r) => `  [${dq(r.key)}, ${dq(r.value)}],`).join('\n')}\n]),`)
      break
    case 'form':
      pre.push('const form = new FormData();')
      for (const r of m.body.rows) {
        pre.push(r.file ? `form.append(${dq(r.key)}, await openAsBlob(${dq(r.value)})); // import { openAsBlob } from "node:fs"` : `form.append(${dq(r.key)}, ${dq(r.value)});`)
      }
      props.push('data: form,')
      break
    case 'binary':
      pre.push(`const file = await readFile(${dq(m.body.path)}); // import { readFile } from "node:fs/promises"`)
      props.push('data: file,')
      break
  }

  if (m.insecure) {
    imports.push('import https from "node:https";')
    props.push('httpsAgent: new https.Agent({ rejectUnauthorized: false }),')
  }

  const code = [
    ...imports,
    '',
    ...pre,
    `const response = await axios({\n${props.map((p) => `  ${indent(p, 2)}`).join('\n')}\n});`,
    'console.log(response.status, response.data);',
  ].join('\n')
  return { code, notes: snippetNotes(m, code, options) }
}
