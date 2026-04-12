import '../components/local-ai.css'

import { onboardingErrorView, onboardingPhaseLabel, onboardingStatusTone, type LocalAIStatus } from '../components/local-ai-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'

type SettingsViewProps = {
  status: LocalAIStatus | null
  loading: boolean
  busy: boolean
  onRepair: () => void
}

function flagLabel(status: LocalAIStatus | null, key: 'supported' | 'configured' | 'bundled' | 'running'): string {
  if (!status) return 'Unknown'
  return status[key] ? 'Yes' : 'No'
}

export function SettingsView({ status, loading, busy, onRepair }: SettingsViewProps) {
  const errorView = onboardingErrorView(status)
  return (
    <section className="panel panel-large settings-stack">
      <div className="panel-header">
        <div>
          <h1>Settings</h1>
          <p>Local AI runtime on this Mac.</p>
        </div>
        <div className={`status-pill ${status ? onboardingStatusTone(status.phase) : 'processing'}`}>
          {loading ? 'Checking' : onboardingPhaseLabel(status?.phase ?? 'checking')}
        </div>
      </div>

      <div className="settings-grid">
        <div className="metric-card">
          <div className="label">Supported</div>
          <div className="value">{flagLabel(status, 'supported')}</div>
        </div>
        <div className="metric-card">
          <div className="label">Configured</div>
          <div className="value">{flagLabel(status, 'configured')}</div>
        </div>
        <div className="metric-card">
          <div className="label">Bundled</div>
          <div className="value">{flagLabel(status, 'bundled')}</div>
        </div>
        <div className="metric-card">
          <div className="label">Running</div>
          <div className="value">{flagLabel(status, 'running')}</div>
        </div>
        <div className="metric-card">
          <div className="label">Model</div>
          <div className="value">{status?.model || 'Unknown'}</div>
        </div>
        <div className="metric-card">
          <div className="label">Endpoint</div>
          <div className="value">{status?.endpoint || 'Unknown'}</div>
        </div>
      </div>

      <div className="status-note">{status?.message || 'Check local AI status and repair the managed runtime if needed.'}</div>
      {errorView ? <LocalAIErrorBanner errorView={errorView} /> : null}

      <div className="actions-row">
        <button className="primary" onClick={onRepair} disabled={loading || busy || Boolean(status && !status.canRepair)}>
          {busy ? 'Repairing...' : 'Repair local AI'}
        </button>
      </div>
    </section>
  )
}
