#!/usr/bin/env node

const path = require('node:path')
const {
  defaultAppPath,
  inheritEntitlementsPath,
  signingIdentity,
  signTarget,
  verifyRequiredNestedCode,
} = require('./mac-release-utils.cjs')

async function main() {
  if (process.platform !== 'darwin') return
  const appPath = process.argv[2] ? path.resolve(process.argv[2]) : await defaultAppPath()
  const identity = signingIdentity()
  const targets = await verifyRequiredNestedCode(appPath)
  const helperApp = targets.find((target) => target.label === 'capture helper app')
  for (const target of targets) {
    if (target.label === 'capture helper app') continue
    signTarget(target.path, { identity })
  }
  if (helperApp) signTarget(helperApp.path, { identity, entitlements: inheritEntitlementsPath })
  console.log(`Signed nested macOS code in ${appPath} with identity ${identity}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
