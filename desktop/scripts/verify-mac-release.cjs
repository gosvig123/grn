#!/usr/bin/env node

const path = require('node:path')
const {
  DEFAULT_MACOS_MIN_VERSION,
  assessGatekeeper,
  compareVersions,
  defaultAppPath,
  expectedArchitecturesForAppPath,
  readAppMinimumSystemVersion,
  readArchitectures,
  readMinimumOsVersions,
  shouldNotarize,
  validateStaple,
  verifyCodeSignature,
  verifyRequiredNestedCode,
} = require('./mac-release-utils.cjs')

const COMPATIBILITY_LIMITS = {
  'gappd binary': DEFAULT_MACOS_MIN_VERSION,
  'Ollama binary': DEFAULT_MACOS_MIN_VERSION,
  'Whisper binary': DEFAULT_MACOS_MIN_VERSION,
  'capture helper binary': DEFAULT_MACOS_MIN_VERSION,
}

async function main() {
  if (process.platform !== 'darwin') return
  const appPath = process.argv[2] ? path.resolve(process.argv[2]) : await defaultAppPath()
  const targets = await verifyRequiredNestedCode(appPath)
  verifyCodeSignature(appPath)
  for (const target of targets) verifyCodeSignature(target.path)
  verifyCompatibility(appPath, targets)
  if (process.env.GAPPD_REQUIRE_GATEKEEPER === '1') assessGatekeeper(appPath)
  if (shouldNotarize()) validateStaple(appPath)
  console.log(`Verified macOS release at ${appPath}`)
}

function verifyCompatibility(appPath, targets) {
  const expectedArchitectures = expectedArchitecturesForAppPath(appPath)
  const appMinimumSystemVersion = readAppMinimumSystemVersion(appPath)
  if (compareVersions(appMinimumSystemVersion, DEFAULT_MACOS_MIN_VERSION) !== 0) {
    throw new Error(
      `App bundle minimum macOS mismatch. Expected ${DEFAULT_MACOS_MIN_VERSION}, found ${appMinimumSystemVersion} at ${appPath}.`,
    )
  }

  for (const target of targets) {
    if (!target.executable) continue

    const actualArchitectures = readArchitectures(target.path)
    const missingArchitectures = expectedArchitectures.filter((arch) => !actualArchitectures.includes(arch))
    if (missingArchitectures.length > 0) {
      throw new Error(
        `${target.label} architecture mismatch. Expected ${expectedArchitectures.join(', ')}, ` +
          `found ${actualArchitectures.join(', ')} at ${target.path}.`,
      )
    }

    const minimumOsVersions = readMinimumOsVersions(target.path)
    const compatibilityLimit = COMPATIBILITY_LIMITS[target.label]
    if (compatibilityLimit) {
      const invalidMinimumOsVersions = minimumOsVersions.filter((version) => compareVersions(version, compatibilityLimit) > 0)
      if (invalidMinimumOsVersions.length > 0) {
        throw new Error(
          `${target.label} minimum macOS mismatch. Expected <= ${compatibilityLimit}, ` +
            `found ${invalidMinimumOsVersions.join(', ')} at ${target.path}.`,
        )
      }
    }

    const appMismatches = minimumOsVersions.filter((version) => compareVersions(version, appMinimumSystemVersion) > 0)
    if (appMismatches.length > 0) {
      throw new Error(
        `${target.label} minimum macOS mismatch. App bundle advertises ${appMinimumSystemVersion}, ` +
          `but ${target.path} requires ${appMismatches.join(', ')}.`,
      )
    }
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
