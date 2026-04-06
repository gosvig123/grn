# Capture Resilience & Audio Persistence

## The Problem

The meeting is the irreplaceable asset. If audio is lost, it's gone forever.
Transcript can be regenerated from audio. Notes can be regenerated from
transcript. But nothing can regenerate the audio.

Current plan holds audio in a memory ring buffer and discards it after
whisper processes each chunk. This means:

- If grn crashes → unprocessed audio is lost
- If meeting app crashes → last buffered chunk is lost
- If whisper is slow/stuck → audio backs up in memory, may OOM
- If power goes out → everything in memory is gone

This is wrong. **Audio must hit disk immediately.**

## Revised Plan: Always Stream Audio to Disk

Every capture session writes raw audio to disk continuously.
This is not optional. It's the safety net for everything else.

```
┌──────────────┐     ┌──────────────────────┐
│ Mic stream   │────▶│ ~/.grn/sessions/     │
│              │     │   {id}/mic.raw        │
└──────────────┘     └──────────┬────────────┘
                                │
                          simultaneously
                                │
                                ▼
                     ┌──────────────────┐
                     │ Chunker + VAD    │──▶ whisper ──▶ DB segments
                     └──────────────────┘

┌──────────────┐     ┌──────────────────────┐
│ System stream│────▶│ ~/.grn/sessions/     │
│              │     │   {id}/system.raw     │
└──────────────┘     └──────────┬────────────┘
                                │
                          simultaneously
                                │
                                ▼
                     ┌──────────────────┐
                     │ Chunker + VAD    │──▶ whisper ──▶ DB segments
                     └──────────────────┘
```

Audio capture writes to two places in parallel:
1. **Disk file** — append-only raw PCM stream (the safety net)
2. **Chunker** — feeds whisper for real-time transcription (the fast path)

Both are fed from the same audio source channel. Disk write is a
simple `io.Writer` append — near zero overhead.

## Session Directory

```
~/.grn/sessions/
└── 2026-04-06T1000-sprint-planning/
    ├── mic.raw              # raw PCM, 16kHz mono s16le
    ├── system.raw           # raw PCM, 16kHz mono s16le
    ├── meta.json            # session metadata
    └── transcript.jsonl     # segments as they arrive (append-only)
```

### meta.json

```json
{
  "id": "abc123",
  "meeting_id": 42,
  "started_at": "2026-04-06T10:00:00Z",
  "ended_at": null,
  "status": "recording",
  "audio_format": {
    "sample_rate": 16000,
    "channels": 1,
    "encoding": "s16le"
  },
  "mic_device": "MacBook Pro Microphone",
  "system_source": "screencapturekit"
}
```

`ended_at: null` and `status: recording` = session was not cleanly closed.

### transcript.jsonl

One JSON object per line, appended as whisper returns segments:

```jsonl
{"start":0.0,"end":3.2,"text":"Let's discuss Q3.","speaker":"You","ts":"2026-04-06T10:00:03Z"}
{"start":3.5,"end":7.1,"text":"I think retention is key.","speaker":"Other","ts":"2026-04-06T10:00:07Z"}
```

JSONL (not a JSON array) because it's safe for append — no closing
bracket needed, each line is independent, survives partial writes.

## Recovery Scenarios

### grn crashes during capture

```
$ grn listen
... recording ...
[crash / kill -9 / power loss]

$ grn listen          # next launch
⚠ Found incomplete session: "Sprint Planning" (Apr 6, 32 min recorded)
  Audio files intact: mic.raw (30.7 MB), system.raw (30.7 MB)
  Transcript: 847 segments (covers first 28 min)

  [r] Re-transcribe from audio (full)
  [e] Enhance with existing transcript (partial)
  [d] Discard session
  [i] Ignore for now
```

Recovery flow:
1. Scan `~/.grn/sessions/` for `status: "recording"` in meta.json
2. Audio files are intact — raw append-only files survive crashes
3. transcript.jsonl has everything whisper completed before the crash
4. User chooses: re-transcribe the raw audio files (best quality)
   or enhance with whatever transcript we have (faster)

### Meeting app crashes / audio drops

Same result — audio files have everything up to the drop point.
The raw files are the source of truth, not the transcript.

### Whisper falls behind real-time

Audio still streams to disk at full speed. Whisper processes chunks
as fast as it can. When the meeting ends, grn continues processing
remaining chunks from the disk files rather than memory.

```
meeting ends
     │
     ├─ audio files: complete (all 45 min)
     ├─ transcript: partial (whisper processed 38 min so far)
     │
     └─ grn continues: reads remaining audio from disk files
        feeds to whisper until fully transcribed
        then runs enhance pipeline
```

No audio is lost. Whisper just catches up.

### Re-process a past session

```
$ grn retranscribe 42              # re-run whisper on meeting #42
$ grn retranscribe 42 --model large-v3  # use a better model
$ grn enhance 42                   # re-run LLM stages only
$ grn enhance 42 --template 1on1  # different template
```

Audio files make everything replayable. Change whisper model,
change LLM, change template — re-run on the same audio.

## Storage & Cleanup

Raw PCM at 16kHz mono s16le = **1.92 MB/min per stream**.
Two streams = **~3.84 MB/min**, **~230 MB/hour**.

| Meeting length | Disk usage (both streams) |
|---|---|
| 30 min | ~115 MB |
| 1 hour | ~230 MB |
| 5 hours/week | ~1.15 GB/week |

### Retention Policy

```toml
[storage]
# How long to keep raw audio files
audio_retention = "30d"     # delete audio after 30 days
# "forever" to never delete, "0" to delete after enhancement
```

Default: **processed** — audio deleted once fully transcribed.
Set to `30d` to keep audio for re-transcription with better models.
Transcripts and notes are kept forever (tiny).

```
$ grn cleanup
Deleted 12 sessions older than 30 days.
Freed 2.8 GB.
Transcripts and notes preserved.
```

Cleanup runs automatically on `grn listen` startup (non-blocking).

## What This Changes

Previous plan → revised:

| Aspect | Before | Now |
|---|---|---|
| Audio in memory | Ring buffer, 30s | Still used for chunker input |
| Audio on disk | Opt-in (`retain = true`) | **Always** — append-only raw files |
| Crash recovery | "detect orphaned rows" (vague) | Concrete: scan sessions dir, offer re-transcribe |
| Whisper behind | Audio lost if buffer overflows | Catches up from disk after meeting |
| Re-processing | Not possible | `grn retranscribe` / `grn enhance` |
| Storage cost | ~0 | ~230 MB/hr, auto-cleanup after 30d |
