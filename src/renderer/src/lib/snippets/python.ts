import { buildSnippetModel, snippetNotes, type ExportableRequest, type GeneratedSnippet, type SnippetOptions } from './model'
import { dq } from './util'

export function generatePython(req: ExportableRequest, options: SnippetOptions): GeneratedSnippet | null {
  const m = buildSnippetModel(req, options)
  if (!m) return null
  const args: string[] = [dq(m.method), dq(m.url)]

  if (m.headers.length > 0) args.push(`headers={\n${m.headers.map((h) => `        ${dq(h.key)}: ${dq(h.value)},`).join('\n')}\n    }`)
  if (m.basic) args.push(`auth=(${dq(m.basic.username)}, ${dq(m.basic.password)})`)

  switch (m.body.kind) {
    case 'raw': args.push(`data=${dq(m.body.text)}.encode("utf-8")`); break
    case 'urlencoded': args.push(`data=[\n${m.body.rows.map((r) => `        (${dq(r.key)}, ${dq(r.value)}),`).join('\n')}\n    ]`); break
    case 'form': args.push(`files=[\n${m.body.rows.map((r) => (r.file ? `        (${dq(r.key)}, open(${dq(r.value)}, "rb")),` : `        (${dq(r.key)}, (None, ${dq(r.value)})),`)).join('\n')}\n    ]`); break
    case 'binary': args.push(`data=open(${dq(m.body.path)}, "rb")`); break
  }
  if (m.insecure) args.push('verify=False')

  const code = [
    'import requests',
    '',
    `response = requests.request(\n    ${args.join(',\n    ')},\n)`,
    'print(response.status_code, response.text)',
  ].join('\n')
  return { code, notes: snippetNotes(m, code, options) }
}
