---
name: onboarding
description: Guided tour of a codebase area — explain what it does, how it's structured, key patterns, important decisions, and where the dragons are. Tailored to the reader's background.
disable-model-invocation: true
user-invocable: true
argument-hint: "[area to explore — module, feature, directory, or blank for full overview]"
---

# Onboarding

You give someone a guided tour of a codebase or a specific area of it. Not a file listing or a README dump — a narrative explanation that builds understanding progressively, tailored to what the reader already knows.

## Input

An onboarding request from:
- `$ARGUMENTS` — a module, feature, directory, or topic to explain
- A blank request — give an overview of the whole project

## Step 1: Understand the reader

Before explaining anything, understand who you're explaining to. Ask (or infer from context):
- **What's their background?** — senior dev new to this codebase? Junior learning the stack? Backend dev touching frontend for the first time?
- **What do they already know?** — the language? The framework? The domain?
- **What's their goal?** — contributing to a specific feature? Reviewing code? Understanding the architecture? Debugging an issue?

Tailor the depth and framing to their background. A React expert exploring a Svelte codebase needs "here's how this maps to what you know." A junior needs "here's what this pattern is and why it's used."

## Step 2: Survey the area

Explore the codebase area to build your own understanding:
- Read the code structure — directories, key files, entry points
- Read project instructions (`CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, etc.)
- Check for ADRs — architectural decisions that explain *why* things are the way they are
- Check git history — who works here, how often does it change, what's recent?
- Identify the key abstractions — what are the building blocks someone needs to understand?

## Step 3: Build the narrative

Present the area as a guided tour, not a reference manual. Structure it to build understanding progressively:

### Start with the big picture
- What does this area do? One paragraph, plain language.
- Where does it sit in the broader system? What depends on it, what does it depend on?
- If the reader changed something here, what would they need to test?

### Walk through the key concepts
- Introduce the main abstractions one at a time, in the order someone would need to learn them
- For each: what is it, why does it exist, how does it relate to the others?
- Use concrete examples from the code — "see how `X` uses `Y` in [file:line]"

### Call out the patterns
- What patterns does this area use? (DI, registry, composables, event-driven, etc.)
- Are they standard or project-specific? If project-specific, explain the convention.
- Where are the patterns consistent and where do they break? Inconsistencies are often the most confusing part for newcomers.

### Point out the dragons
- What's counterintuitive or surprising?
- What's deprecated or in the middle of a migration?
- What looks wrong but is intentional? (Link to ADRs if they exist.)
- What's fragile — areas where a small change can break things in unexpected ways?

### Show the test landscape
- Where are the tests? How do you run them?
- What's well-covered and what isn't?
- Are there test utilities or patterns specific to this area?

## Step 4: Answer questions

After presenting the tour, the reader will have questions. This is a conversation — expect them to:
- Ask to go deeper on a specific concept
- Ask "why is it done this way?" (check ADRs, git blame, or explain the pattern)
- Ask "where would I change X?" (trace the code path for them)
- Ask "what should I read first?" (suggest a reading order for the key files)

## Rules

- Always tailor to the reader's background — don't explain React to a React expert, don't assume framework knowledge from a newcomer
- Always use concrete code references — "the registry pattern" is abstract, "[BlocksRegistry](src/classes/BlocksRegistry.php) manages all block types" is useful
- Always call out what's in flux — nothing is more confusing than learning a pattern only to discover it's being replaced
- Never dump a file tree and call it onboarding — structure beats completeness
- Never explain everything — focus on what the reader needs for their goal. A contributor to one module doesn't need to understand the entire codebase.
- If an area is poorly documented or confusing, say so honestly — "this module is hard to follow because X" is more helpful than a forced explanation
