# Capture Pipeline Design

## How Granola Does It

Granola is **botless** — it never joins calls. Instead it captures audio at
the OS level, making it work with Zoom, Meet, Teams, or anything else.

### Granola's Pipeline

```
┌─────────────┐     ┌─────────────┐
│ Microphone   │────▶│             │     ┌──────────────┐     ┌──────────┐
│ (your voice) │     │ Real-time   │────▶│ Deepgram /   │────▶│ Stored   │
│              │     │ audio       │     │ AssemblyAI   │     │ transcrip│
│ System Audio │────▶│ streams     │     │ (cloud STT)  │     │ (AWS)    │
│ (others)     │     │             │     └──────────────┘     └────┬─────┘
└─────────────┘     └─────────────┘                                │
                                                                   ▼
                    ┌─────────────┐     ┌──────────────┐     ┌──────────┐
                    │ User types  │────▶│ Merge notes  │────▶│ Enhanced │
                    │ rough notes │     │ + transcript │     │ notes    │
                    │ during call │     │ via LLM      │     │ (output) │
                    └─────────────┘     └──────────────┘     └──────────┘
```

Key design decisions Granola makes:
1. **Two streams**: mic (you) + system audio (them) — enables speaker separation
2. **No audio stored**: streamed to cloud STT, then discarded
3. **Manual start**: user triggers recording explicitly
4. **Real-time transcription** on desktop, post-meeting on mobile
5. **Post-meeting enhancement**: LLM merges rough user notes + transcript
6. Uses **CoreAudio Process Taps** (macOS 14.2+) for system audio capture

## How grn Should Do It

### Design Principles

1. **Interface-driven** — capture backends are swappable behind `Recorder`
2. **Local-first** — default to local transcription (Whisper), cloud optional
3. **Stream-oriented** — audio flows as PCM chunks, never large files
4. **Two-channel** — mic + system audio captured separately when possible
5. **Resilient** — audio always streams to disk, survives crashes, enables re-processing
6. **macOS-first** — optimised for macOS capture APIs; Linux planned for later

### Full Pipeline

```
Phase 1: CAPTURE               Phase 2: TRANSCRIBE          Phase 3: ENHANCE
─────────────────               ───────────────────          ────────────────

┌──────────────┐                ┌─────────────────┐
│ Mic Stream   │──┐             │                 │          ┌──────────────┐
│ (your voice) │  │  ┌───────┐ │ Transcriber     │          │              │
└──────────────┘  ├─▶│ Mixer │─▶│                 │          │ AI Enhancer  │
┌──────────────┐  │  │ /Mux  │ │ Local:whisper   │  ┌────┐  │              │
│ System Stream│──┘  └───────┘ │ Cloud:deepgram  │─▶│ DB │─▶│ Summary      │
│ (them)       │               │                 │  └────┘  │ Actions      │
└──────────────┘               │ Outputs tagged  │          │ Participants │
                               │ segments w/     │          │              │
      ▲                        │ speaker labels  │          └──────────────┘
      │                        └─────────────────┘
      │
  OS-specific
  backend
```

### Phase 1: Audio Capture

#### The `Recorder` Interface

```go
type AudioFormat struct {
    SampleRate int    // 16000 for Whisper, 48000 for cloud
    Channels   int    // 1 (mono) or 2 (stereo)
    BitDepth   int    // 16
    Encoding   string // "pcm_s16le"
}

type AudioChunk struct {
    Data      []byte
    Source    string    // "mic" | "system" | "mixed"
    Timestamp time.Time
    Format    AudioFormat
}

type Recorder interface {
    // Available returns true if this backend works on the current OS
    Available() bool

    // Devices lists capturable audio sources
    Devices() ([]Device, error)

    // Start begins capture. Chunks flow into the returned channel.
    // Cancel the context to stop.
    Start(ctx context.Context, opts CaptureOpts) (<-chan AudioChunk, error)
}

type CaptureOpts struct {
    MicDevice    string // empty = default mic
    SystemAudio  bool   // capture system/speaker audio
    TargetApp    string // empty = all, or "zoom", "chrome", etc.
    Format       AudioFormat
    ChunkSize    time.Duration // e.g. 5 seconds
}
```

