'use strict'

// afterSign hook — called by electron-builder after code signing.
// Notarizes the macOS app only when Apple credentials are present,
// so unsigned/local builds are unaffected.
exports.default = async function notarize(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (!process.env.APPLE_ID) {
    console.log('Skipping notarization: APPLE_ID not set')
    return
  }

  const { notarize } = require('@electron/notarize')
  const appName = context.packager.appInfo.productFilename
  const appPath = `${context.appOutDir}/${appName}.app`

  console.log(`Notarizing ${appPath}…`)

  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })

  console.log('Notarization complete')
}
