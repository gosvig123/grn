import '../components/local-ai.css'

import {
  onboardingErrorView,
  onboardingMessageView,
  onboardingPhaseLabel,
  onboardingStatusTone,
  type OnboardingStatus,
} from '../components/local-ai-contract'
import { LocalAIErrorBanner } from '../components/local-ai-error-banner'

type OnboardingViewProps = {
  status: OnboardingStatus
  busy: boolean
  onStart: () => void
  onRetry: () => void
}

type SetupActionsProps = {
  busy: boolean
  isReady: boolean
  label: string
  hint?: string
  showRetry: boolean
  onAction: () => void
  onRetry: () => void
}

type SetupProgressCardProps = {
  status: OnboardingStatus
  copy: OnboardingPhaseCopy
}

type OnboardingPhaseCopy = {
  headline: string
  detail: string
  progressDetail: string
  actionLabel: string
  actionHint?: string
}

const PHASE_COPY: Record<OnboardingStatus['phase'], OnboardingPhaseCopy> = {
  checking: { headline: 'Checking your local AI setup.', detail: 'Looking for the bundled Ollama runtime and any model files already on this Mac.', progressDetail: 'Confirming what is already installed before setup continues.', actionLabel: 'Checking setup...' },
  needs_setup: { headline: 'Install once. Keep recordings local.', detail: 'Start the bundled Ollama runtime and download the recommended model for this Mac.', progressDetail: 'Setup will download the model, then save the local runtime settings.', actionLabel: 'Set up local AI' },
  starting_ollama: { headline: 'Starting the bundled Ollama runtime.', detail: 'Granola is launching the managed local service used for recordings on this Mac.', progressDetail: 'This step usually finishes quickly once the local runtime is ready.', actionLabel: 'Starting Ollama...' },
  pulling_model: { headline: 'Downloading the recommended local model.', detail: 'First-time setup can take several minutes depending on your connection and disk speed.', progressDetail: 'Keep Granola open while the download continues in the background.', actionLabel: 'Downloading model...', actionHint: 'Large model downloads can look quiet between updates. Granola keeps working until setup finishes or an error appears.' },
  saving_config: { headline: 'Finishing local AI setup.', detail: 'The download is done. Granola is saving the managed runtime settings for future recordings.', progressDetail: 'Almost done. This step stores the bundled runtime configuration.', actionLabel: 'Finishing setup...' },
  ready: { headline: 'Local AI is ready.', detail: 'The bundled Ollama runtime is configured and recordings stay on this Mac.', progressDetail: 'Setup complete. You can start using local AI now.', actionLabel: 'Ready' },
  error: { headline: 'Local AI setup needs attention.', detail: 'Setup stopped before the bundled Ollama flow finished. Review the error and try again.', progressDetail: 'Setup paused because an error interrupted the managed runtime flow.', actionLabel: 'Retry setup' },
}

function hasNumericProgress(status: OnboardingStatus): status is OnboardingStatus & { progress: number } {
  return typeof status.progress === 'number'
}

function progressValue(progress: number): number {
  return Math.max(0, Math.min(100, progress))
}

function phaseCopy(status: OnboardingStatus): OnboardingPhaseCopy {
  return PHASE_COPY[status.phase]
}

function progressLabel(status: OnboardingStatus): string {
  if (status.phase === 'ready') return 'Complete'
  if (status.phase === 'error') return 'Stopped'
  return 'Working'
}

function planMetrics(status: OnboardingStatus): Array<{ label: string; value: string }> {
  return [
    { label: 'Mode', value: status.managed ? 'Managed' : 'External' },
    { label: 'Model', value: status.model || 'Recommended default' },
    { label: 'Endpoint', value: status.endpoint || 'Configured during setup' },
    { label: 'Updates', value: 'Live phase events' },
  ]
}

function SetupActions({ busy, isReady, label, hint, showRetry, onAction, onRetry }: SetupActionsProps) {
  return (
    <>
      <div className="actions-row">
        <button className="primary" onClick={onAction} disabled={busy || isReady}>{label}</button>
        {showRetry ? <button className="secondary" onClick={onRetry} disabled={busy}>Retry</button> : null}
      </div>
      {hint ? <div className="action-copy">{hint}</div> : null}
    </>
  )
}

function SetupProgressCard({ status, copy }: SetupProgressCardProps) {
  const progress = status.phase === 'ready' ? 100 : hasNumericProgress(status) ? progressValue(status.progress) : null
  const messageView = onboardingMessageView(status)
  return (
    <div className="progress-block setup-card">
      <div className="progress-head">
        <span className="label">Progress</span>
        <span className="progress-copy">{progress === null ? progressLabel(status) : `${progress}%`}</span>
      </div>
      <div className={`progress-track${progress === null ? ' indeterminate' : ''}`}>
        <div className={`progress-fill${progress === null ? ' indeterminate' : ''}`} style={progress === null ? undefined : { width: `${progress}%` }} />
      </div>
      <div className="progress-copy">{copy.progressDetail}</div>
      {messageView ? (
        <div className="setup-progress-detail">
          <div className="label">Latest update</div>
          <div className="setup-progress-headline">{messageView.headline}</div>
          {messageView.detail ? <div className="progress-copy">{messageView.detail}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function SetupPlanRail({ status }: Pick<OnboardingViewProps, 'status'>) {
  return (
    <aside className="setup-panel setup-rail settings-stack">
      <div><h2>Plan</h2><p>One managed model. No picker in this flow.</p></div>
      <div className="setup-metrics">
        {planMetrics(status).map((metric) => (
          <div key={metric.label} className="metric-card"><div className="label">{metric.label}</div><div className="value">{metric.value}</div></div>
        ))}
      </div>
      <div className="status-note">After setup, Record and Meetings unlock. Settings keeps a repair action for the local runtime.</div>
    </aside>
  )
}

export function OnboardingView({ status, busy, onStart, onRetry }: OnboardingViewProps) {
  const copy = phaseCopy(status)
  const errorView = onboardingErrorView(status)
  const isReady = status.phase === 'ready'
  const isError = status.phase === 'error'
  const action = isError ? onRetry : onStart
  const hint = !isReady && !isError && status.phase !== 'needs_setup' ? copy.actionHint : undefined
  return (
    <section className="panel panel-large setup-shell">
      <div className="panel-header"><div><h1>Local AI setup</h1><p>Bundled Ollama on this Mac.</p></div><div className={`status-pill ${onboardingStatusTone(status.phase)}`}>{onboardingPhaseLabel(status.phase)}</div></div>
      <div className="setup-grid">
        <div className="setup-panel setup-primary">
          <div className="setup-callout"><strong>Recommended</strong><h2>{copy.headline}</h2><p>{copy.detail}</p></div>
          <SetupProgressCard status={status} copy={copy} />
          <SetupActions busy={busy} isReady={isReady} label={copy.actionLabel} hint={hint} showRetry={status.canRetry && !isReady && !isError} onAction={action} onRetry={onRetry} />
          {errorView ? <LocalAIErrorBanner errorView={errorView} /> : null}
        </div>
        <SetupPlanRail status={status} />
      </div>
    </section>
  )
}
