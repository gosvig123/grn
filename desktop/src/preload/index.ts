import { contextBridge, ipcRenderer } from 'electron'

type RecordingState = {
  status: 'idle' | 'recording' | 'stopping' | 'processing' | 'error'
  title?: string
  error?: string
}

type Device = {
  index: number
  name: string
}

type MeetingListItem = {
  id: string
  title: string
  startedAt: string
  endedAt?: string
  hasTranscript: boolean
  hasSummary: boolean
}

type MeetingSegment = {
  startSec: number
  endSec: number
  speaker: string
  text: string
}

type MeetingDetail = {
  id: string
  title: string
  startedAt: string
  endedAt?: string
  transcriptText?: string
  summary?: string
  segments: MeetingSegment[]
}

const api = {
  system: {
    getDevices: (): Promise<Device[]> => ipcRenderer.invoke('system:getDevices'),
    openPermissionsSettings: (): Promise<void> => ipcRenderer.invoke('system:openPermissionsSettings'),
  },
  meetings: {
    list: (): Promise<MeetingListItem[]> => ipcRenderer.invoke('meetings:list'),
    show: (id: string): Promise<MeetingDetail> => ipcRenderer.invoke('meetings:show', id),
  },
  recording: {
    start: (input: { title: string; device: number; mode: string; modelPath?: string }): Promise<RecordingState> =>
      ipcRenderer.invoke('recording:start', input),
    stop: (): Promise<RecordingState> => ipcRenderer.invoke('recording:stop'),
    getStatus: (): Promise<RecordingState> => ipcRenderer.invoke('recording:getStatus'),
    onStatusChanged: (listener: (state: RecordingState) => void): (() => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: RecordingState) => listener(state)
      ipcRenderer.on('recording:status-changed', wrapped)
      return () => ipcRenderer.removeListener('recording:status-changed', wrapped)
    },
  },
}

contextBridge.exposeInMainWorld('grn', api)

declare global {
  interface Window {
    grn: typeof api
  }
}
