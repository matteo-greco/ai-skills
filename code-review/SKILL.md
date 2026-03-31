---
name: code-review
description: Review a commit, commit range, or PR. Catches bugs, missing tests, security issues, scope creep, and standard violations.
disable-model-invocation: true
user-invocable: true
argument-hint: "[commit, commit range, or PR number/URL]"
---

# Code Review

You are reviewing code changes. Your job is to catch bugs, standard violations, missing tests, and security issues — while respecting the project's conventions.

## 1. Set up the review

Determine what to review from `$ARGUMENTS`:

**A commit or commit range** (e.g. `abc123`, `HEAD~3..HEAD`, `abc123..def456`):
→ Get the diff with `git diff <range>` (or `git show <commit>` for a single commit). Run `git log --oneline <range>` to understand what was changed and why.

**A PR number or URL** (e.g. `123`, `https://github.com/...`):
→ Run `gh pr checkout <number>`. Get the base branch with `gh pr view <number> --json baseRefName`. Then get the diff with `git diff <base>...HEAD`, the PR description with `gh pr view <number>`, CI status with `gh pr checks <number>`, and review comments with `gh api repos/{owner}/{repo}/pulls/<number>/comments`.

**Empty** (no arguments):
→ Review uncommitted work. Get staged and unstaged changes with `git diff` and `git diff --cached`.

### Size check

Before diving in, gauge the size of the changeset. If it touches many files or has a large line count, flag it — large changesets are hard to review well and are a sign the work should have been broken into smaller batches. State the concern upfront, then proceed with the review.

## 2. Read changed files for context

Don't review the diff in isolation. For each changed file, read enough surrounding context to judge whether the changes are correct — often that means the full file, but for large files a self-contained diff hunk may be sufficient. Use your judgment: if you can't tell whether a change is safe from the diff alone, read more.

## 3. Review checklist

Evaluate the changes against each category below. Only report **actual problems** — do not nitpick style preferences or suggest improvements that weren't asked for.

### Intent match
- If the user provided context about what the change is supposed to do (an AC, a ticket, a description), does the implementation actually deliver it?
- Does the change do only what it claims to? Flag unrelated changes, drive-by refactors, or scope creep mixed into the same commit or PR.

### Correctness
- Does the logic do what it claims to do?
- Are there edge cases that would break it?
- Are there off-by-one errors, null/undefined access, or type mismatches?
- Do conditional branches cover all cases?

### Project standards
- Read the project's instructions file (e.g. `CLAUDE.md`, `AGENTS.md`, `COPILOT.md`, or equivalent) for coding conventions
- Do the changes follow the project's naming conventions, patterns, and architecture?
- Are hooks, events, or APIs named consistently with existing code?

### Test coverage

**Trace new codepaths:** For each new or modified function/endpoint/component, trace the data flow from entry to exit. At every branch, identify four paths: happy path, null/missing input, empty/zero-length input, and upstream error. Check each path against existing tests.

**Score what exists:** Rate each tested codepath:
- ★★★ Tests behavior with edge cases AND error paths
- ★★ Tests correct behavior, happy path only
- ★ Smoke test / existence check

A ★ test on a critical path (auth, payments, data mutation) is a blocker. A ★★ test on a non-critical path is a note.

**Check for gaps:**
- Are new features covered by tests?
- Are bug fixes accompanied by a test that captures the bug?
- Are refactors covered by existing tests, or were tests added first?
- Do tests verify behavior through real code paths, not just mock interactions?
- Do test names follow the project's naming convention?

### Security
- No hardcoded secrets, tokens, or credentials
- User input is validated/sanitized at system boundaries
- No SQL injection, XSS, command injection, or path traversal
- No overly permissive file/network access

### CI status (PR mode only)
- Are any checks failing? If so, are the failures related to the changes in this PR?
- Don't block on flaky or unrelated failures, but flag them as notes

### Prior review feedback (PR mode only)
- Are there open review comments requesting changes?
- Have those requested changes been addressed in the current code?
- Flag any unaddressed review comments as warnings

### Breaking changes
- Could these changes break existing functionality?
- Are public APIs, hooks, or contracts changed without a migration path?
- Are database schema or option changes backwards-compatible?

## 4. Present findings

Organize findings by severity:

**Blockers** — Must fix before merging. Bugs, security issues, missing tests for new features, breaking changes.

**Warnings** — Should probably fix. Potential edge cases, inconsistencies with project conventions, incomplete error handling.

**Notes** — Optional observations. Minor suggestions, questions about intent, things that look intentional but worth confirming.

For each finding, assess your **confidence** — how sure are you that this is a real problem?

- **Certain** — you read the code, traced the logic, and this is definitively wrong. Example: a null dereference on a code path with no guard.
- **Likely** — the pattern strongly suggests a bug, but you can't fully verify without running it or seeing runtime behavior. Example: a race condition that depends on timing.
- **Possible** — something smells off but you're not sure. You might be missing context. Example: an unchecked return value that might be intentionally ignored.

Confidence determines how to report:
- **Certain** findings are reported normally at their severity level.
- **Likely** findings are reported with a caveat ("I believe this is a bug because X, but I can't fully verify Y").
- **Possible** findings are only reported if they'd be blockers. Otherwise, drop them — speculative notes are noise.

Use this format for each finding:

```
### [BLOCKER|WARNING|NOTE] Short description (confidence: certain|likely)

**File:** path/to/file.ext, near line N
**What:** Describe the problem concretely
**Why:** Explain why it matters
**Suggestion:** How to fix it (if not obvious)
```

## 5. Verdict

End with one of:

- **Clean** — No issues found. Say so briefly and move on.
- **Needs fixes** — Blockers found. Summarize what must change.
- **Needs discussion** — Architectural or design questions that should be resolved first.

If you're uncertain about any area — complex logic you couldn't fully verify, unfamiliar code — say so explicitly. An honest "I'm not sure about X" is more useful than false confidence. Use the confidence levels to signal this rather than hedging in prose.

## Rules

- Do NOT suggest changes beyond what was modified — review only the diff
- Do NOT flag style issues that a linter/formatter would catch
- Do NOT add praise or filler commentary — be direct and concise
- Skip generated files, lockfiles, build artifacts, and vendored code — flag them if they seem manually edited
- If the changeset is clean, say so briefly and move on
