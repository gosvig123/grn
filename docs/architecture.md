# grn Architecture

## Directory Structure

```
grn/
├── cmd/
│   └── grn/              # CLI entrypoint, cobra commands
├── internal/
│   ├── db/               # SQLite schema, migrations, queries
│   ├── capture/          # System audio capture (macOS)
│   ├── transcribe/       # Whisper.cpp / Deepgram / AssemblyAI
│   ├── ai/               # LLM summarization + action extraction
│   ├── ci/               # Action-item CI pipeline engine
│   ├── tui/              # Bubbletea screens and components
│   └── config/           # TOML config parsing and defaults
├── docs/                 # Architecture and design docs
└── go.mod
```

## Data Flow

```
┌──────────┐    ┌─────────────┐    ┌────────────┐    ┌────────────┐
│  System   │───▶│ Transcribe  │───▶│  AI Layer  │───▶│   SQLite   │
│  Audio    │    │  (STT)      │    │ (summarize │    │  Storage   │
│  Capture  │    │             │    │  + extract │    │            │
└──────────┘    └─────────────┘    │  actions)  │    └─────┬──────┘
                                   └────────────┘          │
                                                           ▼
                                                    ┌────────────┐
                                                    │ CI Pipeline │
                                                    │ (watch,     │
                                                    │  poll,      │
                                                    │  remind)    │
                                                    └────────────┘
```

1. **Capture** records system audio via ScreenCaptureKit (macOS)
2. **Transcribe** converts audio chunks to text (local Whisper.cpp or cloud STT API)
3. **AI** sends transcript to LLM, returns structured summary + action items
4. **DB** persists meetings, transcripts, summaries, and actions
5. **CI** polls external systems, matches evidence to open actions, auto-closes

## Component Responsibilities

### `cmd/grn`
Entry point. Cobra root command with subcommands: `record`, `list`, `show`,
`actions`, `ci`, `config`, `export`. Parses flags, loads config, delegates.

### `internal/db`
Schema: `meetings`, `transcripts`, `summaries`, `actions`, `ci_checks`,
`ci_runs`. Uses modernc.org/sqlite (pure Go). Provides typed query functions.
Handles migrations via embedded SQL files.

### `internal/capture`
Audio capture behind a `Recorder` interface.
Returns `io.Reader` of PCM/WAV chunks. macOS impl uses ScreenCaptureKit
via cgo bridge (pmoust/audiorec for system audio, malgo for mic).

### `internal/transcribe`
`Transcriber` interface with implementations: `WhisperLocal` (whisper.cpp
binary), `Deepgram`, `AssemblyAI`. Accepts audio chunks, returns
timestamped segments. Handles streaming where supported.

### `internal/ai`
`Summarizer` interface. Implementations for OpenAI, Claude, Ollama.
Two-phase prompt: (1) structured summary, (2) action extraction.
Returns `Summary` and `[]Action` structs. Configurable model/temperature.

### `internal/ci`
Scheduler + check runners. Watches action items for completion evidence.
Stores run history. Sends notifications on state changes.

### `internal/tui`
Bubbletea app with screen-based navigation. Shared layout with header,
content area, status bar. Each screen is a `tea.Model`.

### `internal/config`
Loads `~/.grn/config.toml`, merges with defaults and env vars.
Validates required fields. Exposes typed `Config` struct.

## CI Pipeline Design

### Check Types

| Type        | Trigger    | Evidence Source                        |
|-------------|------------|----------------------------------------|
| `git_watch` | Cron       | Git log for branch/commit referencing action |
| `jira_poll` | Cron       | JIRA API — ticket status transitions   |
| `reminder`  | Cron       | Time-based deadline proximity          |
| `webhook`   | HTTP POST  | External system pushes completion signal |

### Scheduler Loop

```
every tick (configurable, default 5m):
  for each open action with ci_checks:
    run matching check
    store ci_run result (pass/fail/error + evidence)
    if pass:
      mark action "done" with evidence link
    if approaching deadline + no progress:
      emit reminder notification
```

### Evidence-Based Auto-Close

Actions close only with evidence. A `git_watch` check passes when it finds
a commit message containing the action ID or matching keywords. A `jira_poll`
check passes when the linked ticket moves to "Done"/"Closed". Evidence is
stored in `ci_runs.evidence_json` for auditability.

### CI Schema

```sql
ci_checks:  id, action_id, check_type, config_json, enabled
ci_runs:    id, check_id, status, evidence_json, ran_at
```

## TUI Screens

### Dashboard (default)
Split layout: upcoming meetings (top), recent actions needing attention
(bottom-left), CI status summary (bottom-right). Keybinds for quick nav.

### Meeting List
Filterable table of all meetings. Columns: date, title, duration,
action count, status. Enter opens detail. `/` to search.

### Meeting Detail
Tabbed view: Summary | Transcript | Actions. Summary shows AI output.
Transcript shows timestamped segments. Actions shows extracted items
with inline CI status indicators.

### Actions
Kanban-style columns: Open → In Progress → Done. Each card shows title,
assignee, deadline, CI check status. `e` to edit, `d` to mark done,
`c` to configure CI check.

### CI Status
Table of all active CI checks. Columns: action, check type, last run,
status, next run. Detail view shows run history with evidence.

### Navigation

```
Dashboard ──▶ Meeting List ──▶ Meeting Detail
    │                              │
    ▼                              ▼
  Actions ◀──────────────── Action Detail
    │
    ▼
 CI Status
```

Global: `?` help, `q` back/quit, `tab` cycle focus, `:` command mode.

## Configuration

`~/.grn/config.toml`:

```toml
[audio]
backend = "screencapture"   # macOS ScreenCaptureKit
sample_rate = 16000
format = "wav"

[transcription]
engine = "whisper_local"    # "whisper_local" | "deepgram" | "assemblyai"
model = "base.en"           # whisper model size
api_key = ""                # for cloud engines

[ai]
provider = "openai"         # "openai" | "claude" | "ollama"
model = "gpt-4o"
api_key = ""
temperature = 0.3
base_url = ""               # for ollama or proxies

[ci]
enabled = true
interval = "5m"
reminder_channels = ["terminal"]

[ci.git_watch]
repos = ["~/projects/main"]
match_strategy = "action_id" # "action_id" | "keywords"

[ci.jira]
base_url = ""
email = ""
api_token = ""

[integrations]
slack_webhook = ""
```

Env var override pattern: `GRN_AI_API_KEY` overrides `ai.api_key`.
