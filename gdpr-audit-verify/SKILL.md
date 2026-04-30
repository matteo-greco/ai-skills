---
name: gdpr-audit-verify
description: Verify an external GDPR / TDDDG / ePrivacy audit report for one or more websites you control. Independently reproduces each claim in a real browser, classifies it as confirmed / partial / non-issue, and maps it to the relevant rule (TDDDG § 25, GDPR Art 6, CJEU case law).
user-invocable: true
argument-hint: "[path to audit PDF/email, or paste claims inline]"
---

# GDPR Audit Verify

Verify an external privacy audit (lawyer, regulator, consumer association, compliance tool) against sites the user controls. Two questions per claim: **does it happen?** (technical) and **if so, what rule does it break?** (legal).

External-audit verification only — not preemptive self-audit. Someone is already making claims; the job is to check them before responding.

**Brevity throughout.** Drop articles when fragments read fine, drop hedging, drop pleasantries. Statute wording, citations, code: verbatim. Everything else: tight.

## Step 0: Preflight — browser tooling

Requires a browser-automation MCP server to reproduce each claim in a clean session. Check:

- `chrome-devtools` MCP (`mcp__chrome-devtools__*`) — preferred.
- `playwright` MCP (`mcp__playwright__*`) — acceptable fallback.

If neither: **stop**. Tell the user:

> This skill needs `chrome-devtools-mcp` or `playwright-mcp` to reproduce audit claims with full network/storage observability. Headers and PDFs aren't enough — violations show up at runtime (cookies set after JS, tracker beacons fired before consent, iframe requests aborted vs completed). Install one and re-run.

No fallback to `curl`, HAR import, or source reading. The point is runtime reproduction.

If a browser process is running on the MCP profile and the tool refuses to attach: kill the stale process and retry. Don't proceed without a working browser.

## Step 1: Parse the audit

Get the audit input from `$ARGUMENTS`:
- A path to a PDF/email/screenshot → read it.
- Pasted text → use directly.
- Empty → ask the user to provide the audit.

Extract:

1. **Request / posture** — the single most important thing to capture, and the thing most audits bury. What does the sender actually want? Frame it concretely:
   - **Counterparty type** — regulator (DPA, e.g. BfDI / Garante / CNIL), law firm acting for a client, consumer association (Verbraucherschutzverband under UWG/UKlaG), automated tool report forwarded with no demand, internal stakeholder.
   - **Deadline** — explicit "fix by date X" or implicit "respond promptly". If no deadline, say so — that's load-bearing for next-step urgency.
   - **Consequences threatened** — DPA complaint, lawsuit, Abmahnung (cease-and-desist with fee demand), public disclosure, none stated. Note "none stated" explicitly; absence of threat is a fact.
   - **Tone** — adversarial, neutral/professional, friendly/informational. Affects the reply posture (Step 6) more than the engineering work.
   - **What they expect** — fix only, fix + reply, reply only, no expectation. Quote the operative sentence if there is one.
2. **URL(s) under audit** — every domain mentioned. One audit often covers multiple sites.
3. **Per-site claims** — discrete testable assertions. Common shapes:
   - "*N* cookies set before consent: {names}"
   - "*N* localStorage keys before consent: {names}"
   - "Web beacons match {EasyPrivacy / Fanboy's / other} list"
   - "Connection to third-party host {X} before consent"
   - "Two-click solution for YouTube/Vimeo doesn't actually block the connection"
   - "Form not using HTTPS" / "No SSL"
4. **Jurisdiction invoked** — GDPR alone, or also TDDDG (DE) / LIL (FR) / Garante (IT) / DPA (UK)? Drives Step 2's case-law search. Default if unclear: **EU baseline + Germany** (strictest of common bases).
5. **Auditor's verdict per section** — "compliant" / "to be determined" / "not compliant". Track for the final report.
6. **Statutes, cases, authorities cited by name** — collect every one. Inputs for Step 2.

Capture screenshots and specific cookie values mentioned — you'll compare against your own observations.

## Step 2: Build the current legal landscape (read the actual laws)

Privacy law moves fast. Statutes get amended, CJEU rulings land every few months, DPAs supersede their own guidance. **Don't reason from memory.** Build a fresh briefing from primary sources before classifying.

Use `WebSearch` and `WebFetch` to gather, at minimum:

1. **Statutes the auditor invokes** — fetch the current consolidated text. EU + DE baseline by default:
   - GDPR (Reg 2016/679) — Art 5, 6, 7, Recital 32 carry consent.
   - ePrivacy Directive 2002/58/EC — Art 5(3) is the "no storage on device without consent" rule national laws transpose.
   - Germany: TDDDG (or its current name) — § 25 operative, § 25(1) consent rule, § 25(2) narrow exemptions.
   - Anything else the auditor names (LIL in FR, PECR + UK GDPR in UK, Garante guidance in IT, etc.).

   For each: is the name still current? Is the section number still right? Wording amended? Quote exemption text verbatim — auditors hinge claims on "strictly necessary" wording.

