import { execFile, spawn } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { isManagedLocalAIConfigured, type LocalAIConfig, type LocalAIStatus } from '../shared/contracts'
import { BUNDLED_OLLAMA_BINARY_NAME, BUNDLED_OLLAMA_CACHE_DIRNAME, BUNDLED_OLLAMA_CACHE_ROOT_DIRNAME, BUNDLED_OLLAMA_RELEASE, MANAGED_OLLAMA_ENDPOINT, MANAGED_OLLAMA_HOST_VALUE, MANAGED_OLLAMA_MODEL, MANAGED_OLLAMA_MODELS_DIRNAME, MANAGED_OLLAMA_PORT } from '../shared/bundled-ollama'
import { lastLines } from '../shared/subprocess-output'
import { childEnv } from './grn'
import { type OnboardingErrorState, toOnboardingErrorState } from './onboarding-error-state'
import { pullModelFromOllamaApi, type PullProgressUpdate } from './ollama-pull'

let managedOllamaProcess: ReturnType<typeof spawn> | null = null
let startPromise: Promise<void> | null = null
let managedOllamaOwnedBySession = false
let lastError: OnboardingErrorState | undefined

type ManagedStatusContext = { config: LocalAIConfig | null; configError?: string; supported: boolean; bundled: boolean; running: boolean; configured: boolean; modelAvailable: boolean; ownershipMismatch: boolean }
type ManagedReadiness = { running: boolean; ownershipMismatch: boolean }

export function resolveBundledOllamaBinary(): string { return app.isPackaged ? path.join(process.resourcesPath, 'ollama', BUNDLED_OLLAMA_BINARY_NAME) : path.resolve(__dirname, '../..', BUNDLED_OLLAMA_CACHE_DIRNAME, BUNDLED_OLLAMA_CACHE_ROOT_DIRNAME, BUNDLED_OLLAMA_RELEASE, BUNDLED_OLLAMA_BINARY_NAME) }
export function managedOllamaSupported(): boolean { return process.platform === 'darwin' }
export async function getManagedOllamaStatus(config: LocalAIConfig | null, configError?: string): Promise<LocalAIStatus> {
  const supported = managedOllamaSupported()
  const bundled = supported ? await bundledOllamaAvailable() : false
  const readiness = bundled ? await managedOllamaReadiness() : { running: false, ownershipMismatch: false }
  const configured = isManagedLocalAIConfigured(config)
  const modelAvailable = configured && readiness.running && config ? await managedModelAvailable(config.model) : false
  if (readiness.ownershipMismatch) await managedOllamaOwnershipError()
  return buildLocalAIStatus({ config, configError, supported, bundled, running: readiness.running, configured, modelAvailable, ownershipMismatch: readiness.ownershipMismatch })
}
export async function ensureManagedOllamaRunning(): Promise<void> {
  if (!managedOllamaSupported()) throw new Error('Managed Ollama is only supported on macOS')
  if (!(await bundledOllamaAvailable())) throw new Error(`Bundled Ollama binary missing at ${resolveBundledOllamaBinary()}. Run \`npm run prepare:ollama\` before launching the desktop app.`)
  const readiness = await managedOllamaReadiness()
  if (readiness.running) return
  if (readiness.ownershipMismatch) throw await managedOllamaOwnershipError()
  if (!startPromise) startPromise = startManagedOllama()
  try {
    await startPromise
  } finally {
    startPromise = null
  }
}
export async function pullManagedModel(onProgress?: (update: PullProgressUpdate) => void): Promise<void> {
  await ensureManagedOllamaRunning()
  try {
    await pullModelFromOllamaApi(MANAGED_OLLAMA_ENDPOINT, MANAGED_OLLAMA_MODEL, onProgress)
    lastError = undefined
  } catch (error) {
    lastError = toOnboardingErrorState(error, 'pulling_model', 'Managed Ollama model pull failed')
    throw error
  }
}
export async function managedModelAvailable(model: string): Promise<boolean> {
  try {
    const response = await fetch(`${MANAGED_OLLAMA_ENDPOINT}/api/tags`)
    if (!response.ok) return false
    const body = (await response.json()) as unknown
    return taggedModelNames(body).includes(model)
  } catch {
    return false
  }
}
export function stopManagedOllama(): void {
  if (!managedOllamaProcess) return
  managedOllamaProcess.kill('SIGTERM')
  managedOllamaOwnedBySession = false
  managedOllamaProcess = null
}

