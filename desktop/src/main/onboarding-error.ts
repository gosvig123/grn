import type { OnboardingErrorDebug, OnboardingErrorKind, OnboardingPhase } from '../shared/contracts'

const BLOB_HOST_HINTS = ['cloudflarestorage.com']
const DISK_SPACE_HINTS = ['no space', 'disk full', 'enospc', 'not enough space']
const NETWORK_HINTS = ['network', 'connection', 'dns', 'econn', 'socket', 'fetch', 'registry', 'dial tcp', 'connection refused', 'no such host', 'network is unreachable']
const OWNERSHIP_HINTS = ['another ollama process', 'app-owned runtime', 'ownership mismatch', '127.0.0.1:11435']
const PERMISSION_HINTS = ['permission denied', 'operation not permitted', 'access denied', 'eacces']
const TIMEOUT_HINTS = ['i/o timeout', 'timed out', 'timeout', 'pull stalled', 'stalled with no new progress']

export function classifyOnboardingErrorKind(message: string | undefined, phase: OnboardingPhase, detail?: string, debug?: OnboardingErrorDebug): OnboardingErrorKind {
  const value = normalizeErrorText([message, detail, debug?.rawDetail, debug?.host, debug?.url, debug?.ip].filter(Boolean).join(' '))
  if (matchesAny(value, DISK_SPACE_HINTS)) return 'disk_space'
  if (matchesAny(value, OWNERSHIP_HINTS)) return 'ownership_mismatch'
  if (matchesAny(value, PERMISSION_HINTS)) return 'permission'
  if (phase === 'pulling_model' && matchesAny(value, BLOB_HOST_HINTS) && (matchesAny(value, TIMEOUT_HINTS) || matchesAny(value, NETWORK_HINTS))) return 'pull_blob_host_network'
  if (phase === 'pulling_model' && matchesAny(value, TIMEOUT_HINTS)) return 'pull_timeout'
  if (phase === 'pulling_model' && matchesAny(value, NETWORK_HINTS)) return 'pull_network'
  return 'runtime'
}

function normalizeErrorText(message: string | undefined): string {
  return (message || '').trim().toLowerCase()
}

function matchesAny(value: string, hints: string[]): boolean {
  return hints.some((hint) => value.includes(hint))
}
