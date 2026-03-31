---
name: adr
description: Document an architectural decision — capture the context, options considered, decision made, and consequences. Works from a conversation, a completed feature, or a direct prompt.
disable-model-invocation: true
user-invocable: true
argument-hint: "[decision to document, or blank to discuss first]"
---

# ADR

You write Architecture Decision Records — concise documents that capture *why* a decision was made, not just *what* was decided. ADRs prevent relitigating past decisions and give future developers the context they need to judge whether a decision still holds.

## Input

An architectural decision from:
- `$ARGUMENTS` — a decision to document
- A conversation where a decision was just made (e.g. after a `/spec` or `/refactor` session)
- A direct prompt ("we decided to use X instead of Y, document it")

If the decision isn't clear yet, help the user think it through before writing.

## Step 1: Understand the decision

Gather the key elements:
- **What was decided?** — the specific choice made
- **What problem does it solve?** — the context that forced the decision
- **What alternatives were considered?** — and why they were rejected
- **What are the consequences?** — tradeoffs, risks, things that become easier or harder

If any of these are unclear, ask the user. A good ADR requires all four.

## Step 2: Check for existing ADRs

Before writing, check the project's ADR directory for:
- **Existing ADRs on the same topic** — is this an update or supersession of a previous decision?
- **Related ADRs** — decisions that constrain or interact with this one
- **Numbering convention** — what's the next number in the sequence?
- **Format convention** — does the project use a specific ADR template?

If the project doesn't have an ADR directory yet, ask the user where to create one. Common locations: `doc/architecture/decisions/`, `docs/adr/`, `adr/`.

## Step 3: Write the ADR

Use the project's existing format if one exists. Otherwise, use this structure:

```markdown
# [NUMBER]. [Decision title]

Date: [YYYY-MM-DD]

## Status

[Proposed | Accepted | Deprecated | Superseded by [ADR-NUMBER]]

## Context

[What is the problem or situation that requires a decision? What forces are at play — technical constraints, business requirements, team preferences, deadlines?]

## Decision

[What was decided. State it clearly and directly.]

## Alternatives considered

### [Alternative 1]
[Brief description and why it was rejected.]

### [Alternative 2]
[Brief description and why it was rejected.]

## Consequences

[What becomes easier, harder, or different as a result of this decision. Include both positive and negative consequences. Call out any risks or things to watch for.]
```

### Writing guidelines

- **Context** should make the problem feel real to someone who wasn't in the room. Include enough detail that a new team member could understand *why* the decision was necessary.
- **Decision** should be one or two sentences. If it takes a paragraph, the decision might be multiple decisions.
- **Alternatives** should be fair — describe them as their advocates would, then explain why they lost. Don't strawman.
- **Consequences** should be honest. Every decision has downsides — name them.

## Step 4: Present and iterate

Show the draft to the user. ADRs are important documents — get them right.

Common feedback:
- "The context is missing X" — they know constraints you don't
- "We didn't actually consider that alternative" — remove it
- "The consequences should mention Y" — they see downstream effects you missed
- "This is actually two decisions" — split them

## Step 5: Save

Write the ADR to the project's ADR directory with the correct number and a slug-style filename:
```
NNNN-decision-title-in-kebab-case.md
```

If the new ADR supersedes a previous one, update the old ADR's status to `Superseded by [new ADR number]`.

Commit the ADR with a message like:
```
docs(adr): add ADR NNNN — [decision title]
```

## Rules

- Never write an ADR without understanding the alternatives that were considered — "we chose X" is incomplete without "over Y and Z"
- Never invent alternatives the team didn't actually consider — ask
- Never skip consequences — every decision has tradeoffs, even good ones
- Keep ADRs short — one page is ideal. If it's longer, the decision might need splitting.
- An ADR records a decision at a point in time — don't update old ADRs to reflect new information. Write a new ADR that supersedes it instead.
