#!/usr/bin/env node

const path = require('node:path')
const { defaultAppPath, verifyRequiredNestedCode } = require('./mac-release-utils.cjs')

async function main() {
  const appPath = process.argv[2] ? path.resolve(process.argv[2]) : await defaultAppPath()
  const targets = await verifyRequiredNestedCode(appPath)
  console.log(`Verified ${targets.length} required nested code paths in ${appPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
