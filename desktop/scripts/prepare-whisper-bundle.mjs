import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const release = 'v1.7.6'
const sourceUrl = `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${release}.tar.gz`
const sourceSha256 = '166140e9a6d8a36f787a2bd77f8f44dd64874f12dd8359ff7c1f4f9acb86202e'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache', 'whisper', release)
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'grn-whisper-'))
  try {
    runCommand('tar', ['-xzf', archivePath, '-C', tempDir, '--strip-components=1'], 'Failed to extract Whisper source archive')
    const buildDir = path.join(tempDir, 'build')
    runCommand('cmake', ['-S', tempDir, '-B', buildDir, '-DBUILD_SHARED_LIBS=OFF', '-DGGML_METAL=OFF'], 'Failed to configure Whisper bundle build')
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

function commandOutput(result) {
  if (result.error) return result.error.message
  const stderr = result.stderr.toString().trim()
  const stdout = result.stdout.toString().trim()
  if (stderr) return stderr
  if (stdout) return stdout
  return `Command exited with status ${result.status}`
}
