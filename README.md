# OpenCode Token Dashboard

Local TanStack dashboard for monitoring OpenCode token usage from the local SQLite database.

## Stack

- Node.js server, no Python runtime required
- React + Vite + TypeScript frontend
- TanStack Query for auto-refresh and manual refresh
- TanStack-oriented dashboard tables and charts
- System `sqlite3` CLI in `-readonly -json` mode for large OpenCode databases

## What It Shows

- Daily token comparison using `message.time_created` rather than `session.time_updated`
- Token totals by agent and agent/model
- Task delegation counts
- `task(load_skills=[...])` skill load counts
- Direct `skill()` calls
- Top token-heavy sessions
- Recovery summary for sessions whose `session.agent`/`session.model` fields are empty

The dashboard is token-focused. It intentionally does not use price/cost as a primary metric.

## Data Source

Default database path:

```bash
~/.local/share/opencode/opencode.db
```

The backend invokes `sqlite3` with `-readonly -json`. It does not write to or modify the OpenCode database.

## Run

```bash
cd ~/code/opencode-stat
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
