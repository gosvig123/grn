import type { RecordingState } from '../shared/contracts'

export type { RecordingState }

let state: RecordingState = { status: 'idle' }
const listeners = new Set<(state: RecordingState) => void>()

export function getRecordingState(): RecordingState {
  return state
}

export function setRecordingState(next: RecordingState): void {
  state = next
  for (const listener of listeners) listener(state)
}

export function onRecordingStateChange(listener: (state: RecordingState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
