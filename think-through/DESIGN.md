# think-through — Design Doc

> Status: v1 built and working (standalone skill). A **restructure into an engine + preset
> skills** is agreed but not yet built — see [Restructure](#restructure-engine--presets) below
> and the contracts in [ENGINE.md](ENGINE.md) + [PRESETS.md](PRESETS.md). The sections under
> "What it is" / "Core decisions" / "Machinery" describe the working v1; the Restructure section
> records what supersedes them.

## What it is

You show up with a half-formed plan. `think-through` walks you down the **decision tree
one question at a time** — recommending an answer at each step, pressure-testing yours,
branching as choices open new questions, letting you revise earlier answers. You do this in
a **comfortable HTML document** in your browser instead of a chat slog. When you approve,
it emits a **markdown design doc**: what you decided and why.

The function is: *turn fuzzy intent into a committed, written design through guided
decision-making.* The HTML/server/tree machinery is just the delivery vehicle.

It is a **new, standalone skill** — not derived from, and not replacing, any other grilling
skill. Lives in this repo (`~/code/ai-skills/think-through/`).

## Why it exists

The pain it removes: reaching shared understanding through long chat back-and-forth is
uncomfortable to *read and follow*. A structured, accumulating document is a far better
surface for a branching argument than a linear transcript. The terminal stays great at one
thing — accepting free-text — but it's a poor place to *review* a multi-branch design.

## Core decisions

### 1. Role of the HTML: interaction surface **and** final artifact (B+C)

- You interact **directly in the HTML** (the comfortable medium), not in the terminal.
- The artifact you approve **is the document itself**.
- On approval it is converted to **markdown** (HTML is for humans; markdown is for agents).

Rejected: read-only reflection (A) — chat stays the input. Too little gain; the *during*
discomfort survives.

### 2. Living document, one active question

Grilling is **adaptive** — question N+1 depends on answer N — so a fill-everything-then-submit
form is impossible. Instead:

- The page is a **growing column of cards**. Resolved Q&As stay rendered above (a readable,
  accumulating design doc). The bottom card is the **active** question with its input.
- Answer it → it locks into a resolved card → the next active card appears below.
- At the end, the whole column **is** the artifact you approve. (B and C unified: one
  surface is both the interaction and the deliverable.)

### 3. The data model is a tree (even though v1 renders it linearly)

Every question is a **node**:

```json
{
  "id": "q7",
  "parent": "q6",
  "dependsOn": "q6=A",
  "question": "…",
  "rationale": "why I'm asking",
  "answerType": "single | multi | free | confirm",
  "options": [{ "label": "A. …", "detail": "…", "recommended": true }],
  "recommendation": "A — because …",
  "answer": null,
  "status": "active | resolved | retracted"
}
```

- **v1 renders the tree as a linear card column** (depth-first walk of the resolved path).
- **v2 swaps in a real tree renderer** over the same JSON — no rework. Tree underneath,
  linear on top.
- A tree (not a list) is required even in v1 because **revision needs poisoning**: editing a
  node invalidates descendants whose `dependsOn` no longer holds.

### 4. Node contract (what the agent POSTs per question)

- **Answer types:** `single` (radio), `multi` (checkboxes), `free` (textarea), `confirm`
  (yes/proceed).
- **Every choice card also carries an optional free-text rider** ("B, but actually…") —
  `single`/`multi` are *choice + optional elaboration*, never pure radio. Grilling answers
  are rarely clean selections.
- **The recommendation is pre-selected** in the UI (radio pre-checked, rec text shown) so the
  comfortable path is "glance, accept."

### 5. Revise + poisoning — agent-judged, dead nodes recoverable

You can edit an already-answered card.

- **Who decides what's poisoned: the agent, not the server.** Mechanical `dependsOn`-chain
  poisoning over-kills valid nodes (a descendant may still hold even if its parent changed).
  Editing a card **wakes the agent**; it judges which descendants actually die and re-asks
  only those. The server flags descendants "stale, pending agent review" in the meantime.
- **Dead nodes are not deleted.** They collapse to greyed "retracted (q3 changed)" stubs.
  Keeps history honest, and reverting the edit brings them back.
- Re-asked nodes become the new active card(s).

### 6. Export — markdown is the deliverable

On **Approve**:

- Emit a **resolved design** (not a transcript): title + one-line summary; one section per
  resolved node (question, chosen answer + free-text rider, one-line rationale); an "Open
  questions" section for anything unresolved at approve time. Dropped/retracted branches
  omitted (optionally a terse "Considered and dropped" appendix). No radio noise, no rejected
  recommendations, no timestamps.
- **Path is chosen at approve time** — the page shows a path field defaulting to something
  sane (e.g. `docs/designs/<slug>.md`), overridable before write, because the right home
  differs per repo. The agent does the actual Write after wake (it has the tool + repo
  context).
- **HTML is ephemeral** (temp dir, like `improve-codebase-architecture`) — but its path is
  **printed** so you can re-open it. Markdown is the only survivor.

## Machinery

Topology:

```
Browser (HTML, polls state)  ──answer POST──►  local node server  ──writes──►  state.json
        ▲                                                                          │
        └───────────────── polls /state (~1s) ◄───────────────────────────────────┘
Agent ──POST /question──► server ;  background wait-curl ◄── reads next answer/approval
```

### Server: node stdlib, zero deps

- `server.mjs`, built on node's built-in `http` (~80 lines). **Zero npm deps** — same
  zero-install property as a Python stdlib server, but in the language we debug in, and dodges
  macOS python3 stub / PEP-668 quirks.
- Node is present ~99% of the time this runs; the skill does a `node -v` **preflight** and
  fails with a clear message on the 1% host without it.
- Rejected: Python stdlib (A) — ubiquity edge vanishes once node is assumed present.
  Rejected: express/framework (C) — needs install; stdlib covers serve + POST + long-poll.

### Single-writer server (no race)

- **The server is the sole writer of state.** State lives inside the server process (in
  memory, persisted to `state.json` for crash recovery). The agent never touches the file.
- Agent ↔ server through a bundled **`tt` helper CLI** (`think-through.mjs`), with `curl` as the
  underlying transport. The helper wraps boot/ask/wait/retract/state/export/kill and manages the
  registry cursor, so the agent never writes raw curl and the per-question loop can't be fumbled.
  This follows the "scripts for deterministic, repeated ops" principle — saves tokens and
  improves reliability over generated curl. Wire contract lives in [PROTOCOL.md](PROTOCOL.md).
  - `POST /question` — add a node (`tt ask`).
  - `GET /wait?cursor=N` — **long-poll**, blocks until the next answer/approval, or times out
    (`tt wait`). `cursor` is a monotonic counter so no event is missed between calls.
- Browser ↔ server over `fetch`: `GET /state` (poll ~1s), `POST /answer`, `POST /approve`,
  `POST /edit` (revise), `POST /cancel`.
- One serialized writer kills the JSON-clobber race by construction.

### Sleep/wake — zero tokens while waiting

The agent is turn-based; "waiting" must not burn tokens.

- Agent POSTs the question → launches `curl --max-time <long> .../wait?cursor=N` **in the
  background** → **ends its turn.** The model is now fully idle (**zero tokens**); the node
  server holds the long-poll open (compute, not tokens).
- Browser POSTs the answer → server responds → curl exits → **the harness wakes the agent**
  with the answer as the tool result. The browser answer *is* the wake signal.
- Result: **one model invocation per answered question** — the optimal floor.
- No `ScheduleWakeup` polling (it re-invokes blindly on a timer = wasted runs).
- Unavoidable floor: prompt cache TTL is 5 min. Answer in <5 min → warm re-read (cheap);
  take longer → that one wake pays a cold context re-read. One context read per answer either
  way.
- On the rare wait-curl timeout, the agent just **re-arms** (one cheap turn). `--max-time` set
  generous because a localhost socket won't drop.

### Lifecycle

- **Boot:** `node -v` preflight → generate session id + slug → start `server.mjs` backgrounded
  on a **scanned-free port bound to 127.0.0.1 only** (never exposed) → `open` the URL, print
  it → write first node → arm background wait-curl → end turn.
- **Teardown:** Approve or Cancel → wait-curl returns terminal status → agent exports markdown
  (skipped on cancel) → kills server PID → prints HTML + markdown paths.

### Multi-session (falls out of the architecture)

- Each grill: own session id, own port, own `state.json`.
- Registry: `scratchpad/think-through/<sessionId>.json` = `{port, slug, cursor, status}`.
- Concurrent grills across repos just work; recovery picks the session by slug/repo.

### Resilience — survive walking away for an hour

The motivating scenario: start a grill, join a 1-hour call, come back, lose nothing.

- **Idle-shutdown keys off browser-poll age, not user activity.** An open tab keeps polling
  `/state` every ~1s through the whole call → server stays up. Idle-shutdown fires only when
  polls **stop** (tab closed), and is generous (~2h).
- **Agent is fully yielded during the wait** — background curl, turn ended, zero tokens for
  the whole hour. No compaction happens while idle (the agent isn't running).
- **Persist every write to `state.json`** — crash-safe at all times.
- **Server death self-heals.** If the server dies (idle-exit, OOM, laptop sleep past
  timeout), the agent's wait-curl connection drops → curl exits nonzero → the harness wakes
  the agent → it restarts `server.mjs` against the persisted `state.json`; the browser
  reconnects on its next poll. *The thing that breaks is the thing that triggers the repair.*
- **Coming back:** refocus the tab (it never stopped polling) and answer the active card — the
  agent wakes on your answer. If the tab was closed, reopen the printed URL (server's still up
  within the idle window, or the next interaction heals it).
- **Recovery after agent context compaction:** the agent's rule — if it doesn't know the live
  session, read the registry file and `curl /state` to rehydrate the tree + cursor. The server
  is the source of truth; the registry is just the address.

## Restructure: engine + drivers

> Agreed in a follow-up grilling session, after v1 shipped and was used on a real feature.
> This supersedes the "standalone skill" framing above. The engine contract is in
> [ENGINE.md](ENGINE.md). The concrete walks that *drive* the engine are a separate suite,
> captured outside this dir (the engine stays skill-agnostic) — see
> `../feature-lifecycle-suite.md`. This section records the engine-side *why*.

### The realisation

think-through is not "a design-grilling skill" — it's a **skill-agnostic decision-walking
engine**. The same ask→answer→refine loop serves many situations; the *meaning* of any
particular walk lives in a separate **driving skill**, never in the engine.

### Decisions

1. **think-through becomes a pure engine — not user-invocable, and preset-free.** It owns the
   scripts (`server.mjs`, the `tt` CLI, the page) and the loop/protocol contract, and exposes
   **no preset, template, or domain vocabulary**. (Like a shared `grilling` core that thin skins
   ride on.) Driving skills locate it by sibling path under `~/.claude/skills/`. Kept clean from
   the start — no "temporary" bundling of drivers, since that would bake the very coupling the
   split exists to prevent.

2. **A driver provides all the meaning** (full interface in ENGINE.md): **seed** (what to
   explore/load first), **questions** (the nodes), **artifact renderer** (the deliverable markdown
   it re-pushes each turn), **artifact home** (default export path). The engine guarantees the
   session, rendering, wait/wake, and the WYSIWYG save — nothing domain-specific.

3. **Separate session + separate document per driver.** Drivers run at different times, so each
   opens its own engine session and writes its own artifact. Composition flows through the
   **saved documents** (durable), each driver **seeding** from prior ones. A shared live window
   is at most a v2 same-sitting nicety.

4. **Configurable, discoverable artifact homes.** Defaults work with zero setup; an optional
   `.think-through.json` at repo root pins dirs + tracker so a driver can auto-find prior
   artifacts to seed from. Per-run override stays in the approve UI's path field. (The *homes* are
   an engine concern — predictable locations; *which* artifacts go where is a driver concern,
   captured in the suite doc.)

### Engine deepening — the live artifact pane (WYSIWYG)

The card column alone is too shallow once a driver builds a *structured* artifact (e.g. an event
model): you answer cards but the thing you actually care about is invisible until export. So the
engine grows a second view. This is engine-level and **driver-agnostic** — the engine renders
whatever markdown a driver pushes.

5. **A live artifact pane beside the cards**, read-only, refreshed as decisions land. The engine
   provides the seam (an artifact-push endpoint + a pane); each **driver provides the renderer**
   (by pushing markdown). The pane appears only when an artifact has been pushed — drivers that
   don't push get full-width cards.

6. **WYSIWYG convergence: the artifact pane *is* the deliverable.** This replaces v1's
   approve-time synthesis. The driver maintains the artifact live (`tt artifact` → `POST
   /artifact`); on approve it is saved verbatim. Re-splits the two concepts v1 had conflated:
   **card column = the interaction; artifact pane = the deliverable.** Renders markdown + Mermaid
   via CDN. This subsumes the deferred **tree-view** — that's just another pane renderer.

7. **Refinement flows through cards** (v1 of the pane is read-only). You don't click the artifact;
   the driver proposes a change in a card, you reject/amend, the pane updates. v2 middle path:
   clickable artifact elements that spawn an "edit this" card — pointing-at-the-artifact without
   building a full visual editor.

8. **Layout: side-by-side split** — cards left (~40%), artifact right (~60%), independent scroll;
   collapses to tabs on narrow width. Side-by-side is what makes the live preview worth having
   (answer a card → watch the artifact change).

### Build order for the restructure

Engine work only (the driver suite has its own plan in `../feature-lifecycle-suite.md`):

1. Add the artifact pane + `tt artifact` / `POST /artifact`; render markdown + Mermaid in a
   side-by-side pane.
2. Switch export to save the live artifact verbatim (kill approve-time synthesis).
3. Demote `SKILL.md` → the engine is non-invocable; `ENGINE.md` is the contract drivers program
   against. Keep the existing card/wait/resume machinery untouched.

## Scope

### In scope (v1)

- HTML living-document grilling, one active question at a time.
- Tree data model, rendered linearly.
- Four answer types + free-text rider, pre-selected recommendation.
- Agent-judged revise/poisoning, recoverable retracted nodes.
- Markdown export with path override.
- Node stdlib single-writer server, sleep/wake via background curl.
- Full lifecycle: localhost bind, idle self-shutdown, multi-session, persist + self-heal.

### Deferred (v2)

- **Tree view** — swap the linear renderer for a real tree (minimap + cards, or interactive
  graph). Data model already supports it.
- **Docs-aware variant** — inline `CONTEXT.md` / ADR writes during the grill (a "📝 proposed
  doc change — accept/edit/skip" card type). The agent-side doc-writing judgment interrupts
  the clean question→answer loop; its own design problem. Out of v1.

## File layout (progressive disclosure)

Engine dir holds **engine-only** files (skill-agnostic). Driver skills live in their own sibling
dirs; their specs are captured in `../feature-lifecycle-suite.md`, not here.

```
think-through/                  # the engine (not user-invocable)
├── ENGINE.md           # the contract a driving skill programs against (skill-agnostic)
├── DESIGN.md           # this file — rationale / decision record
├── PROTOCOL.md         # wire contract: tt commands, node payload, endpoints, cursor
├── think-through.mjs   # the `tt` helper CLI
├── server.mjs          # node stdlib server
├── page/               # the side-by-side cards + artifact-pane UI
└── SKILL.md            # v1 manual — superseded by ENGINE.md when the engine goes non-invocable
```

The v1 standalone `SKILL.md` stays until the restructure build lands, then is removed (engine is
not invoked directly). Driver skills (`explore-idea`, `define-architecture`, `create-tickets`)
each get their own dir + `SKILL.md` at build time.

## Open questions

- HTML aesthetic — reuse the `improve-codebase-architecture` editorial style (Tailwind CDN,
  stone/slate, generous whitespace)? Likely yes; not yet decided.
- Exact `--max-time` value and idle-timeout duration — tune during implementation.
- Cancel vs. "save draft and exit" — is there a third terminal state (pause, resume later via
  registry)? Resilience already supports resume; whether to expose an explicit "pause" button
  is undecided.
