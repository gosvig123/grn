import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'

const DEFAULT_MACOS_MIN_VERSION = '13.0'
const MAC_BUILD_NATIVE = 'native'
const MAC_BUILD_ARM64 = 'arm64'
const MAC_BUILD_X64 = 'x64'
const MAC_BUILD_UNIVERSAL = 'universal'
const MAC_ARCH_ARM64 = 'arm64'
const MAC_ARCH_X64 = 'x86_64'
const GO_ARCH_ARM64 = 'arm64'
const GO_ARCH_X64 = 'amd64'
const WORKFLOW_DEV = 'dev'
const WORKFLOW_DIST = 'dist'
const WORKFLOW_BUILD = 'build'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(desktopRoot, '..')
const buildDir = path.join(repoRoot, 'build')
const gappdBinaryPath = path.join(buildDir, 'gappd')
const captureAppPath = path.join(buildDir, 'GappdCapture.app')
const captureBinaryPath = path.join(captureAppPath, 'Contents', 'MacOS', 'gappd-capture')
const workflow = process.argv[2] || WORKFLOW_BUILD
const macBuildProfile = process.env.GAPPD_MAC_BUILD || MAC_BUILD_NATIVE
const macosMinVersion = process.env.GAPPD_MACOS_MIN_VERSION || DEFAULT_MACOS_MIN_VERSION

await buildNativeArtifacts()
await requirePath(gappdBinaryPath, `Native gappd binary missing at ${gappdBinaryPath} after build.`)
if (shouldRunLocalBinaryCheck()) runBinaryCheck()
else console.log(`Skipping local runtime verification for cross-compiled ${macBuildProfile} gappd binary.`)

if (process.platform === 'darwin') {
  await requirePath(captureAppPath, `Native capture helper missing at ${captureAppPath} after build.`)
  await requirePath(captureBinaryPath, `Native capture helper binary missing at ${captureBinaryPath} after build.`)
  verifyBinaryCompatibility('gappd binary', gappdBinaryPath)
  verifyBinaryCompatibility('capture helper binary', captureBinaryPath)
}

async function buildNativeArtifacts() {
  if (process.platform !== 'darwin') {
    runMake(['build'])
    return
  }

  await buildGoBinary()
  runMake(['build-capture'], {
    GAPPD_MAC_BUILD: macBuildProfile,
    GAPPD_MACOS_MIN_VERSION: macosMinVersion,
  })
}

