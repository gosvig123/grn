const path = require('node:path')
const {
  resolveAppPath,
  verifyRequiredNestedCode,
} = require('./mac-release-utils.cjs')

async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = await resolveAppPath(context.appOutDir, context.packager.appInfo.productFilename)
  await verifyRequiredNestedCode(appPath)
  await runScript('./sign-mac-nested-code.cjs', appPath)
}

async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = await resolveAppPath(context.appOutDir, context.packager.appInfo.productFilename)
  await runScript('./notarize-mac-build.cjs', appPath)
  await runScript('./verify-mac-release.cjs', appPath)
}

async function runScript(scriptPath, appPath) {
  const { run } = require('./mac-release-utils.cjs')
  run(process.execPath, [path.join(__dirname, scriptPath), appPath])
}

module.exports = {
  afterPack,
  afterSign,
}
