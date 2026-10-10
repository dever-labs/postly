import { buildSnippetModel, snippetNotes, type ExportableRequest, type GeneratedSnippet, type SnippetOptions } from './model'

const HTTP_METHODS: Record<string, string> = { GET: 'Get', POST: 'Post', PUT: 'Put', DELETE: 'Delete', PATCH: 'Patch', HEAD: 'Head', OPTIONS: 'Options' }

function cs(s: string): string {
  let out = '"'
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (ch === '\\') out += '\\\\'
    else if (ch === '"') out += '\\"'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (c < 32 || c === 0x2028 || c === 0x2029) out += `\\u${c.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return `${out}"`
}

export function generateCSharp(req: ExportableRequest, options: SnippetOptions): GeneratedSnippet | null {
  const m = buildSnippetModel(req, options)
  if (!m) return null
  const lines: string[] = ['using System.Net.Http;', 'using System.Net.Http.Headers;', 'using System.Text;', '']
  lines.push(m.insecure
    ? 'using var handler = new HttpClientHandler { ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator };\nusing var client = new HttpClient(handler);'
    : 'using var client = new HttpClient();')
  lines.push(`using var request = new HttpRequestMessage(HttpMethod.${HTTP_METHODS[m.method] ?? 'Get'}, ${cs(m.url)});`)

  // Content-Type belongs to the body content in HttpClient, not to the request headers
  const contentType = m.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value
  for (const h of m.headers) {
    if (h.key.toLowerCase() === 'content-type') continue
    lines.push(`request.Headers.TryAddWithoutValidation(${cs(h.key)}, ${cs(h.value)});`)
  }
  if (m.basic) lines.push(`request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(${cs(`${m.basic.username}:${m.basic.password}`)})));`)

  switch (m.body.kind) {
    case 'raw': {
      const media = (contentType ?? 'text/plain').split(';')[0].trim()
      lines.push(`request.Content = new StringContent(${cs(m.body.text)}, Encoding.UTF8, ${cs(media)});`)
      break
    }
    case 'urlencoded':
      lines.push('request.Content = new FormUrlEncodedContent(new[]', '{', ...m.body.rows.map((r) => `    new KeyValuePair<string, string>(${cs(r.key)}, ${cs(r.value)}),`), '});')
      break
    case 'form':
      lines.push('var form = new MultipartFormDataContent();')
      for (const r of m.body.rows) {
        lines.push(r.file ? `form.Add(new StreamContent(File.OpenRead(${cs(r.value)})), ${cs(r.key)}, Path.GetFileName(${cs(r.value)}));` : `form.Add(new StringContent(${cs(r.value)}), ${cs(r.key)});`)
      }
      lines.push('request.Content = form;')
      break
    case 'binary':
      lines.push(`request.Content = new StreamContent(File.OpenRead(${cs(m.body.path)}));`)
      if (contentType) lines.push(`request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(${cs(contentType)});`)
      break
  }

  lines.push('', 'using var response = await client.SendAsync(request);', 'Console.WriteLine((int)response.StatusCode + " " + await response.Content.ReadAsStringAsync());')
  const code = lines.join('\n')
  return { code, notes: snippetNotes(m, code, options) }
}
