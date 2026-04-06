# Capture Trigger & Audio Flow

How `grn listen` actually works, end to end.

## Trigger Model

Manual. User runs `grn listen`, audio starts. User presses `q`, audio stops.

```
$ grn listen                    # capture all system audio + mic
$ grn listen --app zoom         # capture only Zoom's audio + mic
$ grn listen --no-mic           # system audio only
$ grn listen --mic-only         # mic only (in-person meeting)
$ grn listen --title "Sprint"   # pre-set meeting title
```

No auto-detection of meetings in v1. No calendar integration.
User is in control of when recording starts and stops.

## Two Streams

Every session captures up to two independent audio streams:

```
Stream A: Microphone         Stream B: System Audio
(your voice)                 (remote participants)
     │                            │
     ▼                            ▼
  16kHz mono s16le            16kHz mono s16le
     │                            │
     ▼                            ▼
  whisper.cpp instance 1      whisper.cpp instance 2
     │                            │
     ▼                            ▼
  segments tagged "You"       segments tagged "Other"
     │                            │
     └────────────┬───────────────┘
                  ▼
          merge by timestamp
                  ▼
         unified transcript
```

This gives us speaker attribution for free — no diarization needed.
Mic stream = "You". System stream = "Other".

## Platform Capture Details

### Audio Capture (macOS 13+)

The `audiorec` library provides both streams via separate backends:

| Stream | Backend | Format | Notes |
|--------|---------|--------|-------|
| Mic | `malgo` (miniaudio) | int16, device-native rate | Standard input device |
| System | ScreenCaptureKit (cgo) | float32, 48kHz stereo | Requires Screen Recording TCC |

Both deliver `Frame{Data []byte, Timestamp time.Time}` on Go channels.

**Format normalization needed before whisper:**
```
Mic:    int16 @ 44.1/48kHz → float32 → resample 16kHz → already mono
System: float32 @ 48kHz stereo → downmix to mono → resample 16kHz
```

**TCC permission:** First run triggers macOS Screen Recording permission
dialog. grn should detect denial and show instructions.

**Fallback chain:**
1. `audiorec` (SCK + malgo) — default
2. CoreAudio Process Taps (macOS 14.2+) — if audiorec fails
3. BlackHole virtual device — last resort, requires user setup

### Time Sync

Both streams go through the same audio server (CoreAudio) with a single
clock. Drift between streams is negligible (<50ms).
Since we chunk into 5-30s windows, this is irrelevant for transcript merging.

## Chunking & VAD

Audio flows continuously. We chunk it for whisper.cpp processing.

### Chunk Strategy

```
continuous PCM stream (per source)
         │
         ▼
┌─────────────────────────────────────────┐
│              Ring Buffer                 │
│  holds last 30s of PCM                  │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │ VAD (voice activity detection)   │   │
│  │ detects speech/silence boundaries│   │
│  └──────────────┬───────────────────┘   │
│                 │                        │
│     silence gap > 500ms?                 │
│     or buffer > 10s?                     │
│                 │                        │
│           yes ──┤                        │
│                 ▼                        │
│         emit chunk + 300ms overlap       │
└─────────────────────────────────────────┘
```

