# grn — Meeting Intelligence for the Terminal

Capture system audio during meetings, transcribe and summarize with AI,
extract action items, and track them to completion — all from your terminal.

```
┌─────────────────────────────────────────────────────┐
│  System Audio ──► Transcribe ──► AI Summary         │
│                                    │                │
│                              Action Items           │
│                                    │                │
│                          CI Pipeline (track)        │
│                                    │                │
│                        TUI Dashboard / CLI          │
└─────────────────────────────────────────────────────┘
```

## Features

- **Live capture** — record system audio (ScreenCaptureKit/PulseAudio)
- **Transcription** — Whisper.cpp local or cloud (Deepgram, AssemblyAI)
- **AI summaries** — OpenAI, Claude, or Ollama (configurable)
- **Action items** — auto-extracted, assigned, tracked
- **CI pipeline** — cron engine polls repos, APIs, sends reminders
- **TUI dashboard** — rich bubbletea interface for browsing everything
- **JSON output** — pipe-friendly `--json` flag on all commands
- **Local-first** — SQLite at `~/.grn/db.sqlite`, no cloud required

## Architecture

```
cmd/grn/          ─── CLI entrypoint + subcommands
internal/
├── audio/        ─── platform capture (macOS/Linux)
├── transcribe/   ─── whisper.cpp / cloud API adapters
├── ai/           ─── summary + extraction (multi-provider)
├── meeting/      ─── domain: meetings, segments, search
├── action/       ─── domain: action items, status tracking
├── ci/           ─── pipeline engine, cron scheduler, checks
├── store/        ─── SQLite repository layer
├── config/       ─── TOML config loader
└── tui/          ─── bubbletea views (dashboard, detail, etc.)
```

## Tech Stack

| Layer         | Choice                              |
|---------------|-------------------------------------|
| Language      | Go                                  |
| TUI           | bubbletea (charmbracelet)           |
| Database      | SQLite via modernc.org/sqlite       |
| Audio (macOS) | ScreenCaptureKit (cgo bridge)       |
| Audio (Linux) | PulseAudio                          |
| Transcription | Whisper.cpp / Deepgram / AssemblyAI |
| AI            | OpenAI / Claude / Ollama            |
| Config        | TOML (~/.grn/config.toml)           |

## Installation

```bash
# From source
git clone https://github.com/yourorg/grn.git
cd grn
go build -o grn ./cmd/grn
mv grn /usr/local/bin/

# Or with go install
go install github.com/yourorg/grn/cmd/grn@latest
```

Requires Go 1.22+. No CGO needed (pure-Go SQLite driver).

## CLI Commands

### `grn`

Launch the TUI dashboard. Browse meetings, action items, and CI status.

```bash
grn                # open dashboard
grn --json         # dump recent meetings as JSON
```

### `grn listen`

Capture system audio and transcribe a live meeting.

```bash
grn listen                       # start capture, auto-detect audio
grn listen --title "Sprint Plan" # set meeting title upfront
grn listen --provider deepgram   # use specific transcription provider
```

Press `q` or `Ctrl+C` to stop. Triggers summarization automatically.

### `grn meetings` / `grn show <id>` / `grn search <query>`

```bash
grn meetings                          # recent meetings (table view)
grn meetings --since 7d --json        # last 7 days, JSON output
grn show 42                           # transcript + summary + actions
grn show 42 --transcript              # full transcript only
grn search "deployment timeline"       # full-text search
grn search "auth" --since 30d --json  # filtered search
```

### `grn actions`

```bash
grn actions                      # list open items
grn actions --all --assignee bob # include completed, filter by person
grn actions done 7               # mark item #7 complete
grn actions edit 7 --due 2026-04-10
```

### `grn summarize <id>`

Re-run AI summarization (e.g., after changing provider).

```bash
grn summarize 42 --provider ollama --model llama3
```

### `grn ci`

```bash
grn ci status               # pipeline state, next runs
grn ci run                  # trigger all checks now
grn ci run --check git      # run specific check only
grn ci add <repo-url>       # watch a git repo for action completion
grn ci add --type jira KEY  # watch a Jira ticket
```

## Configuration

Config lives at `~/.grn/config.toml`:

```toml
[general]
db_path = "~/.grn/db.sqlite"
default_provider = "openai"

[audio]
backend = "screencapture"  # "screencapture" (macOS) or "pulseaudio" (Linux)

[transcription]
provider = "whisper"       # "whisper", "deepgram", "assemblyai"
whisper_model = "base.en"

[ai]
provider = "openai"        # "openai", "claude", "ollama"
model = "gpt-4o"
api_key_env = "OPENAI_API_KEY"

[ai.ollama]
endpoint = "http://localhost:11434"
model = "llama3"

[ci]
enabled = true
interval = "30m"           # check frequency

[ci.notifications]
slack_webhook = ""
desktop = true
```

Env vars override config: `GRN_AI_PROVIDER`, `GRN_AI_API_KEY`, `GRN_TRANSCRIPTION_PROVIDER`.

## Development

```bash
git clone https://github.com/yourorg/grn.git && cd grn
go mod tidy && go build ./... && go test ./...
go run ./cmd/grn              # TUI
go run ./cmd/grn listen       # start recording
```

Rules: max 200 lines/file, no comments unless explaining *why*,
strong typing, zero duplication, `--json` on every command.

## License

MIT
