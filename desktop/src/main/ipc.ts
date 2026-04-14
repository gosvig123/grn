import { BrowserWindow, ipcMain, shell } from 'electron'
import { getDevices, listMeetings, requestCapturePermissions, showMeeting, startRecording, stopRecording } from './grn'
import { getLocalAIStatus, getOnboardingStatus, onOnboardingStatusChange, repairLocalAI, retryOnboarding, startOnboarding } from './onboarding'
import { getRecordingState, onRecordingStateChange } from './state'

let registered = false

export function registerIpc(mainWindow: BrowserWindow): void {
  if (!registered) {
    ipcMain.handle('system:getDevices', () => getDevices())
    ipcMain.handle('system:requestCapturePermissions', () => requestCapturePermissions())
    ipcMain.handle('system:openPermissionsSettings', async (_event, target?: 'microphone' | 'screen-recording') => {
      const urls: Record<string, string> = {
        'microphone': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
        'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      }
      const url = (target && urls[target]) ?? 'x-apple.systempreferences:com.apple.preference.security'
      await shell.openExternal(url, { activate: true })
    })
    ipcMain.handle('meetings:list', () => listMeetings())
    ipcMain.handle('meetings:show', (_event, id: string) => showMeeting(id))
    ipcMain.handle('recording:start', (_event, input) => {
      startRecording(input)
      return getRecordingState()
    })
    ipcMain.handle('recording:stop', () => {
      stopRecording()
      return getRecordingState()
    })
    ipcMain.handle('recording:getStatus', () => getRecordingState())
    ipcMain.handle('onboarding:getStatus', () => getOnboardingStatus())
    ipcMain.handle('onboarding:start', () => startOnboarding())
    ipcMain.handle('onboarding:retry', () => retryOnboarding())
    ipcMain.handle('settings:getLocalAIStatus', () => getLocalAIStatus())
    ipcMain.handle('settings:repairLocalAI', () => repairLocalAI())
    registered = true
  }

  onRecordingStateChange((state) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording:status-changed', state)
    }
  })

  onOnboardingStatusChange((state) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('onboarding:status-changed', state)
    }
  })
}
