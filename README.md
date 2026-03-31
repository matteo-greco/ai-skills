# AI Skills

My personal AI skills for development workflows.

## Skills

- **tdd** — Implement features using strict TDD (red-green-refactor) with ZOMBIES ordering
- **spec** — Break features into acceptance criteria
- **code-review** — Review code changes or PRs for bugs, missing tests, security issues, and standard violations
- **code-health** — Identify unhealthy areas of a codebase and suggest refactoring strategies ranked by impact
- **refactor** — Execute a refactoring safely with incremental steps, test verification, and safety assessment
- **bug-triage** — Investigate a bug report, reproduce it as a failing test, and hand off to /tdd for the fix
- **adr** — Document an architectural decision with context, alternatives, and consequences
- **release** — Cut a release by driving existing CI automation, crafting a polished changelog, and writing an announcement
- **feedback-synthesis** — Scan user feedback sources and distill patterns into actionable insights for planning
- **spike** — Time-boxed technical investigation to answer a question and unblock /spec or /tdd
- **onboarding** — Guided tour of a codebase area, tailored to the reader's background and goals
- **incident** — Respond to a production incident — gather evidence, assess severity, coordinate a fix, write the postmortem

## Setup

Symlink into Claude Code's skills directory:

```bash
ln -s ~/code/ai-skills/tdd ~/.claude/skills/tdd
```

## Acknowledgments

The TDD skill was inspired by:
- [mattpocock/skills](https://github.com/mattpocock/skills) — vertical vs horizontal testing, behavior-focused test philosophy
- [obra/superpowers](https://github.com/obra/superpowers) — structured RED/GREEN verification phases, "when stuck" patterns
