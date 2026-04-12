import type { OnboardingErrorDebug, OnboardingErrorKind } from '../shared/contracts'

type PullStallController = {
  refresh: () => void
  clear: () => void
  errorFor: (error: unknown) => Error
}

type PullFailure = {
  summary: string
  detail?: string
  debug?: OnboardingErrorDebug
  errorKind?: OnboardingErrorKind
}

type PullFailureError = Error & {
  detail?: string
  debug?: OnboardingErrorDebug
  errorKind?: OnboardingErrorKind
}

const OLLAMA_PULL_STALL_TIMEOUT_PRE_BYTES_MS = 90_000
const OLLAMA_PULL_STALL_TIMEOUT_POST_BYTES_MS = 300_000
const TIMEOUT_MARKERS = ['i/o timeout', 'timed out', 'timeout', 'etimedout', 'headers timeout', 'body timeout', 'connect timeout', 'und_err_connect_timeout']
const CONNECTIVITY_MARKERS = ['dial tcp', 'connection refused', 'no such host', 'network is unreachable', 'econnrefused', 'econnreset', 'enetunreach', 'ehostunreach', 'enotfound', 'eai_again', 'fetch failed', 'socketerror']

export function createPullStallController(controller: AbortController, getLastMessage: () => string | undefined, hasByteProgress: () => boolean): PullStallController {
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let stalled = false
  const clear = () => {
    if (!stallTimer) return
    clearTimeout(stallTimer)
    stallTimer = null
  }
  return {
    refresh: () => {
      clear()
      stallTimer = setTimeout(() => {
        stalled = true
        controller.abort()
      }, pullStallTimeoutMs(hasByteProgress()))
    },
    clear,
    errorFor: (error: unknown) => stalled ? new Error(stalledPullMessage(getLastMessage())) : normalizeTransportError(error),
  }
}

function stalledPullMessage(lastMessage?: string): string {
  const detail = lastMessage ? ` Last status: ${lastMessage}.` : ''
  return `Managed Ollama model download stalled with no new progress. Check your network connection, then retry Local AI setup.${detail}`
}

function pullStallTimeoutMs(hasByteProgress: boolean): number {
  return hasByteProgress ? OLLAMA_PULL_STALL_TIMEOUT_POST_BYTES_MS : OLLAMA_PULL_STALL_TIMEOUT_PRE_BYTES_MS
}

export function normalizeTransportError(error: unknown): Error {
  if (isPullFailureError(error)) return error
  return createPullFailureError(...collectErrorDetails(error))
}

export function createPullFailureError(...details: string[]): Error {
  return buildPullFailureError(describePullFailure(...details))
}

function describePullFailure(...details: string[]): PullFailure {
  const rawDetail = preferredDetail(details)
  const debug = buildPullFailureDebug(details, rawDetail)
  if (isBlobHostFailure(details, debug)) {
    return {
      summary: 'Managed Ollama could not reach the model download host. Check your internet connection, VPN, or firewall, then retry Local AI setup.',
      detail: reachabilityDetail(debug, 'Download host'),
      debug,
      errorKind: 'pull_blob_host_network',
    }
  }
  if (matchesDetail(details, TIMEOUT_MARKERS)) {
    return {
      summary: 'Managed Ollama timed out while downloading the model. Check your network connection, then retry Local AI setup.',
      detail: reachabilityDetail(debug, 'Reachability target'),
      debug,
      errorKind: 'pull_timeout',
    }
  }
  if (matchesDetail(details, CONNECTIVITY_MARKERS)) {
    return {
      summary: 'Managed Ollama could not reach the model registry. Check your internet connection, VPN, or firewall, then retry Local AI setup.',
      detail: reachabilityDetail(debug, 'Reachability target'),
      debug,
      errorKind: 'pull_network',
    }
  }
  return { summary: rawDetail?.startsWith('Managed Ollama') ? rawDetail : 'Managed Ollama model download failed.', debug }
}

function collectErrorDetails(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return []
  seen.add(error)
  if (typeof error === 'string') return [error]
  if (typeof error !== 'object') return []
  const details = readNamedDetails(error)
  const cause = 'cause' in error ? error.cause : undefined
  return details.concat(collectErrorDetails(cause, seen)).filter((detail): detail is string => Boolean(detail?.trim()))
}

function readNamedDetails(error: object): Array<string | undefined> {
  return [readStringField(error, 'message'), readStringField(error, 'detail'), readStringField(error, 'code'), readStringField(error, 'name')]
}

function readStringField(value: object, key: 'code' | 'detail' | 'message' | 'name'): string | undefined {
  if (!(key in value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}

function buildPullFailureError(failure: PullFailure): Error {
  const error = new Error(failure.summary) as PullFailureError
  if (failure.detail) error.detail = failure.detail
  if (failure.debug) error.debug = failure.debug
  if (failure.errorKind) error.errorKind = failure.errorKind
  return error
}

function isPullFailureError(error: unknown): error is PullFailureError {
  return error instanceof Error && ('detail' in error || 'debug' in error || 'errorKind' in error)
}

function buildPullFailureDebug(details: string[], rawDetail?: string): OnboardingErrorDebug | undefined {
  const url = firstUrl(details)
  const host = urlHost(url) || firstHost(details)
  const ip = firstIp(details)
  const debug = { rawDetail: rawDetail || preferredDetail(details), url, host, ip }
  return Object.values(debug).some(Boolean) ? debug : undefined
}

function isBlobHostFailure(details: string[], debug?: OnboardingErrorDebug): boolean {
  const target = [debug?.host, debug?.url, ...details].filter(Boolean).join(' ').toLowerCase()
  return target.includes('cloudflarestorage.com') && (matchesDetail(details, TIMEOUT_MARKERS) || matchesDetail(details, CONNECTIVITY_MARKERS))
}

function reachabilityDetail(debug: OnboardingErrorDebug | undefined, label: string): string | undefined {
  if (!debug?.host && !debug?.ip) return undefined
  const target = debug.host && debug.ip ? `${debug.host} (${debug.ip})` : debug.host || debug.ip
  return `${label}: ${target}.`
}

function firstUrl(details: string[]): string | undefined {
  return details.join(' ').match(/https?:\/\/[^\s'"`]+/)?.[0]
}

function urlHost(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

function firstHost(details: string[]): string | undefined {
  return details.join(' ').match(/(?:lookup|host)\s+([a-z0-9.-]+\.[a-z]{2,})/i)?.[1]
}

function firstIp(details: string[]): string | undefined {
  return details.join(' ').match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)?.[0]
}

function firstDetail(details: string[]): string | undefined {
  return details.map((detail) => detail.trim()).find(Boolean)
}

function preferredDetail(details: string[]): string | undefined {
  return details.map((detail) => detail.trim()).find((detail) => detail && !isGenericDetail(detail)) || firstDetail(details)
}

function isGenericDetail(detail: string): boolean {
  const value = detail.trim().toLowerCase()
  return value === 'error' || value === 'typeerror' || value === 'fetch failed' || /^[a-z_]+(?:error)?$/.test(value)
}

function matchesDetail(details: string[], markers: string[]): boolean {
  const value = details.join(' ').toLowerCase()
  return markers.some((marker) => value.includes(marker))
}
