import type { OnboardingPullStage } from '../shared/contracts'
import { createPullFailureError, createPullStallController } from './ollama-pull-errors'

export type PullProgressUpdate = {
  progress?: number
  message?: string
  pullStage?: OnboardingPullStage
  activity: boolean
}
type ParsedPullUpdate = PullProgressUpdate & { validEventSeen: boolean }
type ProgressCallback = (update: PullProgressUpdate) => void

type OllamaPullEvent = {
  status?: string
  error?: string
  digest?: string
  completed?: number
  total?: number
}
type PullLayerProgress = { completed: number; total: number }
type PullStreamState = {
  buffer: string
  sawSuccess: boolean
  lastBytes: number
  lastMessage?: string
  lastPullStage?: OnboardingPullStage
  maxProgress?: number
  layers: Map<string, PullLayerProgress>
}
type PullStallController = ReturnType<typeof createPullStallController>

export async function pullModelFromOllamaApi(endpoint: string, model: string, onProgress?: ProgressCallback): Promise<void> {
  const controller = new AbortController()
  const state: PullStreamState = { buffer: '', sawSuccess: false, lastBytes: 0, layers: new Map() }
  const stall = createPullStallController(controller, () => state.lastMessage, () => state.lastBytes > 0)
  try {
    stall.refresh()
    const response = await startPullRequest(endpoint, model, controller.signal, stall)
    await consumePullStream(response, state, stall, onProgress)
  } finally {
    stall.clear()
  }
}

async function startPullRequest(endpoint: string, model: string, signal: AbortSignal, stall: PullStallController): Promise<Response> {
  try {
    const response = await fetch(`${endpoint}/api/pull`, requestOptions(model, signal))
    if (!response.ok) throw new Error(await responseFailureMessage(response))
    if (!response.body) throw new Error('Managed Ollama model download failed before progress streaming started.')
    return response
  } catch (error) {
    throw stall.errorFor(error)
  }
}

function requestOptions(model: string, signal: AbortSignal): RequestInit {
  return {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
  }
}

async function consumePullStream(response: Response, state: PullStreamState, stall: PullStallController, onProgress?: ProgressCallback): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Managed Ollama model download stream was unavailable.')
  try {
    await readPullStream(reader, new TextDecoder(), state, stall, onProgress)
  } catch (error) {
    throw stall.errorFor(error)
  } finally {
    reader.releaseLock()
  }
  if (!state.sawSuccess) throw new Error('Managed Ollama model download ended before completion.')
}

async function readPullStream(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder, state: PullStreamState, stall: PullStallController, onProgress?: ProgressCallback): Promise<void> {
  stall.refresh()
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    if (processPullChunk(state, decoder.decode(chunk.value, { stream: true }), onProgress, stall)) stall.refresh()
  }
  if (processPullChunk(state, decoder.decode(), onProgress, stall)) stall.refresh()
  if (flushPullBuffer(state, onProgress, stall)) stall.refresh()
}

function processPullChunk(state: PullStreamState, chunk: string, onProgress?: ProgressCallback, stall?: PullStallController): boolean {
  if (!chunk) return false
  state.buffer += chunk
  const lines = state.buffer.split('\n')
  state.buffer = lines.pop() ?? ''
  return lines.map((line) => handlePullLine(state, line, onProgress, stall)).some(Boolean)
}

function flushPullBuffer(state: PullStreamState, onProgress?: ProgressCallback, stall?: PullStallController): boolean {
  const remainder = state.buffer.trim()
  state.buffer = ''
  return remainder ? handlePullLine(state, remainder, onProgress, stall) : false
}

function handlePullLine(state: PullStreamState, line: string, onProgress?: ProgressCallback, stall?: PullStallController): boolean {
  const event = parsePullEvent(line)
  if (event.error) throw createPullFailureError(event.error)
  const update = pullProgressUpdate(state, event)
  if (update.validEventSeen && state.lastBytes === 0) stall?.refresh()
  if (update.message) state.lastMessage = update.message
  if (update.pullStage === 'complete') state.sawSuccess = true
  onProgress?.(update)
  return update.activity
}

