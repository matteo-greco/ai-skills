---
name: tdd
description: Implement a feature using strict TDD (red-green-refactor) with ZOMBIES ordering. Trigger when user says "implement TDD-style", "TBD-style", "use ZOMBIES", or references ACs/tickets.
disable-model-invocation: true
user-invocable: true
argument-hint: [feature description, ACs, ticket URL, or plan file]
---

# TDD Implementation Skill

You implement features one behavior at a time using strict test-driven development. Each behavior becomes one commit. You never write production code without a failing test first.

## Philosophy

**Test behavior, not implementation.** Tests should verify what the system does through its public interfaces — not how it does it internally. A good test reads like a specification. A good test survives refactors unchanged, because internal structure changes don't affect it.

**Work vertically, not horizontally.** Never write all tests first and then all implementation. That produces tests that verify imagined behavior, not actual behavior. Instead: one test, one implementation, repeat. Each test responds to what you learned from the previous cycle.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4
  GREEN: impl1, impl2, impl3, impl4

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
```

## Input

You receive a feature to implement from one of:
- A list of acceptance criteria in the user's message
- A Linear ticket (fetch it via MCP tools and extract the ACs)
- A plan file from a prior `/spec` session
- `$ARGUMENTS` passed when invoking this skill

If the input doesn't include explicit behaviors or acceptance criteria, ask the user to provide them or to run `/spec` first.

## Step 1: Agree on implementation order

Present the behaviors to the user and propose an implementation order following ZOMBIES:

- **Z**ero — empty states, null cases, "nothing happens" baselines
- **O**ne — the simplest single-item happy path
- **M**any — multiple items, collections, batch behavior
- **B**oundaries — edge cases, off-by-one, mode boundaries
- **I**nterfaces — integration points, API contracts
- **E**xceptions — error handling, invalid input, failures
- **S**imple / happy path — the end-to-end flow confirming everything works together

Identify which behaviors are your Zero cases and start there. Explain your reasoning. Get user approval on the order before proceeding.

Focus testing effort on critical paths and complex logic, not every conceivable edge case. If a behavior feels like it needs ten tests, discuss with the user which aspects matter most.

## Step 2: Implement each behavior

Loop through the behaviors in the agreed order. For each one:

### 2a. Write the test(s)

- Write test(s) that express the behavior's expected outcome through its public interface
- Follow the project's test naming conventions (check CLAUDE.md or existing tests)
- Each test should have one specific purpose and once specific reason to fail
- Prefer real code paths over mocks. Only mock when unavoidable (external services, timers, etc.)

### 2b. Verify RED

Run the tests. They **must fail for the right behavioral reason**.

Confirm all of the following:
- [ ] Test fails (not errors)
- [ ] Failure message matches what you expected
- [ ] It fails because the feature is missing, not because of typos or broken imports

What counts as the **right** reason to fail:
- The function returns the wrong value
- The expected behavior doesn't happen
- An assertion fails because the feature doesn't exist yet

What counts as the **wrong** reason to fail:
- Syntax error
- Import error / module not found
- Type error at compile time
- `undefined is not a function`

If the test fails for the wrong reason, **scaffold a stub** — create the function/class/module with a minimal signature that compiles but doesn't implement the behavior (e.g., `throw new Error('not implemented')` or `return null`). Then re-run and confirm the test now fails for the right reason.

**If the test passes immediately**, the behavior was already implemented in a prior step. You MUST still prove the test is valuable:
1. Temporarily remove or break the implementation that makes it pass
2. Run the test — confirm it fails
3. Restore the implementation
4. Run the test — confirm it passes again

This is not optional. A test you never saw fail is a test you don't trust.

### 2c. Verify GREEN

Write the **minimum production code** to make the failing test pass. No more than what's needed. Don't anticipate future tests.

Run the tests. Confirm all of the following:
- [ ] The new test passes
- [ ] All prior tests still pass
- [ ] No new errors or warnings in test output

If the new test fails: fix the code, not the test.
If all prior tests fail: fix immediately before moving on.

### 2d. Refactor

Never refactor while RED. Only refactor after GREEN.

Ask the user: "Want to refactor before we move on?"

If yes, look for:
- Duplication to extract
- Names to improve
- Helpers to create
- Modules to deepen (move complexity behind simpler interfaces)

Re-run tests after each refactor step. Refactoring gets its own commit if the changes are non-trivial.

### 2e. Commit

Create one commit per behavior using conventional commits. The commit message should reference the behavior being implemented.

Behavior changes and refactors must go in **separate commits**. A commit either changes what the code does (behavior) or how it's structured (refactor), never both.

### 2f. Move to next behavior

Repeat from 2a for the next behavior in the order.

## Handling untestable steps

Some behaviors can't be unit tested (e.g., CSS reactivity, visual layout, drag interactions).

In order of preference:
1. **E2E test** — if the project has e2e infrastructure (Playwright, Cypress), write an e2e test
2. **Browser MCP tools** — if available, use browser automation to verify the behavior
3. **Manual verification** — as a last resort, tell the user exactly what to check and ask them to confirm whether it's green or red. Do NOT proceed until they confirm.

Even for manually-verified steps, still commit after confirmation.

## When stuck

| Problem | Solution |
|---------|----------|
| Don't know how to test it | Write the assertion first. What should be true? Work backwards from there. |
| Test is too complicated | The design is too complicated. Simplify the interface. |
| Must mock everything | Code is too coupled. Consider dependency injection or restructuring. |
| Test setup is huge | Extract test helpers. If still complex, the design needs simplifying. |
| Hard to test = hard to use | Listen to the test. Difficulty testing is a design signal, not a testing problem. |

## Rules

- No production code without a failing test first (or user-confirmed manual red state)
- Never skip Verify RED or Verify GREEN — run tests at every phase boundary
- Never commit multiple behaviors in one commit
- Never mix behavior changes and refactors in the same commit
- Never refactor while RED — get to GREEN first
- Never batch test runs across behavior boundaries
- If a test framework or runner isn't obvious, ask the user before guessing
- Respect the project's existing test patterns, file locations, and naming conventions
