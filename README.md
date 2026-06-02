# AI Skills

My personal AI skills for development workflows.

## Setup

Install via [skills.sh](https://skills.sh):

```bash
# install (interactive — pick skills and agents)
npx skills add matteo-greco/ai-skills -g

# install all skills, default agents, no prompts
npx skills add matteo-greco/ai-skills -g -s '*' -y

# update (re-run the install command — it overwrites existing skills)
npx skills add matteo-greco/ai-skills -g -s '*' -y

# uninstall
npx skills remove -g challenge code-review code-health create-tickets bug-triage spec tdd spike refactor adr onboarding gdpr-audit-verify recap
```

## Skills

Awareness:
- **recap** — End-of-day brief — gathers your git activity + PM tickets (Linear/Jira/GH Issues via MCP), detects "today" from largest activity gap (handles night-shift workers), renders 3–5 terse executive bullets ready to paste into standup/Slack
- **onboarding** — Guided tour of a codebase area, tailored to the reader's background and goals

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

Documentation:
- **adr** — Document an architectural decision with context, alternatives, and consequences

Compliance:
- **gdpr-audit-verify** — Verify an external GDPR / TDDDG / ePrivacy audit by reproducing each claim in a real browser and classifying it against EU + DE rules and CJEU case law

## Typical scenarios

**"The CEO wants us to build X"**
`/challenge` → refine the vision → `/spec` → write ACs → `/create-tickets` → `/tdd` → implement → `/code-review`

**"Let's build this feature"**
`/spec` → write ACs → `/create-tickets` → track the work → `/tdd` → implement → `/code-review`

**"A user reported a bug"**
`/bug-triage` → reproduce as failing test → `/tdd` → fix → `/code-review`
Or if it's not urgent: `/bug-triage` → `/create-tickets` → fix later

**"This code is a mess"**
`/code-health` → identify hotspots → `/refactor` → improve incrementally

**"We're not sure this is feasible"**
`/spike` → investigate → `/adr` to document the decision → `/spec` if feasible

**"I want to understand this area before touching it"**
`/onboarding` → guided tour of the area → `/adr` to document decisions → `/spec` if ready to change it

**"End of day — what did I do?"**
`/recap` → terse bullet brief of your git + ticket activity since the last meaningful break, paste-ready for standup or Slack. `--user <name>` to recap a teammate.

**"New dev joining the team"**
`/onboarding` → guided tour of the codebase

**"A lawyer / regulator / compliance tool sent us an audit report"**
`/gdpr-audit-verify` → reproduce each claim in a clean browser, classify against TDDDG § 25 + GDPR + case law, get a per-claim table and ranked fix list

## Acknowledgments

The TDD skill was inspired by:
- [mattpocock/skills](https://github.com/mattpocock/skills) — vertical vs horizontal testing, behavior-focused test philosophy
- [obra/superpowers](https://github.com/obra/superpowers) — structured RED/GREEN verification phases, "when stuck" patterns
