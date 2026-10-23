# Reflection streaming

Reflection uses assistant-ui's external-store runtime with the existing MUI
theme. Forge messages remain the durable conversation; an unfinished reply is
a separate run snapshot, not a completed Agent message.

## HTTP contract

All routes require the existing Forge session cookie. Only the Reflection owner
can create or cancel a run. Read access, including administrator read access,
matches the existing Reflection detail endpoint.

| Method | Route | Result |
| --- | --- | --- |
| POST | `/api/v1/reflections/:id/runs` | `{ run }`, 202 for a new run, 200 for an accepted duplicate |
| GET | `/api/v1/reflections/:id/runs/current` | `{ run }`, with `run: null` before the first run |
| GET | `/api/v1/reflections/:id/runs/:runId/events` | SSE snapshots and live updates |
| POST | `/api/v1/reflections/:id/runs/:runId/cancel` | `{ run }` after requesting cancellation |

The create body is `{ "message": "...", "requestId": "a-client-generated-uuid" }`.
Keep the same request ID when retrying a request whose response was lost. A
duplicate ID with different text, or another run while the Reflection is busy,
returns 409. Invalid messages and disabled/unknown Lens commands are rejected
before a user message or run is saved.

The synchronous `/messages` operation uses the same execution pipeline and returns
`ReflectionDetail` after completion.

SSE frames use `event: reflection`. JSON data contains `version: 1`, `runId`,
`sequence`, `type`, and the **full current `run` snapshot**. Types include
`snapshot`, `text.delta`, `text.replace`, `tool.status`, `proposal.updated`,
`run.status`, `completed`, `failed`, and `cancelled`. The first event is always a
snapshot; even a `text.delta` event carries accumulated text, not a fragment to
append blindly. Reconnection does not replay tokens or invoke the model again.
Ignore snapshots older than the sequence already observed for that run.

The browser uses credentialed streaming fetch, reconnects with backoff, and
stops retrying when authentication or read permission has expired. Final events
trigger a read of the authoritative Reflection detail, replacing the temporary
reply using the saved Agent message ID.

## Lifecycle and safety

- Closing a browser connection only removes its subscription.
- Explicit cancellation changes `running` to `cancelling`. The execution lock
  stays held until Pi and in-flight tools settle, then the run is `cancelled`.
- Candidate writes already completed are retained. Cancellation never adopts
  or rolls back a draft and never automatically retries a question.
- Once final result persistence begins, completion wins over a late stop.
- Generation and all mutations of its linked draft share one exclusion
  boundary, including App/ticket entry points. Reading the candidate remains
  possible; review, rebase, adoption, abandonment and manual writes wait until
  the run has settled.
- Pi emits only decoded top-level `analysis` text and whitelisted tool
  names/status. JSON metadata, private reasoning and tool inputs/results are
  not streamed. The final result still passes the existing evidence and Lens
  checks before it becomes a completed message.
- Markdown does not execute raw HTML, unsafe link schemes or embedded images.

## Deployment

Execution runs inside the **single API process**. SQLite stores acceptance,
current answer snapshots, tool status and terminal state. This is not a
distributed queue and does not support multiple API processes sharing a
Reflection execution.

After an unexpected process restart, previously active runs become
`interrupted`. Saved text remains available, but the server does not replay
questions or candidate writes. Graceful shutdown requests cancellation and
waits for tools to settle before storage can be closed.

For reverse proxies, disable buffering and caching for the SSE endpoint and
allow long-lived responses. The API sends `Cache-Control: no-cache,
no-transform`, `X-Accel-Buffering: no`, and a heartbeat every 15 seconds.
Slow subscribers are disconnected when their buffered output exceeds 1 MiB;
they can reconnect to a current snapshot without blocking Agent execution.

## Verification

The domain tests cover acceptance, idempotency, cancellation/completion races
and mutual exclusion. API tests use real HTTP streaming, temporary SQLite and
Git storage. Browser tests use a deterministic, abort-aware Reflection Agent,
so no external model credentials are required. A live-provider smoke test is a
separate check.
