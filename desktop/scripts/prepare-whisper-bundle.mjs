import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MACOS_MIN_VERSION = '13.0'
const MAC_BUILD_NATIVE = 'native'
const MAC_BUILD_ARM64 = 'arm64'
const MAC_BUILD_X64 = 'x64'
const MAC_BUILD_UNIVERSAL = 'universal'
const MAC_ARCH_ARM64 = 'arm64'
const MAC_ARCH_X64 = 'x86_64'
const release = 'v1.7.6'
const sourceUrl = `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${release}.tar.gz`
const sourceSha256 = '166140e9a6d8a36f787a2bd77f8f44dd64874f12dd8359ff7c1f4f9acb86202e'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const macBuildProfile = process.env.GAPPD_MAC_BUILD || MAC_BUILD_NATIVE
const macosMinVersion = process.env.GAPPD_MACOS_MIN_VERSION || DEFAULT_MACOS_MIN_VERSION
const cacheKey = process.platform === 'darwin' ? `${macBuildProfile}-macos-${macosMinVersion}` : process.platform
const cacheDir = path.join(root, '.cache', 'whisper', release, cacheKey)
const archivePath = path.join(cacheDir, 'whisper.cpp.tar.gz')
const cacheBinaryPath = path.join(cacheDir, 'whisper-cli')
const outputDir = path.join(root, 'resources', 'whisper')
const outputPath = path.join(outputDir, 'whisper-cli')

await mkdir(cacheDir, { recursive: true })
await mkdir(outputDir, { recursive: true })

if (!(await hasMatchingArchive())) await downloadArchive(sourceUrl)
if (!(await hasWorkingBinary(cacheBinaryPath))) await buildBinary()
await copyFile(cacheBinaryPath, outputPath)
await chmod(outputPath, 0o755)

async function hasMatchingArchive() {
  try {
    await access(archivePath)
    return (await fileSha256(archivePath)) === sourceSha256
  } catch {
    return false
  }
}

async function hasWorkingBinary(filePath) {
  try {
    await access(filePath)
  } catch {
    return false
  }
  if (process.platform === 'darwin' && !matchesExpectedCompatibility(filePath)) return false
  if (!shouldRunBinaryCheck()) return true
  return runBinaryCheck(filePath)
}

