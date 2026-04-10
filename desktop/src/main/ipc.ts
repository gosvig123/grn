import { BrowserWindow, ipcMain } from 'electron'
import { getDevices, listMeetings, showMeeting, startRecording, stopRecording } from './grn'
import { getRecordingState, onRecordingStateChange } from './state'

let registered = false

export function registerIpc(mainWindow: BrowserWindow): void {
  if (!registered) {
    ipcMain.handle('system:getDevices', () => getDevices())
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
    registered = true
  }

  onRecordingStateChange((state) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording:status-changed', state)
    }
  })
}