2. **Cases cited** — CJEU + national courts. For each: still good law? Overruled, narrowed, distinguished? Newer rulings on the same point the auditor missed? Anchor cases as starting points: Planet49 (C-673/17), Fashion ID (C-40/17), Schrems II (C-311/18), IAB Europe (C-604/22), LG München Google Fonts and progeny. Fetch and read; don't summarize from memory.

3. **Current DPA / EDPB guidance** for cited jurisdictions — EDPB guidelines on consent and cookies, German DSK position papers (esp. YouTube embeds, GA4), CNIL deliberations, recent Garante decisions. Regulators' current reading shifts faster than the statutes.

4. **Live behavior of trackers / CMPs / services** named in the audit — search for current data-handling docs and any DPA action. Endpoints rebrand; pattern-matching on URLs misses things.

Write the briefing as compact notes — quoted statute text, case holdings one line each with citations, current DPA positions, current tracker behaviour. This is the lens for Step 4. **If a search fails, say so explicitly** — don't fall back on cached knowledge silently.

## Step 3: Reproduce each site in a clean browser session

For every URL, fresh isolated context (no shared cookies/storage):

```
new_page(url, isolatedContext=<site-key>)
```

**Immediately after page load, before any interaction**, snapshot:

```javascript
() => {
  const cookies = document.cookie ? document.cookie.split('; ').map(c => {
    const idx = c.indexOf('=');
    return { name: c.substring(0, idx), valuePreview: c.substring(idx+1, idx+1+50) };
  }) : [];
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    ls[k] = (localStorage.getItem(k) || '').substring(0, 100);
  }
  const ss = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    ss[k] = (sessionStorage.getItem(k) || '').substring(0, 100);
  }
  return { cookies, localStorage: ls, sessionStorage: ss, url: location.href };
}
```

Then `list_network_requests` for the full log. For any POST or third-party request that looks like tracking, fetch the body with `get_network_request` — that's where the smoking gun lives (visitor IDs, page URLs, UA shipped to tracker endpoints).

`document.cookie` only sees non-httpOnly cookies; read `set-cookie` response headers on the main document to catch httpOnly ones (`__cf_bm`, `PHPSESSID`, etc.).

**Note GeoIP** — banners change by region. An Italy test won't reproduce a Germany-only flow. State the test region in the report.

## Step 4: Classify each claim

Two dimensions, using Step 2's legal briefing as the lens.

**Verification** — what reproduction showed:
- **Confirmed (live)** — observed in runtime, matches the auditor.
- **Confirmed (latent)** — not directly observed because the trigger condition wasn't met (affiliate cookie that needs `?aff=`, cart cookie that needs add-to-cart, etc.), but verified via plugin/service code, config, or vendor docs. State the trigger.
- **Partial** — some aspects confirmed, others not.
- **Could not reproduce** — claim doesn't hold (note env/region differences before declaring this).
- **Auditor missed it** — found something worse than what they listed.

Distinguish **claims** (testable assertions: "cookie X set before consent") from **open questions** the auditor raised but did not turn into verdicts ("What's this cookie for?" / "Was machen die Beacons?"). Open questions are not claims to push back on — they're prompts for the privacy notice / cookie register. Route them to the documentation track in Step 5, not to "push back".

**Legal classification** — how serious if confirmed, judged against Step 2's briefing:
- **Clear violation** — rule unambiguous, case law settled.
- **Defensible** — credible exemption or accepted practice (cite).
- **Borderline** — rule applies but case law mixed, or technical detail on the line (e.g. iframe aborted vs completed).
- **Non-issue** — flagged but not actually a rule (e.g. `__cf_bm` flagged as tracker; rhetorical questions presented as findings).

For each, cite the statute / case / guidance from Step 2's notes — not memory.

### Cookie / storage starter heuristics

*Starting* heuristics, not facts. Verify against current DPA guidance before relying. **Structural rule first**: any persistent identifier (UUID, hash, sequence) capable of re-identifying a returning visitor is presumptively non-essential and consent-required, regardless of name.

