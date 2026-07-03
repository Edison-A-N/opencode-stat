# OpenCode Agent Token Tracker

Local TanStack dashboard for tracking **per-agent token consumption** from the local OpenCode SQLite database. The core question it answers: *which agent used how many tokens, on which model, and when?*

## Stack

- Node.js server, no Python runtime required
- React + Vite + TypeScript frontend
- TanStack Query for auto-refresh and manual refresh
- TanStack-oriented dashboard tables and charts
- System `sqlite3` CLI in `-readonly -json` mode for large OpenCode databases

## What It Tracks

Each view is organized around **agent identity** — the specific agent that performed work:

- **Per-agent token totals** — input/output/cache tokens broken down by agent, with model dimension
- **Daily agent comparison** — day-over-day token usage using `message.time_created` (not `session.time_updated`)
- **Agent/model matrix** — which agents ran on which models and their token footprint
- **Task delegation graph** — `task()` calls between agents, including skill loads (`load_skills=[...]`) and direct `skill()` invocations
- **Top agent sessions** — sessions ranked by token consumption with agent attribution
- **Attribution recovery** — restores agent/model identity for sessions where `session.agent`/`session.model` is empty, using assistant message JSON

## Data Source

Default database path:

```bash
~/.local/share/opencode/opencode.db
```

The backend invokes `sqlite3` with `-readonly -json`. It does not write to or modify the OpenCode database.

## Run

```bash
npm install
npm run build
NODE_ENV=production npm start
```

The server binds to `0.0.0.0:12580` by default. Open locally:

```text
http://127.0.0.1:12580
```

For development:

```bash
npm run dev        # API server on 0.0.0.0:12580
npm run dev:client # Vite frontend on 127.0.0.1:5173, proxies /api
```

## Configuration

```bash
OPENCODE_DB=/path/to/opencode.db  # optional
HOST=0.0.0.0                      # optional
PORT=12580                        # optional
```

## API

```text
GET /api/health
GET /api/summary?days=7
```

`days` is clamped to `1..90`.

## Notes

- Requires `sqlite3` with `-json` support. Verified with SQLite `3.53.3`.
- Recent windows are calendar-day windows based on message timestamps.
- Missing session-level agent/model attribution is recovered from assistant message JSON when available.
- Skill token attribution is not exact: OpenCode records total message/session tokens, not token counts per injected skill fragment. The dashboard reports skill load counts and direct skill calls.
