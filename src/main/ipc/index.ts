import { registerCollectionHandlers } from './collections'
import { registerRequestHandlers } from './requests'
import { registerHttpHandlers } from './http'
import { registerOAuthHandlers } from './oauth'
import { registerEnvironmentHandlers } from './environments'
import { registerBackstageHandlers } from './backstage'
import { registerGitHubHandlers } from './github'
import { registerGitLabHandlers } from './gitlab'
import { registerSettingsHandlers } from './settings'

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
}
