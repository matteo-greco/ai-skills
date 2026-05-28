---
name: recap
description: Summarize what the user worked on "today" — gathers git activity from local repos plus any connected PM tool (Linear, Jira, GitHub Issues, etc. via MCP), then renders a terse 3–5 bullet executive brief. "Today" is detected from the largest gap in recent activity, accommodating night-shift workers.
disable-model-invocation: true
user-invocable: true
argument-hint: "[--gap-hours N] [--since ISO] [--repos a,b,c] [--user email-or-name] [--scope cwd|saved|all] [--reconfigure]"
---

# Recap

You produce a short, copy-pasteable summary of what the user has done since their last meaningful break (default: largest activity gap ≥ 4h in the last 72h). The output is a **brief for a busy executive**: 3–5 bullets, past tense, `what — consequence (link)`.

This skill gathers facts and writes the brief. It does **not** judge, advise, or suggest next steps.

## Inputs

- `$ARGUMENTS` — optional:
  - `--gap-hours N` — override the gap threshold used to detect "today" (default `4`)
  - `--since ISO` — skip gap detection, use explicit start (e.g. `--since 2026-05-28T00:00:00`)
  - `--repos a,b,c` — explicit repo list, skip auto-discovery and saved scope
  - `--user <email-or-name>` — recap someone else's activity instead of the logged-in user. Accepts an email (`alice@example.com`), substring match on email (`alice`), or git author-name substring (`Alice K`). Useful for testing or generating recaps on behalf of a teammate.
  - `--scope cwd|saved|all` — override the saved neighborhood scope for this run only:
    - `cwd` — only the current repo (or, if cwd is a parent dir, all direct subdirs)
    - `saved` — use the persisted scope from `~/.claude/recap-scope.yaml` (default if a saved scope exists for this neighborhood)
    - `all` — include every active sibling repo, ignore saved exclusions
  - `--reconfigure` — re-prompt for neighborhood scope and overwrite the saved entry

## Step 1: Discover in-scope repos

`--repos` short-circuits this entire step.

### 1a. Anchor + neighborhood

- **Anchor:** if `cwd/.git` exists → anchor repo = `cwd`. Else → anchor = none, cwd is a parent dir.
- **Neighborhood:** the directory that contains the anchor (i.e. `cwd/..` when anchored, else `cwd`). The neighborhood is the search radius for sibling repos.

### 1b. Candidate set

Walk `<neighborhood>/*/` one level deep. Collect every direct subdir with a `.git` directory. **Do not recurse further** (avoids `node_modules`, vendored deps).

Filter candidates to those with **user activity in the last 72h** — at least one commit by the resolved user (Step 2). Repos that exist but are dormant for this user drop out silently.

If anchor exists and is not in the candidate set (user had no recent activity there), keep it anyway — they invoked from it, they probably want it considered.

### 1c. Resolve scope: saved → prompt → save

Read `~/.claude/recap-scope.yaml`. Format:

```yaml
neighborhoods:
  /Users/alex/code:
    include: [repo-a, repo-b, repo-c]      # only these are surfaced
    exclude: [personal-blog, dotfiles]     # these are never surfaced even if active
    updated: 2026-05-28
  /Users/alex/work:
    include: all                            # surface every active sibling
    exclude: []
    updated: 2026-05-15
```

Resolution order:

1. If `--scope cwd` → scope = `[anchor]` only (no prompt, no save).
2. If `--scope all` → scope = all candidates (no prompt, no save).
3. If config has an entry for this neighborhood **and** `--reconfigure` not set → apply `include`/`exclude` to candidates, use result as scope. Skip the prompt.
4. Otherwise → **prompt the user** (see 1d), then save the answer.

### 1d. The prompt

Only when no saved scope (or `--reconfigure`):

- If only the anchor is active (or only one repo is active total) → no prompt needed, scope = the single active repo. **Still save** the entry to YAML so future runs in this neighborhood reuse it: `include: [<that-repo>]`, `exclude: []`.
- If anchor + N active siblings → ask which to include:

