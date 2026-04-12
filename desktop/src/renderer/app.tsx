import { useEffect, useMemo, useRef, useState } from 'react'
import { AppSidebar } from './components/app-sidebar'
import { getLocalAIContract, toStatusError, type LocalAIStatus, type OnboardingStatus } from './components/local-ai-contract'
import { isPermissionErrorMessage } from './components/meeting-status'
import { PermissionBanner } from './components/permission-banner'
import { MeetingsView } from './routes/meetings-view'
import { OnboardingView } from './routes/onboarding-view'
import { RecordView } from './routes/record-view'
import { SettingsView } from './routes/settings-view'
type RecordingState = Awaited<ReturnType<typeof window.grn.recording.getStatus>>
type Device = Awaited<ReturnType<typeof window.grn.system.getDevices>>[number]
type MeetingListItem = Awaited<ReturnType<typeof window.grn.meetings.list>>[number]
type MeetingDetail = Awaited<ReturnType<typeof window.grn.meetings.show>>
type View = 'record' | 'meetings' | 'settings'
const localAI = getLocalAIContract()

export function App() {
  const [view, setView] = useState<View>('record')
  const [devices, setDevices] = useState<Device[]>([])
  const [meetings, setMeetings] = useState<MeetingListItem[]>([])
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const selectedMeetingIdRef = useRef<string | null>(null)
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingDetail | null>(null)
  const [recording, setRecording] = useState<RecordingState>({ status: 'idle' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [device, setDevice] = useState(0)
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null)
  const [onboardingBusy, setOnboardingBusy] = useState(false)
  const [settingsStatus, setSettingsStatus] = useState<LocalAIStatus | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  function applySelectedMeetingId(id: string | null) {
    selectedMeetingIdRef.current = id
    setSelectedMeetingId(id)
  }
  async function refreshMeetings(preferredMeetingId?: string | null) {
    const items = await window.grn.meetings.list()
    setMeetings(items)
    const nextId = preferredMeetingId ?? selectedMeetingIdRef.current ?? items[0]?.id ?? null
    if (!nextId) {
      applySelectedMeetingId(null)
      setSelectedMeeting(null)
      return
    }
    applySelectedMeetingId(items.some((meeting) => meeting.id === nextId) ? nextId : items[0]?.id ?? null)
  }
  async function loadMeeting(id: string) {
    applySelectedMeetingId(id)
    setSelectedMeeting(await window.grn.meetings.show(id))
  }
  async function loadAppData() {
    const [deviceList, meetingList, recordingState] = await Promise.all([
      window.grn.system.getDevices(),
      window.grn.meetings.list(),
      window.grn.recording.getStatus(),
    ])
    setDevices(deviceList)
    setMeetings(meetingList)
    setRecording(recordingState)
    if (deviceList[0]) setDevice(deviceList[0].index)
    const initialMeetingId = recordingState.meetingId ?? meetingList[0]?.id ?? null
    applySelectedMeetingId(initialMeetingId)
    setSelectedMeeting(initialMeetingId ? await window.grn.meetings.show(initialMeetingId) : null)
  }
  async function loadSettingsStatus() {
    setSettingsLoading(true)
    try {
      setSettingsStatus(await localAI.settings.getLocalAIStatus())
    } catch (err) {
      setSettingsStatus(toStatusError(err))
    } finally {
      setSettingsLoading(false)
    }
  }
  useEffect(() => {
    let disposed = false
    const dispose = localAI.onboarding.onStatusChanged((status) => {
      if (!disposed) setOnboarding(status)
    })
    ;(async () => {
      try {
        const status = await localAI.onboarding.getStatus()
        if (!disposed) setOnboarding(status)
      } catch (err) {
        if (!disposed) setOnboarding(toStatusError(err))
      } finally {
        if (!disposed) setLoading(false)
      }
    })()
    return () => {
      disposed = true
      dispose()
    }
  }, [])

  useEffect(() => {
    if (onboarding?.phase !== 'ready') return
    let disposed = false
    const dispose = window.grn.recording.onStatusChanged(async (state) => {
      if (disposed) return
      setRecording(state)
      const meetingId = state.meetingId ?? selectedMeetingIdRef.current
      if (state.meetingId) applySelectedMeetingId(state.meetingId)
      if (meetingId) {
        await refreshMeetings(meetingId)
        if (!disposed) await loadMeeting(meetingId)
        return
      }
      if (state.status === 'idle' || state.status === 'error') await refreshMeetings()
    })
    void loadAppData().catch((err) => {
      if (!disposed) setError(err instanceof Error ? err.message : String(err))
    })
    return () => {
      disposed = true
      dispose()
    }
  }, [onboarding?.phase])

  useEffect(() => {
    if (onboarding?.phase === 'ready' && view === 'settings') void loadSettingsStatus()
  }, [onboarding?.phase, view])

  const canStart = devices.length > 0 && recording.status === 'idle'
  const canStop = ['recording', 'stopping', 'processing'].includes(recording.status)
  const transcript = useMemo(() => selectedMeeting?.transcriptText ?? '', [selectedMeeting])
  const bannerError = error ?? recording.error ?? null
  const isPermissionError = isPermissionErrorMessage(bannerError)

  async function handleStart() {
    try {
      setError(null)
      await window.grn.recording.start({ title: title.trim() || new Date().toLocaleString(), device, mode: 'both' })
      setView('record')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  async function handleStop() {
    try {
      setError(null)
      await window.grn.recording.stop()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  async function handleOpenPermissionsSettings() {
    try {
      await window.grn.system.openPermissionsSettings()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  async function runOnboarding(action: 'start' | 'retry') {
    setOnboardingBusy(true)
    try {
      setOnboarding(action === 'start' ? await localAI.onboarding.start() : await localAI.onboarding.retry())
    } catch (err) {
      setOnboarding(toStatusError(err))
    } finally {
      setOnboardingBusy(false)
    }
  }
  async function handleRepairLocalAI() {
    setSettingsBusy(true)
    try {
      const nextStatus = await localAI.settings.repairLocalAI()
      setSettingsStatus(nextStatus)
      setOnboarding(nextStatus)
    } catch (err) {
      setSettingsStatus(toStatusError(err))
    } finally {
      setSettingsBusy(false)
    }
  }

  if (loading || !onboarding) return <div className="screen-center">Loading Grn…</div>

  return (
    <div className="app-shell">
      <AppSidebar onboarding={onboarding} recording={recording} view={view} onViewChange={setView} />
      <main className="main-grid">
        {onboarding.phase !== 'ready' ? (
          <OnboardingView status={onboarding} busy={onboardingBusy} onStart={() => void runOnboarding('start')} onRetry={() => void runOnboarding('retry')} />
        ) : view === 'record' ? (
          <RecordView title={title} device={device} devices={devices} canStart={canStart} canStop={canStop} onTitleChange={setTitle} onDeviceChange={setDevice} onStart={() => void handleStart()} onStop={() => void handleStop()} />
        ) : view === 'meetings' ? (
          <MeetingsView meetings={meetings} selectedMeetingId={selectedMeetingId} selectedMeeting={selectedMeeting} transcript={transcript} onRefresh={() => void refreshMeetings()} onSelectMeeting={(id) => void loadMeeting(id)} />
        ) : (
          <SettingsView status={settingsStatus} loading={settingsLoading} busy={settingsBusy} onRepair={() => void handleRepairLocalAI()} />
        )}
        {onboarding.phase === 'ready' ? (
          <PermissionBanner error={bannerError} isPermissionError={isPermissionError} onRetry={() => void handleStart()} onOpenSettings={() => void handleOpenPermissionsSettings()} />
        ) : null}
      </main>
    </div>
  )
}