async function buildGoBinary() {
  if (macBuildProfile !== MAC_BUILD_UNIVERSAL) {
    runMake(['build'], {
      GOOS: 'darwin',
      GOARCH: goArchForProfile(macBuildProfile),
      MACOSX_DEPLOYMENT_TARGET: macosMinVersion,
      OUTPUT: gappdBinaryPath,
    })
    return
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gappd-native-'))
  const arm64Path = path.join(tempDir, 'gappd-arm64')
  const x64Path = path.join(tempDir, 'gappd-x64')

  try {
    runMake(['build'], {
      GOOS: 'darwin',
      GOARCH: GO_ARCH_ARM64,
      MACOSX_DEPLOYMENT_TARGET: macosMinVersion,
      OUTPUT: arm64Path,
    })
    runMake(['build'], {
      GOOS: 'darwin',
      GOARCH: GO_ARCH_X64,
      MACOSX_DEPLOYMENT_TARGET: macosMinVersion,
      OUTPUT: x64Path,
    })
    runCommand('lipo', ['-create', arm64Path, x64Path, '-output', gappdBinaryPath], 'Failed to create universal gappd binary')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function runMake(targets, extraEnv = {}) {
  const result = spawnSync('make', targets, {
    cwd: repoRoot,
    stdio: 'pipe',
    env: { ...process.env, ...extraEnv },
  })
  if (!result.error && result.status === 0) return
  throw new Error(`${label(workflow)} native build failed via \`make ${targets.join(' ')}\`.\n${commandOutput(result)}`.trim())
}

function runBinaryCheck() {
  const result = spawnSync(gappdBinaryPath, ['app', 'config', 'show', '--json'], { cwd: repoRoot, stdio: 'pipe' })
  if (!result.error && result.status === 0) return
  throw new Error(
    `${label(workflow)} native verification failed for \`${path.relative(repoRoot, gappdBinaryPath)} app config show --json\`. ` +
      `Desktop would otherwise launch with a stale or broken binary.\n${commandOutput(result)}`.trim(),
  )
}

function shouldRunLocalBinaryCheck() {
  if (process.platform !== 'darwin') return true
  const hostArchitecture = os.arch() === 'x64' ? MAC_ARCH_X64 : MAC_ARCH_ARM64
  const expectedArchitectures = expectedMacArchitectures(macBuildProfile)
  return expectedArchitectures.includes(hostArchitecture)
}

function verifyBinaryCompatibility(binaryLabel, binaryPath) {
  const expectedArchitectures = expectedMacArchitectures(macBuildProfile)
  const actualArchitectures = readArchitectures(binaryPath)
  const missingArchitectures = expectedArchitectures.filter((arch) => !actualArchitectures.includes(arch))
  if (missingArchitectures.length > 0) {
    throw new Error(
      `${label(workflow)} compatibility verification failed for ${binaryLabel}. ` +
        `Expected architectures ${expectedArchitectures.join(', ')}, found ${actualArchitectures.join(', ')} at ${binaryPath}.`,
    )
  }

  const minimumOsVersions = readMinimumOsVersions(binaryPath)
  const mismatchedMinimumOs = minimumOsVersions.filter((version) => compareVersions(version, macosMinVersion) > 0)
  if (mismatchedMinimumOs.length > 0) {
    throw new Error(
      `${label(workflow)} compatibility verification failed for ${binaryLabel}. ` +
        `Expected minOS <= ${macosMinVersion}, found ${mismatchedMinimumOs.join(', ')} at ${binaryPath}.`,
    )
  }
}

function readArchitectures(binaryPath) {
  const result = spawnSync('lipo', ['-archs', binaryPath], { stdio: 'pipe', encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to inspect architectures for ${binaryPath}.\n${commandOutput(result)}`.trim())
  }
  return result.stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function readMinimumOsVersions(binaryPath) {
  const result = spawnSync('xcrun', ['vtool', '-show-build', binaryPath], { stdio: 'pipe', encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to inspect minimum macOS version for ${binaryPath}.\n${commandOutput(result)}`.trim())
  }
  const matches = [...result.stdout.matchAll(/minos\s+([0-9]+(?:\.[0-9]+)*)/g)].map((match) => match[1])
  if (matches.length > 0) return matches
  throw new Error(`No LC_BUILD_VERSION minos value found for ${binaryPath}.`)
}

function expectedMacArchitectures(buildProfile) {
  switch (buildProfile) {
    case MAC_BUILD_UNIVERSAL:
      return [MAC_ARCH_ARM64, MAC_ARCH_X64]
    case MAC_BUILD_ARM64:
      return [MAC_ARCH_ARM64]
    case MAC_BUILD_X64:
      return [MAC_ARCH_X64]
    case MAC_BUILD_NATIVE:
      return [os.arch() === 'x64' ? MAC_ARCH_X64 : MAC_ARCH_ARM64]
    default:
      throw new Error(`Unsupported GAPPD_MAC_BUILD value: ${buildProfile}`)
  }
}

function goArchForProfile(buildProfile) {
  switch (buildProfile) {
    case MAC_BUILD_ARM64:
      return GO_ARCH_ARM64
    case MAC_BUILD_X64:
      return GO_ARCH_X64
    case MAC_BUILD_NATIVE:
      return os.arch() === 'x64' ? GO_ARCH_X64 : GO_ARCH_ARM64
    default:
      throw new Error(`Unsupported single-arch GAPPD_MAC_BUILD value: ${buildProfile}`)
  }
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

function runCommand(command, args, message) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8' })
  if (!result.error && result.status === 0) return
  throw new Error(`${message}.\n${commandOutput(result)}`.trim())
}

function label(step) {
  return step === WORKFLOW_DEV ? 'Desktop dev' : step === WORKFLOW_DIST ? 'Desktop packaging' : 'Desktop build'
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