| Pattern | Common reading | Notes |
|---|---|---|
| `__cf_bm`, `cf_clearance`, `__Secure-*` Cloudflare challenge | Often accepted as essential | Cloudflare bot management / DDoS protection. Verify current DPA position. |
| `PHPSESSID`, `wp-settings-*`, similar server-session cookies | Conditional | Stronger on transactional/login pages, weaker on pure marketing pages. |
| CMP state cookies (`uc_*`, `OptanonConsent`, `cookielawinfo-*`, `CookieConsent`, etc.) | Generally accepted as essential | The CMP can't function without remembering interaction state + UI version. Confirm your specific CMP's storage is minimal. |
| CMP geo-IP cookies (`tu-geoip-*` and similar) | Defensible | Needed for region-aware banner logic. Best practice: in-memory, not persisted. |
| Persistent `*_visitor_id`, `*_visit_id`, `_ga`, `_gid`, `_fbp` | Presumptively non-essential | Persistent identifier ⇒ consent required. |
| Affiliate cookies (`swpext*`, `_aff*`, `sc_click_id`) | Presumptively non-essential | Commercial tracking. Consent required. |
| Any cookie/localStorage key with a UUID or hashed ID as value, persistent for >session | Presumptively non-essential | Treat as consent-required absent strong evidence to the contrary. |

### Tracker detection — structural first, fingerprints second

Matching only on known URLs misses everything. Services rebrand, change endpoints, self-host. **Detect structurally**:

> Any cross-origin (or first-party-subdomain) **POST** whose body contains both a persistent identifier (UUID, hash, sequence) **and** page metadata (URL / title / referrer / UA / screen size) is presumptively a tracker, regardless of host.

Once found: look up the service's category (analytics / marketing / session-replay / error monitoring) and current legal posture for the jurisdiction. Fetch its docs, check for DPA action. Don't classify from name recognition.

Anchor names as starting points — endpoints, behaviour, legal status all need confirming at invocation time:

- Marketing / customer comms: Bento, Klaviyo, ActiveCampaign, Mailchimp pixel, HubSpot.
- Web analytics: GA / GTM, Adobe Analytics, Matomo, Plausible, Fathom, Usermaven, Simple Analytics, Pirsch.
- Ads / retargeting: Google Ads, Meta Pixel, TikTok Pixel, LinkedIn Insight, Microsoft UET, Pinterest, Reddit, X/Twitter.
- Session replay: Clarity, Hotjar, FullStory, Mouseflow, LogRocket.
- Product analytics / CDP: Segment, RudderStack, Amplitude, Mixpanel, PostHog, Heap.
- Error / RUM: Sentry, Bugsnag, Datadog RUM, New Relic Browser, Rollbar.
- Affiliate: AffiliateWP, SureCart Affiliates, Refersion, Impact, ShareASale, Rewardful.

Cookieless strict-mode analytics and PII-free error monitoring can be defensible under legitimate interests in some jurisdictions; most can't. **Confirm each against current DPA guidance.**

### YouTube / video embed verification

Audits often claim "two-click solution doesn't work — YouTube contacted anyway." To verify:

1. Check whether the iframe `src` in the rendered DOM points directly at `youtube.com` / `vimeo.com`, or at a placeholder (`about:blank`, data URI, internal route).
2. Check the network log for requests to `www.youtube.com/embed/*` (or `player.vimeo.com/*`, etc.):
   - `200` with response = full leak. Clear violation.
   - `ERR_ABORTED` after request queued = browser tried, CMP intercept (e.g. Usercentrics `uc-block.bundle.js`) cancelled. **Borderline** — exfil near-zero, but strict readings (Google-Fonts line) can still find a violation since the request was initiated. Recommend the click-to-load placeholder pattern (iframe src not set until click).
3. Look for privacy-proxy patterns (e.g. `privacy-proxy-server.usercentrics.eu/video/youtube/...-poster-image`) — poster served via proxy is the right architecture.

Check Step 2 for the *current* DSK / regulator position; don't assume the "two-click" doctrine is unchanged.

## Step 5: Output

Plain markdown. Output goes to a human (and possibly to a wrapper bot/email tool downstream).

**Brevity is load-bearing.** Drop articles when fragments read fine. Drop hedging ("perhaps", "it seems"). Drop pleasantries. Cut adjectives that don't carry weight. A CTO opens this and decides what to do — every word that isn't pulling weight is friction. Code, citations, statute wording: keep verbatim. Otherwise: tight.

**Section order matters.** Most audit reports bury the action in a wall of methodology. Invert it:

1. **Request** — what does the doc ask for, by when, with what consequence. Top of the page.
2. **Findings** — bottom-line summary first, then per-site detail.
3. **Next steps** — color-coded fixes, decisions needed, external response, regression prevention.
4. **Method + legal framework** — at the bottom as FYI; reproducibility, not action.

**Other rules**: no ANSI colors, no emoji (except the three traffic-light tokens in next-steps), state test environment (region, browser version, date).

Format:

