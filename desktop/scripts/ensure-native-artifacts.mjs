import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(desktopRoot, '..')
const buildDir = path.join(repoRoot, 'build')
const grnBinaryPath = path.join(buildDir, 'grn')
const captureAppPath = path.join(buildDir, 'GrnCapture.app')
const workflow = process.argv[2] || 'build'
const makeTargets = process.platform === 'darwin' ? ['build', 'build-capture'] : ['build']

runMake(makeTargets)
await requirePath(grnBinaryPath, `Native grn binary missing at ${grnBinaryPath} after \`make ${makeTargets.join(' ')}\`.`)
runBinaryCheck()

if (process.platform === 'darwin') {
  await requirePath(captureAppPath, `Native capture helper missing at ${captureAppPath} after \`make ${makeTargets.join(' ')}\`.`)
}

function runMake(targets) {
  const result = spawnSync('make', targets, { cwd: repoRoot, stdio: 'pipe' })
  if (!result.error && result.status === 0) return
  throw new Error(`${label(workflow)} native build failed via \`make ${targets.join(' ')}\`.\n${commandOutput(result)}`.trim())
}

function runBinaryCheck() {
  const result = spawnSync(grnBinaryPath, ['app', 'config', 'show', '--json'], { cwd: repoRoot, stdio: 'pipe' })
  if (!result.error && result.status === 0) return
  throw new Error(
    `${label(workflow)} native verification failed for \`${path.relative(repoRoot, grnBinaryPath)} app config show --json\`. ` +
      `Desktop would otherwise launch with a stale or broken binary.\n${commandOutput(result)}`.trim(),
  )
}

function label(step) {
  return step === 'dev' ? 'Desktop dev' : step === 'dist' ? 'Desktop packaging' : 'Desktop build'
}

async function requirePath(filePath, message) {
  try {
    await access(filePath)
  } catch {
    throw new Error(message)
  }
}

function commandOutput(result) {
  if (result.error) return result.error.message
  const stderr = result.stderr.toString().trim()
  const stdout = result.stdout.toString().trim()
  if (stderr) return stderr
  if (stdout) return stdout
  return `Command exited with status ${result.status}`
}
