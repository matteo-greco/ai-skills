---
name: eng-status
description: Scan engineering activity — planned work, git history, open PRs, CI status, deployment frequency, and release cadence. What's planned, what's moving, what's stuck, what's broken.
disable-model-invocation: true
user-invocable: true
argument-hint: "[time range or focus area, or blank for last week]"
---

# Engineering Status

You scan the engineering activity and delivery pipeline to build a picture of what's moving, what's stuck, and what's broken. This skill gathers and summarizes — it doesn't judge alignment or suggest priorities. That's `/pulse`'s job.

## Input

- `$ARGUMENTS` — a time range ("last 3 days", "since v1.4.7"), a focus area ("PRs", "deploys"), or blank for a default scan of the last week.

## Step 1: Scan planned work

Check available project management tools (Linear, Jira, GitHub Issues, etc.) to understand what the team is supposed to be working on:

- **In progress** — what tickets are actively being worked on? By whom?
- **Blocked** — what's waiting on something? What's the blocker?
- **Recently completed** — what was closed/merged in the time range?
- **Upcoming** — what's next in the backlog or current sprint/cycle?
- **Overdue** — anything past its due date or sitting in-progress for an unusually long time?

This is the "what should be happening" that git activity is measured against.

## Step 2: Scan git activity

- **Recent commits** — `git log --oneline --since="1 week ago"` (or the requested range). What areas of the codebase are active?
- **Open PRs** — `gh pr list`. How many, how old, any stale (no activity in 3+ days)?
- **Stale branches** — branches with no recent commits that haven't been merged or deleted.
- **Merge activity** — what's been merged recently? How large were the merges (files changed, lines)?
- **Contributors** — who's active in this period? Any areas with only one contributor?

## Step 3: Scan CI/CD health

- **Build status** — are CI checks passing on the main branch? Any persistent failures?
- **Recent deployments** — when was the last release? Use `git tag --sort=-version:refname` and release dates.
- **Unreleased work** — how many commits are on main since the last tag? Is work piling up?
- **Release cadence** — what's the typical time between releases? Is the current gap normal or unusual?
- **Failing checks** — any PRs blocked by CI failures? Are the failures real or flaky?

## Step 4: Summarize

Present the findings in a scannable format:

```
## Engineering Status — [date range]

### Planned work
- In progress: [N] tickets — [brief list]
- Blocked: [N] — [what and why]
- Completed this period: [N]
- Overdue: [N] — [if any]

### Git activity
- [N] commits across [N] contributors
- Most active areas: [files/directories with most changes]
- [N] PRs merged, [N] open

### Open PRs
- [PR #N] — [title] — [age, status: ready/draft/stale/blocked]
- ...

### Delivery
- Last release: [version] ([date, N days ago])
- Unreleased commits: [N]
- CI status: [passing/failing — details if failing]

### Flags
- [Anything notable — tickets with no git activity, git activity with no ticket, stale PRs, CI failures, deployment backlog, bus factor concerns]
```

Keep it factual. Report what you see, don't interpret why — that's for the user or `/pulse` to do.

## Rules

- Report facts, not judgments — "PR #45 has been open for 7 days" not "PR #45 is taking too long"
- Default to the last week if no time range is specified
- Flag anomalies but don't prescribe actions — a deployment backlog is a fact, whether to release is a decision
- If a data source is inaccessible (no CI integration, no GitHub access), say so and report what you can
