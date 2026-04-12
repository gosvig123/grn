import { isManagedLocalAIConfigured, type LocalAIConfig, type LocalAIStatus, type OnboardingStatus } from '../shared/contracts'
import { MANAGED_OLLAMA_ENDPOINT, MANAGED_OLLAMA_MODEL } from '../shared/bundled-ollama'
import { getLocalAIConfig, saveManagedLocalAIConfig } from './grn'
import { toOnboardingErrorState } from './onboarding-error-state'
import {
  ensureManagedOllamaRunning,
  getManagedOllamaStatus,
  managedModelAvailable,
  managedOllamaSupported,
  pullManagedModel,
} from './ollama'

let status: OnboardingStatus = needsSetupStatus()
const listeners = new Set<(status: OnboardingStatus) => void>()

type LocalAIConfigLoadResult = {
  config: LocalAIConfig | null
  error?: string
}

export function getOnboardingStatus(): OnboardingStatus {
  return status
}

export function onOnboardingStatusChange(listener: (status: OnboardingStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function bootstrapOnboarding(): Promise<void> {
  const { config, error } = await loadLocalAIConfig()
  if (error) {
    setStatus(errorStatus(error, status.phase))
    return
  }
  if (!config) {
    setStatus(needsSetupStatus())
    return
  }
  if (!isManagedLocalAIConfigured(config)) {
    setStatus(needsSetupStatus({
      managed: false,
      endpoint: config.endpoint,
      model: config.model,
      message: 'Desktop is configured for external Ollama. Run setup to switch to the managed runtime.',
    }))
    return
  }
  try {
    setStatus(managedStatus('starting_ollama', 'Starting managed Ollama', { endpoint: config.endpoint, model: config.model }))
    await ensureManagedOllamaRunning()
    if (!(await managedModelAvailable(config.model))) {
      setStatus(missingModelStatus(config.model, config.endpoint))
      return
    }
    setStatus(managedStatus('ready', 'Managed Ollama is ready', { endpoint: config.endpoint, model: config.model }))
  } catch (error) {
    setErrorStatus(error, config.model)
  }
}

export async function startOnboarding(): Promise<OnboardingStatus> {
  return runOnboarding()
}

export async function retryOnboarding(): Promise<OnboardingStatus> {
  return runOnboarding()
}

export async function getLocalAIStatus(): Promise<LocalAIStatus> {
  const { config, error } = await loadLocalAIConfig()
  return getManagedOllamaStatus(config, error)
}

export async function repairLocalAI(): Promise<LocalAIStatus> {
  const next = await runOnboarding()
  return {
    ...(await getLocalAIStatus()),
    phase: next.phase,
    message: next.message,
    progress: next.progress,
    error: next.error,
    errorDetail: next.errorDetail,
    debugDetail: next.debugDetail,
    errorDebug: next.errorDebug,
    pullStage: next.pullStage,
    errorKind: next.errorKind,
    ownershipConflict: next.ownershipConflict,
    canRetry: next.canRetry,
  }
}

async function runOnboarding(): Promise<OnboardingStatus> {
  if (!managedOllamaSupported()) {
    setStatus(errorStatus('Managed Ollama onboarding is only supported on macOS', status.phase))
    return status
  }
  try {
    setStatus(managedStatus('checking', 'Checking managed Ollama'))
    await ensureManagedOllamaRunning()
    setStatus(managedStatus('starting_ollama', 'Managed Ollama is running'))
    setStatus(managedStatus('pulling_model', 'Pulling local model'))
    await pullManagedModel(({ progress, message, pullStage }) => {
      const nextProgress = typeof progress === 'number' ? progress : status.progress
      const nextStatus = typeof nextProgress === 'number' ? { progress: nextProgress } : {}
      setStatus(managedStatus('pulling_model', message || 'Pulling local model', { ...nextStatus, pullStage }))
    })
    setStatus(managedStatus('saving_config', 'Saving local AI configuration'))
    const config = await saveManagedLocalAIConfig({ endpoint: MANAGED_OLLAMA_ENDPOINT, model: MANAGED_OLLAMA_MODEL })
    setStatus(managedStatus('ready', 'Local AI is ready', { endpoint: config.endpoint, model: config.model }))
  } catch (error) {
    setErrorStatus(error, MANAGED_OLLAMA_MODEL)
  }
  return status
}

async function loadLocalAIConfig(): Promise<LocalAIConfigLoadResult> {
  try {
    return { config: await getLocalAIConfig() }
  } catch (error) {
    return {
      config: null,
      error: error instanceof Error ? error.message : 'Failed to read local AI configuration',
    }
  }
}

function setStatus(next: OnboardingStatus): void {
  status = next
  for (const listener of listeners) listener(status)
}

function needsSetupStatus(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    phase: 'needs_setup',
    managed: true,
    endpoint: MANAGED_OLLAMA_ENDPOINT,
    model: MANAGED_OLLAMA_MODEL,
    message: 'Local AI setup is required',
    canRetry: false,
    ...overrides,
  }
}

function managedStatus(
  phase: OnboardingStatus['phase'],
  message: string,
  overrides: Partial<OnboardingStatus> = {},
): OnboardingStatus {
  return {
    phase,
    managed: true,
    endpoint: MANAGED_OLLAMA_ENDPOINT,
    model: MANAGED_OLLAMA_MODEL,
    message,
    canRetry: false,
    ...overrides,
  }
}

function missingModelStatus(model: string, endpoint = MANAGED_OLLAMA_ENDPOINT): OnboardingStatus {
  return {
    phase: 'needs_setup',
    managed: true,
    endpoint,
    model,
    message: `Managed Ollama is running, but model ${model} is missing. Run setup to pull it again.`,
    canRetry: true,
  }
}

function errorStatus(error: unknown, phase: OnboardingStatus['phase'], model = MANAGED_OLLAMA_MODEL): OnboardingStatus {
  const nextError = toOnboardingErrorState(error, phase, fallbackOnboardingError(phase))
  return {
    phase: 'error',
    managed: true,
    endpoint: MANAGED_OLLAMA_ENDPOINT,
    model,
    message: nextError.error,
    ...nextError,
    canRetry: true,
  }
}

function setErrorStatus(error: unknown, model: string): void {
  setStatus(errorStatus(error, status.phase, model))
}

function fallbackOnboardingError(phase: OnboardingStatus['phase']): string {
  return phase === 'pulling_model'
    ? 'Managed Ollama model download failed. Check your network connection, then retry Local AI setup.'
    : 'Managed Ollama onboarding failed'
}
