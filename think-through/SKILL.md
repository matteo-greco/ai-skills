---
name: think-through
description: Walk a half-formed plan down its decision tree one question at a time in an interactive browser document, then export the agreed design as markdown. Use when the user says "think this through", "grill me in the browser", "walk me through this design", or wants to stress-test a plan without the chat back-and-forth.
disable-model-invocation: true
user-invocable: true
argument-hint: "[a plan, design, or problem to think through]"
---

# think-through

You walk the user down the **decision tree of a plan, one question at a time** — recommending
an answer at each step and pushing back on theirs. The interaction happens in an **interactive
HTML document** in the browser, not in chat, served by a local node process. On approval you
export the agreed design as **markdown**.

Two companions, one level deep:

- [DESIGN.md](DESIGN.md) — why the machinery is shaped this way. Read once before your first run.
- [PROTOCOL.md](PROTOCOL.md) — node payload schema, `tt` commands, and wire endpoints.

## The model

- The page is a **growing column of cards**: resolved Q&As stay above, the bottom card is
  **active**.
- Questions are **adaptive** — ask **one at a time**, never batch.
- Internally the questions form a **tree** (each node has a `parent` and the `dependsOn` branch
  that spawned it). v1 renders it linearly.
- You **never block the model**: ask, wait in the **background**, end your turn. The user's
  answer wakes you. Zero tokens while waiting.

## Input

A plan, design, or problem from `$ARGUMENTS` or the user's message. Rough is fine. If it's too
vague to find a first real question, ask **one** clarifying question in chat before booting —
don't boot a session to ask "what do you want to build?".

## Prerequisites

`$SKILL_DIR` is this skill's own directory (the one containing this SKILL.md). `tt` below is the
helper CLI: `node "$SKILL_DIR/think-through.mjs"`. It wraps every server call
(boot, ask, wait, retract, state, export, kill) so the loop can't be fumbled. See PROTOCOL.md.
`tt boot` preflights node and fails clearly if it's missing — **don't fall back to chat**.

## Process

### 1. Boot

- `tt boot --topic "<plan>"` — starts the server (free port, **127.0.0.1 only**), writes the
  registry, prints `{url, sessionId, cursor}`. `open` the URL and show it to the user.
- Compose the first question.

### 2. Loop — once per question

1. **Ask** — `tt ask <node.json>` (schema in PROTOCOL.md). Always set `recommendation` and mark
   the recommended option; the UI pre-selects it. `single`/`multi`/`confirm` always also accept
   a free-text rider — expect "B, but actually…".
2. **Wait** — launch `tt wait` **in the background**, then **end your turn**. Don't poll, sleep,
   or use ScheduleWakeup.
3. **On wake**, dispatch the event:
   - **answer** → read the choice + rider. Weak, surprising, or contradictory? Push back with a
     sharper child question. Otherwise ask the next.
   - **edit** → see [Revision](#revision).
   - **approve** → go to step 3.
   - **cancel** → `tt kill`, confirm nothing was written, stop.
   - **timeout** → re-arm `tt wait`, end turn. (Heartbeat; cheap.)
   - **server-down** → the server died. `tt boot --resume` (restarts against persisted state),
     `open` the new URL, re-arm `tt wait`. The browser reconnects on its next poll.

Nothing left to ask? `tt ask` a `confirm` card asking the user to review and approve, then wait.

### 3. Export

- `tt export` returns the user's chosen path and the resolved tree.
- Write **markdown** there: title + one-line summary; one section per resolved node (question,
  chosen answer + rider, one-line rationale); an **Open questions** section. Omit retracted
  branches. No transcript, no rejected recommendations, no timestamps.
- `tt kill`. Print **both** paths: the saved markdown and the ephemeral HTML.

## Revision

An **edit** event means the user changed a resolved answer. **Poisoning is your judgment, not
the server's:** decide which descendants genuinely die (a child may still hold even though its
parent moved), `tt retract <ids>` only those, re-ask the casualties, resume. Reverting an edit
restores the stubs automatically.

## Recovery (after context compaction)

Lost the live session? `tt state` rehydrates the tree from the registry. Server dead
(connection refused)? `tt boot --resume` restarts it against the persisted state; the browser
reconnects on its next poll. The server is the source of truth; the registry is just its
address.

## Rules

- **Never grill in chat.** No node → stop; don't fall back.
- **One question at a time.** Always recommend and pre-select.
- **Never block the model:** ask, background-wait, end turn.
- **Push back** on weak or surprising answers — a sharper follow-up, not silent acceptance.
- **Poisoning is judgment** — re-ask only what genuinely died.
- **Markdown is the deliverable;** the HTML is ephemeral.
- **localhost only** — the server binds 127.0.0.1; never expose a grill.
