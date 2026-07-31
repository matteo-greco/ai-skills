# AI Skills

[![CI](https://github.com/matteo-greco/ai-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/matteo-greco/ai-skills/actions/workflows/ci.yml)

Small, differentiated additions to [Matt Pocock's engineering skills](https://github.com/mattpocock/skills).

Matt's repository owns the general engineering workflow: grilling, specs, tickets, implementation, TDD, code review, triage, debugging, prototyping, and architecture. This repository adds browser-based planning, note backfilling, activity recaps, and specialist GDPR audit verification.

## Setup

Install both repositories via [skills.sh](https://skills.sh):

```bash
# Matt's general engineering workflow
npx skills@latest add mattpocock/skills -g

# These additional skills
npx skills@latest add matteo-greco/ai-skills -g
```

Select `/setup-matt-pocock-skills` when installing Matt's skills, then run it once in each project to configure the issue tracker, triage labels, and documentation layout.

Non-interactive install of every skill:

```bash
npx skills@latest add mattpocock/skills -g -s '*' -y
npx skills@latest add matteo-greco/ai-skills -g -s '*' -y
```

Update by rerunning the install commands. Uninstall this repository's skills with:

```bash
npx skills remove -g plan-in-browser backfill-note gdpr-audit-verify recap
```

## Recommended engineering flow

Adapted from Matt Pocock's [`ask-matt`](https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/SKILL.md) decision tree.

### Main flow: idea → ship

1. **Sharpen the idea in the browser**

   ```text
   /plan-in-browser grill-with-docs <idea>
   ```

   `grill-with-docs` keeps the discussion grounded in the codebase and records domain language and durable decisions. Without a codebase, use `/plan-in-browser grill-me <idea>` instead.

2. **Branch when conversation is not enough**

   If a question needs runnable logic or a UI you can react to:

   ```text
   /handoff → fresh session → /prototype → /handoff back
   ```

   Keep the answer; treat prototype code as throwaway.

3. **Choose by build size**

   Multi-session work:

   ```text
   /to-spec → /to-tickets → fresh session per ticket → /implement → /code-review
   ```

   `/to-tickets` creates tracer-bullet tickets with blocking edges. Work the unblocked frontier and clear context between tickets. `/implement` drives `/tdd` internally and runs `/code-review`; invoke `/code-review` again directly when you want an explicit final branch or PR review.

   Small work that fits the current context:

   ```text
   /implement → /code-review
   ```

Keep grilling, `/to-spec`, and `/to-tickets` in one context window when possible. If the context gets crowded, use `/handoff` and continue in a fresh session rather than pushing through degraded reasoning.

### On-ramps

**Incoming bugs and requests:**

```text
/triage → bug:     /diagnosing-bugs → /code-review
        → request: /implement       → /code-review
```

Use `/triage` for raw work created by other people. Route confirmed hard bugs, flakes, and performance regressions through `/diagnosing-bugs`; it first builds a tight feedback loop, then reproduces, minimizes, fixes, and adds a regression test. If its post-mortem reveals a missing test seam, continue with `/improve-codebase-architecture`.

Tickets produced by `/to-tickets` are already agent-ready and should not be triaged again.

**A huge, foggy effort:**

```text
/plan-in-browser wayfinder <destination> → /to-spec → /to-tickets → /implement
```

Use `wayfinder` only when the decisions cannot fit in one session. It maps and resolves decision work; `/to-spec` collapses those decisions into a buildable plan afterward.

**Codebase upkeep:**

```text
/improve-codebase-architecture → /plan-in-browser grill-with-docs <chosen opportunity>
```

## Skills in this repository

- **plan-in-browser** — Run any installed planning or grilling skill unchanged while routing every human decision through an interactive browser canvas. Designed to wrap Matt's `grill-with-docs`, `grill-me`, `grilling`, and `wayfinder` skills.
- **backfill-note** — Fill empty sections in a specified note using evidence from that note and related notes in the same vault while preserving existing content.
- **recap** — Gather git activity and connected PM tickets, detect the latest work burst, and render a terse 3–5 bullet executive brief for standup or Slack.
- **gdpr-audit-verify** — Reproduce external GDPR, TDDDG, and ePrivacy audit claims in a real browser and classify them against EU and German rules and CJEU case law.

## Relationship to Matt's skills

This repository intentionally does not maintain local versions of general-purpose skills such as TDD, code review, specs, ticket creation, triage, debugging, refactoring, or ADR creation. Install and update [mattpocock/skills](https://github.com/mattpocock/skills) for those capabilities.

If older versions of this repository left global `tdd`, `code-review`, `spec`, or similar skills installed, remove those stale copies before installing Matt's versions so they cannot shadow the upstream skills.

## Development

The executable parts of `plan-in-browser` require Node.js 22 or newer. Install the development dependencies and run the same checks used by CI:

```bash
npm ci
npm run check
```

`npm run check` runs ESLint, rebuilds and verifies the committed `plan-in-browser/dist/` output, type-checks the TypeScript sources, and executes the Node.js test suite. Tests live in `test/` inside each non-hidden root directory and use the `*.test.mjs` suffix. GitHub Actions runs the checks for every push and pull request.

The planning session lifecycle is authored in `plan-in-browser/src/`. Run `npm run build` after changing it; installed skills execute the committed JavaScript in `plan-in-browser/dist/` without requiring a local build.
