# AI Skills

My personal AI skills for development workflows.

## Skills

- **tdd** — Implement features using strict TDD (red-green-refactor) with ZOMBIES ordering
- **spec** — Break features into acceptance criteria
- **code-review** — Review code changes or PRs for bugs, missing tests, security issues, and standard violations
- **code-health** — Identify unhealthy areas of a codebase and suggest refactoring strategies ranked by impact
- **refactor** — Execute a refactoring safely with incremental steps, test verification, and safety assessment

## Setup

Symlink into Claude Code's skills directory:

```bash
ln -s ~/code/ai-skills/tdd ~/.claude/skills/tdd
```

## Acknowledgments

The TDD skill was inspired by:
- [mattpocock/skills](https://github.com/mattpocock/skills) — vertical vs horizontal testing, behavior-focused test philosophy
- [obra/superpowers](https://github.com/obra/superpowers) — structured RED/GREEN verification phases, "when stuck" patterns
