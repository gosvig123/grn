const hooks = require('./scripts/electron-builder-hooks.cjs')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.grn.desktop',
  productName: 'Grn',
  files: ['dist/**', 'dist-electron/**'],
  extraResources: [
    { from: '../build/grn', to: 'bin/grn' },
    { from: '../build/GrnCapture.app', to: 'GrnCapture.app' },
    { from: 'resources/ollama/ollama', to: 'ollama/ollama' },
    { from: 'resources/whisper/whisper-cli', to: 'whisper/whisper-cli' },
  ],
  afterPack: hooks.afterPack,
  afterSign: hooks.afterSign,
  mac: {
    category: 'public.app-category.productivity',
    target: ['dmg'],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
  },
}
