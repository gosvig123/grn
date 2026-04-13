#!/usr/bin/env node

const path = require('node:path')
const {
  assessGatekeeper,
  defaultAppPath,
  shouldNotarize,
  validateStaple,
  verifyCodeSignature,
  verifyRequiredNestedCode,
} = require('./mac-release-utils.cjs')

async function main() {
  if (process.platform !== 'darwin') return
  const appPath = process.argv[2] ? path.resolve(process.argv[2]) : await defaultAppPath()
  const targets = await verifyRequiredNestedCode(appPath)
  verifyCodeSignature(appPath)
  for (const target of targets) verifyCodeSignature(target.path)
  if (process.env.GRN_REQUIRE_GATEKEEPER === '1') assessGatekeeper(appPath)
  if (shouldNotarize()) validateStaple(appPath)
  console.log(`Verified macOS release at ${appPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
