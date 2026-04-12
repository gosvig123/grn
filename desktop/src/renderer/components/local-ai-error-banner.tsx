import './local-ai-error.css'

import { LocalAITechnicalDetails } from './local-ai-technical-details'
import type { LocalAIOwnershipHelp } from './local-ai-ownership'

type LocalAIErrorBannerProps = {
  errorView: {
    title: string
    detail?: string
    debugDetail?: string
    ownershipHelp?: LocalAIOwnershipHelp
  }
}

function copyInstructions(instructions: string) {
  if (!navigator.clipboard?.writeText) return
  void navigator.clipboard.writeText(instructions)
}

export function LocalAIErrorBanner({ errorView }: LocalAIErrorBannerProps) {
  return (
    <div className="banner error setup-error-banner">
      <strong>{errorView.title}</strong>
      {errorView.detail ? <div>{errorView.detail}</div> : null}
      {errorView.ownershipHelp ? (
        <div className="setup-error-help">
          {errorView.ownershipHelp.summary ? <div className="setup-error-summary">Detected listener: {errorView.ownershipHelp.summary}</div> : null}
          <pre className="setup-error-instructions">{errorView.ownershipHelp.instructions}</pre>
          <div className="actions-row">
            <button className="secondary" onClick={() => copyInstructions(errorView.ownershipHelp!.instructions)}>Copy stop instructions</button>
          </div>
        </div>
      ) : null}
      <LocalAITechnicalDetails detail={errorView.debugDetail} />
    </div>
  )
}
