import { onboardingErrorView, onboardingMessageView, onboardingPhaseLabel, onboardingStatusTone, type OnboardingStatus } from './local-ai-contract'

type RecordingState = Awaited<ReturnType<typeof window.grn.recording.getStatus>>
type View = 'record' | 'meetings' | 'settings'

type AppSidebarProps = {
  onboarding: OnboardingStatus
  recording: RecordingState
  view: View
  onViewChange: (view: View) => void
}

function progressSummary(status: OnboardingStatus): string | null {
  if (typeof status.progress !== 'number' || status.phase === 'ready') return null
  return `${Math.max(0, Math.min(100, status.progress))}% complete`
}

function statusSummary(status: OnboardingStatus): string | null {
  const progress = progressSummary(status)
  const message = onboardingMessageView(status)?.compact
  if (!progress) return message || null
  return message ? `${progress} · ${message}` : progress
}

export function AppSidebar({ onboarding, recording, view, onViewChange }: AppSidebarProps) {
  const errorView = onboardingErrorView(onboarding)
  const summary = errorView ? null : statusSummary(onboarding)
  return (
    <aside className="sidebar">
      <div>
        <div className="brand">Grn</div>
        <div className="subtitle">Desktop meeting recorder</div>
      </div>

      {onboarding.phase === 'ready' ? (
        <nav className="nav">
          <button className={view === 'record' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('record')}>
            Record
          </button>
          <button className={view === 'meetings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('meetings')}>
            Meetings
          </button>
          <button className={view === 'settings' ? 'nav-btn active' : 'nav-btn'} onClick={() => onViewChange('settings')}>
            Settings
          </button>
        </nav>
      ) : (
        <nav className="nav">
          <button className="nav-btn active">Setup</button>
        </nav>
      )}

      <div className="status-card">
        <div className="label">Local AI</div>
        <div className={`status-pill ${onboardingStatusTone(onboarding.phase)}`}>{onboardingPhaseLabel(onboarding.phase)}</div>
        {onboarding.model ? <div className="muted">{onboarding.model}</div> : null}
        {summary ? <div className="muted">{summary}</div> : null}
        {onboarding.phase === 'ready' && onboarding.endpoint ? <div className="muted">{onboarding.endpoint}</div> : null}
        {errorView ? <div className="error-text">{errorView.compact}</div> : null}
      </div>

      {onboarding.phase === 'ready' ? (
        <div className="status-card">
          <div className="label">Recorder</div>
          <div className={`status-pill ${recording.status}`}>{recording.status}</div>
          {recording.title ? <div className="muted">{recording.title}</div> : null}
          {recording.meetingId ? <div className="muted">{recording.meetingId}</div> : null}
          {recording.error ? <div className="error-text">{recording.error}</div> : null}
        </div>
      ) : null}
    </aside>
  )
}
