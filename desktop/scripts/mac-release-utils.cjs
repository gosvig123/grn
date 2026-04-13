const { spawnSync } = require('node:child_process')
const { access, mkdtemp, readdir, rm, stat } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const desktopRoot = path.resolve(__dirname, '..')
const distRoot = path.join(desktopRoot, 'dist')
const entitlementsPath = path.join(desktopRoot, 'build', 'entitlements.mac.plist')
const inheritEntitlementsPath = path.join(desktopRoot, 'build', 'entitlements.mac.inherit.plist')
const nestedCodeLayout = [
  { label: 'grn binary', relativePath: ['Contents', 'Resources', 'bin', 'grn'], executable: true },
  { label: 'Ollama binary', relativePath: ['Contents', 'Resources', 'ollama', 'ollama'], executable: true },
  { label: 'Whisper binary', relativePath: ['Contents', 'Resources', 'whisper', 'whisper-cli'], executable: true },
  { label: 'capture helper app', relativePath: ['Contents', 'Resources', 'GrnCapture.app'], executable: false },
  { label: 'capture helper binary', relativePath: ['Contents', 'Resources', 'GrnCapture.app', 'Contents', 'MacOS', 'grn-capture'], executable: true },
]

async function resolveAppPath(appOutDir, productName) {
  const directPath = path.join(appOutDir, `${productName}.app`)
  if (await pathExists(directPath)) return directPath
  const entries = await readdir(appOutDir, { withFileTypes: true })
  const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
  if (appEntry) return path.join(appOutDir, appEntry.name)
  throw new Error(`No packaged app found in ${appOutDir}`)
}

async function defaultAppPath(productName = 'Grn') {
  const candidateDirs = ['mac', 'mac-arm64', 'mac-universal', 'mac-x64']
  for (const dirName of candidateDirs) {
    const appPath = path.join(distRoot, dirName, `${productName}.app`)
    if (await pathExists(appPath)) return appPath
  }
  throw new Error(`No packaged app found in ${distRoot}`)
}

function nestedCodeTargets(appPath) {
  return nestedCodeLayout.map((target) => ({ ...target, path: path.join(appPath, ...target.relativePath) }))
}

async function verifyRequiredNestedCode(appPath) {
  const targets = nestedCodeTargets(appPath)
  for (const target of targets) await verifyTarget(target)
  return targets
}

async function verifyTarget(target) {
  await requirePath(target.path, `${target.label} missing at ${target.path}`)
  if (!target.executable) return
  const fileStat = await stat(target.path)
  if ((fileStat.mode & 0o111) !== 0) return
  throw new Error(`${target.label} is not executable at ${target.path}`)
}

async function requirePath(targetPath, message) {
  if (await pathExists(targetPath)) return
  throw new Error(message)
}

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

function signingIdentity() {
  return process.env.APPLE_SIGNING_IDENTITY || process.env.CSC_NAME || '-'
}

function isReleaseSigning(identity) {
  return identity !== '-'
}

function shouldNotarize() {
  return process.env.GRN_ENABLE_NOTARIZATION === '1'
}

function notarizationCredentials() {
  return {
    appleId: process.env.APPLE_ID,
    password: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  }
}

function assertNotarizationCredentials() {
  const credentials = notarizationCredentials()
  const missing = Object.entries({
    APPLE_ID: credentials.appleId,
    APPLE_APP_SPECIFIC_PASSWORD: credentials.password,
    APPLE_TEAM_ID: credentials.teamId,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length === 0) return credentials
  throw new Error(`Missing notarization env vars: ${missing.join(', ')}`)
}

function signTarget(targetPath, options = {}) {
  const identity = options.identity || signingIdentity()
  const args = ['--force', '--sign', identity]
  if (isReleaseSigning(identity)) args.push('--timestamp', '--options', 'runtime')
  else args.push('--timestamp=none')
  if (options.entitlements) args.push('--entitlements', options.entitlements)
  args.push(targetPath)
  run('codesign', args)
}

function verifyCodeSignature(targetPath) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', targetPath])
}

function assessGatekeeper(targetPath) {
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', targetPath])
}

function staple(targetPath) {
  run('xcrun', ['stapler', 'staple', targetPath])
}

function validateStaple(targetPath) {
  run('xcrun', ['stapler', 'validate', targetPath])
}

async function zipAppForNotary(appPath) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'grn-notary-'))
  const zipPath = path.join(tempDir, `${path.basename(appPath, '.app')}.zip`)
  run('ditto', ['-c', '-k', '--keepParent', appPath, zipPath])
  return { tempDir, zipPath }
}

async function removeTempDir(tempDir) {
  await rm(tempDir, { recursive: true, force: true })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  })
  if (!result.error && result.status === 0) return result
  throw new Error(`${command} ${args.join(' ')} failed.\n${commandOutput(result)}`.trim())
}

function commandOutput(result) {
  if (result.error) return result.error.message
  if (result.stderr && result.stderr.trim()) return result.stderr.trim()
  if (result.stdout && result.stdout.trim()) return result.stdout.trim()
  return `Command exited with status ${result.status}`
}

module.exports = {
  assessGatekeeper,
  assertNotarizationCredentials,
  commandOutput,
  defaultAppPath,
  desktopRoot,
  entitlementsPath,
  inheritEntitlementsPath,
  isReleaseSigning,
  nestedCodeTargets,
  removeTempDir,
  resolveAppPath,
  run,
  shouldNotarize,
  signTarget,
  signingIdentity,
  staple,
  validateStaple,
  verifyCodeSignature,
  verifyRequiredNestedCode,
  zipAppForNotary,
}