```markdown
# GDPR Audit Verification — <date>

## Request

- **From**: <name + role; "automated tool, no counterparty" if applicable>
- **Counterparty type**: <regulator | law firm | consumer association | tool report | internal>
- **Deadline**: <date or "none stated">
- **Consequences threatened**: <complaint to DPA / lawsuit / Abmahnung / public disclosure / none stated>
- **Tone**: <adversarial / professional / informational>
- **Expects**: <fix only / fix + reply / reply only / no expectation> — <quote the operative sentence if there is one>

<One-line read on what the user owes and to whom. E.g. "Lawyer for client X; no deadline, no threat, professional tone — fixes recommended; reply expected but not urgent.">

---

## Findings

**Verdict on auditor's report**: <Holds up / Partially holds / Overstated / Misses the real issue>. <One sentence on the single most material item.>

Use a **single global numbering** for next-step references (`[N1]`, `[N2]`, …) — IDs are unique across the entire report, not per-site. If the same fix applies to multiple sites, give it one ID and list the affected sites inside the next-step block.

**Confirmed and material**:
- [N1] <claim — affects: site-a, site-b>
- ...

**Confirmed but defensible / thin**:
- [N2] <claim — note the nuance>
- ...

**Push back**:
- <claim — why; no next step>
- ...

**Auditor's open questions** (not claims — prompts for the documentation track):
- <question — what answers it: privacy-notice entry, cookie register, etc.>
- ...

**Auditor missed**:
- [N3] <finding — user decides whether to self-disclose>
- ...

### Per site

#### <site 1> — auditor verdict: <NOT compliant | partially | compliant>

| Finding | Verified? | Legal class |
|---|---|---|
| <claim — name cookie/URL/payload> | <Confirmed live / Confirmed latent (trigger: …) / Partial / No / Missed by auditor — evidence in 1 line> | <Clear violation / Defensible / Borderline / Non-issue — cite TDDDG § 25(1) / Art 6 / case> |
| ... | ... | ... |

<One line. Verdict hold? Single material item? Skip if obvious from the table.>

#### <site 2> — ...

(repeat)

---

## Next steps

Color-code each item with a single token at the front:

- 🔴 **urgent** — active, ongoing violation. Stop the bleeding.
- 🟡 **delay-OK** — confirmed issue, not bleeding. Next sprint.
- ⚪ **hardening** — borderline / defensive. Cheap improvement, not required.

T-shirt size: XS / S / M / L. **How to verify**: specific runtime check ("re-run this skill on URL X; confirm tracker Y absent from pre-consent network log").

```
🔴 [N1] <fix> — XS
   Verify: <specific re-check>

🟡 [N2] <fix> — M
   Verify: <specific re-check>

⚪ [N3] <fix> — S
   Verify: <specific re-check>
```

### External response

If the audit came from a person/firm/regulator (not a tool): one paragraph stating an external reply is awaited, what the counterparty expects, and that the engineering fixes above don't substitute for it. Don't draft the reply — Step 6 offers it.

Skip entirely for tool-generated reports with no counterparty.

### Decisions needed

Human calls required before code changes — drop service vs gate it, accept residual risk vs change vendor, scope of self-disclosure. As questions, with options and tipping factors:

- <question — call, options, what tips it each way>

### Regression prevention

One or two concrete suggestions — CI tracker-deny-list check, version-controlled cookie register, scheduled re-audit cadence.

- <suggestion>

---

## Method + legal framework (FYI)

Loaded each site in a clean Chrome profile via <chrome-devtools-mcp | playwright-mcp> from <region> on <date>. No banner interaction. Captured `document.cookie`, `localStorage`, `sessionStorage`, full network log with request/response bodies.

Legal lens: <2–4 sentences naming the rules — operative statute sections per cited jurisdiction (ePrivacy Art 5(3), GDPR Art 6/7, TDDDG § 25), most relevant case law, directly-on-point DPA guidance. Quote section numbers and case citations from Step 2's fetched primary sources, not from memory.>
```

## Step 6: Follow-up offers

End at the regression-prevention section. Skill doesn't draft replies, schedule agents, or write regression tests unprompted — but **may** add one closing one-line offer as a question.

Pick **one** by priority — don't stack:

1. **Named person/firm/regulator/lawyer** with leverage (DPA, Verbraucherschutzverband, law firm threatening complaint): *"Want me to draft a reply to the auditor based on this?"* — the reply is what the user owes someone, regardless of when fixes land.
2. **Person but informational / friendly** (colleague forwarding a tool report): *"Want me to re-verify once you've fixed [N1]?"*
3. **Tool report, no counterparty**: *"Want me to /schedule a quarterly re-audit?"*

Skip if the report is fully compliant or the user has signalled they'll handle next steps.
