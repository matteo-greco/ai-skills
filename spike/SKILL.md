---
name: spike
description: Time-boxed technical investigation when you don't know enough to spec or implement. Explore an approach, prototype if needed, and report findings.
disable-model-invocation: true
user-invocable: true
argument-hint: "[question to answer or approach to explore]"
---

# Spike

You run a time-boxed investigation to answer a technical question. Spikes exist because sometimes you don't know enough to spec a feature, estimate work, or choose an approach. The output is knowledge, not production code.

## Input

A question or uncertainty from:
- `$ARGUMENTS` — a question to answer or approach to explore
- A conversation where the team is stuck on a decision
- A `/spec` session that hit a "we don't know if this is feasible" wall

Good spike questions:
- "Can we use library X for this, or does it conflict with our existing setup?"
- "How does the WordPress block editor handle nested blocks? Can we hook into it?"
- "What would it take to migrate from singleton pattern to DI container in this module?"
- "Is this API fast enough for our use case, or do we need caching?"

## Step 1: Define the question

Sharpen the question into something answerable. A spike should have a clear **done condition** — what do you need to know to unblock the next step?

Bad: "Investigate authentication options"
Good: "Can we use WordPress application passwords for our REST API auth, and does it support the scopes we need?"

If the question is too broad, suggest breaking it into smaller spikes. Each spike should answer one question.

Confirm the question and done condition with the user before starting.

## Step 2: Time-box

Agree on a scope with the user. A spike should be the minimum investigation needed to answer the question — not a deep dive into everything related.

If you're approaching the limit of what's useful without a clear answer, stop and report what you've learned so far rather than going down rabbit holes.

## Step 3: Investigate

Depending on the question, use whatever approach fits:

**Codebase exploration** — read existing code, trace call paths, check how similar problems were solved before, review ADRs for prior decisions in this area.

**Documentation research** — read official docs, API references, changelogs, migration guides for the relevant stack. Check for known issues, limitations, or compatibility constraints.

**Prototyping** — write throwaway code to test feasibility. Keep it minimal — just enough to answer the question. Prototype code does not need tests, style compliance, or error handling. It needs to prove or disprove the approach.

**Benchmarking** — if the question is about performance, measure it. Don't guess.

Take notes as you go. Capture not just what you found, but what you tried that didn't work — dead ends are valuable findings.

## Step 4: Report findings

Present a clear answer to the original question:

```
### Spike: [the question]

**Answer:** [direct answer — yes/no/it depends, in one sentence]

**What we learned:**
- [Key finding 1]
- [Key finding 2]
- ...

**What we tried:**
- [Approach that worked / didn't work and why]
- ...

**Recommendation:**
[What to do next — "proceed with approach X", "this won't work, consider Y instead", "we need a second spike on Z"]

**Open questions:**
[Anything still unresolved]
```

### Prototype code

If you wrote prototype code, make it clear it's throwaway:
- Do NOT commit it to the main branch
- Offer to save it in a scratch branch or discard it
- Call out which parts (if any) could be reused in the real implementation

## Step 5: Hand off

Based on the findings, suggest the next step:
- **Feasible and well-understood** → `/spec` the feature
- **Feasible but needs design decisions** → `/adr` to document the decision, then `/spec`
- **Not feasible** → report why, suggest alternatives
- **Still uncertain** → define a follow-up spike with a narrower question

## Rules

- Always define the question and done condition before investigating — aimless exploration isn't a spike
- Always report findings even if the answer is "we don't know yet" — negative results and dead ends are valuable
- Never commit prototype code to the main branch — it's throwaway by definition
- Never gold-plate a prototype — if you're adding tests and error handling, you've left spike territory
- Never let a spike silently turn into implementation — if the answer is "yes, and here's the code", stop. The code belongs in a `/tdd` session with proper tests.
- If investigation reveals the question was wrong, say so — "we were asking the wrong question, the real question is X"
