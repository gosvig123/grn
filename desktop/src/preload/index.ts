import { contextBridge, ipcRenderer } from 'electron'
import type { Device, LocalAIStatus, MeetingDetail, MeetingListItem, OnboardingStatus, RecordingState } from '../shared/contracts'

const api = {
  system: {
    getDevices: (): Promise<Device[]> => ipcRenderer.invoke('system:getDevices'),
    requestCapturePermissions: (): Promise<{ microphone: string; screen: string }> => ipcRenderer.invoke('system:requestCapturePermissions'),
    openPermissionsSettings: (target?: 'microphone' | 'screen-recording'): Promise<void> => ipcRenderer.invoke('system:openPermissionsSettings', target),
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
  onboarding: {
    getStatus: (): Promise<OnboardingStatus> => ipcRenderer.invoke('onboarding:getStatus'),
    start: (): Promise<OnboardingStatus> => ipcRenderer.invoke('onboarding:start'),
    retry: (): Promise<OnboardingStatus> => ipcRenderer.invoke('onboarding:retry'),
    onStatusChanged: (listener: (state: OnboardingStatus) => void): (() => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: OnboardingStatus) => listener(state)
      ipcRenderer.on('onboarding:status-changed', wrapped)
      return () => ipcRenderer.removeListener('onboarding:status-changed', wrapped)
    },
  },
  settings: {
    getLocalAIStatus: (): Promise<LocalAIStatus> => ipcRenderer.invoke('settings:getLocalAIStatus'),
    repairLocalAI: (): Promise<LocalAIStatus> => ipcRenderer.invoke('settings:repairLocalAI'),
  },
}

contextBridge.exposeInMainWorld('grn', api)

declare global {
  interface Window {
    grn: typeof api
  }
}
