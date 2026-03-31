# AI Skills

My personal AI skills for development workflows.

## Setup

Install via [skills.sh](https://skills.sh):

```bash
npx skills add matteo-greco/ai-skills        # interactive — pick skills and agents
npx skills add matteo-greco/ai-skills --all   # install all skills to all agents
```

Update to the latest version:

```bash
npx skills update
```

## Skills

Awareness:
- **pulse** — Daily situational awareness — orchestrates `/eng-status` and `/feedback-synthesis`, checks alignment against goals
- **feedback-synthesis** — Scan user feedback sources and distill patterns into actionable insights for planning
- **eng-status** — Scan planned work, git activity, PRs, CI/CD health, and delivery cadence
- **onboarding** — Guided tour of a codebase area, tailored to the reader's background and goals
- **incident** — Respond to a production incident — gather evidence, assess severity, coordinate a fix, write the postmortem

Planning:
- **challenge** — Challenge and refine a product direction — elicit the real problem, stress-test assumptions, explore alternatives, and scope down
- **spike** — Time-boxed technical investigation to answer a question and unblock `/spec` or `/tdd`
- **spec** — Break features into acceptance criteria
- **bug-triage** — Investigate a bug report, reproduce it as a failing test, and hand off to `/tdd` for the fix
- **create-tickets** — Create one or more well-structured tickets from a spec, ACs, or feature description

Implementation:
- **tdd** — Implement features using strict TDD (red-green-refactor) with ZOMBIES ordering
- **code-health** — Identify unhealthy areas of a codebase and suggest refactoring strategies ranked by impact
- **refactor** — Execute a refactoring safely with incremental steps, test verification, and safety assessment

Shipping:
- **code-review** — Review code changes or PRs for bugs, missing tests, security issues, and standard violations
- **release** — Cut a release by driving existing CI automation, crafting a polished changelog, and writing an announcement

Documentation:
- **adr** — Document an architectural decision with context, alternatives, and consequences

## Typical scenarios

**"The CEO wants us to build X"**
`/challenge` → refine the vision → `/spec` → write ACs → `/create-tickets` → `/tdd` → implement → `/code-review` → `/release`

**"Let's build this feature"**
`/spec` → write ACs → `/create-tickets` → track the work → `/tdd` → implement → `/code-review` → `/release`

**"A user reported a bug"**
`/bug-triage` → reproduce as failing test → `/tdd` → fix → `/code-review` → `/release`
Or if it's not urgent: `/bug-triage` → `/create-tickets` → fix later

**"This code is a mess"**
`/code-health` → identify hotspots → `/refactor` → improve incrementally

**"We're not sure this is feasible"**
`/spike` → investigate → `/adr` to document the decision → `/spec` if feasible

**"I want to understand this area before touching it"**
`/onboarding` → guided tour of the area → `/adr` to document decisions → `/spec` if ready to change it

**"Something is broken in production"**
`/incident` → stabilize → `/bug-triage` → root cause fix → `/code-review` → `/release` → `/adr` if architectural change needed

**"Changes have piled up without a release"**
`/release` → drive CI automation, craft changelog, write announcement

**"What should we build next?"**
`/feedback-synthesis` → surface user patterns → `/spec` the top pain point → `/create-tickets`

**"Start of day — what's going on?"**
`/pulse` → alignment check against goals (dispatches `/eng-status` + `/feedback-synthesis`)

**"New dev joining the team"**
`/onboarding` → guided tour of the codebase

## Acknowledgments

The TDD skill was inspired by:
- [mattpocock/skills](https://github.com/mattpocock/skills) — vertical vs horizontal testing, behavior-focused test philosophy
- [obra/superpowers](https://github.com/obra/superpowers) — structured RED/GREEN verification phases, "when stuck" patterns
