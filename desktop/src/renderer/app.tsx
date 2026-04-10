import { useEffect, useMemo, useRef, useState } from 'react'

type RecordingState = Awaited<ReturnType<typeof window.grn.recording.getStatus>>
type Device = Awaited<ReturnType<typeof window.grn.system.getDevices>>[number]
type MeetingListItem = Awaited<ReturnType<typeof window.grn.meetings.list>>[number]
type MeetingDetail = Awaited<ReturnType<typeof window.grn.meetings.show>>

type View = 'record' | 'meetings'

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

  async function refreshMeetings() {
    const items = await window.grn.meetings.list()
    setMeetings(items)
    if (!selectedMeetingIdRef.current && items[0]) {
      selectedMeetingIdRef.current = items[0].id
      setSelectedMeetingId(items[0].id)
    }
  }

  async function loadMeeting(id: string) {
    selectedMeetingIdRef.current = id
    setSelectedMeetingId(id)
    setSelectedMeeting(await window.grn.meetings.show(id))
  }

  useEffect(() => {
    let disposed = false
    const dispose = window.grn.recording.onStatusChanged(async (state) => {
      if (disposed) return
      setRecording(state)
      if (state.status === 'idle' || state.status === 'error') {
        await refreshMeetings()
        if (selectedMeetingIdRef.current) await loadMeeting(selectedMeetingIdRef.current)
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
        if (meetingList[0]) {
          selectedMeetingIdRef.current = meetingList[0].id
          setSelectedMeetingId(meetingList[0].id)
          setSelectedMeeting(await window.grn.meetings.show(meetingList[0].id))
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
                      <span>{meeting.hasTranscript ? 'Transcript' : 'No transcript'}</span>
                      <span>{meeting.hasSummary ? 'AI summary' : 'No summary'}</span>
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

        {error ? <div className="banner error">{error}</div> : null}
      </main>
    </div>
  )
}
