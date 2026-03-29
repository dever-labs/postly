import { registerCollectionHandlers } from './collections'
import { registerRequestHandlers } from './requests'
import { registerHttpHandlers } from './http'
import { registerOAuthHandlers } from './oauth'
import { registerEnvironmentHandlers } from './environments'
import { registerBackstageHandlers } from './backstage'
import { registerGitHubHandlers } from './github'
import { registerGitLabHandlers } from './gitlab'
import { registerSettingsHandlers } from './settings'
import { registerIntegrationHandlers } from './integrations'
import { registerWsHandlers } from './ws'
import { registerGrpcHandlers } from './grpc'
import { registerMqttHandlers } from './mqtt'
import { registerAiHandlers } from './ai'
import { registerExportImportHandlers } from './export-import'

export function registerAllIpcHandlers(): void {
  registerCollectionHandlers()
  registerRequestHandlers()
  registerHttpHandlers()
  registerOAuthHandlers()
  registerEnvironmentHandlers()
  registerBackstageHandlers()
  registerGitHubHandlers()
  registerGitLabHandlers()
  registerSettingsHandlers()
  registerIntegrationHandlers()
  registerWsHandlers()
  registerGrpcHandlers()
  registerMqttHandlers()
  registerAiHandlers()
  registerExportImportHandlers()
}
