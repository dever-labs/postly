import { buildSnippetModel, snippetNotes, type ExportableRequest, type GeneratedSnippet, type SnippetOptions } from './model'
import { dq, hasHeader } from './util'

export function generateGo(req: ExportableRequest, options: SnippetOptions): GeneratedSnippet | null {
  const m = buildSnippetModel(req, options)
  if (!m) return null
  const imports = new Set<string>(['"fmt"', '"io"', '"net/http"'])
  const pre: string[] = []
  const headers = [...m.headers]
  let body = 'nil'

  switch (m.body.kind) {
    case 'raw':
      imports.add('"strings"')
      body = `strings.NewReader(${dq(m.body.text)})`
      break
    case 'urlencoded':
      imports.add('"net/url"'); imports.add('"strings"')
      pre.push('form := url.Values{}', ...m.body.rows.map((r) => `form.Add(${dq(r.key)}, ${dq(r.value)})`))
      if (!hasHeader(headers, 'content-type')) headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' })
      body = 'strings.NewReader(form.Encode())'
      break
    case 'form':
      imports.add('"bytes"'); imports.add('"mime/multipart"')
      pre.push('var payload bytes.Buffer', 'writer := multipart.NewWriter(&payload)')
      for (const r of m.body.rows) {
        if (r.file) {
          imports.add('"os"')
          pre.push(`file, err := os.Open(${dq(r.value)})`, 'if err != nil { panic(err) }', 'defer file.Close()', `part, err := writer.CreateFormFile(${dq(r.key)}, ${dq(r.value.split(/[\\/]/).pop() ?? r.value)})`, 'if err != nil { panic(err) }', 'io.Copy(part, file)')
        } else {
          pre.push(`writer.WriteField(${dq(r.key)}, ${dq(r.value)})`)
        }
      }
      pre.push('writer.Close()')
      body = '&payload'
      break
    case 'binary':
      imports.add('"os"')
      pre.push(`file, err := os.Open(${dq(m.body.path)})`, 'if err != nil { panic(err) }', 'defer file.Close()')
      body = 'file'
      break
  }

  let client = 'client := &http.Client{}'
  if (m.insecure) {
    imports.add('"crypto/tls"')
    client = 'client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}'
  }

  const lines: string[] = [
    'package main',
    '',
    `import (\n${[...imports].sort().map((i) => `\t${i}`).join('\n')}\n)`,
    '',
    'func main() {',
    ...pre.map((l) => `\t${l}`),
    `\treq, err := http.NewRequest(${dq(m.method)}, ${dq(m.url)}, ${body})`,
    '\tif err != nil { panic(err) }',
  ]
  for (const h of headers) lines.push(`\treq.Header.Set(${dq(h.key)}, ${dq(h.value)})`)
  if (m.body.kind === 'form') lines.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())')
  if (m.basic) lines.push(`\treq.SetBasicAuth(${dq(m.basic.username)}, ${dq(m.basic.password)})`)
  lines.push(
    `\t${client}`,
    '\tresp, err := client.Do(req)',
    '\tif err != nil { panic(err) }',
    '\tdefer resp.Body.Close()',
    '\tdata, _ := io.ReadAll(resp.Body)',
    '\tfmt.Println(resp.StatusCode, string(data))',
    '}',
  )
  const code = lines.join('\n')
  return { code, notes: snippetNotes(m, code, options) }
}
