#!/usr/bin/env node

const path = require('node:path')
const {
  assertNotarizationCredentials,
  defaultAppPath,
  removeTempDir,
  run,
  shouldNotarize,
  staple,
  zipAppForNotary,
} = require('./mac-release-utils.cjs')

async function main() {
  if (process.platform !== 'darwin') return
  if (!shouldNotarize()) {
    console.log('Skipping notarization because GRN_ENABLE_NOTARIZATION is not set')
    return
  }
  const appPath = process.argv[2] ? path.resolve(process.argv[2]) : await defaultAppPath()
  const credentials = assertNotarizationCredentials()
  const { tempDir, zipPath } = await zipAppForNotary(appPath)
  try {
    run('xcrun', [
      'notarytool',
      'submit',
      zipPath,
      '--apple-id',
      credentials.appleId,
      '--password',
      credentials.password,
      '--team-id',
      credentials.teamId,
      '--wait',
    ])
    staple(appPath)
    console.log(`Notarized and stapled ${appPath}`)
  } finally {
    await removeTempDir(tempDir)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
