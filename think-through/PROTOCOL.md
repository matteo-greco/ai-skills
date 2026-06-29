# think-through — Protocol

The wire contract between the agent, the `tt` helper, the node server, and the browser. SKILL.md
references this; you rarely need it open once the loop is running.

## The `tt` helper CLI

`tt` = `node "$SKILL_DIR/think-through.mjs"`. It wraps every server interaction so the agent
never writes raw curl, and it reads/writes the registry so cursors are handled for you.

| Command | Does | Underlying call |
|---|---|---|
| `tt boot --topic "<plan>" [--resume]` | preflight node, start server backgrounded, write registry, print `{url, sessionId, port, cursor}` | — |
| `tt ask <node.json>` (or stdin) | add the active question node | `POST /question` |
| `tt wait` | **long-poll** for the next event; prints it and advances the registry cursor. **Run in the background.** | `GET /wait?cursor=<auto>` |
| `tt retract <id…>` | mark nodes retracted (greyed, recoverable stubs) | `POST /retract` |
| `tt state` | print the full tree + cursor (rehydrate after compaction) | `GET /state` |
| `tt export` | print the user's chosen export path + resolved tree | `GET /export` |
| `tt kill` | stop the server, mark the registry session closed | — |

`tt wait` self-times-out (`--max-time 3600`) and prints `{"type":"timeout"}` on expiry — re-arm
it. A localhost socket won't drop, so timeouts are rare.

## Node payload (`tt ask`)

```json
{
  "id": "q7",
  "parent": "q6",
  "dependsOn": "q6=A",
  "question": "Clear, specific question.",
  "rationale": "One line: why this matters now.",
  "answerType": "single | multi | free | confirm",
  "options": [
    { "label": "A. …", "detail": "what it means / trade-off", "recommended": true },
    { "label": "B. …", "detail": "…" }
  ],
  "recommendation": "A — because …"
}
```

- `parent` / `dependsOn` are honest tree links — they drive revision/poisoning. Root question:
  `parent: null`, `dependsOn: null`.
- `recommendation` is required; mark one option `recommended: true` (UI pre-selects it).
- `options` omitted for `answerType: "free"`. `confirm` cards need no options either.
- Every non-`free` card also accepts a free-text **rider** — the UI always shows it.
- `single`/`multi` cards auto-include a **"None of the above"** choice paired with the rider. When
  the answer comes back as `selected: ["None of the above"]`, treat the **rider as the answer** —
  the user rejected every option and wrote their own.

## Wait events (`tt wait` output)

One JSON object, discriminated by `type`:

```json
{ "type": "answer",  "nodeId": "q7", "selected": ["A"], "rider": "…optional free text…" }
{ "type": "edit",    "nodeId": "q3", "selected": ["B"], "rider": "…" }
{ "type": "approve", "path": "docs/designs/runway-scenarios.md" }
{ "type": "cancel" }
{ "type": "timeout" }
{ "type": "server-down", "error": "connect ECONNREFUSED …" }
```

`timeout` → re-arm. `server-down` → `tt boot --resume`, then re-arm. Neither advances the cursor.

## Server endpoints (`server.mjs`)

Bound to **127.0.0.1** on a scanned-free port.

| Method | Path | Caller | Body / query |
|---|---|---|---|
| GET | `/` | browser | serves the page |
| GET | `/state` | browser (poll ~1s), `tt state` | → `{ tree, cursor, status }` |
| GET | `/wait?cursor=N` | `tt wait` | long-poll; → first event with `seq > N` |
| GET | `/export` | `tt export` | → `{ path, tree }` (valid after approve) |
| POST | `/question` | `tt ask` | node payload |
| POST | `/retract` | `tt retract` | `{ ids: [...] }` |
| POST | `/answer` | browser | `{ nodeId, selected, rider }` |
| POST | `/edit` | browser | `{ nodeId, selected, rider }` |
| POST | `/approve` | browser | `{ path }` |
| POST | `/cancel` | browser | — |

## Cursor & registry

- Every browser/agent event increments a monotonic `seq`. The **cursor** is the last `seq` the
  agent consumed; `tt wait` returns the first event with `seq > cursor`, so nothing is missed
  between waits.
- Registry: `scratchpad/think-through/<sessionId>.json` = `{ port, slug, cursor, status }`.
  `tt` reads it to find the port and advance the cursor; the agent reads it for recovery.
- State of record: the server's own `state.json` (persisted on every write — crash-safe).
