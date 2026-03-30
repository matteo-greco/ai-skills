---
name: code-health
description: Identify unhealthy areas of a codebase — complexity hotspots, code smells, testability problems, and change coupling. Suggests refactoring strategies ranked by impact.
disable-model-invocation: true
user-invocable: true
argument-hint: "[directory, feature area, or blank for full codebase]"
---

# Code Health

You analyze a codebase to find the areas most worth refactoring. Not all bad code is equally worth fixing — your job is to find code that is both unhealthy and costly, and suggest what to do about it.

## Scope

If `$ARGUMENTS` specifies a directory, feature area, or file pattern:
→ Focus the analysis on that area.

If `$ARGUMENTS` is empty:
→ Analyze the full codebase.

## Step 1: Find hotspots from git history

The most valuable refactoring targets are files that are **both complex and frequently changed**. A messy file nobody touches is low priority. A tangled file that gets edited every sprint is high priority.

Run git history analysis to find:

### Change frequency
Which files change most often? Use `git log --format=format: --name-only` over a meaningful time range (3–6 months) and count changes per file.

### Change coupling
Which files always change together? Files that are modified in the same commits but live in different modules suggest hidden dependencies or shotgun surgery. Look for pairs or clusters with high co-change rates.

### Knowledge concentration
Which files have only one contributor? Use `git shortlog -s` per file or directory. Single-author files are a bus-factor risk — and often lack the design pressure that comes from multiple people working with the code.

## Step 2: Analyze code structure

For the hotspot files identified in Step 1 (and any area the user specified), look for these smells. Prioritize smells that hurt testability — they compound over time and make every future change more expensive.

### Testability killers

These smells force tests to verify implementation details instead of behavior, making tests brittle and hard to write:

- **Missing dependency injection** — classes that instantiate their own collaborators instead of receiving them. Forces tests to use the real dependency or resort to monkey-patching.
- **Singletons and global state** — shared mutable state that leaks between tests and makes execution order matter.
- **Hidden side effects** — methods that read/write external state (files, network, database) without that being visible in their signature.
- **Static method chains** — long chains of static calls that can't be substituted in tests.
- **Deep inheritance hierarchies** — behavior spread across many layers makes it hard to test one thing in isolation.

### Structural smells

- **God class** — one class with too many responsibilities. Changes for unrelated reasons (divergent change).
- **Long method** — methods that do too much. Hard to name, hard to test, hard to reuse.
- **Deep nesting** — excessive if/else or loop nesting. High cyclomatic complexity.
- **Feature envy** — a method that uses another class's data more than its own. The behavior probably belongs elsewhere.
- **Primitive obsession** — using raw strings, numbers, or arrays where a domain object would add clarity and safety.
- **Shotgun surgery** — one logical change requires touching many files. Often revealed by change coupling in Step 1.
- **Data clumps** — the same group of parameters passed together everywhere. Usually wants to be an object.
- **Inappropriate intimacy** — classes that reach into each other's internals instead of communicating through interfaces.

### Test smells (if tests exist)

- Tests that mock everything — a sign the production code is too coupled
- Tests that break when implementation changes but behavior doesn't — testing the "how" not the "what"
- Tests with excessive setup — the code under test has too many dependencies
- Duplicated test setup across files — missing test helpers or fixtures

## Step 3: Rank and present findings

Rank each finding by **pain** — how much it costs the team — not just presence. Consider:

- **Change frequency** — a smell in a file that changes weekly hurts more than one in a file that changes yearly
- **Blast radius** — a smell that affects many other files (via coupling) hurts more than an isolated one
- **Testability impact** — a smell that makes tests hard to write has compounding cost on every future change
- **Fix difficulty** — easy wins with high impact go first

Present findings grouped by area (file or module), ordered by priority. For each finding:

```
### [area/file]

**Change frequency:** N commits in last 6 months
**Contributors:** N
**Co-changes with:** [other files, if relevant]

**Smells found:**
1. [Smell name] — [concrete description of where and what]
2. ...

**Suggested refactoring:**
- [Strategy] — [what to do and what pattern to apply]
- ...
```

## Step 4: Suggest refactoring strategies

For each high-priority finding, suggest a specific refactoring strategy. Name the pattern or technique, explain what it would look like in this codebase, and call out risks or prerequisites.

Common strategies to draw from:

| Smell | Refactoring | Pattern |
|-------|------------|---------|
| Missing DI | Extract dependency, inject via constructor | Dependency Injection |
| Singleton/global state | Pass state explicitly, use DI container | Parameter Object, DI Container |
| God class | Extract classes by responsibility | Single Responsibility, Facade |
| Long method | Extract method, compose pipeline | Composed Method, Strategy |
| Deep nesting | Early returns, extract predicates | Guard Clauses, Specification |
| Feature envy | Move method to the class that owns the data | Move Method |
| Tight coupling | Extract interface, depend on abstraction | Dependency Inversion, Ports & Adapters |
| Shotgun surgery | Move related code into one module | Cohesive Module, Move Function |
| Data clumps | Introduce a value object | Value Object, Parameter Object |
| Deep inheritance | Favor composition, extract behavior | Strategy, Composition over Inheritance |

Don't just name the pattern — sketch how it applies. "Extract a `NotificationService` that receives a `Mailer` via constructor instead of calling `Mailer::getInstance()` directly" is useful. "Apply Dependency Injection" is not.

## Step 5: Discuss with the user

Present your findings and let the user react. They know the codebase's history and constraints better than you do. Expect them to:

- Reprioritize ("that file is about to be rewritten anyway, skip it")
- Add context ("that coupling is intentional, it's a bounded context boundary")
- Focus ("let's dig deeper into the testability problems in this module")

Revise based on their input.

## Rules

- Always start from git history — don't just grep for smells without knowing what code is actively worked on
- Rank by pain, not by purity — a pragmatic fix in a hotspot beats a perfect refactoring in dead code
- Be specific — name the file, the class, the method. Vague findings are useless.
- Suggest strategies, not just problems — every finding should come with a path forward
- Don't propose rewrites — suggest incremental refactorings that can be done safely, ideally behind existing tests
- Respect existing tests — if code is well-tested, note that as a strength even if the code itself smells. Well-tested smelly code is safer to refactor.