```
Active repos in <neighborhood> (last 72h):
  [a] <anchor>            (12 commits)   <-- invoked from here
  [b] sibling-one         (4 commits)
  [c] sibling-two         (1 commit)
  [d] personal-blog       (7 commits)
  [e] dotfiles            (2 commits)

Which should /recap surface? (e.g. "a,b,c" or "all" or "anchor only")
Also: anything to permanently exclude? (e.g. "d,e" — won't be asked again)
```

Use `AskUserQuestion` with two questions: include-list + permanent-exclude-list. Persist both to the YAML.

### 1e. Apply scope

Final scope = `(candidates ∩ include) − exclude`, plus anchor if it wasn't filtered. If empty → "no in-scope repos with activity in 72h" and stop.

### Why include/exclude vs just include

`exclude` is the "never bother me about this" list — personal projects, dotfiles, scratch repos. They get filtered even when new ones appear. `include` can be `all` to mean "surface everything except excludes" — sensible default for work-only neighborhoods.

## Step 2: Identify the target user

**Default (no `--user`):** for each in-scope repo, read its local `user.email`:

```bash
git -C <repo> config user.email
```

Fall back to global `git config --global user.email` if local is unset. Repos with no email configured: skip with a note in the final output ("skipped <repo> — no git user.email").

All subsequent commit filters use **that repo's** email — handles work/personal split.

**With `--user <value>`:** override identity resolution.

- Resolution: scan recent commits across in-scope repos with `git log --format='%ae %an'` (last 30d, dedup) to build the author list, then match `<value>` as substring against both email and name (case-insensitive).
  - **Cluster matches by person before disambiguating.** A single person often has multiple identities (work email + personal email, name variants like `Alex Doe` / `alex-doe`). If all matched authors share a normalized name root or one email's local-part matches another's name, treat as one person and OR-match all their emails in downstream queries.
  - If exactly one cluster, use it.
  - If multiple distinct clusters (e.g. "alex" matches both Alex Doe and Alex Smith), list them and ask user to disambiguate.
  - If none match, error: "no author matching '<value>' in last 30d across in-scope repos".
- Once resolved, use that email for **every** repo's commit filter (don't re-read per-repo `user.email`). Same email also drives branch-author filter (Step 3) and PR filter (replace `--author "@me"` with `--author "<resolved-handle>"` if a GitHub handle can be derived; otherwise fall back to email filter on PR author).
- **PM tool probe (Step 4):** PM MCPs typically grant the authenticated user full workspace access — they can query *any* user's issues, comments, projects. Don't assume scope is "logged-in only". When `--user` is set:
  - Linear: query by `assignee = "<user>"` OR `updatedBy = "<user>"` OR `commentedBy = "<user>"`. Resolve `<user>` to a Linear member via the MCP's user-lookup (name or email).
  - Jira: `assignee = "<user>" OR worklogAuthor = "<user>"` via JQL.
  - GitHub: `gh issue list --author <handle>`.
  - Only if a tool genuinely cannot filter by another user (rare — usually a workspace-permission issue), log it in notes and continue with git-only data.
- **Output header:** when `--user` is set, prepend the brief with the user's name so it's not mistaken for your own:

```
Recap for <name or email> — since <today_start>:
```

## Step 3: Gather raw activity timestamps

For each repo, collect timestamps of the user's activity in the last 72h:

```bash
git -C <repo> log --author="<email>" --since="72 hours ago" \
  --pretty=format:'%cI%x09%H%x09%s' --all
```

**Filter out non-work commits** from the result before feeding into synthesis:
- Stash artifacts: subjects starting with `WIP on `, `index on `, or matching `^WIP$`.
- Merge commits with no message of substance (subjects starting with `Merge branch ` or `Merge pull request `) — keep their timestamps for gap detection, but don't render them as bullets.

