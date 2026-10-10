import { buildCurl, parseCurl, type CurlExport, type ParsedCurl } from '@/lib/curl'
import { generateSnippet, type SnippetLanguage } from '@/lib/snippets'
import type { GeneratedSnippet } from '@/lib/snippets/model'
import { createRequestInContext } from '@/lib/requestActions'
import { mergeScopedVars, rootCollectionId } from '@/lib/variableScopes'
import { useCollectionsStore } from '@/store/collections'
import { useEnvironmentsStore } from '@/store/environments'
import { useVariablesStore } from '@/store/variables'
import { useRequestsStore } from '@/store/requests'
import { useUIStore } from '@/store/ui'

const DEFAULT_NAMES = new Set(['', 'New Request'])

export interface CurlCopyOptions {
  resolveVariables: boolean
  includeSecrets: boolean
}

function applyToActive(parsed: ParsedCurl): void {
  const { editingRequest, updateField } = useRequestsStore.getState()
  if (!editingRequest) return
  if (DEFAULT_NAMES.has(editingRequest.name)) updateField('name', parsed.name)
  updateField('protocol', 'http')
  updateField('method', parsed.method)
  updateField('url', parsed.url)
  updateField('params', [])
  updateField('headers', parsed.headers)
  updateField('bodyType', parsed.bodyType)
  updateField('bodyContent', parsed.bodyContent)
  updateField('authType', parsed.authType)
  updateField('authConfig', parsed.authConfig)
  updateField('sslVerification', parsed.sslVerification)
}

function report(parsed: ParsedCurl): void {
  const { addToast } = useUIStore.getState()
  if (parsed.warnings.length === 0) { addToast('Imported from cURL', 'success'); return }
  const shown = parsed.warnings.slice(0, 3).join('; ')
  const more = parsed.warnings.length > 3 ? ` (+${parsed.warnings.length - 3} more)` : ''
  addToast(`Imported from cURL with ${parsed.warnings.length} note${parsed.warnings.length === 1 ? '' : 's'}: ${shown}${more}`, 'info')
}

/** Replaces the open request's fields with the parsed command. Returns false when the text is not cURL. */
export function importCurlIntoActive(text: string): boolean {
  const parsed = parseCurl(text)
  if (!parsed || !useRequestsStore.getState().editingRequest) return false
  applyToActive(parsed)
  report(parsed)
  return true
}

/** Creates a new request next to the current one and fills it from the command. */
export async function importCurlAsNewRequest(text: string): Promise<boolean> {
  const parsed = parseCurl(text)
  if (!parsed) return false
  const created = await createRequestInContext()
  if (!created) return false
  applyToActive(parsed)
  report(parsed)
  return true
}

function exportOptions(options: CurlCopyOptions) {
  let variables: Record<string, string> | undefined
  if (options.resolveVariables) {
    const request = useRequestsStore.getState().editingRequest
    const collectionId = rootCollectionId(request?.folderId, useCollectionsStore.getState().folders)
    const activeEnvId = useEnvironmentsStore.getState().activeEnv?.id
    // Resolve precedence first, then drop secrets, so a secret never lets a lower scope's value show through
    const merged = mergeScopedVars({
      environment: useEnvironmentsStore.getState().vars.filter((v) => v.envId === activeEnvId),
      collection: collectionId ? useVariablesStore.getState().collections[collectionId] ?? [] : [],
      global: useVariablesStore.getState().globals,
    })
    variables = Object.fromEntries(merged.filter((v) => v.scope !== 'dynamic' && (options.includeSecrets || !v.isSecret)).map((v) => [v.key, v.value]))
  }
  return { variables, includeSecrets: options.includeSecrets }
}

/** Builds a snippet for the open request. Secret environment variables stay as {{NAME}} unless secrets are included. */
export function exportActiveAsSnippet(language: SnippetLanguage, options: CurlCopyOptions): GeneratedSnippet | null {
  const request = useRequestsStore.getState().editingRequest
  if (!request) return null
  return generateSnippet(language, request, exportOptions(options))
}

/** Builds the cURL command for the open request. */
export function exportActiveAsCurl(options: CurlCopyOptions): CurlExport | null {
  const request = useRequestsStore.getState().editingRequest
  if (!request) return null
  return buildCurl(request, exportOptions(options))
}
