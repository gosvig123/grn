import { spawn } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'
import { getRecordingState, setRecordingState } from './state'

export type Device = {
  index: number
  name: string
}

export type MeetingStatus = {
  state: 'recording' | 'processing' | 'completed' | 'failed'
  updatedAt: string
  failureMessage?: string
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
  const child = spawn(resolveGrnBinary(), args, {
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  recordingChild = child
  setRecordingState({ status: 'recording', title: input.title })

  const markProcessing = () => {
    const current = getRecordingState()
    if (current.status === 'stopping') {
      setRecordingState({ status: 'processing', title: current.title })
    }
  }

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('Stopping...')) {
      setRecordingState({ status: 'stopping', title: input.title })
      return
    }
    if (text.includes('Transcribing') || text.includes('Enhancing')) {
      setRecordingState({ status: 'processing', title: input.title })
    }
  })

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
    markProcessing()
  })

  child.on('error', (error) => {
    recordingChild = null
    setRecordingState({ status: 'error', title: input.title, error: error.message })
  })

  child.on('exit', (code, signal) => {
    recordingChild = null
    if (code === 0) {
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

function formatChildError(stderr: string, code: number | null, signal: NodeJS.Signals | null): string {
  const cleaned = stderr.trim()
  if (cleaned) {
    const lines = cleaned.split('\n').filter(Boolean)
    return lines.slice(-8).join('\n')
  }
  return code === null ? `Process exited with signal ${signal}` : `Process exited with code ${code}`
}
