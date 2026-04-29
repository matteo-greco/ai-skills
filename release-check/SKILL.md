---
name: release-check
description: Assess what's about to release in a repo — summarize unreleased work in user-facing terms via Linear tickets, judge AC completeness, and surface release blockers via /code-review.
user-invocable: true
argument-hint: "[repo path, or blank for current working directory]"
---

# Release Check

You assess whether a project is ready to release. The output answers two questions: **what's about to ship?** (in user-facing terms, not commit messages) and **is anything a release blocker?**

This skill is meant to be invoked on demand — by a human in Claude Code, or programmatically by a wrapper (e.g. a Telegram bot). Output is plain markdown so it's portable across both.

## Step 1: Determine the repo and the range

Resolve which repo to check from `$ARGUMENTS`:
- Empty → use the current working directory.
- Path → `cd` into it. Validate it's a git repo (`.git` directory present).

Refresh the local checkout:

```bash
git fetch --tags --quiet origin
```

Find the last release tag and the unreleased range. Use the project's tag style — most are semver (`v1.2.3`) but some use calver:

```bash
LAST_TAG=$(git describe --tags --abbrev=0 origin/main 2>/dev/null)
RANGE="$LAST_TAG..origin/main"
git log --format='%H%x09%s' "$RANGE"
```

If the range is empty, tell the user "Nothing to release — `main` is at `$LAST_TAG`." and stop. Don't run the rest of the skill.

## Step 2: Extract ticket IDs and bucket commits

Scan all commit messages (subject + body) in the range for ticket references. Use a case-insensitive match (e.g. both `ETC-705` and `etc-705` are valid) and normalize to upper case for the lookup:

```bash
git log --format='%H%n%an%n%s%n%b%n---' "$RANGE"
```

Bucket each commit into:
- **Ticketed** — references one or more tickets. A single commit can land on multiple tickets; include it under each. A commit is "ticketed" as long as the regex matches *anywhere* in the subject or body, regardless of formatting (lowercase prefix, missing parens, missing conventional-commit type, etc.).
- **Ad-hoc** — *zero* ticket references in the subject or body. Capture the author for ad-hoc entries — list every ad-hoc commit explicitly in Step 7 so the user can review and nudge the team toward the `(TICKET-NNN)` convention.

When a ticketed commit doesn't follow the team's convention (e.g. lowercased ticket id, missing `(TICKET-NNN)` parentheses, missing conventional-commit type prefix), do **not** put it under Ad-hoc — it's still ticketed. Track these separately as "Convention notes" for Step 7.

Also detect the **hide convention** — commits flagged "ship but exclude from the changelog." A commit is hidden if either:

- Its subject *ends* with `[hide]` (preferred form, e.g. `feat(ETC-705): foo [hide]`).
- Its subject *starts* with `hide:` or `hide(scope):` (older form, e.g. `hide: small rename`).

Both forms are still in active use. Treat them equivalently. Hidden commits still ship; they just don't appear in user-facing release notes. Track the count of hidden commits separately for Step 7.

Tickets that look like noise (e.g. version strings matched by accident) should be discarded after the Linear lookup in Step 3 fails.

## Step 3: Fetch Linear tickets

For each unique ticket ID, fetch the title, description, ACs, and current state via the Linear GraphQL API. Requires `LINEAR_API_KEY` in the environment:

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"query($id:String!){ issue(id:$id){ identifier title description state{name} } }","variables":{"id":"ETC-725"}}'
```

If `LINEAR_API_KEY` isn't set, tell the user how to set it and stop. Don't try alternative paths — Linear data is non-negotiable for this skill.

If a ticket lookup fails (404, deleted, wrong prefix), drop it from the ticketed bucket and treat the referencing commits as ad-hoc. Note dropped tickets in the output.

## Step 4: Judge AC completeness per ticket

For each ticket, gather the combined diff of all referenced commits:

```bash
git show --format= <sha1> <sha2> ...
```

Then judge the ticket against its Acceptance Criteria:

- **Parse the ACs.** Look for any of these signals in the description:
  - A heading: `## AC`, `## ACs`, `## Acceptance Criteria`, or `## What this ticket delivers` (case-insensitive).
  - A label: `AC:`, `ACs:`, `Acceptance Criteria:`.
  - A leading bulleted or numbered list with no heading.
