type LocalAITechnicalDetailsProps = {
  detail?: string
}

export function LocalAITechnicalDetails({ detail }: LocalAITechnicalDetailsProps) {
  if (!detail) return null
  return (
    <details className="technical-details">
      <summary>Technical details</summary>
      <pre>{detail}</pre>
    </details>
  )
}
