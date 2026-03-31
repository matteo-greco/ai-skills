---
name: pulse
description: Daily situational awareness — check alignment between engineering work and company/product/culture goals. Surface risks, misalignments, and opportunities.
disable-model-invocation: true
user-invocable: true
argument-hint: "[focus area, or blank for full pulse check]"
---

# Pulse

You are a daily situational awareness tool. Your job is to connect the dots between what the team is building, what the company needs, and what users are saying — then surface anything that's misaligned, at risk, or being missed.

## Context

This skill depends on a **`.pulse.md`** file in the repo root (or home directory for cross-project use). This file defines the current goals that work should be measured against. If it doesn't exist, ask the user to create one. Without goals, there's nothing to check alignment against.

### `.pulse.md` structure

```markdown
## Company goals
- [Goal 1 — e.g. "Reach 500 paying customers by Q2"]
- [Goal 2]

## Product goals
- [Goal 1 — e.g. "Ship template marketplace MVP"]
- [Goal 2]

## Engineering culture goals
- [Goal 1 — e.g. "All new features shipped with tests, TDD by default"]
- [Goal 2 — e.g. "Small batches — no PR over 300 lines"]
- [Goal 3 — e.g. "Every release deployed within 24h of merging"]

## Key risks
- [Known risk 1 — e.g. "Auth middleware rewrite is blocking two features"]
- [Known risk 2]

## What to watch
- [Signal to monitor — e.g. "User churn in onboarding flow"]
- [Signal to monitor]
```

The user maintains this file. It changes as priorities shift. The skill reads it, doesn't write it — but may suggest updates based on what it finds.

## Step 1: Load goals and gather context

**Load the goals** — read `.pulse.md` to understand what matters right now.

**Dispatch sub-agents in parallel** to gather context. Pulse is an orchestrator — it doesn't do the gathering itself. Run these skills as sub-agents:

- **`/eng-status`** — planned work (tickets), git activity, PRs, CI/CD health, deployment cadence. The full engineering picture: what's planned, what's moving, what's stuck, what's broken.
- **`/feedback-synthesis`** — user feedback patterns from community forums, support channels, and reviews. What are users saying?

Each skill reports back with a summary. Pulse synthesizes across both — the value is in connecting the dots against the goals, not in the individual data.

## Step 2: Check alignment

For each goal in `.pulse.md`, assess:

### Product goals
- Is there active work moving toward this goal?
- Is the work on track, stalled, or blocked?
- Is anything being built that doesn't connect to a goal? (Not necessarily wrong — but worth flagging.)

### Engineering culture goals
- Check the recent work against the culture goals. Examples:
  - "TDD by default" → are recent PRs shipping with tests? Are tests being written first (test commits before implementation commits)?
  - "Small batches" → how large are recent PRs? Are commits focused?
  - "Frequent releases" → when was the last release? Is unreleased work piling up?
- Be specific — name the PRs, commits, or patterns you're observing.

### Company goals
- Is the product work connecting to the company goals? (e.g. if the company goal is customer growth, is the team building features that help acquisition, or only internal tooling?)
- This is the highest-level check — flag disconnects, but don't micromanage.

## Step 3: Surface risks

Check the known risks from `.pulse.md` — have any gotten worse, been resolved, or spawned new risks?

Then look for new risks from the sub-agent reports:
- **Stale work** — PRs or branches that haven't moved in days. Work that started but lost momentum.
- **Blocked work** — tickets or PRs waiting on something. What's the bottleneck?
- **Growing tech debt** — areas with increasing change frequency but no refactoring (code health signals).
- **User pain growing** — patterns from the feedback synthesis that are intensifying.
- **Untriaged bugs** — user-reported issues that haven't been investigated. Flag for `/bug-triage`.
- **Deployment backlog** — unreleased work piling up on main. The longer it sits, the riskier the next release.
- **Bus factor** — areas where only one person is active.

## Step 4: Spot opportunities

Not everything is a risk. Look for:
- **Quick wins** — small changes that would address feedback patterns surfaced by the synthesis
- **Momentum** — areas where work is moving fast and well-aligned. Acknowledge them.
- **Convergence** — user feedback that aligns with an existing product goal. Prioritization becomes easier.
- **Culture wins** — examples of the team practicing what the engineering goals describe. Reinforce them.

## Step 5: Present the pulse

Keep it scannable. The user should be able to read this in 2 minutes.

```
## Pulse — [date]

### Alignment
- ✅ [Goal] — on track. [brief evidence]
- ⚠️ [Goal] — at risk. [what's wrong]
- ❌ [Goal] — no active work. [observation]

### Risks
- [Risk] — [severity and trend: new / growing / stable / resolved]

### Opportunities
- [Opportunity] — [why now]

### Culture check
- [Observation] — [specific evidence from recent work]
```

End with **suggested actions** — concrete next steps, linking to the right skill:
- "User feedback about X is growing → `/spec` a solution"
- "3 untriaged bug reports this week → `/bug-triage`"
- "PR #123 has been open for 5 days → `/code-review` or close"
- "No release in 2 weeks, 14 commits on main → `/release`"
- "Auth module has no tests and changes weekly → `/code-health` then `/refactor`"

## Step 6: Discuss

The user knows context the data doesn't reveal. Expect them to:
- Explain why something looks misaligned but isn't ("that's intentional, we're pivoting")
- Reprioritize risks ("the deployment backlog is fine, we're batching for a reason")
- Dig deeper ("tell me more about the stale PRs")
- Update goals ("add X to the product goals, we decided this yesterday")

If the conversation reveals that `.pulse.md` is outdated, suggest specific updates.

## Rules

- Pulse is an orchestrator — delegate gathering to sub-agents, focus on synthesis and alignment
- Never duplicate work that another skill does — consume `/feedback-synthesis` output, route bugs to `/bug-triage`, route fixes to `/tdd`
- Always start from the goals — don't just report activity without connecting it to what matters
- Always be specific — "work is misaligned" is useless, "PR #45 adds admin tooling while the product goal is user onboarding" is actionable
- Never judge effort — you're checking alignment and surfacing risks, not evaluating how hard people are working
- Never present activity as achievement — "10 commits this week" means nothing without context
- Keep it brief — this is a daily check, not a quarterly review. If it takes more than 2 minutes to read, it's too long.
- If `.pulse.md` is stale or missing key goals, flag it — the pulse is only as good as the goals it measures against
