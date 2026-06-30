# Feature-lifecycle suite — plan

> Status: agreed, not yet built. Three thin skills that walk a feature from idea → architecture →
> tickets, each driving the **think-through** engine (the skill-agnostic decision-walking engine;
> contract in `think-through/ENGINE.md`). The engine knows nothing about these skills; all the
> meaning lives here. Long-term goal: a self-owned suite with **no dependency on Matt Pocock's
> `to-prd` / `to-issues`** (those are inspiration only and become deletable).

## The chain

| Where you are | Skill | Produces | Seeds from |
| --- | --- | --- | --- |
| Rough idea | **explore-idea** | a **PRD** (problem, solution, user stories) | — |
| Defined feature, need architecture + test seams | **define-architecture** | an **event model** (+ ADRs) | PRD + codebase |
| Defined everything, need breakdown | **create-tickets** | **vertical tracer-bullet tickets** | PRD + event model |

**Escape hatches:** a small feature skips define-architecture (explore-idea → create-tickets); a
tiny one is implemented straight from the PRD.

Each skill = **self-contained**: it does the engine-walk **and** produces its own artifact. Each
runs as its **own engine session** with its **own document**; composition flows through the saved
documents (a later skill seeds from earlier ones), not a shared live window.

A skill drives the engine by supplying the four things ENGINE.md defines — **seed, questions,
artifact renderer, artifact home**. Below is each skill's version of those.

## explore-idea

- **Walks:** the idea — is it worth building, what is its shape and boundary.
- **Seed:** the user's rough input + light codebase context. No architecture.
- **Question strategy:** clarify problem, who it's for, the solution shape, what's out of scope.
  Stay at product altitude; defer *how*.
- **Artifact (live pane):** a **lean PRD** — problem, solution, **user stories**. Deliberately
  **omits architecture + testing** (that's what made the old fused PRD rot). Stories get low human
  review but high *agent* value downstream — create-tickets references them heavily, so write them
  extensively.
- **Home:** `docs/prd/<slug>.md` (default; configurable).

## define-architecture

- **Walks:** architecture + **test seams** — the two concerns the PRD dropped, now walked
  rigorously.
- **Seed:** the PRD + the codebase + existing ADRs + `CONTEXT.md` glossary + CODING_STANDARDS
  (seam discipline: prefer existing seams, highest seam possible).
- **Question strategy:** **Event Modeling (Dymitruk) is the spine** for behavioral features —
  lay the feature out as a timeline of trigger → command → event → read-model → UI. Each
  command-handler / projection in the model **is a test seam**, so the seam decisions fall out of
  the model rather than being brainstormed. **Optional spine:** fall back to an ADR + seam-map
  walk for non-behavioral changes (UI tweak, config) — forcing the model there is ceremony.
- **Artifact (live pane):** an **event model** — see format below. Genuine, hard-to-reverse
  trade-offs are also recorded as **ADRs** (side effect, same discipline as the docs-aware grill).
- **Home:** `docs/designs/<slug>.event-model.md` (default; configurable).

### Event-model file format

Markdown container (agent-native, diffable) with two parts:

1. A **Mermaid `sequence`/flowchart** timeline overview (the visual; renders on GitHub).
2. **One section per vertical slice**, fixed-heading skeleton:

```markdown
## Slice 3 — Exclude tax events from run-rate

- **Trigger:** user toggles "exclude tax events" in the scenario panel
- **Command:** SetTaxExclusion { scenarioId, excluded }
- **Event(s):** TaxExclusionSet
- **Read-model:** RunwayProjection (recomputed run-rate window)
- **UI:** scenario panel toggle → runway hero updates
- **Seam:** pure projection engine — feed events + flag, assert run-rate excludes tax rows.
  Highest-value seam (per CODING_STANDARDS).
- **Notes:** structural-break case interacts here — see Slice 5.
```

The **seam line is the bridge**: define-architecture's per-slice test-seam decision, carried
verbatim into the ticket so RGR has its target named. Loose fixed headings (not a strict YAML
data block) — slicing downstream is agent-judged, not codegen, so headings are anchor enough.

## create-tickets

- **Walks:** slicing — turning the event model into independently-grabbable work.
- **Seed:** the event model + the PRD + the repo's tracker (GitHub Issues here) + triage vocab.
- **Question strategy:** confirm/adjust the **vertical tracer-bullet** slices (each cuts through
  all layers end-to-end; demoable on its own; prefer many thin over few thick), their order, and
  HITL-vs-AFK. The event-model slices are the starting proposal, so this is near-mechanical.
- **Artifact (live pane):** the **ticket list** — title, type (HITL/AFK), blocked-by, the slice's
  seam carried in. On approve, **creates the issues** in the tracker (self-contained; does not
  hand off to `to-issues`).
- **Home:** the repo's issue tracker. **Replaces** the existing `create-tickets` skill in this
  repo.

## Cross-cutting

- **Artifact homes:** defaults above; optional `.think-through.json` at repo root pins
  `{ designsDir, prdDir, tracker }` so each skill can auto-find prior artifacts to seed from.
  Per-run override stays in the engine's approve UI path field.
- **Engine dependency:** all three locate the engine at its sibling path under the skills dir and
  shell out to `think-through.mjs`. They ship/install together with the engine.
- **Naming:** `create-tickets` collides with the current repo skill and with Matt's `to-issues` —
  intended; the new one replaces the old (repo is being rebuilt).

## Build order

1. Engine first (artifact pane + WYSIWYG + non-invocable) — see `think-through/DESIGN.md`.
2. `explore-idea` (PRD renderer + seed/strategy).
3. `define-architecture` (event-model renderer + ADR side-effects + seam discipline).
4. `create-tickets` (slice the event model → tracer-bullet issues in the tracker).