**Parameters:**
- Min chunk: 2s (ignore very short fragments)
- Max chunk: 10s (force-split even without silence)
- Silence threshold: 500ms of below-threshold audio
- Overlap: 300ms appended from previous chunk's tail
- Format: 16kHz mono float32 (whisper's native input)

**VAD options for v1:**
- Simple energy-based: RMS below threshold = silence. Fast, no deps.
- Silero VAD via whisper.cpp `--vad` flag (if using server mode)

Start with energy-based. Upgrade to Silero later if needed.

### Per-Source Chunking

Each stream has its own chunker. Chunks are tagged with source:

```go
type Chunk struct {
    Audio     []float32
    Source    string        // "mic" | "system"
    StartTime time.Time
    Duration  time.Duration
}
```

Both chunkers write to the same channel. The transcription layer
processes chunks as they arrive regardless of source.

## Whisper Integration

### Architecture: whisper-server as child process

```
grn listen
  │
  ├─▶ spawn: whisper-server --model ~/.grn/models/ggml-base.en.bin
  │          --port 8765 --host 127.0.0.1
  │
  ├─▶ start mic capture goroutine
  ├─▶ start system capture goroutine
  │
  │   chunks arrive on shared channel
  │         │
  │         ▼
  │   POST http://127.0.0.1:8765/inference
  │     Content-Type: multipart/form-data
  │     file: chunk.wav (16kHz mono)
  │     response_format: json
  │         │
  │         ▼
  │   { "text": "...", "segments": [...] }
  │         │
  │         ▼
  │   tag with source ("You" / "Other")
  │   write segment to DB
  │   update TUI transcript view
  │
  └─▶ on quit: kill whisper-server, flush, enhance
```

**Why server mode over Go bindings:**
- No CGo in grn itself — pure Go binary
- Model loaded once, reused across all chunks
- Clean HTTP boundary — easy to swap for cloud STT later
- whisper-server ships with whisper.cpp

**Chunk submission is sequential per source, parallel across sources.**
Two goroutines POST concurrently. Whisper-server handles one at a time
(single model), so chunks queue. At ~3s inference per 10s chunk on
Apple Silicon base.en, this keeps up with real-time easily.

### Whisper Response Parsing

```json
{
  "segments": [
    {
      "t0": 0, "t1": 340,
      "text": " Let's discuss the Q3 targets."
    },
    {
      "t0": 400, "t1": 820,
      "text": " I think we should focus on retention."
    }
  ]
}
```

Mapped to our segment type:

```go
type Segment struct {
    Start   time.Duration  // absolute meeting time, not chunk-relative
    End     time.Duration
    Text    string
    Speaker string         // "You" or "Other"
}
```

Timestamps adjusted: `segment.t0 + chunk.StartTime` = absolute position.

## Transcript Merge

Segments from both streams merge into a single timeline:

```go
func mergeSegments(mic, system []Segment) []Segment {
    all := append(mic, system...)
    sort.Slice(all, func(i, j int) bool {
        return all[i].Start < all[j].Start
    })
    return all
}
```

Result:

```
[00:32] You:   Let's discuss the Q3 targets.
[00:36] Other: I think we should focus on retention.
[00:41] You:   Agreed. What about the new pricing?
[00:44] Other: We tested three tiers last week.
```

**Overlap handling:** If mic and system segments overlap in time
(both people talking), both segments are kept. The LLM handles
overlapping speech gracefully in the enhancement stage.

## Participant Identification (v1)

v1 does **not** attempt multi-speaker diarization on the system stream.

| What we know | How |
|---|---|
| "You" spoke | Came from mic stream |
| "Other" spoke | Came from system stream |
| How many "others" | Unknown in v1 |
| Who specifically | Unknown in v1 — LLM infers from context |

The LLM extraction stage (Stage 1) is surprisingly good at inferring
participant names from conversational cues: "Thanks Sarah", "Mike can
you take that?", "As the PM I think...". We rely on this for v1.

**Future (not now):**
- pyannote-audio as Python sidecar for multi-speaker diarization
- Speaker embedding enrollment for named identification
- Calendar integration to pre-populate expected participants

## Session State Machine

```
                grn listen
                    │
                    ▼
             ┌──────────┐
             │   INIT   │  detect backends, load config,
             │          │  spawn whisper-server, create DB row
             └────┬─────┘
                  │
                  ▼
             ┌──────────┐
             │ CAPTURE  │  streams active, chunks flowing,
             │          │  segments written to DB, TUI updating
             └────┬─────┘
                  │  user presses 'q' or ctrl-c
                  ▼
             ┌──────────┐
             │ STOPPING │  stop streams, flush last chunks,
             │          │  kill whisper-server, cleanup OS resources
             └────┬─────┘
                  │
                  ▼
             ┌──────────┐
             │ ENHANCE  │  collect transcript, prompt for notes,
             │          │  run Stage 1 + Stage 2 via Ollama
             └────┬─────┘
                  │
                  ▼
             ┌──────────┐
             │   DONE   │  show summary, offer to edit,
             │          │  prompt for CI setup
             └──────────┘
```

DB meeting row tracks state: `recording → processing → complete`.
If grn crashes during CAPTURE, next launch detects orphaned
`recording` rows and offers to recover/enhance the partial transcript.

## What Gets Stored

| Data | When | Where | Retained |
|---|---|---|---|
| Raw PCM audio | During capture | `~/.grn/sessions/{id}/` | 30 days (configurable) |
| Audio file | N/A (raw files are the audio) | See above | See above |
| Transcript segments | As they arrive | SQLite | Yes |
| Raw whisper JSON | Per chunk | Nowhere | No |
| Stage 1 extraction | Post-meeting | SQLite (`meetings.extraction`) | Yes |
| Stage 2 notes | Post-meeting | SQLite (`meetings.summary`) | Yes |
| Action items | Post-meeting | SQLite (`action_items`) | Yes |

## Future: Linux Support

Linux capture (PulseAudio/PipeWire via `jfreymuth/pulse`) is a future goal.
Not in scope for v1 — macOS only.
