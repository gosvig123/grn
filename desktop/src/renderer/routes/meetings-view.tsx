import { artifactLabel, meetingStatusLabel, processingStatusLabel } from '../components/meeting-status'

type MeetingListItem = Awaited<ReturnType<typeof window.grn.meetings.list>>[number]
type MeetingDetail = Awaited<ReturnType<typeof window.grn.meetings.show>>

type MeetingsViewProps = {
  meetings: MeetingListItem[]
  selectedMeetingId: string | null
  selectedMeeting: MeetingDetail | null
  transcript: string
  onRefresh: () => void
  onSelectMeeting: (id: string) => void
}

export function MeetingsView({ meetings, selectedMeetingId, selectedMeeting, transcript, onRefresh, onSelectMeeting }: MeetingsViewProps) {
  const selectedStatus = selectedMeeting?.status

  return (
    <>
      <section className="panel list-panel">
        <div className="panel-header compact">
          <div>
            <h1>Meetings</h1>
            <p>{meetings.length} saved</p>
          </div>
          <button className="secondary" onClick={onRefresh}>
            Refresh
          </button>
        </div>
        <div className="meeting-list">
          {meetings.map((meeting) => (
            <button
              key={meeting.id}
              className={meeting.id === selectedMeetingId ? 'meeting-row selected' : 'meeting-row'}
              onClick={() => onSelectMeeting(meeting.id)}
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
  )
}