#### macOS Backend: `capture_darwin.go`

**Primary: ScreenCaptureKit** (macOS 13+)
- Uses `github.com/tmc/apple/screencapturekit` (pure Go, no CGO)
- `SCContentFilter` targets specific apps or entire display
- Separate `.audio` (system) and `.microphone` streams
- Requires Screen Recording permission (TCC)

**Fallback: CoreAudio Process Taps** (macOS 14.2+)
- `AudioHardwareCreateProcessTap()` taps specific PIDs
- Small ObjC helper via cgo for the tap setup
- Raw float32 PCM via IOProc callback

**Last resort: BlackHole virtual device**
- `brew install blackhole-2ch`
- Requires Multi-Output Device setup
- Captures all system audio (no per-app filtering)

```
Backend detection order:
1. Can we use ScreenCaptureKit? (macOS 13+, permission granted)
2. Can we use CoreAudio taps? (macOS 14.2+)
3. Is BlackHole installed?
4. Error: no capture backend available
```

#### Mic Capture

Microphone is simpler — standard OS audio input:
- AVAudioEngine or ScreenCaptureKit `.microphone` stream
- Uses malgo for low-level CoreAudio access when needed

### Phase 2: Transcription

#### The `Transcriber` Interface

```go
type Segment struct {
    Start   time.Duration
    End     time.Duration
    Text    string
    Speaker string // "you" | "speaker_1" | "unknown"
    Source  string // "mic" | "system"
}

type Transcriber interface {
    // TranscribeStream processes audio chunks as they arrive
    TranscribeStream(ctx context.Context, chunks <-chan AudioChunk) (<-chan Segment, error)

    // TranscribeBatch processes a complete audio buffer
    TranscribeBatch(ctx context.Context, audio []byte, format AudioFormat) ([]Segment, error)
}
```

**Local: Whisper**
- Shell out to `whisper-cpp` binary or use Go bindings
- Model sizes: tiny (75MB) → large (3GB) — configurable
- Batch mode: accumulate N seconds, transcribe, emit segments
- Latency: ~2-5s for a 30s chunk on Apple Silicon (base model)

**Cloud: Deepgram / AssemblyAI**
- WebSocket streaming for real-time segments
- Speaker diarization built-in
- Requires API key + network

**Hybrid mode** (recommended default):
- Real-time: local Whisper (fast, private, good-enough)
- Post-meeting: re-process with cloud STT for higher accuracy
- User chooses which transcript to keep

### Phase 3: Enhancement

Happens after meeting ends (or on-demand via `grn summarize`):

```go
type EnhanceInput struct {
    Transcript []Segment
    UserNotes  string // optional rough notes taken during meeting
    Template   string // "standup", "1on1", "discovery", etc.
}

type EnhanceOutput struct {
    Title        string
    Summary      string
    ActionItems  []ActionItem
    Participants []string
    Topics       []string
}
```

LLM receives transcript + optional user notes + template prompt.
Returns structured output parsed into `EnhanceOutput`.

### Session Lifecycle

```
User runs: grn listen [--app zoom]

1. INIT
   ├─ Detect OS + available backends
   ├─ Load config (~/.grn/config.toml)
   ├─ Open SQLite, create meeting row (status: "recording")
   └─ Show TUI recording screen (elapsed time, audio levels)

2. CAPTURE (runs until user stops with 'q' or Ctrl-C)
   ├─ Start system audio stream
   ├─ Start mic stream (if enabled)
   ├─ Chunk audio into 5-10s windows
   ├─ Feed chunks to transcriber
   ├─ Display live transcript in TUI (scrolling)
   └─ Buffer segments in memory + write to DB incrementally

3. STOP (user presses 'q' or meeting ends)
   ├─ Stop audio streams
   ├─ Cleanup OS resources (unload PA modules, stop SCK stream)
   ├─ Flush remaining audio to transcriber
   ├─ Update meeting row (status: "processing", ended_at)
   └─ If audio retention enabled: save WAV to ~/.grn/audio/

4. ENHANCE (automatic post-meeting)
   ├─ Collect full transcript from DB
   ├─ Prompt user for rough notes (optional, editor opens)
   ├─ Send to LLM with selected template
   ├─ Parse structured output
   ├─ Store summary, action items, participants
   ├─ Update meeting row (status: "complete")
   └─ Show summary in TUI, offer to edit

5. CI SETUP (optional, prompted)
   ├─ For each action item:
   │   ├─ "Watch git for commits?" → create git_watch check
   │   ├─ "Link to Jira ticket?" → create jira_poll check
   │   └─ "Set reminder?" → create reminder check
   └─ CI daemon picks up new checks on next tick
```

