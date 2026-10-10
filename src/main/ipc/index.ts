import { registerCollectionHandlers } from './collections'
import { registerRequestHandlers } from './requests'
import { registerHttpHandlers } from './http'
import { registerOAuthHandlers } from './oauth'
import { registerEnvironmentHandlers } from './environments'
import { registerBackstageHandlers } from './backstage'
import { registerGitHubHandlers } from './github'
import { registerGitLabHandlers } from './gitlab'
import { registerGitHandlers } from './git'
import { registerSettingsHandlers } from './settings'
import { registerProxyHandlers } from './proxy'
import { registerHistoryHandlers } from './history'
import { registerCookieHandlers } from './cookies'
import { registerIntegrationHandlers } from './integrations'
import { registerWsHandlers } from './ws'
import { registerGrpcHandlers } from './grpc'
import { registerMqttHandlers } from './mqtt'
import { registerAiHandlers } from './ai'
import { registerExportImportHandlers } from './export-import'
import { registerDraftHandlers } from './drafts'
import { registerWindowHandlers } from './window'
import { registerUpdaterHandlers } from './updater'
import { installIpcSenderGuard } from './sender-guard'

export { attachWindowEvents } from './window'

export function registerAllIpcHandlers(): void {
  installIpcSenderGuard()
  registerCollectionHandlers()
  registerRequestHandlers()
  registerHttpHandlers()
  registerOAuthHandlers()
  registerEnvironmentHandlers()
  registerBackstageHandlers()
  registerGitHubHandlers()
  registerGitLabHandlers()
  registerGitHandlers()
  registerSettingsHandlers()
  registerProxyHandlers()
  registerHistoryHandlers()
  registerCookieHandlers()
  registerIntegrationHandlers()
  registerWsHandlers()
  registerGrpcHandlers()
  registerMqttHandlers()
  registerAiHandlers()
  registerExportImportHandlers()
  registerDraftHandlers()
  registerWindowHandlers()
  registerUpdaterHandlers()
}
