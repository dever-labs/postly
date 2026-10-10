import { generateCurl } from '@/lib/curl'
import { generateAxios } from './axios'
import { generateCSharp } from './csharp'
import { generateFetch } from './fetch'
import { generateGo } from './go'
import type { ExportableRequest, GeneratedSnippet, SnippetOptions } from './model'
import { generatePython } from './python'

export type SnippetLanguage = 'curl' | 'fetch' | 'axios' | 'python' | 'go' | 'csharp'

export interface LanguageInfo {
  id: SnippetLanguage
  label: string
  /** Monaco language id. Only languages already bundled are used; the rest render as plain text. */
  monaco: string
  generate: (req: ExportableRequest, options: SnippetOptions) => GeneratedSnippet | null
}

export const LANGUAGES: LanguageInfo[] = [
  { id: 'curl', label: 'cURL', monaco: 'plaintext', generate: generateCurl },
  { id: 'fetch', label: 'JavaScript (fetch)', monaco: 'javascript', generate: generateFetch },
  { id: 'axios', label: 'Node.js (axios)', monaco: 'javascript', generate: generateAxios },
  { id: 'python', label: 'Python (requests)', monaco: 'plaintext', generate: generatePython },
  { id: 'go', label: 'Go (net/http)', monaco: 'plaintext', generate: generateGo },
  { id: 'csharp', label: 'C# (HttpClient)', monaco: 'plaintext', generate: generateCSharp },
]

export function generateSnippet(language: SnippetLanguage, req: ExportableRequest, options: SnippetOptions): GeneratedSnippet | null {
  return LANGUAGES.find((l) => l.id === language)?.generate(req, options) ?? null
}
