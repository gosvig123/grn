import type { OnboardingErrorDebug, OnboardingPhase, OnboardingStatus, OwnershipConflict } from '../shared/contracts'
import { classifyOnboardingErrorKind } from './onboarding-error'

type ErrorLike = Record<string, unknown>

export type OnboardingErrorState = {
  error: string
  errorDetail?: OnboardingStatus['errorDetail']
  debugDetail?: OnboardingStatus['debugDetail']
  errorDebug?: OnboardingStatus['errorDebug']
  errorKind: NonNullable<OnboardingStatus['errorKind']>
  ownershipConflict?: OnboardingStatus['ownershipConflict']
}

export function toOnboardingErrorState(error: unknown, phase: OnboardingPhase, fallback: string): OnboardingErrorState {
  const summary = normalizeText(readErrorString(error, 'message') || readErrorMessage(error) || fallback) || fallback
  const errorDetail = normalizeText(readErrorString(error, 'detail'))
  const errorDebug = readErrorDebug(error)
  const ownershipConflict = readOwnershipConflict(error)
  return {
    error: summary,
    errorDetail,
    debugDetail: errorDebug?.rawDetail,
    errorDebug,
    errorKind: classifyOnboardingErrorKind(summary, phase, errorDetail, errorDebug),
    ownershipConflict,
  }
}

function readErrorMessage(error: unknown): string | undefined {
  return typeof error === 'string' ? error : undefined
}

function readErrorString(error: unknown, key: 'detail' | 'message'): string | undefined {
  if (!error || typeof error !== 'object' || !(key in error)) return undefined
  const value = (error as ErrorLike)[key]
  return typeof value === 'string' ? value : undefined
}

function readOwnershipConflict(error: unknown): OwnershipConflict | undefined {
  if (!error || typeof error !== 'object' || !('ownershipConflict' in error)) return undefined
  const value = (error as ErrorLike).ownershipConflict
  if (!value || typeof value !== 'object') return undefined
  const pid = readNumber((value as ErrorLike).pid)
  const port = readNumber((value as ErrorLike).port)
  if (pid === undefined || port === undefined) return undefined
  const conflict = {
    pid,
    port,
    summary: readString((value as ErrorLike).summary),
    stopCommand: readString((value as ErrorLike).stopCommand),
  }
  return conflict
}

function readErrorDebug(error: unknown): OnboardingErrorDebug | undefined {
  if (!error || typeof error !== 'object' || !('debug' in error)) return undefined
  const value = (error as ErrorLike).debug
  if (!value || typeof value !== 'object') return undefined
  const debug = {
    rawDetail: readString((value as ErrorLike).rawDetail),
    url: readString((value as ErrorLike).url),
    host: readString((value as ErrorLike).host),
    ip: readString((value as ErrorLike).ip),
  }
  return Object.values(debug).some(Boolean) ? debug : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}
