const hooks = require('./scripts/electron-builder-hooks.cjs')

const MACOS_MINIMUM_SYSTEM_VERSION = '14.0'
const MAC_SIGNING_IDENTITY = process.env.APPLE_SIGNING_IDENTITY || process.env.CSC_NAME || '-'

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.gappd.desktop',
  productName: 'Gappd',
  directories: {
    output: 'release',
  },
  files: ['dist/**', 'dist-electron/**'],
  extraResources: [
    { from: '../build/gappd', to: 'bin/gappd' },
    { from: '../build/GappdCapture.app', to: 'GappdCapture.app' },
    { from: 'resources/ollama/ollama', to: 'ollama/ollama' },
    { from: 'resources/whisper/whisper-cli', to: 'whisper/whisper-cli' },
  ],
  afterPack: hooks.afterPack,
  afterSign: hooks.afterSign,
  mac: {
    category: 'public.app-category.productivity',
    target: ['dmg'],
    minimumSystemVersion: MACOS_MINIMUM_SYSTEM_VERSION,
    identity: MAC_SIGNING_IDENTITY,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
  },
}
