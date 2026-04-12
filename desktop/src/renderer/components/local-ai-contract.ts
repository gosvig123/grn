import { buildOwnershipHelp, type LocalAIOwnershipHelp } from './local-ai-ownership'

type LocalAIContract = Pick<typeof window.grn, 'onboarding' | 'settings'>

export type OnboardingStatus = Awaited<ReturnType<LocalAIContract['onboarding']['getStatus']>>
export type LocalAIStatus = Awaited<ReturnType<LocalAIContract['settings']['getLocalAIStatus']>>

type OnboardingMessageView = {
  headline: string
  detail?: string
  compact: string
}

type OnboardingErrorView = {
  title: string
  detail?: string
  errorDetail?: string
  debugDetail?: string
  compact: string
  ownershipHelp?: LocalAIOwnershipHelp
}

const PULL_STAGE_VIEWS: Record<NonNullable<OnboardingStatus['pullStage']>, OnboardingMessageView> = {
  preparing: { headline: 'Preparing download', compact: 'Preparing download.' },
  downloading: { headline: 'Downloading model', compact: 'Downloading model.' },
  verifying: { headline: 'Verifying download', compact: 'Verifying download.' },
  finalizing: { headline: 'Finishing model install', compact: 'Finishing install.' },
  complete: { headline: 'Download complete', compact: 'Download complete.' },
}

const ERROR_VIEWS: Record<NonNullable<OnboardingStatus['errorKind']>, Omit<OnboardingErrorView, 'debugDetail' | 'ownershipHelp'>> = {
  pull_timeout: { title: 'Model download timed out.', detail: 'Check your connection, then retry Local AI setup.', compact: 'Download timed out.' },
  pull_network: { title: 'Model download interrupted.', detail: 'Check your connection, then retry Local AI setup.', compact: 'Download interrupted.' },
  pull_blob_host_network: { title: 'Granola could not reach the model download host.', detail: 'Check VPN, firewall, or network filtering on this Mac, then retry Local AI setup.', compact: 'Model host unavailable.' },
  disk_space: { title: 'Not enough disk space for the model.', detail: 'Free some space on this Mac, then retry Local AI setup.', compact: 'Need more disk space.' },
  permission: { title: 'Granola could not update local AI files.', detail: 'Check file permissions on this Mac, then retry setup.', compact: 'File permission issue.' },
  ownership_mismatch: { title: "Another Ollama process is using Granola's local port.", detail: 'Granola needs 127.0.0.1:11435 for its managed runtime. Stop the other Ollama process manually, then retry setup.', compact: 'Another Ollama is using 11435.' },
  runtime: { title: 'Bundled Ollama needs attention.', compact: 'Bundled Ollama needs attention.' },
}

const GENERIC_PHASE_MESSAGES: Record<OnboardingStatus['phase'], string[]> = {
  checking: ['checking managed ollama', 'checking your local ai setup'],
  needs_setup: ['local ai setup is required'],
  starting_ollama: ['managed ollama is running', 'starting the bundled ollama runtime'],
  pulling_model: ['pulling local model', 'downloading the recommended local model'],
  saving_config: ['saving local ai configuration', 'finishing local ai setup'],
  ready: ['local ai is ready'],
  error: ['managed ollama onboarding failed', 'local ai setup needs attention'],
}

const STATUS_DELIMITERS = [' -- ', ' - ', ' | ', ': ']

export function getLocalAIContract(): LocalAIContract {
  return window.grn
}

export function onboardingPhaseLabel(phase: OnboardingStatus['phase']): string {
  switch (phase) {
    case 'checking': return 'Checking'
    case 'needs_setup': return 'Needs setup'
    case 'starting_ollama': return 'Starting Ollama'
    case 'pulling_model': return 'Pulling model'
    case 'saving_config': return 'Saving config'
    case 'ready': return 'Ready'
    case 'error': return 'Error'
  }
}

export function onboardingStatusTone(phase: OnboardingStatus['phase']): 'idle' | 'processing' | 'error' {
  if (phase === 'ready') return 'idle'
  if (phase === 'error') return 'error'
  return 'processing'
}

export function onboardingMessageView(status: Pick<OnboardingStatus, 'phase' | 'message' | 'progress' | 'pullStage'>): OnboardingMessageView | null {
  const pullView = onboardingPullStageView(status)
  if (pullView) return pullView
  const text = cleanStatusText(status.message, typeof status.progress === 'number')
  if (!text || isGenericPhaseMessage(status.phase, text)) return null
  const [headline, detail] = splitStatusText(text)
  return { headline, detail, compact: truncateText(detail || headline, 72) }
}

export function onboardingErrorView(status: Pick<OnboardingStatus, 'debugDetail' | 'error' | 'errorDetail' | 'errorKind' | 'ownershipConflict'> | null | undefined): OnboardingErrorView | null {
  if (!status) return null
  if (status.errorKind) return structuredErrorView(status)
  return legacyErrorView(status.error)
}

