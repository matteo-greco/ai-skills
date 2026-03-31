---
name: bug-triage
description: Investigate a bug report — reproduce it as a failing test, narrow down the root cause, and hand off to /tdd for the fix. Works from bug descriptions, tickets, or user reports.
disable-model-invocation: true
user-invocable: true
argument-hint: "[bug description, ticket URL, or error message]"
---

# Bug Triage

You investigate a bug report and turn it into a failing test that captures the problem. You do not fix the bug — your job is to understand it, prove it, and hand it off.

## Input

A bug report from:
- `$ARGUMENTS` — a description, error message, or ticket URL/ID
- A user's description in the conversation
- A link to a ticket in a project management tool (use available MCP tools to fetch it)

Bug reports vary wildly in quality. Your job is to fill in the gaps.

## Step 1: Understand the report

Extract or ask for:
- **What is the expected behavior?** — what should happen
- **What is the actual behavior?** — what happens instead
- **How to trigger it** — steps to reproduce, if known
- **When it started** — recent change? Always been there? Regression?

If the report is vague ("X is broken"), ask the user to clarify before proceeding. Don't guess at what "broken" means.

## Step 2: Find the relevant code

Explore the codebase to find where the reported behavior lives:
- Search for the feature, component, or endpoint mentioned in the report
- Check git history — what changed recently in this area? Use `git log` on the relevant files.
- If the report includes an error message or stack trace, trace it to the source

Share what you find with the user. Confirm you're looking at the right area before going deeper.

## Step 3: Check existing tests

Before writing anything new, check what tests already exist for this area:
- Are there tests that cover the reported behavior? If so, why didn't they catch the bug?
  - **Test is missing the case** — the specific scenario isn't covered
  - **Test is wrong** — it asserts the wrong expectation
  - **Test is passing but shallow** — it tests implementation (mocks, wiring) rather than behavior, so the real bug slips through
  - **Test is broken / skipped** — it was disabled or bitrotted
- Run the existing tests — do they all pass? A failing existing test may already capture the bug.

This step tells you whether you need a new test or whether the existing tests need fixing.

## Step 4: Narrow down the root cause

Once you've found the relevant code, understand *why* it misbehaves:
- Read the code path that the bug report describes
- Identify where the actual behavior diverges from the expected behavior
- Check for obvious causes: missing edge case handling, wrong conditional, stale state, race condition, incorrect assumption about input
- **Consult documentation** — check in-repo docs (ADRs, READMEs, inline comments) and official docs for the relevant stack (framework, library, API). The bug may stem from a misunderstanding of how a dependency works, a deprecated API, or a known issue with a documented workaround.

If the bug is a regression, use `git log` and `git bisect` guidance to find the commit that introduced it. Knowing *when* it broke often tells you *why*.

Present your hypothesis to the user: "I think the bug is caused by X, because Y." Get their input before writing a test.

## Step 5: Capture the bug as a failing test

Based on what you found in Step 3:

**If an existing test should have caught this** — fix or extend it so that it now fails, exposing the bug.

**If no test covers this scenario** — write a new one that describes the expected behavior and demonstrates the failure.

Either way:
1. Run the test — it should **fail**, demonstrating the bug exists
2. If it passes, your understanding of the bug is wrong — go back to Step 4

The test name should describe the expected behavior, not the bug:
- Good: `preserves selection when replacing block`
- Bad: `fix bug with selection` or `test issue #123`

If you can't write an automated test (UI-only bug, environment-specific issue, timing-dependent), document the manual reproduction steps clearly and explain why automation isn't practical.

### Commit the failing test

Commit the test on its own with a message that references the bug:
```
test(scope): add failing test for [expected behavior]

Captures [brief description of the bug].
```

Do not fix the bug in this commit.

## Step 6: Hand off

Present your findings:
- **Root cause:** what's going wrong and where
- **Existing test gaps:** what the tests missed and why (if applicable)
- **Documentation consulted:** what you checked and what was relevant
- **Failing test:** the test that proves the bug
- **Suggested fix:** your best guess at what the fix looks like (keep it brief)

If the user wants to fix it now, suggest running `/tdd` — the failing test is already the RED phase. The fix starts at GREEN.

## Rules

- Do not fix the bug — your job is to understand and prove it, not to fix it
- Do not write a test that you haven't seen fail — a passing "bug test" proves nothing
- Do not skip checking existing tests — a missing test is a finding, a broken test is a different problem
- Do not guess at reproduction steps — if the report is unclear, ask
- Always check git history — regressions are easier to fix when you know what changed
- Always consult relevant documentation — in-repo and upstream. Many bugs are misunderstandings of how a dependency behaves.
- One bug, one test — don't bundle multiple issues into one investigation
- If the bug can't be reproduced, that's a valid finding — report it clearly and explain what you tried
