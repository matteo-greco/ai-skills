---
name: incident
description: Respond to a production incident — gather evidence, assess severity, find the cause, coordinate a fix, and write the postmortem. Structured triage when things are on fire.
disable-model-invocation: true
user-invocable: true
argument-hint: "[what's happening — error, user report, alert, or symptom]"
---

# Incident Response

Something is broken in production. Your job is to help stabilize the situation quickly and methodically — gather evidence, assess impact, find the cause, and coordinate a fix. Speed matters, but so does not making things worse.

## Input

An incident report from:
- `$ARGUMENTS` — an error message, alert, user report, or symptom
- A panicked message from the user
- An automated alert or monitoring notification

## Step 1: Assess severity

Before diving into code, understand the blast radius:

- **Who is affected?** — all users, a subset, one user, internal only?
- **What's broken?** — core functionality down, degraded experience, cosmetic issue, data at risk?
- **Since when?** — just started, been going on for hours, intermittent?
- **Is it getting worse?** — stable, degrading, cascading?

Classify severity:

- **Critical** — core functionality down for all/most users, data loss risk, or security breach. Drop everything.
- **High** — significant functionality impaired, workaround exists but it's painful. Fix urgently.
- **Medium** — noticeable degradation but users can work around it. Fix soon.
- **Low** — minor issue, limited impact. Can be handled as a normal bug.

For **low** severity, suggest switching to `/bug-triage` instead — it doesn't need incident response.

Tell the user your assessment. Agree on severity before proceeding.

## Step 2: Gather evidence

Collect everything relevant. Work fast but be thorough — evidence gathered now saves debugging time later.

- **Error logs** — check application logs, server logs, error tracking (Sentry, etc.). Use available MCP tools or ask the user for access.
- **Recent changes** — what was deployed recently? `git log --oneline` on the deployed branch. Check CI/CD for recent deployments.
- **Monitoring** — dashboards, metrics, health checks. Is this a spike or a flatline?
- **User reports** — what exactly are users seeing? Screenshots, error messages, reproduction steps.
- **Environment** — did anything change? Infrastructure updates, dependency upgrades, config changes, third-party outages.

Present the evidence clearly. Patterns often become obvious once everything is laid out.

## Step 3: Identify the cause

Based on the evidence:

1. **Correlate with recent changes** — most incidents are caused by something that changed. If a deploy happened right before the incident started, that's your prime suspect.
2. **Check the code path** — trace the error or symptom through the code. Read the relevant files.
3. **Check external dependencies** — is a third-party service down? An API returning unexpected responses? A database connection failing?
4. **Check for known issues** — search project issues, upstream bug trackers, and documentation for the error message or symptoms.

Present your hypothesis: "I believe the cause is X, because Y." If you're not sure, say so and present the top candidates.

## Step 4: Decide on a response

Two options, and the choice depends on the severity and the fix complexity:

### Rollback (when speed is critical)

If the incident correlates with a recent deploy and the previous version was stable:
- Identify the last known good version
- Help the user trigger a rollback through their deployment process
- Verify the rollback resolves the issue

Rollback first, investigate later. Don't debug for an hour when a 2-minute rollback would restore service.

**But first, check if a rollback is safe.** Not all incidents can be rolled back:
- **Data corruption** — if the bug wrote bad data, rolling back the code doesn't fix the data. The bad data persists and may cause the old version to break too.
- **Schema migrations** — if the deploy included a database migration, the old code may not work against the new schema.
- **External side effects** — if the bug sent incorrect notifications, created wrong records in third-party systems, etc., rolling back doesn't undo those.

If a rollback isn't safe, say so clearly and explain why. Fix forward is the only option in these cases.

### Fix forward (when the fix is clear and small)

If the cause is identified and the fix is simple:
- Write the fix
- Hand off to `/code-review` for a quick sanity check if time allows
- Help deploy through the project's normal process

Never fix forward with a complex change during an incident. If the fix isn't obvious, rollback.

**Tell the user which approach you recommend and why.** Get their approval before acting. During an incident is not the time for surprises.

## Step 5: Verify resolution

After the rollback or fix is deployed:
- Confirm the symptoms are gone
- Check logs for the error — is it still occurring?
- Monitor for a reasonable period — some issues are intermittent
- Confirm with the user that the situation is stable

## Step 6: Write the postmortem

Once the fire is out, document what happened. A postmortem prevents the same incident from happening again.

```
### Incident: [short description]

**Date:** [YYYY-MM-DD]
**Duration:** [how long from detection to resolution]
**Severity:** [Critical / High / Medium]
**Impact:** [who was affected, how]

**Timeline:**
- [HH:MM] — [what happened]
- [HH:MM] — [what was done]
- ...

**Root cause:**
[What actually caused the incident — be specific]

**Resolution:**
[What was done to fix it — rollback, hotfix, config change]

**What went well:**
- [Things that helped — monitoring caught it fast, rollback was smooth, etc.]

**What could be improved:**
- [Things that slowed response — missing alerts, unclear runbooks, etc.]

**Action items:**
- [ ] [Preventive action — e.g. "add monitoring for X", "add test for this edge case"]
- [ ] [Process improvement — e.g. "add rollback runbook for this service"]
```

Suggest where to save the postmortem — the project's incident log, a wiki, or an ADR if the incident triggered an architectural decision.

The postmortem's action items should feed into the normal workflow: `/bug-triage` for the root cause fix, `/spec` for preventive features, `/adr` for any architectural decisions made under pressure that should be formally documented.

## Rules

- Always assess severity first — the response should be proportional to the impact
- Always check recent changes — most incidents are caused by something that changed
- Rollback over fix-forward when in doubt — restoring service is more important than finding the perfect fix
- Never deploy a complex fix during an incident — simple and correct beats clever and risky
- Never skip the postmortem — incidents that aren't documented will repeat
- Never blame individuals in the postmortem — focus on systems and processes
- If you don't have enough access to diagnose (no logs, no monitoring), say so immediately — the user may need to gather evidence themselves
