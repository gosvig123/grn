import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const release = 'v0.20.5'
const artifact = 'ollama-darwin.tgz'
const sha256 = '71773629d3581d75b18411a0cba80b2f6e7d9021855bb3c9f34ad4e0fb4b33a0'
const url = `https://github.com/ollama/ollama/releases/download/${release}/${artifact}`
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, '.cache', 'ollama', release)
const archivePath = path.join(cacheDir, artifact)
const cacheBinaryPath = path.join(cacheDir, 'ollama')
const outputDir = path.join(root, 'resources', 'ollama')
const outputPath = path.join(outputDir, 'ollama')

await mkdir(cacheDir, { recursive: true })
await mkdir(outputDir, { recursive: true })

if (!(await hasMatchingArchive())) await downloadArchive(url)
await extractBinary()

async function hasMatchingArchive() {
  try {
    await access(archivePath)
    return (await fileSha256(archivePath)) === sha256
  } catch {
    return false
  }
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
        reject(new Error(`Failed to download Ollama archive: ${response.statusCode}`))
        return
      }
      const file = createWriteStream(archivePath)
      response.pipe(file)
      file.on('finish', () => file.close(resolve))
      file.on('error', reject)
    }).on('error', reject)
  })
  const actual = await fileSha256(archivePath)
  if (actual !== sha256) throw new Error(`Ollama archive sha256 mismatch: ${actual}`)
}

async function extractBinary() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'grn-ollama-'))
  try {
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', tempDir], { stdio: 'pipe' })
    if (result.status !== 0) throw new Error(result.stderr.toString() || 'Failed to extract Ollama archive')
    await copyFile(path.join(tempDir, 'ollama'), cacheBinaryPath)
    await chmod(cacheBinaryPath, 0o755)
    await copyFile(cacheBinaryPath, outputPath)
    await chmod(outputPath, 0o755)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function isRedirect(statusCode) {
  return Boolean(statusCode && statusCode >= 300 && statusCode < 400)
}

async function fileSha256(filePath) {
  const data = await readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}