Also gather:
- **Pushed branches:** `git -C <repo> for-each-ref --sort=-committerdate --format='%(committerdate:iso8601)%09%(refname:short)%09%(authoremail)' refs/remotes/origin --count=20`. Filter to: (a) tip committed in last 72h, **and** (b) `authoremail` matches the user's email. Branches authored by others (teammates) get dropped here.
- **Dirty WIP:** `git -C <repo> status --porcelain` — if non-empty, capture as a single "WIP in <repo>" signal (no timestamp; included only if scope ends up containing this repo).
- **PRs (if `gh` available):** `gh pr list --author "@me" --state all --search "updated:>$(date -u -v-72H +%Y-%m-%d)" --json number,title,state,url,updatedAt,headRefName` — run from inside each repo with a GitHub remote. Tolerate missing `gh` silently.

## Step 4: Probe PM tools via MCP

Enumerate available MCP servers. For each known PM adapter, query the user's recent activity (last 72h):

- **Linear** (`mcp__*Linear*`): query issues assigned-to-me OR recently-updated-by-me. Capture `{id, title, state, url, updatedAt}`.
- **Jira** (`mcp__*Jira*`): same shape via JQL `assignee = currentUser() AND updated >= -3d`.
- **GitHub Issues** (`mcp__*GitHub*` or via `gh issue list --author @me`): same shape.
- **Asana / Notion / others:** if a probe is obvious from the tool list, attempt it.

For each tool that responds, feed `updatedAt` timestamps into the gap-detection pool (Step 5) **alongside** git timestamps — a Linear ticket moved at 2am counts as activity.

If **no** PM tool is connected, skip silently. Cross-linking in Step 6 still works via branch/commit ID extraction.

## Step 5: Detect "today" via activity gap

Pool all timestamps from Step 3 and Step 4 into one sorted-descending list. **Normalize to UTC before sorting** — git emits `%cI` with author's local offset, teammates in different timezones will mis-sort otherwise. Then:

1. Walk consecutive pairs from newest to oldest.
2. First pair where `prev - curr ≥ gap_hours` → `today_start = prev` (the activity *after* the gap).
3. If the most recent timestamp is itself older than `gap_hours` → user has been idle; `today_start = most_recent_timestamp` (recap the last burst, even if it ended yesterday). Note this in the output: "(last burst ended <time>)".
4. Fallbacks:
   - **No activity in 72h:** `today_start = local midnight`. Output a single line: "No activity since <date>."
   - **No gap found (continuous):** cap at 18h back from now. Note: "(no clear break detected, capped at 18h)".
   - **Only one timestamp:** use it as `today_start`.

Default `gap_hours = 4`. Override via `--gap-hours`. If `--since` provided, skip this entire step.

State the chosen `today_start` to the user in one line above the bullets, so they can sanity-check.

## Step 6: Build the activity set and cross-link tickets

Filter everything from Step 3 + Step 4 to `>= today_start`.

For each commit / branch / PR, extract candidate ticket IDs:
- From branch name: regex `[A-Z]{2,6}-\d+` (matches `ENG-123`, `OPS-7`, etc.) — also try `\b[a-z]+/([A-Z]+-\d+)` for prefixed branches.
- From commit subject + body: same regex.
- From PR title + body.

If the same ticket ID appears in PM-tool results, **merge** — use the PM title and URL as the canonical reference for that group of commits/PR.

If a ticket ID can't be enriched (no matching PM tool, or tool didn't return it), fall back in this order:
1. Branch URL if branch exists and has remote: `[ETC-818](https://github.com/owner/repo/tree/chris/etc-818-...)`.
2. PR URL if a PR exists for the branch.
3. Bare ID as plain text (no link) if nothing else available.

Group activity by:
1. Enriched PM tickets (one bullet per ticket, merging all linked commits/PR).
2. PRs without ticket IDs (one bullet per PR).
3. Loose commits — cluster by topic only if they obviously share one (same file area, same subject prefix). Otherwise one bullet for the largest cluster, drop the rest.
4. WIP — include only if non-trivial (>5 changed files or new untracked files); render as "drafted X in <repo>".

## Step 7: Render — two zones

Split output into **metadata** (what the user reads to sanity-check the run) and **paste-block** (what they copy into Slack/standup).

```
<metadata line(s) — outside any code block>

```
<paste-block content — inside a fenced code block>
```

<notes — outside, after>
```

