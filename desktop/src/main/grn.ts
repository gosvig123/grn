import { spawn } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'
import { getRecordingState, setRecordingState, type RecordingState } from './state'

export type Device = {
  index: number
  name: string
}

export type CaptureStatus = 'recording' | 'captured' | 'failed'
export type ProcessingStatus = 'not_started' | 'processing' | 'completed' | 'failed'

export type MeetingStatus = {
  state: 'recording' | 'captured' | 'processing' | 'completed' | 'failed'
  updatedAt: string
  capture: {
    state: CaptureStatus
    updatedAt: string
    failureMessage?: string
  }
  processing: {
    state: ProcessingStatus
    updatedAt: string
    failureMessage?: string
  }
}

export type MeetingListItem = {
  id: string
  title: string
  startedAt: string
  endedAt?: string
  status: MeetingStatus
  hasTranscript: boolean
  hasSummary: boolean
}

export type MeetingSegment = {
  startSec: number
  endSec: number
  speaker: string
  text: string
}

export type MeetingDetail = {
  id: string
  title: string
  startedAt: string
  endedAt?: string
  status: MeetingStatus
  transcriptText?: string
  summary?: string
  segments: MeetingSegment[]
}

type DevicesResponse = { devices: Device[] }
type MeetingsResponse = { meetings: MeetingListItem[] }
type MeetingResponse = { meeting: MeetingDetail }
type RecordingProtocolEvent = {
  type: 'recording.started' | 'recording.stopping' | 'recording.processing' | 'recording.completed' | 'recording.failed'
  meetingId: string
  title: string
  status: MeetingStatus
  error?: string
}

let recordingChild: ReturnType<typeof spawn> | null = null

export function resolveGrnBinary(): string {
  const override = process.env.GRN_BINARY_PATH
  if (override) return override
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', 'grn')
  return path.resolve(__dirname, '../../..', 'build', 'grn')
}

export async function getDevices(): Promise<Device[]> {
  const result = await runJSON<DevicesResponse>(['app', 'devices', '--json'])
  return result.devices
}

export async function listMeetings(): Promise<MeetingListItem[]> {
  const result = await runJSON<MeetingsResponse>(['app', 'meetings', 'list', '--json'])
  return result.meetings
}

export async function showMeeting(id: string): Promise<MeetingDetail> {
  const result = await runJSON<MeetingResponse>(['app', 'meetings', 'show', id, '--json'])
  return result.meeting
}

export function startRecording(input: { title: string; device: number; mode: string; modelPath?: string }): void {
  if (recordingChild) throw new Error('A recording is already running')

  const args = ['app', 'record', 'start', '--title', input.title, '--device', String(input.device), '--mode', input.mode]
  if (input.modelPath) args.push('--model', input.modelPath)

  let stderr = ''
  let stdoutBuffer = ''
  let sawTerminalEvent = false
  let sawProtocolEvent = false
  let protocolError: string | null = null
  const child = spawn(resolveGrnBinary(), args, {
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  recordingChild = child

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const event = parseRecordingProtocolEvent(trimmed)
      if (!event) {
        protocolError = `Invalid recording protocol event: ${trimmed}`
        continue
      }
      sawProtocolEvent = true
      if (isTerminalProtocolEvent(event.type)) sawTerminalEvent = true
      setRecordingState(recordingStateFromEvent(event))
    }
  })

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  child.on('error', (error) => {
    recordingChild = null
    setRecordingState({ status: 'error', title: input.title, error: error.message })
  })

  child.on('exit', (code, signal) => {
    recordingChild = null
    if (sawTerminalEvent) return
    if (protocolError) {
      setRecordingState({ status: 'error', title: input.title, error: protocolError })
      return
    }
    if (stdoutBuffer.trim()) {
      setRecordingState({
        status: 'error',
        title: input.title,
        error: `Incomplete recording protocol event: ${stdoutBuffer.trim()}`,
      })
      return
    }
    if (code === 0 && !sawProtocolEvent) {
      setRecordingState({ status: 'idle' })
      return
    }
    if (signal === 'SIGINT' && getRecordingState().status !== 'error') {
      setRecordingState({ status: 'idle' })
      return
    }
    setRecordingState({
      status: 'error',
      title: input.title,
      error: formatChildError(stderr, code, signal),
    })
  })
}

export function stopRecording(): void {
  if (!recordingChild) return
  setRecordingState({ ...getRecordingState(), status: 'stopping' })
  recordingChild.kill('SIGINT')
}

export async function runJSON<T>(args: string[]): Promise<T> {
  const output = await runCommand(args)
  return JSON.parse(output) as T
}

function runCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveGrnBinary(), args, {
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(stderr || stdout || `grn exited with code ${code}`))
    })
  })
}

function childEnv(): NodeJS.ProcessEnv {
  const pathParts = [
    process.env.PATH ?? '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]

  return {
    ...process.env,
    PATH: Array.from(new Set(pathParts.filter(Boolean))).join(':'),
  }
}

function parseRecordingProtocolEvent(line: string): RecordingProtocolEvent | null {
  try {
    const parsed = JSON.parse(line) as Partial<RecordingProtocolEvent>
    if (!parsed.type || !parsed.meetingId || !parsed.title || !parsed.status) return null
    if (!isProtocolEventType(parsed.type)) return null
    return parsed as RecordingProtocolEvent
  } catch {
    return null
  }
}

function isProtocolEventType(value: string): value is RecordingProtocolEvent['type'] {
  return [
    'recording.started',
    'recording.stopping',
    'recording.processing',
    'recording.completed',
    'recording.failed',
  ].includes(value)
}

function isTerminalProtocolEvent(type: RecordingProtocolEvent['type']): boolean {
  return type === 'recording.completed' || type === 'recording.failed'
}

function recordingStateFromEvent(event: RecordingProtocolEvent): RecordingState {
  const base = { meetingId: event.meetingId, title: event.title }
  switch (event.type) {
    case 'recording.started':
      return { ...base, status: 'recording' }
    case 'recording.stopping':
      return { ...base, status: 'stopping' }
    case 'recording.processing':
      return { ...base, status: 'processing' }
    case 'recording.completed':
      return { ...base, status: 'idle' }
    case 'recording.failed':
      return { ...base, status: 'error', error: event.error ?? protocolFailureMessage(event.status) }
  }
}

function protocolFailureMessage(status: MeetingStatus): string {
  return status.capture.failureMessage ?? status.processing.failureMessage ?? 'Recording failed'
}

function formatChildError(stderr: string, code: number | null, signal: NodeJS.Signals | null): string {
  const cleaned = stderr.trim()
  if (cleaned) {
    const lines = cleaned.split('\n').filter(Boolean)
    return lines.slice(-8).join('\n')
  }
  return code === null ? `Process exited with signal ${signal}` : `Process exited with code ${code}`
}
