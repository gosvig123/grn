import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import { app } from 'electron'
import type { OnboardingPullStage } from '../shared/contracts'
import {
  BUNDLED_WHISPER_BINARY_NAME,
  MANAGED_WHISPER_MODEL,
  MANAGED_WHISPER_MODEL_SHA256,
  MANAGED_WHISPER_MODELS_DIRNAME,
  MANAGED_WHISPER_MODEL_URL,
} from '../shared/bundled-whisper'

export type WhisperProgressUpdate = {
  progress?: number
  message?: string
  pullStage?: OnboardingPullStage
  activity: boolean
}

export function resolveBundledWhisperBinary(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'whisper', BUNDLED_WHISPER_BINARY_NAME)
    : path.resolve(__dirname, '../..', 'resources', 'whisper', BUNDLED_WHISPER_BINARY_NAME)
}

export function resolveManagedWhisperModelPath(): string {
  return path.join(app.getPath('userData'), MANAGED_WHISPER_MODELS_DIRNAME, MANAGED_WHISPER_MODEL)
}

export function getManagedWhisperPaths(): { binaryPath: string; modelPath: string } {
  const binaryPath = resolveBundledWhisperBinary()
  const modelPath = resolveManagedWhisperModelPath()
  if (!isExecutableFileSync(binaryPath)) throw new Error(missingBundledWhisperMessage(binaryPath))
  if (!existsSync(modelPath)) throw new Error(`Managed Whisper model missing at ${modelPath}. Run Local AI setup before starting a recording.`)
  return { binaryPath, modelPath }
}

export async function bundledWhisperAvailable(): Promise<boolean> {
  return isExecutableFile(resolveBundledWhisperBinary())
}

export async function managedWhisperModelAvailable(): Promise<boolean> {
  return (await fileSha256IfExists(resolveManagedWhisperModelPath())) === MANAGED_WHISPER_MODEL_SHA256
}

export async function ensureManagedWhisperModel(onProgress?: (update: WhisperProgressUpdate) => void): Promise<string> {
  const binaryPath = resolveBundledWhisperBinary()
  if (!(await bundledWhisperAvailable())) throw new Error(missingBundledWhisperMessage(binaryPath))
  const modelPath = resolveManagedWhisperModelPath()
  if (await managedWhisperModelAvailable()) return modelPath
  await mkdir(path.dirname(modelPath), { recursive: true })
  onProgress?.({ message: 'Preparing speech model download', pullStage: 'preparing', activity: true })
  const tempPath = `${modelPath}.download`
  await rm(tempPath, { force: true })
  try {
    const response = await fetch(MANAGED_WHISPER_MODEL_URL)
    if (!response.ok) throw new Error(`Whisper model download failed with status ${response.status}.`)
    if (!response.body) throw new Error('Whisper model download stream was unavailable.')
    await writeModelFile(response, tempPath, onProgress)
    onProgress?.({ message: 'Verifying speech model', pullStage: 'verifying', progress: 99, activity: true })
    const actual = await fileSha256(tempPath)
    if (actual !== MANAGED_WHISPER_MODEL_SHA256) throw new Error(`Whisper model sha256 mismatch: ${actual}`)
    onProgress?.({ message: 'Finalizing speech model', pullStage: 'finalizing', progress: 100, activity: true })
    await rename(tempPath, modelPath)
    onProgress?.({ message: 'Speech model ready', pullStage: 'complete', progress: 100, activity: true })
    return modelPath
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

async function writeModelFile(response: Response, targetPath: string, onProgress?: (update: WhisperProgressUpdate) => void): Promise<void> {
  const total = Number.parseInt(response.headers.get('content-length') || '', 10)
  const input = response.body?.getReader()
  if (!input) throw new Error('Whisper model download stream was unavailable.')
  const output = createWriteStream(targetPath, { mode: 0o644 })
  let written = 0
  try {
    for (;;) {
      const chunk = await input.read()
      if (chunk.done) break
      const buffer = Buffer.from(chunk.value)
      written += buffer.length
      if (!output.write(buffer)) await once(output, 'drain')
      onProgress?.(downloadProgress(total, written))
    }
    output.end()
    await once(output, 'finish')
  } catch (error) {
    output.destroy()
    throw error
  } finally {
    input.releaseLock()
  }
}

function downloadProgress(total: number, written: number): WhisperProgressUpdate {
  const progress = total > 0 ? Math.max(0, Math.min(99, Math.round((written / total) * 100))) : undefined
  return { message: 'Downloading speech model', pullStage: 'downloading', progress, activity: true }
}

export function missingBundledWhisperMessage(binaryPath = resolveBundledWhisperBinary()): string {
  return app.isPackaged
    ? 'Bundled Whisper runtime files are missing from this app. Reinstall Granola. If the problem continues, the app bundle may be corrupted.'
    : `Bundled Whisper binary missing at ${binaryPath}. Run \`npm run prepare:whisper\` before launching the desktop app.`
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile() && (info.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function isExecutableFileSync(filePath: string): boolean {
  try {
    const info = statSync(filePath)
    return info.isFile() && (info.mode & 0o111) !== 0
  } catch {
    return false
  }
}

async function fileSha256IfExists(filePath: string): Promise<string | null> {
  try {
    await access(filePath)
    return fileSha256(filePath)
  } catch {
    return null
  }
}

function fileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(filePath)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('error', reject)
    input.on('end', () => resolve(hash.digest('hex')))
  })
}
