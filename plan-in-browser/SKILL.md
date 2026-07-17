---
name: plan-in-browser
description: Run an installed planning or grilling skill through an interactive browser canvas instead of asking its human-in-the-loop questions in the terminal. Invoke with the source skill name followed by its normal arguments.
disable-model-invocation: true
argument-hint: "<source-skill> [request]"
---

# Plan in Browser

Run another installed planning skill unchanged except for its human interaction transport: every
question is presented and answered in the browser canvas.

`$SKILL_DIR` means this skill's directory (the directory containing this `SKILL.md`).

## Invocation

The first argument is the source skill name; the remainder is that skill's request. Examples:

```text
/skill:plan-in-browser grill-me Design a caching layer
/skill:plan-in-browser grill-with-docs Clarify the billing model
/skill:plan-in-browser wayfinder Replace the persistence architecture
```

If the source skill name is missing, report the usage above. Do not start a planning conversation
in the terminal.

## Load the source discipline

1. Resolve the source skill dynamically:

   ```bash
   node "$SKILL_DIR/resolve-skill.mjs" <source-skill>
   ```

2. Read the returned `SKILL.md` completely and follow its relative Markdown references when they
   are relevant to the requested workflow.
3. If it delegates to another skill (for example `grill-me` delegates to `grilling`), resolve and
   read that skill in the same way. Do not invoke a slash command and lose the canvas transport
   rule.
4. Follow the source skill's planning method, repository operations, side effects, and completion
   criteria unchanged. This skill changes only how HITL questions are delivered.

## Transport invariant

Every question or decision that needs a human answer MUST go through the browser canvas. Never put
such a question in assistant prose and never use a terminal selector. Status updates, findings,
tool activity, and the final outcome may still appear in the terminal.

This invariant applies recursively to every discipline the source skill composes.

Ask exactly one question at a time unless the source skill explicitly requires otherwise. Include
a recommendation whenever the source discipline calls for one. Treat the canvas result as
authoritative user feedback even though it arrives as a tool result.

### Preferred transport: Pi extension

When the `planning_canvas` tool is available, call it with the question. It opens or reuses the
browser canvas and blocks until the user answers. Dispatch its result:

- `answer`: continue the source skill using `selectedOptionIds` and `note` as the user's response.
- `edit`: reconsider the revised decision and any later decisions it invalidates, then continue.
- `cancel`: call `planning_canvas_close` and stop without pretending the plan completed.
- `timeout`: call `planning_canvas` again with the same active question to resume waiting.

When the source workflow is complete, call `planning_canvas_close`.

### Portable fallback: shell CLI

If `planning_canvas` is unavailable, use the bundled CLI. This works in agent harnesses with a
blocking shell tool:

1. Start once and retain the returned `sessionId`:

   ```bash
   node "$SKILL_DIR/canvas.mjs" start --topic "<short topic>"
   ```

2. Write each question payload to a temporary JSON file, then block for the browser answer:

   ```bash
   node "$SKILL_DIR/canvas.mjs" ask --session <sessionId> --file <question.json>
   ```

3. If an edit event arrives while another question remains active, handle it and then wait again:

   ```bash
   node "$SKILL_DIR/canvas.mjs" wait --session <sessionId>
   ```

4. On completion or cancellation:

   ```bash
   node "$SKILL_DIR/canvas.mjs" close --session <sessionId>
   ```

Do not run `ask` or `wait` in the background. The blocking tool call is intentional: answering in
the browser resolves it and relays the answer directly into the agent context.

## Question contract

```json
{
  "id": "stable-question-id",
  "question": "A clear, specific question",
  "context": "Why this decision matters now",
  "answerType": "single",
  "options": [
    { "id": "a", "label": "First choice", "detail": "Trade-off or consequence" },
    { "id": "b", "label": "Second choice", "detail": "Trade-off or consequence" }
  ],
  "recommendedOptionIds": ["a"],
  "recommendation": "Prefer the first choice because …"
}
```

`answerType` is `single`, `multi`, `free`, or `confirm`. Omit `options` for `free` and `confirm`.
Option IDs are stable identities; labels are display text. Choice questions always permit a note
and a custom "None of the above" answer. Recommendations are preselected.