function parsePullEvent(line: string): OllamaPullEvent {
  const trimmed = line.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as OllamaPullEvent
    return validPullEvent(parsed) ? parsed : invalidPullEvent(trimmed)
  } catch {
    return invalidPullEvent(trimmed)
  }
}

function validPullEvent(event: OllamaPullEvent): boolean {
  return ['status', 'error', 'digest', 'completed', 'total'].some((key) => key in event)
}
function invalidPullEvent(line: string): never { throw new Error(`Managed Ollama returned an invalid pull event: ${line}`) }

function pullProgressUpdate(state: PullStreamState, event: OllamaPullEvent): ParsedPullUpdate {
  const pullStage = nextPullStage(event)
  const bytesProgressed = updateLayerProgress(state, event)
  const stageChanged = Boolean(pullStage && pullStage !== state.lastPullStage)
  if (stageChanged) state.lastPullStage = pullStage
  return {
    pullStage,
    activity: bytesProgressed || stageChanged,
    validEventSeen: true,
    progress: aggregateProgress(state, pullStage),
    message: pullEventMessage(event, pullStage),
  }
}

function updateLayerProgress(state: PullStreamState, event: OllamaPullEvent): boolean {
  if (typeof event.completed !== 'number' || typeof event.total !== 'number' || event.total <= 0) return false
  const key = (event.digest || normalizeStatus(event.status) || 'unknown').trim()
  const layer = state.layers.get(key) ?? { completed: 0, total: 0 }
  state.layers.set(key, { completed: Math.max(layer.completed, event.completed), total: Math.max(layer.total, event.total) })
  const totalBytes = Array.from(state.layers.values()).reduce((sum, next) => sum + Math.min(next.completed, next.total), 0)
  if (totalBytes <= state.lastBytes) return false
  state.lastBytes = totalBytes
  return true
}

function aggregateProgress(state: PullStreamState, pullStage?: OnboardingPullStage): number | undefined {
  const totals = Array.from(state.layers.values()).reduce((sum, next) => ({ completed: sum.completed + Math.min(next.completed, next.total), total: sum.total + next.total }), { completed: 0, total: 0 })
  if (!totals.total) return pullStage === 'complete' ? 100 : state.maxProgress
  const rawProgress = Math.round((totals.completed / totals.total) * 100)
  const nextProgress = Math.max(state.maxProgress ?? 0, pullStage === 'complete' ? 100 : Math.min(rawProgress, 99))
  state.maxProgress = nextProgress
  return nextProgress
}

function pullEventMessage(event: OllamaPullEvent, pullStage?: OnboardingPullStage): string | undefined {
  if (pullStage === 'complete') return 'Download complete'
  if (pullStage === 'downloading') return 'Downloading model'
  return mappedStatusMessage(normalizeStatus(event.status))
}

function nextPullStage(event: OllamaPullEvent): OnboardingPullStage | undefined {
  const status = normalizeStatus(event.status)
  if (status === 'success') return 'complete'
  if (typeof event.completed === 'number' && typeof event.total === 'number' && event.total > 0) return 'downloading'
  if (status === 'pulling manifest') return 'preparing'
  if (status.startsWith('pulling ')) return 'downloading'
  if (status === 'verifying sha256 digest') return 'verifying'
  if (status === 'writing manifest' || status === 'removing any unused layers') return 'finalizing'
  return undefined
}

function mappedStatusMessage(status: string): string | undefined {
  if (!status) return undefined
  if (status === 'pulling manifest') return 'Pulling manifest'
  if (status === 'verifying sha256 digest') return 'Verifying download'
  if (status === 'writing manifest') return 'Writing manifest'
  if (status === 'removing any unused layers') return 'Cleaning up'
  return titleCase(status)
}
function normalizeStatus(status: string | undefined): string { return status?.trim().toLowerCase() ?? '' }
function titleCase(value: string): string { return value.replace(/\b\w/g, (match) => match.toUpperCase()) }

async function responseFailureMessage(response: Response): Promise<string> {
  const detail = await response.text()
  return detail.trim() || `Managed Ollama model download failed with status ${response.status}.`
}