- **Also read any "Deviations from original AC" section.** It documents how the scope changed during implementation; the *deviated* ACs are the ones to evaluate against, not the original ones.
- The user's tickets follow the convention of user-perspective ACs ordered by ZOMBIES (Zero, One, Many, Boundaries, Interfaces, Exceptions, Simple).
- **If the description has no AC structure at all**, treat the whole description as the spec. Note this in the output ("AC structure inferred — verify manually").
- **For each AC**, decide based on the diff and commit messages whether it's:
  - **landed** ✅ — implemented, with code + tests visibly delivering the behavior.
  - **partial** ⏳ — some part landed, but the AC isn't fully satisfied (e.g. happy path only, no error handling, missing UI).
  - **not started** ⏸ — no diff change appears to address it.
- **Categorize the ticket overall**:
  - **COMPLETE** — every AC landed.
  - **PARTIAL** — at least one AC landed, but not all.
  - **TANGENTIAL** — commits are progress (refactor, prep work, test scaffolding) but don't land any specific AC.

**Use the Linear ticket state as a hint, not the answer.** If the ticket is `Done`, the team thinks it's complete — the diff should back that up. If it's `In Progress` or `In Review`, expect PARTIAL. State alone never overrides what the diff actually shows: a ticket marked `Done` whose diff doesn't deliver every AC is still PARTIAL, and worth flagging.

Be biased toward "uncertain → flag, don't approve." A ticket you mark COMPLETE should be defensible from the diff alone. When in doubt, mark PARTIAL and explain.

Remember: under TDD, multiple commits per ticket is normal — roughly one per AC. Commit presence alone isn't proof of completeness; trace the diff. Commits tagged `[hide]` within a ticket are typically progress (refactors, tests, internal renames); use the visible commits as the primary signal for AC delivery.

## Step 5: Dispatch /code-review for blockers

Run `/code-review $RANGE` as a sub-agent. The review surfaces bugs, missing tests, security issues, and standard violations across the entire range — that's the blocker dimension.

Don't paraphrase or summarize the review's findings — present them as the sub-agent returned them, under a clear "Blockers" section.

## Step 6: Synthesize a verdict

Combine ticket completeness with the code-review output into one of:

- **✅ READY** — all ticketed work is COMPLETE or TANGENTIAL, and `/code-review` found no real concerns.
- **⚠️ PROCEED WITH CAUTION** — PARTIAL tickets exist, or `/code-review` flagged non-blocking notes. Recommend either holding the partial tickets or shipping with explicit acknowledgement.
- **🛑 HOLD** — `/code-review` found something blocker-grade (security, correctness, broken tests, or a regression).

The verdict is one line; reasoning lives elsewhere in the report.

## Step 7: Output

Present the report as plain markdown. Output may be consumed by humans in a terminal or by another tool wrapping this skill, so:

- No ANSI colors.
- Short paragraphs.
- Use bullets for ticket landings.
- Put the verdict last.

Format:

```markdown
# Release Check — <repo name> (<N> commits since <LAST_TAG>)

## Landing fully
- ETC-725: <user-facing one-liner from the ticket>
- ETC-720: <user-facing one-liner from the ticket>

## Landing partially
- ETC-731: <user-facing one-liner>
  - ✅ <AC that landed>
  - ⏳ <AC that's only partial — note what's missing>
  - ⏸ <AC that's not started>
  - Recommendation: hold, or ship and track the remainder.

## Tangential / refactor only
- ETC-740: refactor only — no ACs touched
- ETC-999: ticket lookup failed (treated as ad-hoc)

## Ad-hoc commits (no ticket reference)
List every commit here — these have no ticket reference at all and the team should consider adding tickets going forward:
- `<sha7>` `<author>` — `<subject>`
- `<sha7>` `<author>` — `<subject>`

## Convention notes
Ticketed commits whose subject doesn't follow the team's commit convention. These are *not* ad-hoc — they reference a ticket — but the formatting drifted:
- `<sha7>` `<author>` — `<subject>` — *lowercase ticket id*
- `<sha7>` `<author>` — `<subject>` — *missing `(TICKET-NNN)` parentheses*
- `<sha7>` `<author>` — `<subject>` — *no conventional-commit type prefix*

Omit this section if everything is well-formatted.

## Excluded from changelog
- `<N>` commits tagged `[hide]` will ship but won't appear in user-facing release notes.

## Blockers
<output of /code-review, verbatim>

## Verdict
✅ READY — <one-line rationale>
```

If a section is empty (e.g. no partial tickets), omit it rather than printing "(none)".