async function downloadArchive(targetUrl) {
  await new Promise((resolve, reject) => {
    https.get(targetUrl, (response) => {
      if (isRedirect(response.statusCode) && response.headers.location) {
        response.resume()
        resolve(downloadArchive(response.headers.location))
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download Whisper source archive: ${response.statusCode}`))
        return
      }
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks)
          await rm(archivePath, { force: true })
          await writeFile(archivePath, buffer)
          resolve(undefined)
        } catch (error) {
          reject(error)
        }
      })
      response.on('error', reject)
    }).on('error', reject)
  })
  const actual = await fileSha256(archivePath)
  if (actual !== sourceSha256) throw new Error(`Whisper source archive sha256 mismatch: ${actual}`)
}

async function buildBinary() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gappd-whisper-'))
  try {
    runCommand('tar', ['-xzf', archivePath, '-C', tempDir, '--strip-components=1'], 'Failed to extract Whisper source archive')
    const buildDir = path.join(tempDir, 'build')
    const configureArgs = ['-S', tempDir, '-B', buildDir, '-DBUILD_SHARED_LIBS=OFF', '-DGGML_METAL=OFF', '-DGGML_NATIVE=OFF']
    if (process.platform === 'darwin') {
      configureArgs.push(`-DCMAKE_OSX_DEPLOYMENT_TARGET=${macosMinVersion}`)
      configureArgs.push(`-DCMAKE_OSX_ARCHITECTURES=${cmakeArchitectures()}`)
    }
    runCommand('cmake', configureArgs, 'Failed to configure Whisper bundle build')
    runCommand('cmake', ['--build', buildDir, '--config', 'Release', '--target', 'whisper-cli'], 'Failed to build Whisper CLI bundle')
    const builtBinaryPath = path.join(buildDir, 'bin', 'whisper-cli')
    if (!(await hasWorkingBinary(builtBinaryPath))) throw new Error(`Built Whisper CLI is missing or invalid at ${builtBinaryPath}`)
    await copyFile(builtBinaryPath, cacheBinaryPath)
    await chmod(cacheBinaryPath, 0o755)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function runCommand(command, args, message) {
  const result = spawnSync(command, args, { stdio: 'pipe' })
  if (!result.error && result.status === 0) return
  throw new Error(`${message}\n${commandOutput(result)}`.trim())
}

function runBinaryCheck(filePath) {
  const result = spawnSync(filePath, ['-h'], { stdio: 'pipe' })
  return !result.error && result.status === 0
}

function isRedirect(statusCode) {
  return Boolean(statusCode && statusCode >= 300 && statusCode < 400)
}

async function fileSha256(filePath) {
  const data = await readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

function shouldRunBinaryCheck() {
  if (process.platform !== 'darwin') return true
  if (macBuildProfile === MAC_BUILD_UNIVERSAL) return true
  const hostArchitecture = os.arch() === 'x64' ? MAC_ARCH_X64 : MAC_ARCH_ARM64
  return cmakeArchitectures() === hostArchitecture
}

function matchesExpectedCompatibility(filePath) {
  const actualArchitectures = readArchitectures(filePath)
  const missingArchitectures = expectedArchitectures().filter((arch) => !actualArchitectures.includes(arch))
  if (missingArchitectures.length > 0) return false
  const minimumOsVersions = readMinimumOsVersions(filePath)
  return minimumOsVersions.every((version) => compareVersions(version, macosMinVersion) <= 0)
}

function expectedArchitectures() {
  switch (macBuildProfile) {
    case MAC_BUILD_UNIVERSAL:
      return [MAC_ARCH_ARM64, MAC_ARCH_X64]
    case MAC_BUILD_ARM64:
      return [MAC_ARCH_ARM64]
    case MAC_BUILD_X64:
      return [MAC_ARCH_X64]
    case MAC_BUILD_NATIVE:
      return [os.arch() === 'x64' ? MAC_ARCH_X64 : MAC_ARCH_ARM64]
    default:
      throw new Error(`Unsupported GAPPD_MAC_BUILD value: ${macBuildProfile}`)
  }
}

function readArchitectures(filePath) {
  const result = spawnSync('lipo', ['-archs', filePath], { stdio: 'pipe', encoding: 'utf8' })
  if (result.error || result.status !== 0) return []
  return result.stdout.trim().split(/\s+/).filter(Boolean)
}

function readMinimumOsVersions(filePath) {
  const result = spawnSync('xcrun', ['vtool', '-show-build', filePath], { stdio: 'pipe', encoding: 'utf8' })
  if (result.error || result.status !== 0) return []
  return [...result.stdout.matchAll(/minos\s+([0-9]+(?:\.[0-9]+)*)/g)].map((match) => match[1])
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] || 0
    const rightPart = rightParts[index] || 0
    if (leftPart > rightPart) return 1
    if (leftPart < rightPart) return -1
  }

  return 0
}

function cmakeArchitectures() {
  switch (macBuildProfile) {
    case MAC_BUILD_UNIVERSAL:
      return `${MAC_ARCH_ARM64};${MAC_ARCH_X64}`
    case MAC_BUILD_ARM64:
      return MAC_ARCH_ARM64
    case MAC_BUILD_X64:
      return MAC_ARCH_X64
    case MAC_BUILD_NATIVE:
      return os.arch() === 'x64' ? MAC_ARCH_X64 : MAC_ARCH_ARM64
    default:
      throw new Error(`Unsupported GAPPD_MAC_BUILD value: ${macBuildProfile}`)
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
