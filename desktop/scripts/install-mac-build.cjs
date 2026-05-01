#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { defaultAppPath } = require('./mac-release-utils.cjs')

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('macOS install is only supported on macOS')
  }

  const appPath = process.argv[2] ? path.resolve(process.argv[2]) : await defaultAppPath()
  run('rm', ['-rf', '/Applications/Gappd.app'])
  run('ditto', [appPath, '/Applications/Gappd.app'])
  console.log(`Installed ${appPath} to /Applications/Gappd.app`)
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8' })
  if (!result.error && result.status === 0) return
  const output = result.error?.message || result.stderr.trim() || result.stdout.trim() || `Command exited with status ${result.status}`
  throw new Error(`${command} ${args.join(' ')} failed.\n${output}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