### Chunk Strategy

Audio is chunked for streaming transcription:

```
|----5s----|----5s----|----5s----|----5s----|
[  chunk1  ][  chunk2  ][  chunk3  ][  chunk4 ]
      \          \           \          \
       ▼          ▼           ▼          ▼
    segment1   segment2   segment3   segment4
```

- **Chunk size**: 5-10 seconds (configurable)
- **Overlap**: 0.5s overlap between chunks to avoid cutting words
- **Format**: 16kHz mono PCM s16le (32 KB/s = ~1.9 MB/min)
- **Buffering**: ring buffer holds last 30s for context if needed

For local Whisper, larger chunks (15-30s) are more efficient.
For cloud streaming APIs, smaller chunks (1-3s) give faster feedback.

### Per-App vs All-Audio Capture

| Mode | When | How |
|------|------|-----|
| **Targeted** | User specifies `--app zoom` | SCK content filter for specific app |
| **All system** | Default / no specific app | SCK full display audio capture |
| **Mic only** | `--mic-only` flag | Standard mic input, no system audio |
| **System only** | `--no-mic` flag | System audio only, skip mic |

Targeted mode is preferred — less noise, better transcription accuracy,
lower resource usage. But it requires knowing which app to target.

**Auto-detect strategy**: poll running apps for known meeting processes
(`zoom.us`, `Google Chrome`, `Microsoft Teams`) starting audio output.

### Error Handling & Recovery

| Failure | Recovery |
|---------|----------|
| Audio backend unavailable | Try next in detection order, error if none |
| Permission denied (macOS TCC) | Prompt user to grant Screen Recording access |
| Transcription API down | Buffer audio, retry, fall back to local Whisper |
| Whisper OOM | Drop to smaller model automatically |
| Meeting app quits mid-capture | Detect silence > 30s, prompt to stop |
| grn crashes during capture | On next launch, recover in-progress meeting from DB |
| Disk full | Warn when < 500MB free, stop audio retention |

### Privacy & Storage

```
Default (private):
  Audio → streamed to transcriber → deleted
  Transcript → SQLite only
  No cloud calls unless explicitly configured

Audio retention (always on, configurable cleanup):
  [storage]
  audio_retention = "30d"  # auto-cleanup after 30 days
  # "forever" to never delete, "0" to delete after enhancement

Opt-in cloud:
  [transcription]
  engine = "deepgram"  # explicitly chosen
```

### Directory Layout for Capture Code

```
internal/capture/
├── recorder.go          # Recorder interface + AudioChunk types
├── detect.go            # Auto-detect best backend for current OS
├── capture_darwin.go    # macOS: SCK + CoreAudio tap + BlackHole
├── mic.go               # Mic capture (AVAudioEngine / malgo)
└── chunk.go             # Chunking, overlap, ring buffer logic

internal/transcribe/
├── transcriber.go       # Transcriber interface + Segment types
├── whisper.go           # Local whisper.cpp integration
├── deepgram.go          # Deepgram WebSocket streaming
└── assemblyai.go        # AssemblyAI real-time API

internal/ai/
├── enhancer.go          # Enhancer interface + EnhanceOutput types
├── openai.go            # OpenAI implementation
├── claude.go            # Anthropic Claude implementation
├── ollama.go            # Local Ollama implementation
└── templates.go         # Prompt templates (standup, 1on1, etc.)
```

### Future: Linux Support

Linux capture is planned but not in scope for v1. The likely approach is
PipeWire (modern distros) with PulseAudio as a fallback, using per-app
targets via `pw-record` or null-sink routing.