export function toStatusError(error: unknown): LocalAIStatus {
  return {
    phase: 'error',
    managed: true,
    endpoint: '',
    model: '',
    message: 'Local AI unavailable.',
    error: error instanceof Error ? error.message : String(error),
    errorKind: 'runtime',
    canRetry: true,
    supported: false,
    configured: false,
    bundled: false,
    running: false,
    canRepair: false,
  }
}

function cleanStatusText(message: string, hasProgress: boolean): string {
  const withoutOutput = normalizeText(message.split(/recent ollama output:/i)[0] || '')
  if (!withoutOutput) return ''
  const withoutPercent = hasProgress ? normalizeText(withoutOutput.replace(/\b\d{1,3}%\b/g, '')) : withoutOutput
  return truncateText(withoutPercent.replace(/\s+[-|:]\s*$/, ''), 120)
}

function cleanErrorText(message: string | undefined): string {
  return truncateText(normalizeText((message || '').split(/recent ollama output:/i)[0] || ''), 180)
}

function cleanDebugDetail(detail: string | undefined): string | undefined {
  const text = (detail || '').trim()
  return text ? truncateText(text, 1200) : undefined
}

function onboardingPullStageView(status: Pick<OnboardingStatus, 'phase' | 'message' | 'progress' | 'pullStage'>): OnboardingMessageView | null {
  if (status.phase !== 'pulling_model' || !status.pullStage) return null
  return { ...PULL_STAGE_VIEWS[status.pullStage], detail: cleanPullDetail(status) }
}

function structuredErrorView(status: Pick<OnboardingStatus, 'debugDetail' | 'error' | 'errorDetail' | 'errorKind' | 'ownershipConflict'>): OnboardingErrorView {
  const view = ERROR_VIEWS[status.errorKind!]
  return { ...view, detail: status.errorDetail || view.detail, errorDetail: status.errorDetail, debugDetail: cleanDebugDetail(status.debugDetail), ownershipHelp: status.errorKind === 'ownership_mismatch' ? buildOwnershipHelp(status.ownershipConflict) : undefined }
}

function legacyErrorView(error: string | undefined): OnboardingErrorView | null {
  const text = cleanErrorText(error)
  if (!text) return null
  if (matchesText(text, ['network', 'connection', 'timed out', 'timeout', 'dns', 'econn', 'socket', 'fetch', 'download', 'pull stalled', 'could not reach', 'registry'])) return { title: 'Model download interrupted.', detail: 'Check your connection, then retry Local AI setup.', compact: 'Download interrupted.' }
  if (matchesText(text, ['no space', 'disk full', 'enospc', 'not enough space'])) return { title: 'Not enough disk space for the model.', detail: 'Free some space on this Mac, then retry Local AI setup.', compact: 'Need more disk space.' }
  if (matchesText(text, ['permission denied', 'operation not permitted', 'access denied', 'eacces'])) return { title: 'Granola could not update local AI files.', detail: 'Check file permissions on this Mac, then retry setup.', compact: 'File permission issue.' }
  if (matchesText(text, ['another ollama process', 'app-owned runtime', '127.0.0.1:11435', 'address already in use'])) return { title: "Another Ollama process is using Granola's local port.", detail: 'Granola needs 127.0.0.1:11435 for its managed runtime. Stop the other Ollama process manually, then retry setup.', compact: 'Another Ollama is using 11435.', ownershipHelp: buildOwnershipHelp(undefined) }
  return matchesText(text, ['spawn', 'listen']) ? { title: 'Bundled Ollama could not finish setup.', detail: truncateText(text, 120), compact: 'Bundled Ollama needs attention.' } : { title: truncateText(text, 120), compact: truncateText(text, 72) }
}

function splitStatusText(text: string): [string, string | undefined] {
  for (const delimiter of STATUS_DELIMITERS) {
    const parts = text.split(delimiter)
    if (parts.length > 1) return [parts[0], normalizeText(parts.slice(1).join(delimiter)) || undefined]
  }
  return [text, undefined]
}

function isGenericPhaseMessage(phase: OnboardingStatus['phase'], text: string): boolean {
  return GENERIC_PHASE_MESSAGES[phase].includes(normalizeKey(text))
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeKey(value: string): string {
  return normalizeText(value).toLowerCase()
}

function cleanPullDetail(status: Pick<OnboardingStatus, 'phase' | 'message' | 'progress' | 'pullStage'>): string | undefined {
  const text = cleanStatusText(status.message, typeof status.progress === 'number')
  if (!text || isGenericPhaseMessage(status.phase, text)) return undefined
  if (status.pullStage && normalizeKey(text) === normalizeKey(PULL_STAGE_VIEWS[status.pullStage].headline)) return undefined
  return text
}

function matchesText(text: string, needles: string[]): boolean {
  const normalized = normalizeKey(text)
  return needles.some((needle) => normalized.includes(needle))
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}...`
}
