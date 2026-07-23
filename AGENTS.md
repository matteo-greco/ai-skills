## Agent skills

### Issue tracker

Issues are tracked as local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The canonical triage labels use their default names. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain-doc layout. See `docs/agents/domain.md`.

### Subagents

Use the user-owned bounded `subagent` extension for delegated work. Leaf tasks must not spawn additional subagents unless the original task explicitly requests nested orchestration. Keep the default nesting budget at zero and the default elapsed timeout unless the task clearly requires a larger bounded budget.
