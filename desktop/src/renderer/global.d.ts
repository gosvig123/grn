export {}

declare global {
  type MeetingStatus = {
    state: 'recording' | 'processing' | 'completed' | 'failed'
    updatedAt: string
    failureMessage?: string
  }

  interface Window {
    grn: {
      system: {
        getDevices(): Promise<Array<{ index: number; name: string }>>
        openPermissionsSettings(): Promise<void>
      }
      meetings: {
        list(): Promise<
          Array<{
            id: string
            title: string
            startedAt: string
            endedAt?: string
            status: MeetingStatus
            hasTranscript: boolean
            hasSummary: boolean
          }>
        >
        show(id: string): Promise<{
          id: string
          title: string
          startedAt: string
          endedAt?: string
          status: MeetingStatus
          transcriptText?: string
          summary?: string
          segments: Array<{ startSec: number; endSec: number; speaker: string; text: string }>
        }>
      }
      recording: {
        start(input: { title: string; device: number; mode: string; modelPath?: string }): Promise<{
          status: 'idle' | 'recording' | 'stopping' | 'processing' | 'error'
          title?: string
          error?: string
        }>
        stop(): Promise<{
          status: 'idle' | 'recording' | 'stopping' | 'processing' | 'error'
          title?: string
          error?: string
        }>
        getStatus(): Promise<{
          status: 'idle' | 'recording' | 'stopping' | 'processing' | 'error'
          title?: string
          error?: string
        }>
        onStatusChanged(listener: (state: {
          status: 'idle' | 'recording' | 'stopping' | 'processing' | 'error'
          title?: string
          error?: string
        }) => void): () => void
      }
    }
  }
}