async function startManagedOllama(): Promise<void> {
  await mkdir(managedOllamaModelsDir(), { recursive: true })
  const binaryPath = resolveBundledOllamaBinary()
  managedOllamaOwnedBySession = false
  const child = spawn(binaryPath, ['serve'], { env: managedOllamaEnv(), stdio: ['ignore', 'ignore', 'pipe'] })
  managedOllamaProcess = child
  child.stderr.on('data', (chunk) => { lastError = toOnboardingErrorState(lastLines(chunk.toString()), 'error', 'Managed Ollama reported an error') })
  child.on('exit', (code, signal) => {
    managedOllamaOwnedBySession = false
    managedOllamaProcess = null
    if (signal !== 'SIGTERM') lastError = toOnboardingErrorState(startupExitMessage(binaryPath, code, signal), 'error', 'Managed Ollama exited before becoming ready')
  })
  child.on('error', (error) => {
    managedOllamaOwnedBySession = false
    managedOllamaProcess = null
    lastError = toOnboardingErrorState(`Failed to start managed Ollama at ${binaryPath}: ${error.message}`, 'error', 'Failed to start managed Ollama')
  })
  try {
    await waitForManagedOllama(child, binaryPath)
    lastError = undefined
  } catch (error) {
    stopManagedOllama()
    throw error
  }
}
function buildLocalAIStatus(context: ManagedStatusContext): LocalAIStatus {
  const phase = localAIPhase(context)
  const error = context.configError ? toOnboardingErrorState(context.configError, phase, 'Failed to read local AI configuration') : phase === 'error' ? lastError : undefined
  return {
    phase,
    managed: Boolean(context.config?.managed),
    endpoint: context.config?.endpoint || MANAGED_OLLAMA_ENDPOINT,
    model: context.config?.model || MANAGED_OLLAMA_MODEL,
    message: localAIMessage(context),
    error: error?.error,
    errorDetail: error?.errorDetail,
    debugDetail: error?.debugDetail,
    errorDebug: error?.errorDebug,
    errorKind: error?.errorKind,
    ownershipConflict: error?.ownershipConflict,
    canRetry: phase === 'error' || (context.configured && context.running && !context.modelAvailable),
    supported: context.supported,
    configured: context.configured,
    bundled: context.bundled,
    running: context.running,
    canRepair: context.supported && context.bundled,
  }
}
function managedOllamaEnv(): NodeJS.ProcessEnv { return { ...childEnv(), OLLAMA_HOST: MANAGED_OLLAMA_HOST_VALUE, OLLAMA_MODELS: managedOllamaModelsDir() } }
function managedOllamaProcessRunning(child: ReturnType<typeof spawn> | null): child is ReturnType<typeof spawn> & { pid: number } { return Boolean(child?.pid && !child.killed && child.exitCode === null && child.signalCode === null) }
async function managedOllamaListenerPid(): Promise<number | null> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => execFile('lsof', ['-nP', `-iTCP:${MANAGED_OLLAMA_PORT}`, '-sTCP:LISTEN', '-t'], (error, out) => error ? reject(error) : resolve(out)))
    const pid = Number.parseInt(stdout.trim().split('\n')[0] || '', 10)
    return Number.isInteger(pid) ? pid : null
  } catch {
    return null
  }
}
async function managedOllamaListenerSummary(): Promise<string | undefined> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => execFile('lsof', ['-nP', `-iTCP:${MANAGED_OLLAMA_PORT}`, '-sTCP:LISTEN'], (error, out) => error ? reject(error) : resolve(out)))
    return summarizeManagedOllamaListener(stdout)
  } catch {
    return undefined
  }
}
function summarizeManagedOllamaListener(stdout: string): string | undefined {
  const listener = stdout.trim().split('\n').find((line) => line && !line.startsWith('COMMAND'))
  if (!listener) return undefined
  const parts = listener.trim().split(/\s+/)
  if (!parts[0] || !parts[1]) return listener.trim()
  return `Detected listener: ${parts[0]} (PID ${parts[1]}) on 127.0.0.1:${MANAGED_OLLAMA_PORT}.`
}
async function managedOllamaChildOwnsListener(child: ReturnType<typeof spawn> | null): Promise<boolean> { return managedOllamaProcessRunning(child) && (await managedOllamaListenerPid()) === child.pid }
async function managedOllamaOwnedAndHealthy(child: ReturnType<typeof spawn> | null): Promise<boolean> {
  if (!(await managedOllamaChildOwnsListener(child))) return false
  if (!(await managedOllamaHealthy())) return false
  return managedOllamaChildOwnsListener(child)
}
async function managedOllamaReadiness(): Promise<ManagedReadiness> {
  const healthy = await managedOllamaHealthy()
  const running = managedOllamaOwnedBySession && await managedOllamaOwnedAndHealthy(managedOllamaProcess)
  return { running, ownershipMismatch: healthy && !running }
}
async function managedOllamaOwnershipError(): Promise<Error> {
  const detail = `Granola needs 127.0.0.1:${MANAGED_OLLAMA_PORT} for its managed runtime. Stop the other Ollama process manually, then retry Local AI setup.`
  const pid = await managedOllamaListenerPid()
  const rawDetail = await managedOllamaListenerSummary()
  const ownershipConflict = pid === null ? undefined : { pid, port: MANAGED_OLLAMA_PORT, summary: rawDetail, stopCommand: `kill ${pid}` }
  const error = Object.assign(new Error('Managed Ollama requires the app-owned runtime, but another Ollama process is already serving 127.0.0.1:11435. Stop the other Ollama process and retry Local AI setup.'), { detail, debug: rawDetail ? { rawDetail } : undefined, ownershipConflict })
  lastError = toOnboardingErrorState(error, 'starting_ollama', 'Managed Ollama ownership mismatch')
  return error
}
function taggedModelNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || !('models' in payload) || !Array.isArray(payload.models)) return []
  return payload.models.flatMap((model) => (!model || typeof model !== 'object' ? [] : [model.name, model.model].filter((value): value is string => typeof value === 'string')))
}
function managedOllamaModelsDir(): string { return path.join(app.getPath('userData'), MANAGED_OLLAMA_MODELS_DIRNAME) }
async function bundledOllamaAvailable(): Promise<boolean> { try { await access(resolveBundledOllamaBinary()); return true } catch { return false } }
async function managedOllamaHealthy(): Promise<boolean> { try { const response = await fetch(`${MANAGED_OLLAMA_ENDPOINT}/api/version`); return response.ok } catch { return false } }
async function waitForManagedOllama(child: ReturnType<typeof spawn>, binaryPath: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const startupError = earlyManagedOllamaExit(child, binaryPath)
    if (startupError) throw new Error(startupError)
    if (await managedOllamaOwnedAndHealthy(child)) {
      managedOllamaOwnedBySession = true
      return
    }
    if ((await managedOllamaListenerPid()) !== null && await managedOllamaHealthy()) throw await managedOllamaOwnershipError()
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Managed Ollama did not become ready in time at ${binaryPath}${lastError?.error ? `: ${lastError.error}` : ''}`)
}
function earlyManagedOllamaExit(child: ReturnType<typeof spawn>, binaryPath: string): string | null {
  if (child.exitCode === null && child.signalCode === null) return null
  return lastError?.error || startupExitMessage(binaryPath, child.exitCode, child.signalCode)
}
function startupExitMessage(binaryPath: string, code: number | null, signal: NodeJS.Signals | null): string {
  const status = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`
  return `Managed Ollama exited before becoming ready from ${binaryPath} (${status})${lastError?.error ? `: ${lastError.error}` : ''}`
}
function localAIMessage(context: ManagedStatusContext): string {
  if (context.configError) return 'Failed to read local AI configuration'
  if (!context.supported) return 'Managed Ollama is unavailable on this platform'
  if (!context.bundled) return 'Bundled Ollama runtime is missing. Run `npm run prepare:ollama` before launching the desktop app.'
  if (context.ownershipMismatch) return 'Managed Ollama requires the app-owned runtime, but another Ollama process is already serving 127.0.0.1:11435. Stop the other Ollama process and retry Local AI setup.'
  if (context.configured && context.running && !context.modelAvailable) return `Managed Ollama is running, but model ${context.config?.model || MANAGED_OLLAMA_MODEL} is missing. Run setup to pull it again.`
  if (context.configured && context.running) return 'Managed Ollama is running'
  if (context.configured) return 'Managed Ollama is configured but stopped'
  if (context.config && !context.config.managed) return context.running ? 'Desktop is configured for external Ollama while the managed runtime is running. Run setup to switch to the managed runtime.' : 'Desktop is configured for external Ollama. Run setup to switch to the managed runtime.'
  if (context.running) return 'Managed Ollama is running but setup has not switched desktop to it yet.'
  return 'Managed Ollama is ready for setup'
}
function localAIPhase(context: ManagedStatusContext): LocalAIStatus['phase'] {
  if (context.configError || !context.supported || !context.bundled || context.ownershipMismatch) return 'error'
  if (context.configured && context.running && !context.modelAvailable) return 'needs_setup'
  if (context.configured && context.running) return 'ready'
  if (context.configured) return 'error'
  return 'needs_setup'
}
