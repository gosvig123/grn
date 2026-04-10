import { useEffect, useMemo, useRef, useState } from 'react'

type RecordingState = Awaited<ReturnType<typeof window.grn.recording.getStatus>>
type Device = Awaited<ReturnType<typeof window.grn.system.getDevices>>[number]
type MeetingListItem = Awaited<ReturnType<typeof window.grn.meetings.list>>[number]
type MeetingDetail = Awaited<ReturnType<typeof window.grn.meetings.show>>

type View = 'record' | 'meetings'

function meetingStatusLabel(state: MeetingStatus['state']): string {
  switch (state) {
    case 'recording':
      return 'Recording'
    case 'captured':
      return 'Captured'
    case 'processing':
      return 'Processing'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
  }
}

function processingStatusLabel(state: MeetingStatus['processing']['state']): string {
  switch (state) {
    case 'not_started':
      return 'Not started'
    case 'processing':
      return 'Processing'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
  }
}

function artifactLabel(ready: boolean, present: string, missing: string): string {
  return ready ? present : missing
}

const permissionErrorHints = [
  'permission denied',
  'microphone access denied',
  'screen recording access required',
  'grant permission:',
  'privacy & security',
]

function isPermissionErrorMessage(message: string | null | undefined): boolean {
  if (!message) return false
  const normalized = message.toLowerCase()
  return permissionErrorHints.some((hint) => normalized.includes(hint))
}

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
  const [mode, setMode] = useState('both')

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
    const resolvedId = items.some((meeting) => meeting.id === nextId) ? nextId : items[0]?.id ?? null
    applySelectedMeetingId(resolvedId)
  }

  async function loadMeeting(id: string) {
    applySelectedMeetingId(id)
    setSelectedMeeting(await window.grn.meetings.show(id))
  }

  useEffect(() => {
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
      if (state.status === 'idle' || state.status === 'error') {
        await refreshMeetings()
      }
    })

    ;(async () => {
      try {
        const [deviceList, meetingList, recordingState] = await Promise.all([
          window.grn.system.getDevices(),
          window.grn.meetings.list(),
          window.grn.recording.getStatus(),
        ])
        if (disposed) return
        setDevices(deviceList)
        setMeetings(meetingList)
        setRecording(recordingState)
        if (deviceList[0]) setDevice(deviceList[0].index)
        const initialMeetingId = recordingState.meetingId ?? meetingList[0]?.id ?? null
        applySelectedMeetingId(initialMeetingId)
        if (initialMeetingId) {
          setSelectedMeeting(await window.grn.meetings.show(initialMeetingId))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    })()

    return () => {
      disposed = true
      dispose()
    }
  }, [])

  const canStart = devices.length > 0 && recording.status === 'idle'
  const canStop = recording.status === 'recording' || recording.status === 'stopping' || recording.status === 'processing'
  const transcript = useMemo(() => selectedMeeting?.transcriptText ?? '', [selectedMeeting])
  const selectedStatus = selectedMeeting?.status
  const bannerError = error ?? recording.error ?? null
  const isPermissionError = isPermissionErrorMessage(bannerError)

  async function handleStart() {
    try {
      setError(null)
      await window.grn.recording.start({
        title: title.trim() || new Date().toLocaleString(),
        device,
        mode,
      })
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

  if (loading) return <div className="screen-center">Loading Grn…</div>

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">Grn</div>
          <div className="subtitle">Desktop meeting recorder</div>
        </div>
        <nav className="nav">
          <button className={view === 'record' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('record')}>
            Record
          </button>
          <button className={view === 'meetings' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('meetings')}>
            Meetings
          </button>
        </nav>
        <div className="status-card">
          <div className="label">Status</div>
          <div className={`status-pill ${recording.status}`}>{recording.status}</div>
          {recording.title ? <div className="muted">{recording.title}</div> : null}
          {recording.meetingId ? <div className="muted">{recording.meetingId}</div> : null}
          {recording.error ? <div className="error-text">{recording.error}</div> : null}
        </div>
      </aside>

      <main className="main-grid">
        {view === 'record' ? (
          <section className="panel panel-large">
            <div className="panel-header">
              <div>
                <h1>Record</h1>
                <p>Start and stop meeting recording using the existing grn backend.</p>
              </div>
            </div>

            <div className="form-grid">
              <label>
                <span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sprint planning" />
              </label>
              <label>
                <span>Device</span>
                <select value={device} onChange={(e) => setDevice(Number(e.target.value))}>
                  {devices.map((d) => (
                    <option key={d.index} value={d.index}>
                      [{d.index}] {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Mode</span>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="both">both</option>
                  <option value="mic">mic</option>
                  <option value="system">system</option>
                </select>
              </label>
            </div>

            <div className="actions-row">
              <button className="primary" onClick={handleStart} disabled={!canStart}>
                Start recording
              </button>
              <button className="secondary" onClick={handleStop} disabled={!canStop}>
                Stop recording
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="panel list-panel">
              <div className="panel-header compact">
                <div>
                  <h1>Meetings</h1>
                  <p>{meetings.length} saved</p>
                </div>
                <button className="secondary" onClick={() => void refreshMeetings()}>
                  Refresh
                </button>
              </div>
              <div className="meeting-list">
                {meetings.map((meeting) => (
                  <button
                    key={meeting.id}
                    className={meeting.id === selectedMeetingId ? 'meeting-row selected' : 'meeting-row'}
                    onClick={() => void loadMeeting(meeting.id)}
                  >
                    <div className="meeting-title">{meeting.title}</div>
                    <div className="meeting-meta">{new Date(meeting.startedAt).toLocaleString()}</div>
                    <div className="meeting-flags">
                      <span>Capture: {meetingStatusLabel(meeting.status.capture.state)}</span>
                      <span>AI: {processingStatusLabel(meeting.status.processing.state)}</span>
                      <span>{artifactLabel(meeting.hasTranscript, 'Transcript', 'No transcript')}</span>
                      <span>{artifactLabel(meeting.hasSummary, 'AI summary', 'No summary')}</span>
                    </div>
                  </button>
                ))}
                {meetings.length === 0 ? <div className="empty-state">No meetings yet.</div> : null}
              </div>
            </section>

            <section className="panel detail-panel">
              {selectedMeeting ? (
                <>
                  <div className="panel-header">
                    <div>
                      <h1>{selectedMeeting.title}</h1>
                      <p>{new Date(selectedMeeting.startedAt).toLocaleString()}</p>
                      {selectedStatus ? (
                        <>
                          <p>
                            Capture {meetingStatusLabel(selectedStatus.capture.state)} · updated{' '}
                            {new Date(selectedStatus.capture.updatedAt).toLocaleString()}
                          </p>
                          <p>
                            AI {processingStatusLabel(selectedStatus.processing.state)} · updated{' '}
                            {new Date(selectedStatus.processing.updatedAt).toLocaleString()}
                          </p>
                        </>
                      ) : null}
                      {selectedStatus?.capture.failureMessage ? <p>{selectedStatus.capture.failureMessage}</p> : null}
                      {selectedStatus?.processing.failureMessage ? <p>{selectedStatus.processing.failureMessage}</p> : null}
                    </div>
                  </div>
                  <div className="detail-grid">
                    <div className="detail-block">
                      <h2>AI summary</h2>
                      <pre>{selectedMeeting.summary || 'No AI summary yet.'}</pre>
                    </div>
                    <div className="detail-block">
                      <h2>Transcript</h2>
                      <pre>{transcript || 'No transcript yet.'}</pre>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">Select a meeting to view details.</div>
              )}
            </section>
          </>
        )}

        {bannerError ? (
          <div className="banner error">
            <div>{bannerError}</div>
            {isPermissionError ? (
              <>
                <div>
                  Enable GrnCapture in macOS Privacy &amp; Security, then try again. Screen Recording changes may
                  require quitting and reopening the app before retrying.
                </div>
                <div className="actions-row banner-actions">
                  <button className="primary" onClick={() => void handleStart()}>
                    Try again
                  </button>
                  <button className="secondary" onClick={() => void handleOpenPermissionsSettings()}>
                    Open System Settings
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  )
}
