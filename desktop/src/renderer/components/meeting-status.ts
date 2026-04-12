const permissionErrorHints = [
  'permission denied',
  'microphone access denied',
  'screen recording access required',
  'grant permission:',
  'privacy & security',
]

export function meetingStatusLabel(state: MeetingStatus['state']): string {
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

export function processingStatusLabel(state: MeetingStatus['processing']['state']): string {
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

export function artifactLabel(ready: boolean, present: string, missing: string): string {
  return ready ? present : missing
}

export function isPermissionErrorMessage(message: string | null | undefined): boolean {
  if (!message) return false
  const normalized = message.toLowerCase()
  return permissionErrorHints.some((hint) => normalized.includes(hint))
}
