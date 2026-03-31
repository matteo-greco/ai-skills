---
name: refactor
description: Execute a refactoring safely — assesses test coverage, writes characterization tests if needed, and applies changes incrementally. Works standalone or as a follow-up to /code-health findings.
disable-model-invocation: true
user-invocable: true
argument-hint: "[what to refactor — a smell, a file, a class, or a code-health finding]"
---

# Refactor

You execute a specific refactoring safely and incrementally. Your job is to improve the code's structure without changing its behavior, and to prove it at every step.

## Input

A refactoring target from:
- `$ARGUMENTS` — a file, class, method, or smell to address
- A `/code-health` finding the user wants to act on
- A direct description ("extract this into a service", "break up this god class")

If the target is vague, ask the user to clarify what they want improved and why.

## Step 1: Assess the area

Before touching anything, understand what you're working with:

1. **Read the code** — understand the current structure and what it does.
2. **Find the tests** — what tests exist for this code? Read them.
3. **Judge the safety level:**

- **Safe** — Good test coverage with behavior-focused tests. Tests verify *what* the code does, not *how*. You can refactor and the tests will catch regressions.
- **Caution** — Tests exist but are implementation-focused (heavy mocking, assertions on call order, brittle wiring checks). Refactoring may break tests even if behavior is preserved.
- **Unsafe** — Little or no test coverage.

Tell the user your assessment and which approach you'll take (see Step 2). Get their approval before proceeding.

## Step 2: Choose your approach

### Safe → Refactor with confidence

The tests are your safety net. Refactor in small steps, running tests after each change to verify behavior is preserved. Each meaningful step gets its own commit.

### Caution → Fix the tests first

Implementation-focused tests will fight you during refactoring. Before changing production code:
1. Identify which tests are testing *how* vs *what*
2. Rewrite them to test behavior — same coverage, less coupling to internals
3. Verify the rewritten tests pass against the current code
4. Commit the test improvements separately
5. Then proceed as if Safe

### Unsafe → Secure the area first

Two options, depending on whether writing tests is practical:

**Option A: Write characterization tests first (preferred)**
A characterization test captures what the code *currently does* — not what it *should* do. Run the code, observe its output, assert that output. The goal is a safety net, not validation of correctness.
1. Write characterization tests that lock in current behavior
2. Verify they pass
3. Commit the tests
4. Then proceed as if Safe

**Option B: Tidyings only (when tests aren't practical yet)**
Limit yourself to small, mechanical, structure-preserving moves:
- Extract method
- Extract variable
- Extract constant
- Rename
- Reorder declarations
- Inline temp
- Remove dead code

These don't change behavior by construction. Each tidying gets its own commit. Do NOT attempt larger refactorings (changing interfaces, moving responsibilities, introducing abstractions) without test coverage.

## Step 3: Execute the refactoring

Work in small, verifiable steps. Each step should be:
1. **One focused change** — don't combine multiple refactorings in one step
2. **Behavior-preserving** — the code does the same thing before and after
3. **Verified** — run the tests after each step. If tests fail, the refactoring changed behavior — stop, investigate, and fix before continuing.
4. **Committed** — each step gets its own commit with a clear message

If a step reveals that the refactoring is larger than expected, stop and tell the user. Suggest breaking it into multiple sessions or routing through `/spec` for planning.

### Commit discipline

- Separate test changes from production code changes
- Separate tidyings from structural refactorings
- Never mix refactoring with behavior changes — if you spot a bug while refactoring, note it and fix it in a separate commit
- Commit messages should describe the refactoring move, not just "refactor": `refactor(auth): extract token validation into TokenValidator`

## Step 4: Verify the result

After completing the refactoring:
1. Run the full test suite — not just the tests for the changed files
2. Check that no tests were deleted or weakened (same or better coverage)
3. Briefly summarize what changed and why the code is better now

## Rules

- Never change behavior during a refactoring — if you need to change behavior, that's a separate task
- Never delete or weaken tests to make a refactoring pass — fix the code or rethink the approach
- Never skip the safety assessment — knowing your test coverage is a prerequisite
- Always run tests after each step — don't batch multiple changes and hope for the best
- Prefer many small commits over one large commit — easier to review, easier to revert
- If the refactoring scope grows beyond what was originally planned, stop and discuss with the user rather than pushing forward
