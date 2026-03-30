---
name: spec
description: Break a feature into acceptance criteria, explore the codebase for context, and optionally create tickets. Trigger when user says "spec this", "write ACs", "break this down", or describes a feature they want specified.
disable-model-invocation: true
user-invocable: true
argument-hint: [feature description or idea]
---

# Spec Skill

You take a feature idea and turn it into a well-structured set of acceptance criteria, informed by the current codebase. You iterate with the user until they're happy, then optionally create tickets.

## Input

A feature description from:
- The user's message
- `$ARGUMENTS` passed when invoking this skill
- A ticket or issue to refine

The description can be rough — a sentence, a paragraph, a screenshot. Your job is to sharpen it.

## Step 1: Understand the feature

Before writing anything, understand what exists. Explore the codebase to find:
- Related code, components, and patterns that this feature will touch
- Existing behavior that the feature extends or modifies
- Conventions and architecture that constrain the implementation

Share a brief summary of your findings with the user. Call out anything surprising or relevant — existing utilities that can be reused, patterns to follow, constraints to be aware of. This is the "technical context" section of the spec.

Don't write ACs yet. Confirm with the user that your understanding of the feature and the codebase context is correct before proceeding.

### Scope check

If the feature feels too large for a single spec — many moving parts, multiple independent behaviors, or touching unrelated areas of the codebase — say so. Suggest breaking it into smaller, independently-specifiable pieces before writing ACs. It's cheaper to split early than to discover mid-iteration that half the ACs belong in a different ticket.

## Step 2: Write acceptance criteria

Write ACs from the user's perspective:
- **"When I [do this], [that happens]"**
- **"When [condition], [expected outcome]"**

Each AC should describe one observable behavior. Avoid implementation language — no "the function returns", no "the API calls", no "the component renders". Describe what the user sees or experiences.

### Use ZOMBIES to find the right order

ZOMBIES is a thinking tool, not a rigid template. Use it to discover ACs you might miss and to find a natural ordering — but the final order should make sense for the feature, not force-fit a framework.

- **Z**ero — what happens when there's nothing? Empty states, no selection, no data, no input
- **O**ne — the simplest single case of the feature working
- **M**any — multiple items, repeated actions, collections
- **B**oundaries — edge cases, mode boundaries, limits
- **I**nterfaces — integration points, how this connects to other features
- **E**xceptions — what goes wrong? Errors, invalid input, failures
- **S**imple / happy path — the full end-to-end flow

Start by looking for Zero cases — they're easy to overlook and often reveal important baseline behavior. Then work through the other categories to make sure you haven't missed anything. Not every category will have ACs — that's fine.

Propose an order and explain your reasoning, but the user decides. If they want to reorder, do it.

### Establish a precondition if helpful

If all ACs share a common setup, state it once at the top rather than repeating it:

> Given that [precondition]

## Step 3: Iterate

Before presenting, self-review the draft:
- Any AC that's vague or could mean multiple things? Sharpen it.
- Any ZOMBIES category you didn't consider? Think about why — is it genuinely not applicable, or did you miss something?
- Any two ACs that overlap or could be collapsed?
- Any AC that describes implementation rather than behavior? Rewrite it.

Then present the ACs to the user. This is a conversation, not a handoff.

Expect feedback like:
- "This AC is too vague"
- "These two should be one"
- "You're missing the case where..."
- "This isn't a Zero case, it's a Boundary"
- "Reorder these"

Revise and re-present until the user says they're happy. Do not rush this step.

## Step 4: Technical findings (optional)

If your codebase exploration in Step 1 uncovered relevant technical details, include a brief "Technical context" section alongside the ACs:

- Key files that will be touched
- Existing functions or patterns to reuse
- Architectural constraints or gotchas
- Dependencies between ACs

Keep it concise — bullet points, not paragraphs. This section helps whoever picks up the implementation (whether it's `/tdd` in this session or a developer reading the ticket later).

## Step 5: Create tickets (optional)

Ask the user: "Want me to create a ticket for this?"

If yes:
- Check what project management MCP tools are available (Linear, Jira, GitHub Issues, etc.)
- Ask the user which project/team to create the ticket in if not obvious
- Include the ACs and technical context in the ticket body
- Return the ticket URL/ID to the user

If the feature is large enough to warrant multiple tickets, propose a split and get approval before creating them.

If no MCP tools are available for ticket creation, offer to format the spec as copyable markdown instead.

## Step 6: Hand off to implementation (optional)

If the user wants to implement immediately, suggest running `/tdd` with the ACs you just wrote. The spec output is designed to be valid `/tdd` input.

## Rules

- Never skip codebase exploration — ACs written without context miss edge cases and duplicate existing behavior
- Never finalize ACs without user approval — iterate until they say it's done
- Always write ACs from the user's perspective, never from the implementation's perspective
- Use ZOMBIES to suggest an order and catch missing cases — but the user decides the final ordering
- Don't write implementation plans — that's `/tdd`'s job. Technical context is fine; step-by-step implementation instructions are not.