The paste-block is **pure content**. No timestamps, no scope info, no "PM enrichment status", no skip messages. Just bullets + `Next up:` placeholder. User selects inside the fence, copies, pastes — that's the whole interaction.

### Metadata zone (before the fence)

One line, terse:

```
Since 10:25am · scope: morning-brief · PM: linear (enriched)
```

Components, separated by ` · `:
- `Since <today_start>` formatted per recency rules below
- `scope: <repo-or-comma-list>` — which repos contributed bullets
- `PM: <tool>` (`linear (enriched)`, `linear (skipped)`, `none`)
- `user: <name>` only when `--user` is set
- `(stale)` if stale-burst fallback fired

### Paste zone

Inside a fenced code block. Only contains bullets and the `Next up:` placeholder. If `--user` is set, the first line of the paste block is `Recap for <name>:` — included because the reader of the pasted message needs to know whose recap it is.

### Notes zone (after the fence)

Single line if needed. See Step 8.

---

Goal for the paste-block bullets: shortest possible bullet that still carries `what + consequence + link`. Executive scans in 10 seconds.

**Compression rules (mandatory):**

- **Drop articles** (`a`, `an`, `the`) wherever the sentence still parses. "Shipped Yahoo source" not "Shipped the Yahoo source".
- **Drop filler** — `just`, `really`, `basically`, `actually`, `simply`, `now`, `pretty much`, `kind of`. They add nothing.
- **Drop hedging** when it isn't load-bearing — `seems to`, `appears to`, `I think`. Keep hedges that carry real epistemic info ("likely bottleneck" = unverified claim worth signaling).
- **Drop pleasantries** entirely.
- **Fragments encouraged.** "Timeline loop hardened — one bad source no longer kills brief." Subject-drop OK when context is the user.
- **Short verbs.** ship/fix/gate/kill/swap/cut/wire/draft beats implement/establish/introduce/refactor-toward.
- **Compress numbers and units.** `~3%` not `approximately 3 percent`. `$5–$10/mo` not `between five and ten dollars per month`.
- **Em-dash compresses cause and effect.** `Yahoo source live — daily stocks in morning brief`. No "which means", "so that", "resulting in".
- **One slash for either/or pairs.** "upgrade tier / self-host beefier" not "either upgrade the tier or self-host on a beefier machine".
- **Repo/scope only when needed for disambiguation.** "in morning-brief" stays if multiple repos touched today; drops if all activity is one repo.
- **Code/identifiers/errors verbatim** — never compress technical names. `/retrieve`, `ENABLE_AI_TOOL_CALLS_DISPLAY`, `ENG-458` stay exact.
- **Past tense, active voice.** Same as before.
- **Inline markdown links** — `[ENG-458](url)`, `[#214](url)`.

**Format:** `- <action> <object> — <consequence> ([link])`. Em dash optional when consequence fuses naturally.

**Bullet count:** 3–5 sweet spot. Soft 7. Hard 10. Merge TDD `test+feat` pairs on same scope into one bullet. Drop the smallest items before exceeding 7.

**Word budget:** target ≤15 words per bullet. Hard cap 25. If over, you're listing mechanism — re-compress. Strip file names, line counts, branch names (unless branch name *is* the ticket ID), tech stack labels (`PHP`, `TS`), helper-class names that don't add meaning to an outsider.

**`today_start` formatting (used in metadata line):**

- Same calendar day → `10:25am`
- Yesterday → `yesterday 6:42pm`
- 2–6 days back → weekday + rough time of day: `Tue afternoon`, `Mon evening`
- ≥7 days back → absolute date: `May 12`

`today_start` only appears in the metadata line outside the fence. **Never inside the paste-block.**

**`Next up:` section — always present, never inferred:**

Append the section header with an empty bullet for the user to fill in themselves. Never speculate. Plans live in the user's head, not in git.

```
Next up:
- 
```

That's it. One header, one empty `- ` placeholder, blank line after. The user types their own plans on paste.

