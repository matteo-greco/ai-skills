---
name: create-tickets
description: Create one or more well-structured tickets from a spec, ACs, or feature description. Trigger when user says "create tickets", "file this", "turn this into tickets", or has ACs ready to track.
disable-model-invocation: true
user-invocable: true
argument-hint: "[spec, ACs, feature description, or ticket URL to split]"
---

# Create Tickets

You take a spec, a set of acceptance criteria, or a feature description and turn it into well-structured tickets in the team's project management tool. You handle the mechanics — splitting, structuring, labeling, and linking — so the user can focus on what to build.

## Input

Material to create tickets from:
- `$ARGUMENTS` — ACs, a feature description, or a ticket URL to refine/split
- Output from a previous `/spec` run in this conversation
- A document, issue, or discussion the user points you to

The input quality varies. A polished spec with ordered ACs is the ideal case. A rough paragraph is fine too — you'll structure it.

## Step 1: Understand the work

Before creating anything, make sure you understand what's being asked:

- **Read the input carefully** — what are the distinct pieces of work?
- **Check the codebase** — if you have access, briefly explore the relevant code to validate that the described work makes sense and catch obvious gaps
- **Identify dependencies** — does any piece need to be done before another?

Also check for a **`.tickets.md`** file in the repo root. This is an optional project-specific config that provides defaults and conventions this skill can't infer. It might include:

- **Default team/project** — where tickets go unless specified otherwise
- **Label taxonomy** — the project's label names and when to use each one
- **Description template** — a different structure than the default Summary + ACs format
- **Sizing guidance** — what "too big for one ticket" means for this team (e.g., "no ticket should span more than 2 days of work")

If it exists, follow it — its values override the defaults in this skill.

If the input is vague or missing important details, ask the user to clarify before proceeding. Don't invent requirements.

## Step 2: Check for duplicates

Before creating anything, search the PM tool for existing tickets that cover the same work:

1. Extract key terms from the input
2. Search open issues in the target team/project
3. If a substantially similar ticket already exists, tell the user and ask whether to proceed, update the existing ticket, or stop

This prevents duplicate work and surfaces related context the user may not be aware of.

## Step 3: Determine ticket structure

Decide whether this is one ticket or many:

- **Single ticket** — the work is cohesive, can be done in one pass, and has a clear definition of done
- **Multiple tickets** — the work has independent pieces that can be worked on separately, or is too large for one ticket

If splitting, each ticket should be:
- **Independently deliverable** — it can be completed, reviewed, and merged on its own
- **Vertically sliced** — delivers a thin slice of user-visible value, not a horizontal layer (e.g., "add the API endpoint" + "add the UI" is worse than "users can create a widget" + "users can edit a widget")
- **Ordered** — if there are dependencies, the order should reflect them

Present the proposed structure to the user: "I see N tickets here — here's how I'd split them." Get approval before creating anything.

## Step 4: Structure each ticket

For each ticket, prepare:

### Title
- Short, action-oriented — describes what changes from the user's perspective
- Good: "Support bulk selection in the asset list"
- Bad: "Asset list improvements" or "Implement bulk select feature for asset management component"

### Description

Use this structure:

```markdown
## Summary

[1-3 sentences describing the problem or feature and why it matters]

## Acceptance Criteria

- [ ] [User-observable outcome or behavior change]
- [ ] [Another criterion]
```

AC rules:
- Each criterion describes a **user-observable outcome** — what the user can see, do, or experience differently
- Keep criteria **critical only** — if it's not essential for "done", leave it out
- Use clear, testable language — someone should be able to verify each criterion with a yes/no
- Typically 2-5 criteria. More than 5 suggests the ticket should be split.
- If the input already has well-structured ACs (e.g., from `/spec`), preserve them — don't rewrite what's already good

### Implementation notes

If you have technical context — key files, patterns to follow, architectural considerations — prepare it separately. This goes as **comments** on the ticket, not in the description. Each distinct topic gets its own comment so that discussions stay focused and don't cross-talk. Keep implementation details out of ACs.

### Labels

Check what labels exist in the PM tool before applying any. Use the project's existing taxonomy. As a fallback, common categories:
- New capability → **Feature**
- Enhancement to existing functionality → **Improvement**
- Something broken → **Bug**
- Internal cleanup → **Code Quality**

Don't over-label — one label is usually enough, two at most.

### Priority

Default to no priority. Only set one if the user specifies or urgency is obvious from context.

### Links

If splitting a parent ticket, link back. If tickets depend on each other, note the dependency.

## Step 5: Present for confirmation

Present the full draft to the user before creating anything. For each ticket show: title, team/project, labels, description, and implementation notes (if any). Make it clear which parts go in the description vs as a comment.

**Wait for the user to confirm, modify, or cancel before proceeding.**

## Step 6: Create the tickets

Check what project management MCP tools are available (Linear, Jira, GitHub Issues, etc.).

If tools are available:
1. Determine the target team/project — use `.tickets.md` defaults if available, otherwise ask
2. Create the tickets — in dependency order so you can link subsequent tickets back
3. If there are implementation notes, add each distinct topic as a **separate comment** on the ticket
4. Add any cross-links or dependencies between them
5. Return the ticket URLs/IDs to the user

If no MCP tools are available, format the tickets as copyable markdown and offer to create them as GitHub Issues via `gh` if the project is on GitHub.

## Step 7: Summarize

Present a summary of what was created:

```
Created N tickets:
- [TICKET-1] Title — [URL]
- [TICKET-2] Title — [URL]
  - depends on TICKET-1
```

If the user wants to start implementing, suggest `/tdd` with the first ticket.

## Rules

- Always confirm before creating — never auto-create tickets
- Never invent requirements — if the input doesn't specify a behavior, don't add it. Ask instead.
- Always check for duplicates before creating — surface existing tickets that overlap
- Always check what labels, projects, and conventions exist in the PM tool before applying metadata — don't create new labels without asking
- Always make ACs user-perspective, not implementation-perspective — even if the input was technical
- If the input already has well-structured ACs (e.g., from `/spec`), preserve them — don't rewrite what's already good
- One ticket, one piece of deliverable work — if a ticket has ACs that could ship independently, it should probably be split
- Implementation details go in comments, not in the description — one comment per topic, keep tickets clean for stakeholders
- Don't over-label — one label is usually enough, two at most
- If a `.tickets.md` exists, follow it — its defaults and conventions override this skill's defaults
