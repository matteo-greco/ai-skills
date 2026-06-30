# think-through — Engine Contract

think-through is a **skill-agnostic decision-walking engine**. It walks a user down a tree of
decisions one question at a time in an interactive browser document, and renders a live artifact
the user approves. It knows **nothing** about what is being decided — design, architecture,
tickets, anything. Concrete walks live in *other* skills that drive this engine; the engine never
names or assumes them.

This file is the contract a driving skill programs against. Wire details: [PROTOCOL.md](PROTOCOL.md).

## What the engine owns

- **Sessions** — boot/resume a local server (free port, 127.0.0.1 only), a registry entry, and
  persisted state. Multi-session, crash-resume, idle self-shutdown.
- **The card column** — the interaction: questions pushed by the driver, answered in the browser,
  with answer types `single | multi | free | confirm`, a free-text rider on every card, a
  "None of the above" choice on `single`/`multi`, and a pre-selected recommendation.
- **The decision tree** — nodes carry `parent` + `dependsOn`; revision/poisoning is supported.
  (Linear render today; the tree/alternate renderers are just other views of the same state.)
- **The artifact pane** — a live, read-only rendering of the deliverable-under-construction
  (markdown + Mermaid), shown beside the cards. The pane **is** the deliverable: on approve it is
  saved verbatim (no separate synthesis step).
- **The wait/wake loop** — long-poll so the driver spends zero tokens while the user thinks.
- **Export** — on approve, hand back the current artifact + the chosen path; the driver writes it.

## What a driving skill provides

The engine is generic; a driver supplies all the meaning:

1. **Seed** — what to explore/load before the first question (codebase, prior artifacts, ADRs).
   The engine does not read any of this; the driver does and turns it into questions.
2. **Questions** — the actual nodes (`tt ask`). Their content, order, and branching are entirely
   the driver's domain. The engine just renders and collects answers.
3. **Artifact renderer** — after each answer, the driver re-pushes the current artifact markdown
   (`tt artifact`). Its *shape* (a PRD, an event model, a ticket list, …) is the driver's choice;
   the engine only renders markdown + Mermaid.
4. **Artifact home** — the default export path the driver wants (the user can override in the
   approve UI). The engine stores and returns it; it does not decide it.

The engine exposes **no preset, template, or domain vocabulary.** If a concept is specific to a
kind of walk, it belongs in the driving skill, not here.

## The loop a driver runs

```
tt boot --topic "<thing>"          # start session, open browser
# seed: explore whatever this walk needs
loop:
  tt ask <node.json>               # push the active question
  tt artifact <artifact.md>        # (re)render the deliverable-so-far in the pane
  tt wait        &  end turn       # background long-poll; wake on the user's event
  on answer  -> refine, next question
  on edit    -> judge poisoning, re-ask only true casualties
  on approve -> tt export -> write the artifact to the chosen path -> tt kill
  on cancel  -> tt kill
  on timeout/server-down -> re-arm / tt boot --resume
```

The driver decides what every question and artifact *says*; the engine guarantees the session,
the rendering, the wait/wake, and the WYSIWYG save.

## Driver location

Driving skills locate the engine by sibling path under the skills directory, e.g.
`ENGINE="$(dirname "$SKILL_DIR")/think-through"` then `node "$ENGINE/think-through.mjs" …`. The
engine ships as a dependency installed alongside its drivers; it is **not user-invocable** on its
own.