Do **not**:
- Infer next steps from open PRs, WIP branches, ticket states, or anything else.
- Fill the bullet with observations dressed as plans ("Branch pushed but no PR yet" belongs in the main bullets as a fact, not here as a plan).
- Suggest what the user "should" do next.

**Full output example (own recap):**

````
Since 10:25am · scope: morning-brief · PM: linear (enriched)

```
- Yahoo Finance source live in morning-brief — daily stocks in morning brief
- Timeline loop hardened — one bad source no longer kills brief
- /retrieve stress-tested — SurrealDB bottlenecks at 3+ users; upgrade tier / self-host beefier
- Drafted RAG→web search fallback — ships 1.4.3 ([ENG-458](https://linear.app/...))

Next up:
- 
```
````

**Full output example (teammate recap with `--user chris`):**

````
Since yesterday 4:24pm · scope: etch · PM: linear (enriched) · user: Chris · (stale)

```
Recap for Chris:
- Scaffolded [ETC-818](https://linear.app/.../ETC-818) custom-field CRUD API in etch — schemas + client + tests ready, branch up, no PR

Next up:
- 
```
````

**Voice notes:**

- Numbers > adjectives. `3+ users` beats `several users`. `$5–$10/mo` beats `cheap`.
- Honest hedges OK. `likely bottleneck`, `roughly`, `~3%` are signal, not filler.
- Naming teammates OK when they own a next step. `Alex on fallback`, `Sam PoC`.
- Light personal aside is OK if it carries real info ("only took 1h" = effort signal). Skip if pure decoration.

**Before/after compression (apply to every draft bullet):**

| Draft | Compressed |
|---|---|
| Shipped a new Yahoo Finance news source in the morning-brief repo | Yahoo Finance source live in morning-brief |
| The timeline loop was hardened so that one bad source no longer breaks the brief | Timeline loop hardened — one bad source no longer kills brief |
| We stress-tested the /retrieve endpoint and found that SurrealDB is likely a bottleneck at 3+ concurrent users | /retrieve stress-tested — SurrealDB bottlenecks at 3+ users |
| I drafted a fallback that uses web search when RAG returns nothing useful | Drafted RAG→web search fallback |

Run each bullet through this mental pass before output. If you can cut a word without losing technical info, cut it.

**Anti-examples (do not produce):**

- ❌ "Refactored `UserService.authenticate()` to use the new `TokenValidator` interface" — mechanism, no consequence
- ❌ "Made 7 commits across 3 repos today" — activity report
- ❌ "I worked on the auth bug and then started looking at the webhook code" — narrative
- ❌ "Let me know if you want more detail!" — pleasantry
- ❌ "Implemented a solution that addresses the issue with..." — verbose verb, drop "a solution that addresses the issue with"

Unknown consequence → state neutrally, don't invent: "Auth token storage refactored — prep for SSO".

WIP/drafted clearly marked: "Drafted ...", "WIP pushed: ...".

## Step 8: Notes section (only if needed)

**Outside** the fenced paste-block. After the closing fence.

Add a single line if either:

- Repos skipped (no `user.email`): `Skipped: <repo1>, <repo2>.`
- PM tool present but couldn't filter to `--user` target: already reflected in metadata as `PM: linear (skipped)`. Don't repeat.

Skip the notes zone entirely if nothing applies. PM not connected, gap detection fallback, scope already in metadata — all silent here.

**Never list "quiet" repos** — the user knows what isn't in scope. Don't enumerate `repo-a, repo-b, repo-c` as "no activity".

Nothing else. No "let me know", no follow-up offers.

## Rules

- **Brief over complete.** If in doubt, drop the bullet.
- **Consequence over mechanism.** Always.
- **Never invent.** If you don't know the impact, say so neutrally or omit.
- **Respect identity per repo.** Mixed work/personal email setups are common; never assume one global identity.
- **Tolerate missing tools.** `gh` absent, no MCP PM tool, no commits in 72h — all are valid states. Degrade gracefully, don't error out.
- **Output is the deliverable.** No preamble, no "Here's your recap:", no closing line. The user copies, pastes, edits — that's the whole interaction.
