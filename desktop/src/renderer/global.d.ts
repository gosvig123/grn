import type { Device, LocalAIStatus, MeetingDetail, MeetingListItem, MeetingStatus as SharedMeetingStatus, OnboardingStatus, RecordingState } from '../shared/contracts'

export {}

declare global {
  type MeetingStatus = SharedMeetingStatus

  interface Window {
    grn: {
      system: {
        getDevices(): Promise<Device[]>
        openPermissionsSettings(): Promise<void>
      }
      meetings: {
        list(): Promise<MeetingListItem[]>
        show(id: string): Promise<MeetingDetail>
      }
      recording: {
        start(input: { title: string; device: number; mode: string; modelPath?: string }): Promise<RecordingState>
        stop(): Promise<RecordingState>
        getStatus(): Promise<RecordingState>
        onStatusChanged(listener: (state: RecordingState) => void): () => void
      }
      onboarding: {
        getStatus(): Promise<OnboardingStatus>
        start(): Promise<OnboardingStatus>
        retry(): Promise<OnboardingStatus>
        onStatusChanged(listener: (state: OnboardingStatus) => void): () => void
      }
      settings: {
        getLocalAIStatus(): Promise<LocalAIStatus>
        repairLocalAI(): Promise<LocalAIStatus>
      }
    }
  }
}
